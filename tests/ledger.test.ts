import { and, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { createAdjustment, postAdjustment, cancelAdjustment } from "@/domain/adjustments/commands"
import type { Actor } from "@/domain/command"
import { D } from "@/domain/decimal"
import { reverseCommand } from "@/domain/ledger/reverse"
import { reconcile } from "@/domain/ledger/reconcile"
import { onHandAsOf, stockByItem, listMoves } from "@/domain/ledger/queries"
import { archiveLocation, createLocation, expandPattern, generateBins, updateLocation } from "@/domain/locations/commands"
import { moveStock } from "@/domain/moves/commands"
import { seedProduct, seedTenant, testDb } from "./db"

let db: Db

beforeAll(async () => {
  ;({ db } = await testDb())
})

async function workspace(role = "owner") {
  const t = await seedTenant(db, role)
  const wh = await createLocation(db, t.actor, { kind: "warehouse", name: "Main warehouse", code: "main" })
  await generateBins(db, t.actor, { parentId: wh.id, pattern: "A-{01..03}" })
  const bins = await db.select().from(s.manifestLocations).where(and(eq(s.manifestLocations.tenantId, t.tenant.id), eq(s.manifestLocations.kind, "bin")))
  const bin = (code: string) => bins.find((b) => b.code === code)!
  return { ...t, wh, bin }
}

async function quant(tenantId: string, productId: string, locationId: string) {
  const [q] = await db
    .select()
    .from(s.manifestQuants)
    .where(and(eq(s.manifestQuants.tenantId, tenantId), eq(s.manifestQuants.productId, productId), eq(s.manifestQuants.locationId, locationId)))
  return q ? D(q.onHand).toNumber() : 0
}

async function valuation(tenantId: string, productId: string) {
  const [c] = await db.select().from(s.manifestItemCosts).where(and(eq(s.manifestItemCosts.tenantId, tenantId), eq(s.manifestItemCosts.productId, productId)))
  return { qty: D(c?.qty).toNumber(), value: D(c?.value).toNumber() }
}

const add = (actor: Actor, locationId: string, productId: string, qty: number, unitCost?: number, extra: Record<string, unknown> = {}) =>
  createAdjustment(db, actor, { locationId, reason: "FOUND", post: true, lines: [{ productId, qtyDelta: String(qty), unitCost: unitCost != null ? String(unitCost) : null }], ...extra })
const remove = (actor: Actor, locationId: string, productId: string, qty: number, reason = "THEFT") =>
  createAdjustment(db, actor, { locationId, reason, post: true, lines: [{ productId, qtyDelta: String(-qty) }] })

describe("locations", () => {
  it("expands bin patterns with padding and letters", () => {
    expect(expandPattern("A-{01..03}-{1..2}")).toEqual(["A-01-1", "A-01-2", "A-02-1", "A-02-2", "A-03-1", "A-03-2"])
    expect(expandPattern("{A..C}1")).toEqual(["A1", "B1", "C1"])
  })

  it("bootstraps virtual locations and builds breadcrumb paths", async () => {
    const { tenant, bin } = await workspace()
    const virtual = await db.select().from(s.manifestLocations).where(and(eq(s.manifestLocations.tenantId, tenant.id), eq(s.manifestLocations.isVirtual, true)))
    expect(virtual.map((v) => v.kind).sort()).toEqual(["adjustment", "customer", "production", "scrap", "supplier", "transit"])
    expect(bin("A-02").path).toBe("MAIN / A-02")
  })

  it("re-roots descendants when a code changes", async () => {
    const { actor, wh, tenant } = await workspace()
    await updateLocation(db, actor, { id: wh.id, code: "hq" })
    const [b] = await db.select().from(s.manifestLocations).where(and(eq(s.manifestLocations.tenantId, tenant.id), eq(s.manifestLocations.code, "A-01")))
    expect(b.path).toBe("HQ / A-01")
  })

  it("refuses duplicate codes and bins without a parent", async () => {
    const { actor } = await workspace()
    await expect(createLocation(db, actor, { kind: "warehouse", name: "Again", code: "MAIN" })).rejects.toThrow(/already used/)
    await expect(createLocation(db, actor, { kind: "bin", name: "Loose", code: "X1" })).rejects.toThrow(/inside another location/)
  })

  it("won't archive a location that holds stock", async () => {
    const { actor, tenant, wh, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    await add(actor, bin("A-01").id, p.id, 1, 1)
    await expect(archiveLocation(db, actor, { id: wh.id })).rejects.toThrow(/still holds stock/)
  })
})

describe("adjustments and the ledger", () => {
  it("posts double-entry moves, updates quants and mirrors legacy quantity", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    const res = await add(actor, bin("A-01").id, p.id, 12, 3)
    expect(res.number).toMatch(/^ADJ-0000\d\d$/)
    expect(await quant(tenant.id, p.id, bin("A-01").id)).toBe(12)
    expect(await valuation(tenant.id, p.id)).toEqual({ qty: 12, value: 36 })
    const [legacy] = await db.select().from(s.products).where(eq(s.products.id, p.id))
    expect(legacy.quantity).toBe(12)
    const moves = await listMoves(db, tenant.id, { productId: p.id })
    expect(moves).toHaveLength(1)
    expect(moves[0].fromCode).toBe("ADJUSTMENTS")
  })

  it("refuses to go below zero and writes nothing when it does", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id, { name: "Tee", sku: "TEE-BLK-M" })
    await add(actor, bin("A-01").id, p.id, 3, 1)
    await expect(remove(actor, bin("A-01").id, p.id, 5)).rejects.toThrow("TEE-BLK-M · Tee: only 3 available at A-01, tried to take 5.")
    expect(await quant(tenant.id, p.id, bin("A-01").id)).toBe(3)
    const adjustments = await db.select().from(s.manifestAdjustments).where(eq(s.manifestAdjustments.tenantId, tenant.id))
    expect(adjustments).toHaveLength(1)
  })

  it("sends damage to scrap and theft to adjustments", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    await add(actor, bin("A-01").id, p.id, 10, 1)
    await remove(actor, bin("A-01").id, p.id, 2, "DAMAGE")
    await remove(actor, bin("A-01").id, p.id, 1, "THEFT")
    const moves = await listMoves(db, tenant.id, { productId: p.id })
    expect(moves.map((m) => m.toCode)).toEqual(expect.arrayContaining(["SCRAP", "ADJUSTMENTS"]))
  })

  it("enforces reason direction", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    await expect(createAdjustment(db, actor, { locationId: bin("A-01").id, reason: "DAMAGE", post: true, lines: [{ productId: p.id, qtyDelta: "4" }] })).rejects.toThrow(/can only remove/)
  })

  it("works out the delta for counted quantities at posting time", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    await add(actor, bin("A-01").id, p.id, 15, 1)
    const draft = await createAdjustment(db, actor, { locationId: bin("A-01").id, reason: "COUNT", lines: [{ productId: p.id, countedQty: "12" }] })
    expect(draft.status).toBe("draft")
    await remove(actor, bin("A-01").id, p.id, 1) // someone takes one before the count posts: 14 on hand
    await postAdjustment(db, actor, { id: draft.id })
    expect(await quant(tenant.id, p.id, bin("A-01").id)).toBe(12)
    const [line] = await db.select().from(s.manifestAdjustmentLines).where(eq(s.manifestAdjustmentLines.adjustmentId, draft.id))
    expect([D(line.qtyBefore).toNumber(), D(line.qtyDelta).toNumber()]).toEqual([14, -2])
  })

  it("only posts or cancels drafts", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    const posted = await add(actor, bin("A-01").id, p.id, 1, 1)
    await expect(postAdjustment(db, actor, { id: posted.id })).rejects.toThrow("A posted adjustment can't be post.")
    await expect(cancelAdjustment(db, actor, { id: posted.id })).rejects.toThrow(/can't be cancel/)
  })

  it("requires a variant for products that have them", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id, { name: "Hoodie", hasVariants: true })
    await expect(add(actor, bin("A-01").id, p.id, 1)).rejects.toThrow(/has variants/)
  })

  it("rolls variant quantities up to the product", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id, { name: "Hoodie", hasVariants: true })
    const [s1, m1] = await db
      .insert(s.productVariants)
      .values([
        { tenantId: tenant.id, productId: p.id, name: "S", price: "40", sku: "HD-S" },
        { tenantId: tenant.id, productId: p.id, name: "M", price: "40", sku: "HD-M" },
      ])
      .returning()
    await createAdjustment(db, actor, {
      locationId: bin("A-01").id,
      reason: "FOUND",
      post: true,
      lines: [
        { productId: p.id, variantId: s1.id, qtyDelta: "4", unitCost: "10" },
        { productId: p.id, variantId: m1.id, qtyDelta: "6", unitCost: "10" },
      ],
    })
    const [legacy] = await db.select().from(s.products).where(eq(s.products.id, p.id))
    expect(legacy.quantity).toBe(10)
  })

  it("keeps members' inventory_levels in sync for mapped locations", async () => {
    const t = await seedTenant(db)
    const [legacyLoc] = await db.insert(s.inventoryLocations).values({ tenantId: t.tenant.id, name: "Legacy main" }).returning()
    const wh = await createLocation(db, t.actor, { kind: "warehouse", name: "Main", code: "MAIN", legacyLocationId: legacyLoc.id })
    const bin = await createLocation(db, t.actor, { kind: "bin", name: "B1", code: "B1", parentId: wh.id })
    const p = await seedProduct(db, t.tenant.id)
    await add(t.actor, bin.id, p.id, 7, 1)
    await remove(t.actor, bin.id, p.id, 2)
    const levels = await db.select().from(s.inventoryLevels).where(eq(s.inventoryLevels.productId, p.id))
    expect(levels).toHaveLength(1)
    expect(levels[0].quantityOnHand).toBe(5)
  })
})

describe("costing", () => {
  it("consumes FIFO layers oldest first", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    await add(actor, bin("A-01").id, p.id, 10, 2)
    await add(actor, bin("A-01").id, p.id, 10, 4)
    await remove(actor, bin("A-01").id, p.id, 15)
    const [out] = await listMoves(db, tenant.id, { productId: p.id })
    expect(D(out.totalCost).toNumber()).toBe(40) // 10 × 2 + 5 × 4
    expect(await valuation(tenant.id, p.id)).toEqual({ qty: 5, value: 20 })
  })

  it("uses a running average when the workspace is set to average", async () => {
    const { actor, tenant, bin } = await workspace()
    await db.update(s.manifestSettings).set({ costingMethod: "average" }).where(eq(s.manifestSettings.tenantId, tenant.id))
    const p = await seedProduct(db, tenant.id)
    await add(actor, bin("A-01").id, p.id, 10, 2)
    await add(actor, bin("A-01").id, p.id, 10, 4)
    await remove(actor, bin("A-01").id, p.id, 15)
    const [out] = await listMoves(db, tenant.id, { productId: p.id })
    expect(D(out.totalCost).toNumber()).toBe(45) // 15 × 3
    expect(await valuation(tenant.id, p.id)).toEqual({ qty: 5, value: 15 })
  })

  it("defaults unit cost to the item's current cost, then its catalog cost", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id, { costPrice: "7.50" })
    await add(actor, bin("A-01").id, p.id, 2)
    expect(await valuation(tenant.id, p.id)).toEqual({ qty: 2, value: 15 })
  })

  it("keeps value when stock only moves inside the building", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    await add(actor, bin("A-01").id, p.id, 10, 5)
    await moveStock(db, actor, { fromLocationId: bin("A-01").id, toLocationId: bin("A-02").id, lines: [{ productId: p.id, qty: "4" }] })
    expect([await quant(tenant.id, p.id, bin("A-01").id), await quant(tenant.id, p.id, bin("A-02").id)]).toEqual([6, 4])
    expect(await valuation(tenant.id, p.id)).toEqual({ qty: 10, value: 50 })
  })
})

describe("undo, idempotency, permissions and locks", () => {
  it("undoes a command with reversal moves, exactly once", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    await add(actor, bin("A-01").id, p.id, 10, 2)
    const second = await add(actor, bin("A-01").id, p.id, 5, 6)
    await reverseCommand(db, actor, { commandId: second.commandId })
    expect(await quant(tenant.id, p.id, bin("A-01").id)).toBe(10)
    expect(await valuation(tenant.id, p.id)).toEqual({ qty: 10, value: 20 }) // the 5 @ 6 layer came back out
    await expect(reverseCommand(db, actor, { commandId: second.commandId })).rejects.toThrow(/already been undone/)
    expect(await listMoves(db, tenant.id, { productId: p.id })).toHaveLength(3)
  })

  it("returns the first result when a command is replayed with the same key", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    const key = "scanner-7f3a"
    const a = await add(actor, bin("A-01").id, p.id, 3, 1, { idempotencyKey: key })
    const b = await add(actor, bin("A-01").id, p.id, 3, 1, { idempotencyKey: key })
    expect(b.id).toBe(a.id)
    expect(await quant(tenant.id, p.id, bin("A-01").id)).toBe(3)
  })

  it("checks permissions before doing anything", async () => {
    const { tenant, bin, actor } = await workspace()
    const p = await seedProduct(db, tenant.id)
    const viewer = { ...actor, role: "viewer" }
    await expect(add(viewer, bin("A-01").id, p.id, 1)).rejects.toThrow(/permission/)
    const member = { ...actor, role: "member" }
    await expect(createLocation(db, member, { kind: "warehouse", name: "X", code: "X" })).rejects.toThrow(/permission/)
  })

  it("refuses postings inside a locked period", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    await db.update(s.manifestSettings).set({ lockDate: "2026-06-30" }).where(eq(s.manifestSettings.tenantId, tenant.id))
    await expect(add(actor, bin("A-01").id, p.id, 1, 1, { occurredAt: new Date("2026-06-15T12:00:00Z") })).rejects.toThrow(/locked through 2026-06-30/)
    await expect(add(actor, bin("A-01").id, p.id, 1, 1, { occurredAt: new Date("2026-07-01T12:00:00Z") })).resolves.toBeTruthy()
  })

  it("writes an audit row and an outbox event in the same transaction", async () => {
    const { actor, tenant, bin } = await workspace()
    const p = await seedProduct(db, tenant.id)
    const res = await add(actor, bin("A-01").id, p.id, 1, 1)
    const audit = await db.select().from(s.manifestAudit).where(eq(s.manifestAudit.commandId, res.commandId))
    const events = await db.select().from(s.manifestEvents).where(eq(s.manifestEvents.commandId, res.commandId))
    expect(audit.map((a) => a.command)).toEqual(["adjustment.create"])
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["adjustment.created", "stock.changed", "adjustment.posted"]))
  })

  it("keeps workspaces apart", async () => {
    const a = await workspace()
    const b = await workspace()
    const p = await seedProduct(db, a.tenant.id)
    await expect(add(b.actor, b.bin("A-01").id, p.id, 1, 1)).rejects.toThrow(/no longer exists/)
    await expect(add(b.actor, a.bin("A-01").id, p.id, 1, 1)).rejects.toThrow(/doesn't exist in this workspace/)
  })
})

describe("invariants", () => {
  it("quants, valuation and time travel always agree with the moves", async () => {
    const { actor, tenant, bin } = await workspace()
    const items = [await seedProduct(db, tenant.id), await seedProduct(db, tenant.id), await seedProduct(db, tenant.id)]
    const bins = ["A-01", "A-02", "A-03"].map(bin)
    let seed = 42
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
    const commands: string[] = []

    for (let i = 0; i < 120; i++) {
      const p = items[rand(items.length)]
      const from = bins[rand(bins.length)]
      const to = bins[rand(bins.length)]
      const qty = 1 + rand(9)
      try {
        const op = rand(10)
        if (op < 4) commands.push((await add(actor, from.id, p.id, qty, 1 + rand(20))).commandId)
        else if (op < 7) commands.push((await remove(actor, from.id, p.id, qty, rand(2) ? "THEFT" : "DAMAGE")).commandId)
        else if (op < 9 && from.id !== to.id) commands.push((await moveStock(db, actor, { fromLocationId: from.id, toLocationId: to.id, lines: [{ productId: p.id, qty: String(qty) }] })).commandId)
        else if (commands.length) await reverseCommand(db, actor, { commandId: commands[rand(commands.length)] })
      } catch (e) {
        // Refusals (not enough stock, already undone) are expected; anything else is a bug.
        if (!(e instanceof Error) || !/available|already|nothing to undo/.test(e.message)) throw e
      }
    }

    expect(await reconcile(db, tenant.id)).toEqual([])

    const quants = await db.select().from(s.manifestQuants).where(eq(s.manifestQuants.tenantId, tenant.id))
    expect(quants.every((q) => D(q.onHand).gte(0))).toBe(true)

    const grid = await stockByItem(db, tenant.id)
    const asOfNow = await onHandAsOf(db, tenant.id, new Date(Date.now() + 1000))
    for (const row of grid) {
      const tt = asOfNow.find((r) => r.productId === row.productId)
      expect(D(tt?.onHand).toNumber()).toBe(D(row.onHand).toNumber())
    }
  })
})

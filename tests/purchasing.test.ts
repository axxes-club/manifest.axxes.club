import { and, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import type { Actor } from "@/domain/command"
import { D } from "@/domain/decimal"
import { createAdjustment } from "@/domain/adjustments/commands"
import { createLocation } from "@/domain/locations/commands"
import { reconcile } from "@/domain/ledger/reconcile"
import { reverseCommand } from "@/domain/ledger/reverse"
import {
  addLandedCost,
  createPurchaseOrder,
  receivePurchaseOrder,
  suggestedLine,
  transitionPurchaseOrder,
  updatePurchaseOrder,
} from "@/domain/purchasing/commands"
import { seedProduct, seedTenant, testDb } from "./db"

let db: Db
beforeAll(async () => {
  ;({ db } = await testDb())
})

async function setup(opts: { currency?: string } = {}) {
  const t = await seedTenant(db)
  const wh = await createLocation(db, t.actor, { kind: "warehouse", name: "Main", code: "MAIN" })
  const dock = await createLocation(db, t.actor, { kind: "bin", name: "Dock", code: "DOCK", parentId: wh.id })
  const [supplier] = await db
    .insert(s.suppliers)
    .values({ tenantId: t.tenant.id, name: "Blank Goods Co.", currency: opts.currency ?? "USD", leadTimeDays: 10 })
    .returning()
  const a = await seedProduct(db, t.tenant.id, { name: "Tee", sku: "TEE" })
  const b = await seedProduct(db, t.tenant.id, { name: "Cap", sku: "CAP" })
  return { ...t, wh, dock, supplier, a, b }
}

async function placedPo(actor: Actor, x: Awaited<ReturnType<typeof setup>>, lines = [{ p: x.a.id, qty: "10", cost: "4" }, { p: x.b.id, qty: "20", cost: "2.5" }]) {
  const po = await createPurchaseOrder(db, actor, {
    supplierId: x.supplier.id,
    destinationId: x.dock.id,
    lines: lines.map((l) => ({ productId: l.p, qtyOrdered: l.qty, unitCost: l.cost })),
  })
  await transitionPurchaseOrder(db, actor, { id: po.id, event: "place" })
  const poLines = await db.select().from(s.manifestPoLines).where(eq(s.manifestPoLines.poId, po.id))
  const line = (productId: string) => poLines.find((l) => l.productId === productId)!
  return { ...po, line }
}

const status = async (id: string) => (await db.select().from(s.manifestPurchaseOrders).where(eq(s.manifestPurchaseOrders.id, id)))[0].status
const value = async (tenantId: string, productId: string) => {
  const [c] = await db.select().from(s.manifestItemCosts).where(and(eq(s.manifestItemCosts.tenantId, tenantId), eq(s.manifestItemCosts.productId, productId)))
  return { qty: D(c?.qty).toNumber(), value: D(c?.value).toNumber() }
}

describe("purchase orders", () => {
  it("numbers orders, defaults the expected date from lead time, and places them", async () => {
    const x = await setup()
    const po = await createPurchaseOrder(db, x.actor, { supplierId: x.supplier.id, lines: [{ productId: x.a.id, qtyOrdered: "5", unitCost: "3" }] })
    expect(po.number).toBe("PO-000001")
    const [row] = await db.select().from(s.manifestPurchaseOrders).where(eq(s.manifestPurchaseOrders.id, po.id))
    expect(row.expectedOn).toBe(new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10))
    await transitionPurchaseOrder(db, x.actor, { id: po.id, event: "place" })
    expect(await status(po.id)).toBe("sent")
  })

  it("requires approval above the threshold for people who can't approve", async () => {
    const x = await setup()
    await db.update(s.manifestSettings).set({ poApprovalThreshold: "100" }).where(eq(s.manifestSettings.tenantId, x.tenant.id))
    const po = await createPurchaseOrder(db, x.actor, { supplierId: x.supplier.id, lines: [{ productId: x.a.id, qtyOrdered: "50", unitCost: "3" }] })
    const buyer = { ...x.actor, role: "member" }
    await expect(transitionPurchaseOrder(db, buyer, { id: po.id, event: "place" })).rejects.toThrow(/permission/)
    const manager = { ...x.actor, role: "manager" }
    await transitionPurchaseOrder(db, manager, { id: po.id, event: "approve" })
    await transitionPurchaseOrder(db, manager, { id: po.id, event: "send" })
    expect(await status(po.id)).toBe("sent")
  })

  it("sends an edited approved order back to draft", async () => {
    const x = await setup()
    const po = await createPurchaseOrder(db, x.actor, { supplierId: x.supplier.id, lines: [{ productId: x.a.id, qtyOrdered: "5", unitCost: "3" }] })
    await transitionPurchaseOrder(db, x.actor, { id: po.id, event: "approve" })
    const [line] = await db.select().from(s.manifestPoLines).where(eq(s.manifestPoLines.poId, po.id))
    await updatePurchaseOrder(db, x.actor, { id: po.id, supplierId: x.supplier.id, lines: [{ id: line.id, productId: x.a.id, qtyOrdered: "8", unitCost: "3" }] })
    expect(await status(po.id)).toBe("draft")
  })

  it("remembers supplier prices when an order is placed", async () => {
    const x = await setup()
    await placedPo(x.actor, x)
    const hint = await suggestedLine(db, x.tenant.id, x.supplier.id, x.a.id, null)
    expect([hint.source, hint.unitCost]).toEqual(["supplier", "4.0000"])
  })
})

describe("receiving", () => {
  it("receives in parts, values at order cost, and tracks status", async () => {
    const x = await setup()
    const po = await placedPo(x.actor, x)
    const r1 = await receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "4" }] })
    expect([r1.number, r1.status]).toEqual(["GRN-000001", "partially_received"])
    expect(await value(x.tenant.id, x.a.id)).toEqual({ qty: 4, value: 16 })
    await receivePurchaseOrder(db, x.actor, {
      poId: po.id,
      lines: [
        { poLineId: po.line(x.a.id).id, qty: "6" },
        { poLineId: po.line(x.b.id).id, qty: "20" },
      ],
    })
    expect(await status(po.id)).toBe("received")
    expect(await value(x.tenant.id, x.b.id)).toEqual({ qty: 20, value: 50 })
    expect(await reconcile(db, x.tenant.id)).toEqual([])
  })

  it("converts foreign-currency orders at the order's rate", async () => {
    const x = await setup({ currency: "EUR" })
    const po = await createPurchaseOrder(db, x.actor, {
      supplierId: x.supplier.id,
      destinationId: x.dock.id,
      exchangeRate: "1.10",
      lines: [{ productId: x.a.id, qtyOrdered: "10", unitCost: "5" }],
    })
    await transitionPurchaseOrder(db, x.actor, { id: po.id, event: "place" })
    const [line] = await db.select().from(s.manifestPoLines).where(eq(s.manifestPoLines.poId, po.id))
    await receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: line.id, qty: "10" }] })
    expect(await value(x.tenant.id, x.a.id)).toEqual({ qty: 10, value: 55 })
  })

  it("refuses over-receipts beyond tolerance unless a manager accepts them", async () => {
    const x = await setup()
    const po = await placedPo(x.actor, x)
    const member = { ...x.actor, role: "member" }
    await expect(receivePurchaseOrder(db, member, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "11" }] })).rejects.toThrow(/only 10 is outstanding/)
    await expect(receivePurchaseOrder(db, member, { poId: po.id, allowOver: true, lines: [{ poLineId: po.line(x.a.id).id, qty: "11" }] })).rejects.toThrow(/only 10/)
    await db.update(s.manifestSettings).set({ overReceiptPct: "10" }).where(eq(s.manifestSettings.tenantId, x.tenant.id))
    await expect(receivePurchaseOrder(db, member, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "11" }] })).resolves.toBeTruthy()
    await expect(receivePurchaseOrder(db, x.actor, { poId: po.id, allowOver: true, lines: [{ poLineId: po.line(x.a.id).id, qty: "5" }] })).resolves.toBeTruthy()
  })

  it("can receive into quarantine, which isn't available", async () => {
    const x = await setup()
    const po = await placedPo(x.actor, x)
    await receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "3", quarantine: true }] })
    const quants = await db.select().from(s.manifestQuants).where(eq(s.manifestQuants.productId, x.a.id))
    expect(quants.map((q) => [q.status, D(q.onHand).toNumber()])).toEqual([["quarantine", 3]])
    const [legacy] = await db.select().from(s.products).where(eq(s.products.id, x.a.id))
    expect(legacy.quantity).toBe(0)
  })

  it("protects received history when an order is edited", async () => {
    const x = await setup()
    const po = await placedPo(x.actor, x)
    await receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "6" }] })
    const base = { id: po.id, supplierId: x.supplier.id }
    const a = po.line(x.a.id)
    const b = po.line(x.b.id)
    await expect(updatePurchaseOrder(db, x.actor, { ...base, lines: [{ id: b.id, productId: x.b.id, qtyOrdered: "20", unitCost: "2.5" }] })).rejects.toThrow(/can't be removed/)
    await expect(updatePurchaseOrder(db, x.actor, { ...base, lines: [{ id: a.id, productId: x.a.id, qtyOrdered: "5", unitCost: "4" }, { id: b.id, productId: x.b.id, qtyOrdered: "20", unitCost: "2.5" }] })).rejects.toThrow(/can't be less than that/)
    await expect(updatePurchaseOrder(db, x.actor, { ...base, lines: [{ id: a.id, productId: x.a.id, qtyOrdered: "10", unitCost: "9" }, { id: b.id, productId: x.b.id, qtyOrdered: "20", unitCost: "2.5" }] })).rejects.toThrow(/cost is fixed/)
    // Cutting the order to what arrived and dropping the unreceived line completes it.
    await updatePurchaseOrder(db, x.actor, { ...base, lines: [{ id: a.id, productId: x.a.id, qtyOrdered: "6", unitCost: "4" }] })
    expect(await status(po.id)).toBe("received")
  })

  it("undoes a receipt: stock, valuation and the order all roll back", async () => {
    const x = await setup()
    const po = await placedPo(x.actor, x)
    await receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "10" }] })
    const r = await receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: po.line(x.b.id).id, qty: "20" }] })
    expect(await status(po.id)).toBe("received")
    await reverseCommand(db, x.actor, { commandId: r.commandId })
    expect(await status(po.id)).toBe("partially_received")
    expect(await value(x.tenant.id, x.b.id)).toEqual({ qty: 0, value: 0 })
    const [line] = await db.select().from(s.manifestPoLines).where(eq(s.manifestPoLines.id, po.line(x.b.id).id))
    expect(D(line.qtyReceived).toNumber()).toBe(0)
    const [receipt] = await db.select().from(s.manifestReceipts).where(eq(s.manifestReceipts.id, r.id))
    expect(receipt.status).toBe("reversed")
    expect(await reconcile(db, x.tenant.id)).toEqual([])
  })

  it("won't cancel an order that has receipts; close it instead", async () => {
    const x = await setup()
    const po = await placedPo(x.actor, x)
    await receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "1" }] })
    await expect(transitionPurchaseOrder(db, x.actor, { id: po.id, event: "cancel" })).rejects.toThrow(/can't be cancel/)
    await transitionPurchaseOrder(db, x.actor, { id: po.id, event: "close" })
    expect(await status(po.id)).toBe("closed")
    await expect(receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "1" }] })).rejects.toThrow(/closed order/)
  })
})

describe("landed costs", () => {
  it("splits by value, capitalizing what's on hand and expensing what's gone (FIFO)", async () => {
    const x = await setup()
    const po = await placedPo(x.actor, x) // A: 10 × 4 = 40, B: 20 × 2.5 = 50
    const r = await receivePurchaseOrder(db, x.actor, {
      poId: po.id,
      lines: [
        { poLineId: po.line(x.a.id).id, qty: "10" },
        { poLineId: po.line(x.b.id).id, qty: "20" },
      ],
    })
    // Half of A is sold before the freight bill arrives.
    await createAdjustment(db, x.actor, { locationId: x.dock.id, reason: "PROMO", post: true, lines: [{ productId: x.a.id, qtyDelta: "-5" }] })
    const lc = await addLandedCost(db, x.actor, { receiptId: r.id, description: "Freight", amount: "18" })
    // A's share: 18 × 40/90 = 8, half on hand → 4 capitalized, 4 expensed. B's share: 10, all on hand.
    expect([Number(lc.capitalized), Number(lc.expensed)]).toEqual([14, 4])
    expect(await value(x.tenant.id, x.a.id)).toEqual({ qty: 5, value: 24 })
    expect(await value(x.tenant.id, x.b.id)).toEqual({ qty: 20, value: 60 })
    expect(await reconcile(db, x.tenant.id)).toEqual([])
    await expect(reverseCommand(db, x.actor, { commandId: r.commandId })).rejects.toThrow(/landed costs on it/)
  })

  it("splits by quantity and accepts credits", async () => {
    const x = await setup()
    const po = await placedPo(x.actor, x)
    const r = await receivePurchaseOrder(db, x.actor, {
      poId: po.id,
      lines: [
        { poLineId: po.line(x.a.id).id, qty: "10" },
        { poLineId: po.line(x.b.id).id, qty: "20" },
      ],
    })
    await addLandedCost(db, x.actor, { receiptId: r.id, description: "Duty", amount: "30", method: "quantity" })
    await addLandedCost(db, x.actor, { receiptId: r.id, description: "Duty refund", amount: "-6", method: "quantity" })
    expect(await value(x.tenant.id, x.a.id)).toEqual({ qty: 10, value: 48 }) // 40 + 10 − 2
    expect(await value(x.tenant.id, x.b.id)).toEqual({ qty: 20, value: 66 }) // 50 + 20 − 4
  })

  it("adds to the running value under average cost", async () => {
    const x = await setup()
    await db.update(s.manifestSettings).set({ costingMethod: "average" }).where(eq(s.manifestSettings.tenantId, x.tenant.id))
    const po = await placedPo(x.actor, x, [{ p: x.a.id, qty: "10", cost: "4" }])
    const r = await receivePurchaseOrder(db, x.actor, { poId: po.id, lines: [{ poLineId: po.line(x.a.id).id, qty: "10" }] })
    await addLandedCost(db, x.actor, { receiptId: r.id, description: "Freight", amount: "5" })
    expect(await value(x.tenant.id, x.a.id)).toEqual({ qty: 10, value: 45 })
  })
})

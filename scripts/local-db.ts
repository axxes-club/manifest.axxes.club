/**
 * Local development database: a real Postgres (PGlite) on disk, speaking the
 * wire protocol on 127.0.0.1:5499, so you can run Manifest end to end without
 * touching the shared AXXES database.
 *
 *   npm run db:local           start (seeds a demo workspace on first run)
 *   npm run db:local -- --reset  wipe and re-seed
 *
 * Then run the app with:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5499/postgres npm run dev
 * and sign in as demo@manifest.local / manifest-demo.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { hashPassword } from "better-auth/crypto"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import * as schema from "../src/lib/db/schema"
import type { Db } from "../src/lib/db"
import type { Actor } from "../src/domain/command"
import { createAdjustment } from "../src/domain/adjustments/commands"
import { createItem } from "../src/domain/catalog/commands"
import { createLocation, generateBins } from "../src/domain/locations/commands"
import { moveStock } from "../src/domain/moves/commands"
import { addLandedCost, createPurchaseOrder, receivePurchaseOrder, transitionPurchaseOrder } from "../src/domain/purchasing/commands"
import { applySchema } from "./schema"

const DIR = ".local/pgdata"
const PORT = Number(process.env.PORT ?? 5499)

async function main() {
  if (process.argv.includes("--reset") && existsSync(DIR)) rmSync(DIR, { recursive: true })
  const fresh = !existsSync(DIR)
  mkdirSync(".local", { recursive: true })
  const client = new PGlite(DIR)
  await client.waitReady
  if (fresh) {
    console.log("Creating schema…")
    await applySchema(client)
    console.log("Seeding demo workspace…")
    await seed(drizzle(client, { schema }) as unknown as Db)
  }
  const server = new PGLiteSocketServer({ db: client, port: PORT, host: "127.0.0.1", maxConnections: 8 })
  await server.start()
  console.log(`\nLocal Postgres ready on 127.0.0.1:${PORT}`)
  console.log(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`)
  console.log("Sign in: demo@manifest.local / manifest-demo\n")
  const stop = async () => (await server.stop(), await client.close(), process.exit(0))
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
}

const daysAgo = (d: number, hour = 10) => {
  const t = new Date(Date.now() - d * 86400000)
  t.setHours(hour, Math.floor(Math.random() * 60), 0, 0)
  return t
}

async function seed(db: Db) {
  const userId = "demo-user"
  await db.insert(schema.user).values({ id: userId, name: "Dana Rivera", email: "demo@manifest.local", emailVerified: true })
  await db.insert(schema.account).values({ id: "demo-account", accountId: userId, providerId: "credential", userId, password: await hashPassword("manifest-demo") })

  const [brand] = await db.insert(schema.tenants).values({ name: "Night Shift Supply Co.", slug: "night-shift", type: "brand", ownerId: userId, status: "active" }).returning()
  const [venue] = await db.insert(schema.tenants).values({ name: "Lot 9", slug: "lot-9", type: "venue", ownerId: userId, status: "active" }).returning()
  await db.insert(schema.tenantMemberships).values([
    { tenantId: brand.id, userId, role: "owner", isPrimary: true },
    { tenantId: venue.id, userId, role: "manager", isPrimary: false },
  ])
  const actor: Actor = { tenantId: brand.id, userId, role: "owner" }

  // Where things live
  const main = await createLocation(db, actor, { kind: "warehouse", name: "Main warehouse", code: "MAIN" })
  await generateBins(db, actor, { parentId: main.id, pattern: "A-{01..06}" })
  await generateBins(db, actor, { parentId: main.id, pattern: "B-{01..04}" })
  const lot9 = await createLocation(db, actor, { kind: "venue", name: "Lot 9 merch booth", code: "LOT9" })
  await generateBins(db, actor, { parentId: lot9.id, pattern: "BOOTH-{1..2}" })
  await createLocation(db, actor, { kind: "popup", name: "Riverside Market", code: "RIVER" })
  await createLocation(db, actor, { kind: "vehicle", name: "Sprinter van", code: "VAN1" })
  const bins = Object.fromEntries(
    (await db.select().from(schema.manifestLocations).where(eq(schema.manifestLocations.tenantId, brand.id))).map((l) => [l.code, l.id]),
  )

  // What they stock
  const tee = await createItem(db, actor, { name: "Logo tee", sku: "TEE", price: "32", costPrice: "7.40", reorderPoint: "12", options: { Size: ["S", "M", "L"], Color: ["Black", "Bone"] } })
  const hoodie = await createItem(db, actor, { name: "Heavyweight hoodie", sku: "HD", price: "78", costPrice: "24", reorderPoint: "6", options: { Size: ["M", "L"] } })
  const simple = [
    { name: "Dad cap", sku: "CAP-01", price: "28", costPrice: "5.10", reorderPoint: "15", qty: 60, bin: "A-03" },
    { name: "Enamel mug", sku: "MUG-01", price: "18", costPrice: "4.25", reorderPoint: "20", qty: 48, bin: "A-04" },
    { name: "Canvas tote", sku: "TOTE-01", price: "22", costPrice: "3.80", reorderPoint: "10", qty: 35, bin: "A-05" },
    { name: "Poster set (3)", sku: "POST-01", price: "40", costPrice: "9.00", reorderPoint: "8", qty: 14, bin: "B-01" },
    { name: "Sticker pack", sku: "STK-01", price: "6", costPrice: "0.65", reorderPoint: "100", qty: 400, bin: "B-02" },
    { name: "Vinyl LP — Night Shift Vol. 1", sku: "LP-001", price: "30", costPrice: "11.50", reorderPoint: "10", qty: 25, bin: "B-03" },
  ]
  const ids: Record<string, { productId: string; variantId: string | null }> = {}
  for (const s of simple) {
    const r = await createItem(db, actor, { name: s.name, sku: s.sku, price: s.price, costPrice: s.costPrice, reorderPoint: s.reorderPoint })
    ids[s.sku] = { productId: r.id, variantId: null }
  }
  for (const v of await db.select().from(schema.productVariants).where(eq(schema.productVariants.tenantId, brand.id))) {
    ids[v.sku!] = { productId: v.productId, variantId: v.id }
  }

  // Opening balances, 60 days ago
  const teeSkus = Object.keys(ids).filter((k) => k.startsWith("TEE-"))
  await createAdjustment(db, actor, {
    kind: "opening",
    reason: "OPENING",
    locationId: bins["A-01"],
    occurredAt: daysAgo(60),
    post: true,
    note: "Go-live stock take",
    lines: teeSkus.map((sku) => ({ ...ids[sku], qtyDelta: String(30 + Math.floor(Math.random() * 30)), unitCost: "7.40" })),
  })
  await createAdjustment(db, actor, {
    kind: "opening",
    reason: "OPENING",
    locationId: bins["A-02"],
    occurredAt: daysAgo(60),
    post: true,
    lines: ["HD-M", "HD-L"].map((sku) => ({ ...ids[sku], qtyDelta: "24", unitCost: "24" })),
  })
  for (const s of simple) {
    await createAdjustment(db, actor, { kind: "opening", reason: "OPENING", locationId: bins[s.bin], occurredAt: daysAgo(60), post: true, lines: [{ ...ids[s.sku], qtyDelta: String(s.qty), unitCost: s.costPrice }] })
  }

  // Sixty days of life: restocks at new costs, events, damage, samples.
  const sellable = [...teeSkus, "HD-M", "HD-L", ...simple.map((s) => s.sku)]
  const home = (sku: string) => (sku.startsWith("TEE-") ? "A-01" : sku.startsWith("HD-") ? "A-02" : simple.find((s) => s.sku === sku)!.bin)
  for (let d = 58; d > 0; d -= 1 + Math.floor(Math.random() * 3)) {
    const sku = sellable[Math.floor(Math.random() * sellable.length)]
    const roll = Math.random()
    try {
      if (roll < 0.55) {
        await createAdjustment(db, actor, { reason: "PROMO", locationId: bins[home(sku)], occurredAt: daysAgo(d, 21), post: true, note: "Event sell-through", lines: [{ ...ids[sku], qtyDelta: String(-(2 + Math.floor(Math.random() * 8))) }] })
      } else if (roll < 0.75) {
        const base = Number(simple.find((s) => s.sku === sku)?.costPrice ?? (sku.startsWith("HD") ? 24 : 7.4))
        await createAdjustment(db, actor, { reason: "FOUND", locationId: bins[home(sku)], occurredAt: daysAgo(d, 9), post: true, note: "Restock from supplier", lines: [{ ...ids[sku], qtyDelta: String(10 + Math.floor(Math.random() * 20)), unitCost: (base * (0.95 + Math.random() * 0.15)).toFixed(2) }] })
      } else if (roll < 0.87) {
        await createAdjustment(db, actor, { reason: "DAMAGE", locationId: bins[home(sku)], occurredAt: daysAgo(d, 14), post: true, note: "Misprint", lines: [{ ...ids[sku], qtyDelta: "-1" }] })
      } else {
        await createAdjustment(db, actor, { reason: "SAMPLE", locationId: bins[home(sku)], occurredAt: daysAgo(d, 16), post: true, note: "Influencer seeding", lines: [{ ...ids[sku], qtyDelta: "-2" }] })
      }
    } catch {
      // Not enough stock for that one; life goes on.
    }
  }

  // Stock staged at the venue booth, a couple of items running low, and a draft waiting for review.
  await moveStock(db, actor, { fromLocationId: bins["A-03"], toLocationId: bins["BOOTH-1"], lines: [{ ...ids["CAP-01"], qty: "12" }] })
  await moveStock(db, actor, { fromLocationId: bins["A-04"], toLocationId: bins["BOOTH-1"], lines: [{ ...ids["MUG-01"], qty: "10" }] })
  await createAdjustment(db, actor, { reason: "PROMO", locationId: bins["B-01"], post: true, note: "Gallery night", lines: [{ ...ids["POST-01"], qtyDelta: "-9" }] })
  await createAdjustment(db, actor, { reason: "COUNT", locationId: bins["B-03"], note: "Weekly count, needs review", lines: [{ ...ids["LP-001"], countedQty: "19" }] })

  // Purchasing: a blank supplier and a print shop, orders in every state.
  const [blanks, printer] = await db
    .insert(schema.suppliers)
    .values([
      { tenantId: brand.id, name: "Blank Goods Co.", email: "orders@blankgoods.example", currency: "USD", leadTimeDays: 12, paymentTerms: "Net 30", city: "Los Angeles", state: "CA" },
      { tenantId: brand.id, name: "Taller Serigráfico", email: "hola@taller.example", currency: "MXN", leadTimeDays: 21, paymentTerms: "50% upfront", city: "Guadalajara", country: "MX" },
    ])
    .returning()
  const po = async (supplierId: string, lines: [string, string, string][], extra: Record<string, unknown> = {}) =>
    createPurchaseOrder(db, actor, { supplierId, destinationId: bins["A-06"], lines: lines.map(([sku, q, c]) => ({ ...ids[sku], qtyOrdered: q, unitCost: c })), ...extra })
  const lineIds = async (poId: string) => Object.fromEntries((await db.select().from(schema.manifestPoLines).where(eq(schema.manifestPoLines.poId, poId))).map((l) => [l.productId + (l.variantId ?? ""), l.id]))
  const key = (sku: string) => ids[sku].productId + (ids[sku].variantId ?? "")

  const done = await po(blanks.id, [["CAP-01", "60", "5.05"], ["TOTE-01", "40", "3.75"]])
  await transitionPurchaseOrder(db, actor, { id: done.id, event: "place" })
  let l = await lineIds(done.id)
  const grn = await receivePurchaseOrder(db, actor, { poId: done.id, reference: "PS-88121", receivedAt: daysAgo(9), lines: [{ poLineId: l[key("CAP-01")], qty: "60" }, { poLineId: l[key("TOTE-01")], qty: "40" }] })
  await addLandedCost(db, actor, { receiptId: grn.id, description: "UPS freight", amount: "42.50" })

  const partial = await po(printer.id, [["POST-01", "40", "150"], ["STK-01", "500", "9"]], { exchangeRate: "0.058", expectedOn: daysAgo(-1).toISOString().slice(0, 10) })
  await transitionPurchaseOrder(db, actor, { id: partial.id, event: "place" })
  l = await lineIds(partial.id)
  await receivePurchaseOrder(db, actor, { poId: partial.id, receivedAt: daysAgo(2), lines: [{ poLineId: l[key("POST-01")], qty: "25" }] })

  const late = await po(blanks.id, [["TEE-M-BLACK", "48", "7.10"], ["TEE-L-BLACK", "36", "7.10"], ["HD-L", "24", "23.50"]], { expectedOn: daysAgo(3).toISOString().slice(0, 10) })
  await transitionPurchaseOrder(db, actor, { id: late.id, event: "place" })
  await po(blanks.id, [["MUG-01", "72", "4.10"]], { note: "Matte black, same as last run." })

  await db.update(schema.manifestSettings).set({ onboardedAt: new Date() }).where(eq(schema.manifestSettings.tenantId, brand.id))
  console.log(`Seeded ${Object.keys(ids).length} stockable items in "${brand.name}" (${tee.variants + hoodie.variants} variants).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

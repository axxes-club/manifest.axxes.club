import { and, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { createItem, updateItem } from "@/domain/catalog/commands"
import { commitOpening, detectMapping, parseCsv, previewOpening, toRows } from "@/domain/imports/opening"
import { createLocation } from "@/domain/locations/commands"
import { stockByItem } from "@/domain/ledger/queries"
import { reconcile } from "@/domain/ledger/reconcile"
import { seedTenant, testDb } from "./db"

let db: Db
beforeAll(async () => {
  ;({ db } = await testDb())
})

describe("catalog", () => {
  it("creates a variant matrix with derived SKUs and profiles", async () => {
    const { actor, tenant } = await seedTenant(db)
    const res = await createItem(db, actor, { name: "Logo tee", sku: "tee", price: "30", costPrice: "8.5", options: { Size: ["S", "M"], Color: ["Black", "Bone"] } })
    expect(res.variants).toBe(4)
    const variants = await db.select().from(s.productVariants).where(eq(s.productVariants.productId, res.id))
    expect(variants.map((v) => v.sku).sort()).toEqual(["TEE-M-BLACK", "TEE-M-BONE", "TEE-S-BLACK", "TEE-S-BONE"])
    const profiles = await db.select().from(s.manifestItemProfiles).where(eq(s.manifestItemProfiles.tenantId, tenant.id))
    expect(profiles).toHaveLength(4)
  })

  it("rejects duplicate SKUs, case-insensitively", async () => {
    const { actor } = await seedTenant(db)
    await createItem(db, actor, { name: "Cap", sku: "CAP-1" })
    await expect(createItem(db, actor, { name: "Other cap", sku: "cap-1" })).rejects.toThrow(/already used/)
  })

  it("updates details and reorder settings without touching quantity", async () => {
    const { actor, tenant } = await seedTenant(db)
    const { id } = await createItem(db, actor, { name: "Tote", sku: "TOTE" })
    await updateItem(db, actor, { productId: id, name: "Canvas tote", reorderPoint: "12" })
    const [p] = await db.select().from(s.products).where(eq(s.products.id, id))
    const [profile] = await db.select().from(s.manifestItemProfiles).where(and(eq(s.manifestItemProfiles.tenantId, tenant.id), eq(s.manifestItemProfiles.productId, id)))
    expect([p.name, p.quantity, profile.reorderPoint]).toEqual(["Canvas tote", 0, "12.0000"])
  })
})

describe("opening balance import", () => {
  const csv = [
    "SKU,Item name,Location,On hand,Unit cost,Price",
    'TEE-1,"Tee, black",A1,10,$4.00,25',
    "TEE-1,,A2,5,4,",
    "MUG-1,Mug,A1,3,2.5,12",
    "BAD-1,Thing,ZZ,1,1,1",
    "TEE-1,,A1,2,4,",
    "NEG-1,Neg,A1,-4,1,1",
  ].join("\n")

  it("parses quoted CSV and maps loose column names", () => {
    const table = parseCsv(csv)
    expect(table[1]).toEqual(["TEE-1", "Tee, black", "A1", "10", "$4.00", "25"])
    expect(detectMapping(table[0])).toEqual({ sku: 0, name: 1, location: 2, qty: 3, unitCost: 4, price: 5 })
  })

  it("previews row by row, then commits atomically as opening adjustments", async () => {
    const { actor, tenant } = await seedTenant(db)
    const wh = await createLocation(db, actor, { kind: "warehouse", name: "Main", code: "MAIN" })
    await createLocation(db, actor, { kind: "bin", name: "A1", code: "A1", parentId: wh.id })
    await createLocation(db, actor, { kind: "bin", name: "A2", code: "A2", parentId: wh.id })
    const table = parseCsv(csv)
    const rows = toRows(table, detectMapping(table[0]))

    const preview = await previewOpening(db, tenant.id, rows, { createMissing: true })
    expect(preview.map((r) => [r.row, r.status, r.problem ?? ""])).toEqual([
      [2, "create", ""],
      [3, "create", ""],
      [4, "create", ""],
      [5, "skip", "No location with code ZZ"],
      [6, "skip", "Same SKU and location as an earlier row"],
      [7, "skip", "Opening quantities can't be negative"],
    ])

    const res = await commitOpening(db, actor, { rows, createMissing: true })
    expect(res).toMatchObject({ imported: 3, itemsCreated: 2, documents: ["OPN-000001", "OPN-000002"] })
    expect(res.skipped).toHaveLength(3)

    const grid = await stockByItem(db, tenant.id)
    const tee = grid.find((g) => g.sku === "TEE-1")!
    expect([Number(tee.onHand), Number(tee.unitCost)]).toEqual([15, 4])
    expect(await reconcile(db, tenant.id)).toEqual([])
  })
})

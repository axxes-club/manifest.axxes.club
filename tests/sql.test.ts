import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { outer } from "@/lib/db/sql"
import { seedProduct, seedTenant, testDb } from "./db"

let db: Db
beforeAll(async () => {
  ;({ db } = await testDb())
})

describe("correlated subqueries", () => {
  it("outer() keeps the reference on the outer row in single-table selects", async () => {
    const { tenant } = await seedTenant(db)
    const p = await seedProduct(db, tenant.id, { hasVariants: true })
    await db.insert(s.productVariants).values([
      { tenantId: tenant.id, productId: p.id, price: "1", name: "A" },
      { tenantId: tenant.id, productId: p.id, price: "1", name: "B" },
    ])
    const where = eq(s.products.id, p.id)
    const [naive] = await db
      .select({ n: sql<number>`(SELECT count(*) FROM ${s.productVariants} v WHERE v.product_id = ${s.products.id})::int` })
      .from(s.products)
      .where(where)
    const [fixed] = await db
      .select({ n: sql<number>`(SELECT count(*) FROM ${s.productVariants} v WHERE v.product_id = ${outer(s.products.id)})::int` })
      .from(s.products)
      .where(where)
    expect(naive.n).toBe(0) // "id" bound to v.id: the bug
    expect(fixed.n).toBe(2)
  })
})

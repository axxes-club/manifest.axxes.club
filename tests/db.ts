import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { applySchema } from "../scripts/schema"
import type { Db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import type { Actor } from "@/domain/command"

/**
 * A throwaway Postgres (PGlite, in-process) with the shared AXXES tables
 * created from their Drizzle definitions and Manifest's own tables created by
 * running the real migration files, exactly as production would.
 */
export async function testDb() {
  const client = new PGlite()
  await applySchema(client)
  const db = drizzle(client, { schema }) as unknown as Db
  return { db, client }
}

let n = 0

/** A workspace with an owner, ready for commands. */
export async function seedTenant(db: Db, role = "owner") {
  n++
  const userId = `user-${n}-${Math.random().toString(36).slice(2, 8)}`
  await db.insert(schema.user).values({ id: userId, name: `Test User ${n}`, email: `${userId}@example.com` })
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: `Workspace ${n}`, slug: `ws-${userId}`, ownerId: userId, status: "active" })
    .returning()
  await db.insert(schema.tenantMemberships).values({ tenantId: tenant.id, userId, role: role as "owner", isPrimary: true })
  const actor: Actor = { tenantId: tenant.id, userId, role }
  return { tenant, userId, actor }
}

export async function seedProduct(db: Db, tenantId: string, over: Partial<typeof schema.products.$inferInsert> = {}) {
  const [p] = await db
    .insert(schema.products)
    .values({ tenantId, name: over.name ?? `Item ${++n}`, sku: over.sku ?? `SKU-${n}`, price: "10.00", status: "active", ...over })
    .returning()
  return p
}

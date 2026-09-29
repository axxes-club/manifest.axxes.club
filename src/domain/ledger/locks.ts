import { sql } from "drizzle-orm"
import type { Db } from "@/lib/db"

type Key = { tenantId: string; productId: string; variantId: string | null | undefined }
const keyString = (k: Key) => `${k.tenantId}:${k.productId}:${k.variantId ?? ""}`

/**
 * Serializes everything touching the same items for the rest of the
 * transaction: stock, cost layers and valuation. Locks are taken in a fixed
 * order, so two commands can't deadlock. Re-locking in the same transaction is free.
 */
export async function lockItems(tx: Db, keys: Key[]) {
  const unique = [...new Set(keys.map(keyString))].sort()
  for (const k of unique) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${k}, 0))`)
}

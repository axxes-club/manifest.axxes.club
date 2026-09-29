import { sql } from "drizzle-orm"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"

export const DEFAULT_PREFIXES = {
  adjustment: "ADJ",
  opening: "OPN",
  reversal: "REV",
  purchase_order: "PO",
  receipt: "GRN",
  sales_order: "SO",
  shipment: "SHP",
  transfer: "TR",
  count: "CC",
  return: "RMA",
  build: "BO",
} as const

export type SequenceKey = keyof typeof DEFAULT_PREFIXES

/**
 * Next document number, e.g. "ADJ-000042". The row lock from the upsert makes
 * it gap-free and race-free inside the caller's transaction.
 */
export async function nextNumber(tx: Db, tenantId: string, key: SequenceKey) {
  const [row] = await tx
    .insert(s.manifestSequences)
    .values({ tenantId, key, prefix: DEFAULT_PREFIXES[key], next: 2 })
    .onConflictDoUpdate({
      target: [s.manifestSequences.tenantId, s.manifestSequences.key],
      set: { next: sql`${s.manifestSequences.next} + 1` },
    })
    .returning()
  const n = row.next - 1
  return `${row.prefix}-${String(n).padStart(row.padding, "0")}`
}

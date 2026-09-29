import { and, eq, sql } from "drizzle-orm"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { D } from "../decimal"

export type Drift = {
  kind: "quant" | "value"
  productId: string
  variantId: string | null
  locationId?: string
  expected: string
  actual: string
}

/**
 * Re-derives every quant from the moves and every FIFO valuation from its
 * layers, and reports anything that disagrees. It should always return an
 * empty list; the nightly job alerts on Today when it doesn't.
 */
export async function reconcile(db: Db, tenantId: string): Promise<Drift[]> {
  type Row = { product_id: string; variant_id: string | null; location_id: string; lot_id: string | null; status: string; expected: string; actual: string }
  const rows = await db.execute(sql`
    WITH ledger AS (
      SELECT product_id, variant_id, to_location_id AS location_id, lot_id, to_status AS status, qty
        FROM ${s.manifestStockMoves} WHERE tenant_id = ${tenantId}
      UNION ALL
      SELECT product_id, variant_id, from_location_id, lot_id, from_status, -qty
        FROM ${s.manifestStockMoves} WHERE tenant_id = ${tenantId}
    ),
    expected AS (
      SELECT l.product_id, l.variant_id, l.location_id, l.lot_id, l.status, sum(l.qty) AS qty
        FROM ledger l JOIN ${s.manifestLocations} loc ON loc.id = l.location_id
       WHERE NOT loc.is_virtual OR loc.is_valued
       GROUP BY 1, 2, 3, 4, 5
    ),
    actual AS (
      SELECT product_id, variant_id, location_id, lot_id, status, on_hand AS qty
        FROM ${s.manifestQuants} WHERE tenant_id = ${tenantId}
    )
    SELECT coalesce(e.product_id, a.product_id) AS product_id,
           coalesce(e.variant_id, a.variant_id) AS variant_id,
           coalesce(e.location_id, a.location_id) AS location_id,
           coalesce(e.lot_id, a.lot_id) AS lot_id,
           coalesce(e.status, a.status)::text AS status,
           coalesce(e.qty, 0)::text AS expected,
           coalesce(a.qty, 0)::text AS actual
      FROM expected e
      FULL JOIN actual a
        ON a.product_id = e.product_id
       AND a.variant_id IS NOT DISTINCT FROM e.variant_id
       AND a.location_id = e.location_id
       AND a.lot_id IS NOT DISTINCT FROM e.lot_id
       AND a.status = e.status
     WHERE coalesce(e.qty, 0) <> coalesce(a.qty, 0)
  `)

  const drift: Drift[] = rowsOf<Row>(rows).map((r) => ({
    kind: "quant",
    productId: r.product_id,
    variantId: r.variant_id,
    locationId: r.location_id,
    expected: r.expected,
    actual: r.actual,
  }))

  const [settings] = await db.select().from(s.manifestSettings).where(eq(s.manifestSettings.tenantId, tenantId)).limit(1)
  if (settings?.costingMethod === "fifo") {
    const layers = await db
      .select({
        productId: s.manifestCostLayers.productId,
        variantId: s.manifestCostLayers.variantId,
        value: sql<string>`sum(${s.manifestCostLayers.qtyRemaining} * ${s.manifestCostLayers.unitCost})`,
      })
      .from(s.manifestCostLayers)
      .where(eq(s.manifestCostLayers.tenantId, tenantId))
      .groupBy(s.manifestCostLayers.productId, s.manifestCostLayers.variantId)
    const costs = await db.select().from(s.manifestItemCosts).where(and(eq(s.manifestItemCosts.tenantId, tenantId)))
    for (const c of costs) {
      const l = layers.find((x) => x.productId === c.productId && x.variantId === c.variantId)
      if (!D(l?.value).toDecimalPlaces(2).eq(D(c.value).toDecimalPlaces(2))) {
        drift.push({ kind: "value", productId: c.productId, variantId: c.variantId, expected: D(l?.value).toFixed(4), actual: c.value })
      }
    }
  }
  return drift
}

/** node-postgres style results have .rows; PGlite and neon-serverless both do. */
function rowsOf<T>(r: unknown): T[] {
  return Array.isArray(r) ? (r as T[]) : ((r as { rows: T[] }).rows ?? [])
}

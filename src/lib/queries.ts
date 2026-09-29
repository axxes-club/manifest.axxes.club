import "server-only"
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm"
import { db, schema as s } from "@/lib/db"
import { outer } from "@/lib/db/sql"
import type { Locale } from "@/lib/format"

export async function getSettings(tenantId: string) {
  const [row] = await db.select().from(s.manifestSettings).where(eq(s.manifestSettings.tenantId, tenantId)).limit(1)
  return row
}

export async function getLocale(tenantId: string): Promise<Locale> {
  const settings = await getSettings(tenantId)
  return { locale: settings?.locale ?? "en-US", currency: settings?.baseCurrency ?? "USD" }
}

export type LocationRow = Awaited<ReturnType<typeof listLocations>>[number]

/** Physical locations with what each holds directly (not including children). */
export async function listLocations(tenantId: string, opts: { archived?: boolean } = {}) {
  return db
    .select({
      id: s.manifestLocations.id,
      parentId: s.manifestLocations.parentId,
      kind: s.manifestLocations.kind,
      code: s.manifestLocations.code,
      name: s.manifestLocations.name,
      path: s.manifestLocations.path,
      allowNegative: s.manifestLocations.allowNegative,
      archivedAt: s.manifestLocations.archivedAt,
      legacyLocationId: s.manifestLocations.legacyLocationId,
      units: sql<string>`coalesce((SELECT sum(q.on_hand) FROM ${s.manifestQuants} q WHERE q.location_id = ${outer(s.manifestLocations.id)}), 0)`,
      skus: sql<number>`(SELECT count(*) FROM ${s.manifestQuants} q WHERE q.location_id = ${outer(s.manifestLocations.id)} AND q.on_hand <> 0)::int`,
    })
    .from(s.manifestLocations)
    .where(
      and(
        eq(s.manifestLocations.tenantId, tenantId),
        eq(s.manifestLocations.isVirtual, false),
        opts.archived ? undefined : isNull(s.manifestLocations.archivedAt),
      ),
    )
    .orderBy(asc(s.manifestLocations.path))
}

export async function getLocation(tenantId: string, id: string) {
  const [row] = await db.select().from(s.manifestLocations).where(and(eq(s.manifestLocations.tenantId, tenantId), eq(s.manifestLocations.id, id))).limit(1)
  return row
}

export async function listReasons(tenantId: string, includeInactive = false) {
  return db
    .select()
    .from(s.manifestReasonCodes)
    .where(and(eq(s.manifestReasonCodes.tenantId, tenantId), includeInactive ? undefined : eq(s.manifestReasonCodes.isActive, true)))
    .orderBy(asc(s.manifestReasonCodes.sortOrder), asc(s.manifestReasonCodes.code))
}

export async function listAdjustments(tenantId: string, status?: string) {
  return db
    .select({
      id: s.manifestAdjustments.id,
      number: s.manifestAdjustments.number,
      status: s.manifestAdjustments.status,
      kind: s.manifestAdjustments.kind,
      reason: s.manifestAdjustments.reason,
      occurredAt: s.manifestAdjustments.occurredAt,
      createdAt: s.manifestAdjustments.createdAt,
      location: s.manifestLocations.code,
      author: s.user.name,
      lines: sql<number>`(SELECT count(*) FROM ${s.manifestAdjustmentLines} l WHERE l.adjustment_id = ${outer(s.manifestAdjustments.id)})::int`,
      net: sql<string | null>`(SELECT sum(l.qty_delta) FROM ${s.manifestAdjustmentLines} l WHERE l.adjustment_id = ${outer(s.manifestAdjustments.id)})`,
      value: sql<string | null>`(SELECT sum(m.total_cost * CASE WHEN m.to_location_id = ${outer(s.manifestAdjustments.locationId)} THEN 1 ELSE -1 END) FROM ${s.manifestStockMoves} m WHERE m.doc_id = ${outer(s.manifestAdjustments.id)} AND m.reversal_of IS NULL)`,
    })
    .from(s.manifestAdjustments)
    .innerJoin(s.manifestLocations, eq(s.manifestLocations.id, s.manifestAdjustments.locationId))
    .leftJoin(s.user, eq(s.user.id, s.manifestAdjustments.createdBy))
    .where(and(eq(s.manifestAdjustments.tenantId, tenantId), status ? eq(s.manifestAdjustments.status, status as "draft") : undefined))
    .orderBy(desc(s.manifestAdjustments.createdAt))
    .limit(300)
}

export async function adjustmentCounts(tenantId: string) {
  const rows = await db
    .select({ status: s.manifestAdjustments.status, n: count() })
    .from(s.manifestAdjustments)
    .where(eq(s.manifestAdjustments.tenantId, tenantId))
    .groupBy(s.manifestAdjustments.status)
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<"draft" | "posted" | "cancelled", number>>
}

export async function getAdjustment(tenantId: string, id: string) {
  const [doc] = await db
    .select({ doc: s.manifestAdjustments, location: s.manifestLocations, author: s.user.name })
    .from(s.manifestAdjustments)
    .innerJoin(s.manifestLocations, eq(s.manifestLocations.id, s.manifestAdjustments.locationId))
    .leftJoin(s.user, eq(s.user.id, s.manifestAdjustments.createdBy))
    .where(and(eq(s.manifestAdjustments.tenantId, tenantId), eq(s.manifestAdjustments.id, id)))
    .limit(1)
  if (!doc) return null
  const lines = await db
    .select({
      id: s.manifestAdjustmentLines.id,
      productId: s.manifestAdjustmentLines.productId,
      variantId: s.manifestAdjustmentLines.variantId,
      name: sql<string>`${s.products.name} || coalesce(' (' || ${s.productVariants.name} || ')', '')`,
      sku: sql<string | null>`coalesce(${s.productVariants.sku}, ${s.products.sku})`,
      qtyDelta: s.manifestAdjustmentLines.qtyDelta,
      countedQty: s.manifestAdjustmentLines.countedQty,
      qtyBefore: s.manifestAdjustmentLines.qtyBefore,
      unitCost: s.manifestAdjustmentLines.unitCost,
    })
    .from(s.manifestAdjustmentLines)
    .innerJoin(s.products, eq(s.products.id, s.manifestAdjustmentLines.productId))
    .leftJoin(s.productVariants, eq(s.productVariants.id, s.manifestAdjustmentLines.variantId))
    .where(eq(s.manifestAdjustmentLines.adjustmentId, id))
  const [reversal] = doc.doc.commandId
    ? await db
        .select({ number: s.manifestStockMoves.docNumber, at: s.manifestStockMoves.postedAt })
        .from(s.manifestStockMoves)
        .where(and(eq(s.manifestStockMoves.tenantId, tenantId), eq(s.manifestStockMoves.docId, id), eq(s.manifestStockMoves.docType, "reversal")))
        .limit(1)
    : []
  return { ...doc, lines, reversal }
}

export type CatalogRow = Awaited<ReturnType<typeof listItems>>[number]

/** The catalog: one row per product, variants rolled up. */
export async function listItems(tenantId: string, q?: string) {
  return db
    .select({
      id: s.products.id,
      name: s.products.name,
      sku: s.products.sku,
      barcode: s.products.barcode,
      price: s.products.price,
      costPrice: s.products.costPrice,
      status: s.products.status,
      hasVariants: s.products.hasVariants,
      variants: sql<number>`(SELECT count(*) FROM ${s.productVariants} v WHERE v.product_id = ${outer(s.products.id)} AND v.deleted_at IS NULL)::int`,
      onHand: sql<string>`coalesce((SELECT sum(q.on_hand) FROM ${s.manifestQuants} q JOIN ${s.manifestLocations} l ON l.id = q.location_id WHERE q.product_id = ${outer(s.products.id)} AND NOT l.is_virtual), 0)`,
    })
    .from(s.products)
    .where(
      and(
        eq(s.products.tenantId, tenantId),
        isNull(s.products.deletedAt),
        q ? or(ilike(s.products.name, `%${q}%`), ilike(s.products.sku, `%${q}%`), ilike(s.products.barcode, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(asc(s.products.name))
    .limit(500)
}

export async function getItem(tenantId: string, productId: string) {
  const [product] = await db
    .select()
    .from(s.products)
    .where(and(eq(s.products.tenantId, tenantId), eq(s.products.id, productId), isNull(s.products.deletedAt)))
    .limit(1)
  if (!product) return null
  const variants = await db
    .select()
    .from(s.productVariants)
    .where(and(eq(s.productVariants.productId, productId), isNull(s.productVariants.deletedAt)))
    .orderBy(asc(s.productVariants.sortOrder))
  const profiles = await db.select().from(s.manifestItemProfiles).where(and(eq(s.manifestItemProfiles.tenantId, tenantId), eq(s.manifestItemProfiles.productId, productId)))
  return { product, variants, profiles }
}

/** Documents waiting on someone, for the Today inbox. */
export async function draftAdjustments(tenantId: string) {
  return db
    .select({ id: s.manifestAdjustments.id, number: s.manifestAdjustments.number, reason: s.manifestAdjustments.reason, createdAt: s.manifestAdjustments.createdAt })
    .from(s.manifestAdjustments)
    .where(and(eq(s.manifestAdjustments.tenantId, tenantId), eq(s.manifestAdjustments.status, "draft")))
    .orderBy(desc(s.manifestAdjustments.createdAt))
    .limit(6)
}

/** Stock value per day for the last N days, from the moves: for the Today trend line. */
export async function valueSeries(tenantId: string, days = 30) {
  const rows = await db.execute(sql`
    WITH days AS (SELECT generate_series(current_date - ${days - 1}::int, current_date, interval '1 day')::date AS d),
    flows AS (
      SELECT date_trunc('day', m.occurred_at)::date AS d,
             sum(CASE WHEN tl.is_valued AND NOT fl.is_valued THEN m.total_cost WHEN fl.is_valued AND NOT tl.is_valued THEN -m.total_cost ELSE 0 END) AS delta
        FROM ${s.manifestStockMoves} m
        JOIN ${s.manifestLocations} fl ON fl.id = m.from_location_id
        JOIN ${s.manifestLocations} tl ON tl.id = m.to_location_id
       WHERE m.tenant_id = ${tenantId}
       GROUP BY 1
    ),
    opening AS (SELECT coalesce(sum(delta), 0) AS v FROM flows WHERE d < current_date - ${days - 1}::int)
    SELECT to_char(days.d, 'YYYY-MM-DD') AS day,
           (SELECT v FROM opening) + coalesce(sum(f.delta) OVER (ORDER BY days.d), 0) AS value
      FROM days LEFT JOIN flows f ON f.d = days.d
     ORDER BY days.d`)
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as { day: string; value: string }[]
  return list.map((r) => ({ day: r.day, value: Number(r.value) }))
}

/** Resolves a SKU (product or variant) for prefilled forms, e.g. from a ⌘K verb or a scanned label. */
export async function findBySku(tenantId: string, sku: string) {
  const [v] = await db
    .select({ productId: s.productVariants.productId, variantId: s.productVariants.id, name: s.products.name, variant: s.productVariants.name, sku: s.productVariants.sku })
    .from(s.productVariants)
    .innerJoin(s.products, eq(s.products.id, s.productVariants.productId))
    .where(and(eq(s.productVariants.tenantId, tenantId), isNull(s.productVariants.deletedAt), sql`lower(${s.productVariants.sku}) = lower(${sku})`))
    .limit(1)
  if (v) return { productId: v.productId, variantId: v.variantId as string | null, label: `${v.name} (${v.variant})`, sku: v.sku }
  const [p] = await db
    .select({ productId: s.products.id, name: s.products.name, sku: s.products.sku })
    .from(s.products)
    .where(and(eq(s.products.tenantId, tenantId), isNull(s.products.deletedAt), sql`lower(${s.products.sku}) = lower(${sku})`))
    .limit(1)
  return p ? { productId: p.productId, variantId: null as string | null, label: p.name, sku: p.sku } : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Route params are user input; anything that isn't a UUID can't be a record. */
export const isUuid = (v: string) => UUID.test(v)

/** For each item, the physical location holding most of it: the natural put-away bin. */
export async function homeLocations(tenantId: string, items: { productId: string; variantId: string | null }[]) {
  if (!items.length) return new Map<string, string>()
  const rows = await db
    .select({ productId: s.manifestQuants.productId, variantId: s.manifestQuants.variantId, locationId: s.manifestQuants.locationId, onHand: s.manifestQuants.onHand })
    .from(s.manifestQuants)
    .innerJoin(s.manifestLocations, eq(s.manifestLocations.id, s.manifestQuants.locationId))
    .where(
      and(
        eq(s.manifestQuants.tenantId, tenantId),
        eq(s.manifestLocations.isVirtual, false),
        isNull(s.manifestLocations.archivedAt),
        sql`${s.manifestQuants.productId} IN (${sql.join([...new Set(items.map((i) => i.productId))].map((id) => sql`${id}`), sql`, `)})`,
      ),
    )
    .orderBy(desc(s.manifestQuants.onHand))
  const out = new Map<string, string>()
  for (const r of rows) {
    const key = `${r.productId}:${r.variantId ?? ""}`
    if (!out.has(key)) out.set(key, r.locationId)
  }
  return out
}

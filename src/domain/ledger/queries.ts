import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm"
import { alias, type PgColumn } from "drizzle-orm/pg-core"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { eqOrNull } from "./costing"
import { inSubtree } from "./paths"

export type StockFilter = { q?: string; locationPath?: string; productId?: string; variantId?: string | null; lowOnly?: boolean }

const itemName = sql<string>`${s.products.name} || coalesce(' (' || ${s.productVariants.name} || ')', '')`
const itemSku = sql<string | null>`coalesce(${s.productVariants.sku}, ${s.products.sku})`

/**
 * Stock by item across physical locations (or one location subtree), with
 * on-hand, reserved, available and value. The main Stock grid.
 */
export async function stockByItem(db: Db, tenantId: string, f: StockFilter = {}, limit = 500) {
  const where = and(
    eq(s.manifestQuants.tenantId, tenantId),
    eq(s.manifestLocations.isVirtual, false),
    f.locationPath ? inSubtree(s.manifestLocations.path, f.locationPath) : undefined,
    f.productId ? eq(s.manifestQuants.productId, f.productId) : undefined,
    f.q ? or(ilike(s.products.name, `%${f.q}%`), ilike(s.products.sku, `%${f.q}%`), ilike(s.productVariants.sku, `%${f.q}%`), ilike(s.products.barcode, `%${f.q}%`)) : undefined,
  )
  const rows = await db
    .select({
      productId: s.manifestQuants.productId,
      variantId: s.manifestQuants.variantId,
      name: itemName,
      sku: itemSku,
      onHand: sql<string>`sum(${s.manifestQuants.onHand})`,
      reserved: sql<string>`sum(${s.manifestQuants.reserved})`,
      available: sql<string>`sum(CASE WHEN ${s.manifestQuants.status} = 'available' THEN ${s.manifestQuants.onHand} - ${s.manifestQuants.reserved} ELSE 0 END)`,
      held: sql<string>`sum(CASE WHEN ${s.manifestQuants.status} <> 'available' THEN ${s.manifestQuants.onHand} ELSE 0 END)`,
      locations: sql<number>`count(DISTINCT ${s.manifestQuants.locationId}) FILTER (WHERE ${s.manifestQuants.onHand} <> 0)`,
      unitCost: sql<string>`coalesce(max(CASE WHEN ${s.manifestItemCosts.qty} > 0 THEN ${s.manifestItemCosts.value} / ${s.manifestItemCosts.qty} ELSE ${s.manifestItemCosts.lastUnitCost} END), 0)`,
      reorderPoint: sql<string | null>`max(${s.manifestItemProfiles.reorderPoint})`,
      threshold: sql<number | null>`max(coalesce(${s.productVariants.lowStockThreshold}, ${s.products.lowStockThreshold}))`,
    })
    .from(s.manifestQuants)
    .innerJoin(s.manifestLocations, eq(s.manifestLocations.id, s.manifestQuants.locationId))
    .innerJoin(s.products, eq(s.products.id, s.manifestQuants.productId))
    .leftJoin(s.productVariants, eq(s.productVariants.id, s.manifestQuants.variantId))
    .leftJoin(
      s.manifestItemCosts,
      and(
        eq(s.manifestItemCosts.tenantId, s.manifestQuants.tenantId),
        eq(s.manifestItemCosts.productId, s.manifestQuants.productId),
        sql`${s.manifestItemCosts.variantId} IS NOT DISTINCT FROM ${s.manifestQuants.variantId}`,
      ),
    )
    .leftJoin(
      s.manifestItemProfiles,
      and(
        eq(s.manifestItemProfiles.tenantId, s.manifestQuants.tenantId),
        eq(s.manifestItemProfiles.productId, s.manifestQuants.productId),
        sql`${s.manifestItemProfiles.variantId} IS NOT DISTINCT FROM ${s.manifestQuants.variantId}`,
      ),
    )
    .where(where)
    .groupBy(s.manifestQuants.productId, s.manifestQuants.variantId, s.products.name, s.productVariants.name, s.productVariants.sku, s.products.sku)
    .orderBy(itemName)
    .limit(limit)

  const out = rows.map((r) => {
    const point = r.reorderPoint ?? (r.threshold != null ? String(r.threshold) : null)
    return { ...r, reorderPoint: point, low: point != null && Number(r.available) <= Number(point) }
  })
  return f.lowOnly ? out.filter((r) => r.low) : out
}

/** Where one item is, bin by bin. */
export async function stockByLocation(db: Db, tenantId: string, productId: string, variantId: string | null) {
  return db
    .select({
      locationId: s.manifestLocations.id,
      code: s.manifestLocations.code,
      path: s.manifestLocations.path,
      kind: s.manifestLocations.kind,
      status: s.manifestQuants.status,
      lotId: s.manifestQuants.lotId,
      onHand: s.manifestQuants.onHand,
      reserved: s.manifestQuants.reserved,
    })
    .from(s.manifestQuants)
    .innerJoin(s.manifestLocations, eq(s.manifestLocations.id, s.manifestQuants.locationId))
    .where(and(eq(s.manifestQuants.tenantId, tenantId), eq(s.manifestQuants.productId, productId), eqOrNull(s.manifestQuants.variantId, variantId), sql`${s.manifestQuants.onHand} <> 0`))
    .orderBy(s.manifestLocations.path)
}

const fromLoc = alias(s.manifestLocations, "from_loc")
const toLoc = alias(s.manifestLocations, "to_loc")

export type MoveFilter = {
  productId?: string
  variantId?: string | null
  locationId?: string
  docType?: string
  commandId?: string
  since?: Date
  until?: Date
  q?: string
}

/** The ledger, newest first, with both sides named. Powers the Moves screen and every move trail. */
export async function listMoves(db: Db, tenantId: string, f: MoveFilter = {}, limit = 200) {
  const conds: (SQL | undefined)[] = [
    eq(s.manifestStockMoves.tenantId, tenantId),
    f.productId ? eq(s.manifestStockMoves.productId, f.productId) : undefined,
    f.productId && f.variantId !== undefined ? eqOrNull(s.manifestStockMoves.variantId, f.variantId) : undefined,
    f.locationId ? or(eq(s.manifestStockMoves.fromLocationId, f.locationId), eq(s.manifestStockMoves.toLocationId, f.locationId)) : undefined,
    f.docType ? eq(s.manifestStockMoves.docType, f.docType) : undefined,
    f.commandId ? eq(s.manifestStockMoves.commandId, f.commandId) : undefined,
    f.since ? gte(s.manifestStockMoves.occurredAt, f.since) : undefined,
    f.until ? lte(s.manifestStockMoves.occurredAt, f.until) : undefined,
    f.q ? or(ilike(s.products.name, `%${f.q}%`), ilike(s.products.sku, `%${f.q}%`), ilike(s.manifestStockMoves.docNumber, `%${f.q}%`)) : undefined,
  ]
  return db
    .select({
      id: s.manifestStockMoves.id,
      commandId: s.manifestStockMoves.commandId,
      occurredAt: s.manifestStockMoves.occurredAt,
      productId: s.manifestStockMoves.productId,
      variantId: s.manifestStockMoves.variantId,
      name: itemName,
      sku: itemSku,
      qty: s.manifestStockMoves.qty,
      unitCost: s.manifestStockMoves.unitCost,
      totalCost: s.manifestStockMoves.totalCost,
      fromId: fromLoc.id,
      fromCode: fromLoc.code,
      fromVirtual: fromLoc.isVirtual,
      toId: toLoc.id,
      toCode: toLoc.code,
      toVirtual: toLoc.isVirtual,
      fromStatus: s.manifestStockMoves.fromStatus,
      toStatus: s.manifestStockMoves.toStatus,
      docType: s.manifestStockMoves.docType,
      docId: s.manifestStockMoves.docId,
      docNumber: s.manifestStockMoves.docNumber,
      reason: s.manifestStockMoves.reason,
      note: s.manifestStockMoves.note,
      actorId: s.manifestStockMoves.actorId,
      actorName: s.user.name,
      reversalOf: s.manifestStockMoves.reversalOf,
    })
    .from(s.manifestStockMoves)
    .innerJoin(fromLoc, eq(fromLoc.id, s.manifestStockMoves.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, s.manifestStockMoves.toLocationId))
    .innerJoin(s.products, eq(s.products.id, s.manifestStockMoves.productId))
    .leftJoin(s.productVariants, eq(s.productVariants.id, s.manifestStockMoves.variantId))
    .leftJoin(s.user, eq(s.user.id, s.manifestStockMoves.actorId))
    .where(and(...conds))
    .orderBy(desc(s.manifestStockMoves.occurredAt), desc(s.manifestStockMoves.postedAt))
    .limit(limit)
}

/**
 * Time travel: physical on-hand per item as of a moment, rebuilt from the
 * moves alone. Because it never reads the quants, it doubles as their audit.
 */
export async function onHandAsOf(db: Db, tenantId: string, at: Date, f: { productId?: string; variantId?: string | null; locationPath?: string } = {}) {
  const physical = (loc: { isVirtual: PgColumn; path: PgColumn }) =>
    and(eq(loc.isVirtual, false), f.locationPath ? inSubtree(loc.path, f.locationPath) : undefined)
  const rows = await db
    .select({
      productId: s.manifestStockMoves.productId,
      variantId: s.manifestStockMoves.variantId,
      onHand: sql<string>`coalesce(sum(CASE WHEN ${physical(toLoc)} THEN ${s.manifestStockMoves.qty} ELSE 0 END), 0) - coalesce(sum(CASE WHEN ${physical(fromLoc)} THEN ${s.manifestStockMoves.qty} ELSE 0 END), 0)`,
    })
    .from(s.manifestStockMoves)
    .innerJoin(fromLoc, eq(fromLoc.id, s.manifestStockMoves.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, s.manifestStockMoves.toLocationId))
    .where(
      and(
        eq(s.manifestStockMoves.tenantId, tenantId),
        lte(s.manifestStockMoves.occurredAt, at),
        f.productId ? eq(s.manifestStockMoves.productId, f.productId) : undefined,
        f.productId && f.variantId !== undefined ? eqOrNull(s.manifestStockMoves.variantId, f.variantId) : undefined,
      ),
    )
    .groupBy(s.manifestStockMoves.productId, s.manifestStockMoves.variantId)
  return rows
}

/** Daily on-hand series for one item, for the item page chart and the time scrubber. */
export async function onHandSeries(db: Db, tenantId: string, productId: string, variantId: string | null, days = 90) {
  const since = new Date(Date.now() - days * 86400000)
  const [opening] = await onHandAsOf(db, tenantId, since, { productId, variantId })
  const deltas = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${s.manifestStockMoves.occurredAt}), 'YYYY-MM-DD')`,
      delta: sql<string>`sum(CASE WHEN ${toLoc.isVirtual} = false THEN ${s.manifestStockMoves.qty} ELSE 0 END) - sum(CASE WHEN ${fromLoc.isVirtual} = false THEN ${s.manifestStockMoves.qty} ELSE 0 END)`,
    })
    .from(s.manifestStockMoves)
    .innerJoin(fromLoc, eq(fromLoc.id, s.manifestStockMoves.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, s.manifestStockMoves.toLocationId))
    .where(
      and(
        eq(s.manifestStockMoves.tenantId, tenantId),
        eq(s.manifestStockMoves.productId, productId),
        eqOrNull(s.manifestStockMoves.variantId, variantId),
        sql`${s.manifestStockMoves.occurredAt} > ${since}`,
      ),
    )
    .groupBy(sql`1`)
  const byDay = new Map(deltas.map((d) => [d.day, Number(d.delta)]))
  let level = Number(opening?.onHand ?? 0)
  const series: { day: string; onHand: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    level += byDay.get(day) ?? 0
    series.push({ day, onHand: level })
  }
  return series
}

/** Workspace-level totals for the Today page. */
export async function stockTotals(db: Db, tenantId: string) {
  const [row] = await db
    .select({
      value: sql<string>`coalesce(sum(${s.manifestItemCosts.value}), 0)`,
      units: sql<string>`coalesce(sum(${s.manifestItemCosts.qty}), 0)`,
      items: sql<number>`count(*) FILTER (WHERE ${s.manifestItemCosts.qty} > 0)`,
    })
    .from(s.manifestItemCosts)
    .where(eq(s.manifestItemCosts.tenantId, tenantId))
  return row ?? { value: "0", units: "0", items: 0 }
}

import { and, asc, eq, gt, isNull, sql, type SQL } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { D, Decimal, toDb, ZERO } from "../decimal"

export type ItemKey = { tenantId: string; productId: string; variantId: string | null }
export type CostingMethod = "fifo" | "average"

/** `col = v`, or `col IS NULL` when v is null. Variant and lot are optional parts of an item key. */
export function eqOrNull(col: PgColumn, v: string | null | undefined): SQL {
  return v ? eq(col, v) : isNull(col)
}

export async function itemCost(tx: Db, k: ItemKey) {
  const [row] = await tx
    .select()
    .from(s.manifestItemCosts)
    .where(and(eq(s.manifestItemCosts.tenantId, k.tenantId), eq(s.manifestItemCosts.productId, k.productId), eqOrNull(s.manifestItemCosts.variantId, k.variantId)))
    .for("update")
    .limit(1)
  return row
}

/** Cost of one unit right now: the running average, or the last cost in when nothing is on hand. */
export function unitCostOf(row: { qty: string; value: string; lastUnitCost: string } | undefined): Decimal {
  if (!row) return ZERO
  const q = D(row.qty)
  return q.gt(0) ? D(row.value).div(q) : D(row.lastUnitCost)
}

async function saveItemCost(tx: Db, k: ItemKey, qty: Decimal, value: Decimal, lastUnitCost: Decimal) {
  await tx
    .insert(s.manifestItemCosts)
    .values({ ...k, qty: toDb(qty), value: toDb(value), lastUnitCost: toDb(lastUnitCost) })
    .onConflictDoUpdate({
      target: [s.manifestItemCosts.tenantId, s.manifestItemCosts.productId, s.manifestItemCosts.variantId],
      set: { qty: toDb(qty), value: toDb(value), lastUnitCost: toDb(lastUnitCost), updatedAt: new Date() },
    })
}

async function fifoValue(tx: Db, k: ItemKey) {
  const [row] = await tx
    .select({ v: sql<string>`coalesce(sum(${s.manifestCostLayers.qtyRemaining} * ${s.manifestCostLayers.unitCost}), 0)` })
    .from(s.manifestCostLayers)
    .where(and(eq(s.manifestCostLayers.tenantId, k.tenantId), eq(s.manifestCostLayers.productId, k.productId), eqOrNull(s.manifestCostLayers.variantId, k.variantId)))
  return D(row?.v)
}

/** Stock entering valuation (a receipt, found stock, an opening balance). */
export async function valueIn(tx: Db, method: CostingMethod, k: ItemKey, q: Decimal, unitCost: Decimal, moveId: string, occurredAt: Date) {
  const cur = await itemCost(tx, k)
  const qty = D(cur?.qty).add(q)
  if (method === "fifo") {
    await tx.insert(s.manifestCostLayers).values({ ...k, moveId, qtyIn: toDb(q), qtyRemaining: toDb(q), unitCost: toDb(unitCost), occurredAt })
    await saveItemCost(tx, k, qty, await fifoValue(tx, k), unitCost)
  } else {
    const value = qty.isZero() ? ZERO : D(cur?.value).add(q.mul(unitCost))
    await saveItemCost(tx, k, qty, value, unitCost)
  }
}

/**
 * Stock leaving valuation (shipped, scrapped, written off). Returns the cost it
 * took with it. FIFO consumes the oldest layers first; `preferLayerOf` lets a
 * reversal take back exactly the layer its original move created.
 */
export async function valueOut(tx: Db, method: CostingMethod, k: ItemKey, q: Decimal, preferLayerOf?: string | null): Promise<Decimal> {
  const cur = await itemCost(tx, k)
  const fallback = unitCostOf(cur)
  const qty = D(cur?.qty).sub(q)

  if (method === "average") {
    const cost = q.mul(fallback)
    const value = qty.lte(0) ? ZERO : D(cur?.value).sub(cost)
    await saveItemCost(tx, k, qty, value, D(cur?.lastUnitCost))
    return cost
  }

  let remaining = q
  let total = ZERO
  const itemWhere = and(
    eq(s.manifestCostLayers.tenantId, k.tenantId),
    eq(s.manifestCostLayers.productId, k.productId),
    eqOrNull(s.manifestCostLayers.variantId, k.variantId),
    gt(s.manifestCostLayers.qtyRemaining, "0"),
  )
  const preferred = preferLayerOf
    ? await tx.select().from(s.manifestCostLayers).where(and(itemWhere, eq(s.manifestCostLayers.moveId, preferLayerOf))).for("update")
    : []
  const rest = await tx
    .select()
    .from(s.manifestCostLayers)
    .where(itemWhere)
    .orderBy(asc(s.manifestCostLayers.occurredAt), asc(s.manifestCostLayers.id))
    .for("update")

  for (const layer of [...preferred, ...rest.filter((l) => !preferred.some((p) => p.id === l.id))]) {
    if (remaining.lte(0)) break
    const take = Decimal.min(remaining, D(layer.qtyRemaining))
    total = total.add(take.mul(layer.unitCost))
    remaining = remaining.sub(take)
    await tx
      .update(s.manifestCostLayers)
      .set({ qtyRemaining: toDb(D(layer.qtyRemaining).sub(take)) })
      .where(eq(s.manifestCostLayers.id, layer.id))
  }
  // Going negative: there's no layer left to consume, so cost the shortfall at the last known cost.
  if (remaining.gt(0)) total = total.add(remaining.mul(fallback))

  await saveItemCost(tx, k, qty, await fifoValue(tx, k), D(cur?.lastUnitCost))
  return total
}

/**
 * Adds a landed-cost share to stock that came in on one receipt move. Only the
 * part of that stock still on hand can carry extra cost; the rest was already
 * sold or scrapped at the old cost. Returns the amount actually capitalized.
 *
 * FIFO: the receipt's own layer is revalued, pro rata to what's left of it.
 * Average: the share is spread over what's on hand, capped by the receipt qty.
 */
export async function capitalize(tx: Db, method: CostingMethod, k: ItemKey, moveId: string, receivedQty: Decimal, share: Decimal): Promise<Decimal> {
  const cur = await itemCost(tx, k)
  if (method === "fifo") {
    const [layer] = await tx.select().from(s.manifestCostLayers).where(eq(s.manifestCostLayers.moveId, moveId)).for("update").limit(1)
    if (!layer || D(layer.qtyRemaining).lte(0)) return ZERO
    const remaining = D(layer.qtyRemaining)
    let amount = share.mul(remaining).div(D(layer.qtyIn))
    // A credit can take cost down to zero, never below.
    const floor = D(layer.unitCost).mul(remaining).neg()
    if (amount.lt(floor)) amount = floor
    await tx
      .update(s.manifestCostLayers)
      .set({ unitCost: toDb(D(layer.unitCost).add(amount.div(remaining))) })
      .where(eq(s.manifestCostLayers.id, layer.id))
    await saveItemCost(tx, k, D(cur?.qty), await fifoValue(tx, k), D(cur?.lastUnitCost))
    return amount
  }
  const onHand = Decimal.max(D(cur?.qty), 0)
  if (onHand.isZero()) return ZERO
  let amount = share.mul(Decimal.min(onHand, receivedQty)).div(receivedQty)
  const floor = D(cur?.value).neg()
  if (amount.lt(floor)) amount = floor
  await saveItemCost(tx, k, D(cur?.qty), D(cur?.value).add(amount), D(cur?.lastUnitCost))
  return amount
}

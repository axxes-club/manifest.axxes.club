import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import type { CommandScope } from "../command"
import { D, Decimal, toDb, type Num } from "../decimal"
import { DomainError } from "../errors"
import { ensureWorkspace } from "../workspace"
import { eqOrNull, itemCost, unitCostOf, valueIn, valueOut, type ItemKey } from "./costing"
import { lockItems } from "./locks"
import { syncLegacy } from "./projection"

export type StockStatus = (typeof s.manifestStockStatus.enumValues)[number]

export type MoveInput = {
  productId: string
  variantId?: string | null
  lotId?: string | null
  fromLocationId: string
  toLocationId: string
  fromStatus?: StockStatus
  toStatus?: StockStatus
  qty: Num
  /** Cost per unit for stock entering valuation. Omit to use the item's current cost. */
  unitCost?: Num | null
  docType: string
  docId?: string | null
  docLineId?: string | null
  docNumber?: string | null
  reason?: string | null
  note?: string | null
  occurredAt?: Date
  reversalOf?: string | null
}

export type Move = typeof s.manifestStockMoves.$inferSelect
type Location = typeof s.manifestLocations.$inferSelect

/** Quants exist for physical locations and for virtual ones that still hold our stock (transit, consignee). */
export const tracksStock = (l: Pick<Location, "isVirtual" | "isValued">) => !l.isVirtual || l.isValued

const itemKeyOf = (tenantId: string, m: MoveInput): ItemKey => ({ tenantId, productId: m.productId, variantId: m.variantId ?? null })
const keyString = (k: ItemKey) => `${k.tenantId}:${k.productId}:${k.variantId ?? ""}`

/**
 * Posts moves to the ledger. Everything that changes stock, from a one-line
 * adjustment to a 500-line receipt, ends up here, inside the caller's command
 * transaction. It:
 *   1. validates items, locations and the period lock,
 *   2. takes a per-item lock so concurrent commands on the same item queue up,
 *   3. moves quantity between quants, refusing to go below zero (or into reserved stock),
 *   4. values the move (FIFO layers or running average),
 *   5. writes the immutable move row,
 *   6. refreshes members' legacy stock columns.
 */
export async function postMoves(tx: Db, cmd: CommandScope, inputs: MoveInput[]): Promise<Move[]> {
  if (!inputs.length) return []
  const tenantId = cmd.actor.tenantId
  const settings = await ensureWorkspace(tx, tenantId)
  const now = new Date()

  // --- Validate -------------------------------------------------------------
  const locationIds = [...new Set(inputs.flatMap((m) => [m.fromLocationId, m.toLocationId]))]
  const locations = new Map(
    (await tx.select().from(s.manifestLocations).where(and(eq(s.manifestLocations.tenantId, tenantId), inArray(s.manifestLocations.id, locationIds)))).map((l) => [l.id, l]),
  )
  const productIds = [...new Set(inputs.map((m) => m.productId))]
  const productRows = await tx
    .select({ id: s.products.id, name: s.products.name, sku: s.products.sku, hasVariants: s.products.hasVariants, costPrice: s.products.costPrice })
    .from(s.products)
    .where(and(eq(s.products.tenantId, tenantId), inArray(s.products.id, productIds), isNull(s.products.deletedAt)))
  const productsById = new Map(productRows.map((p) => [p.id, p]))
  const variantIds = [...new Set(inputs.map((m) => m.variantId).filter((v): v is string => !!v))]
  const variantsById = new Map(
    variantIds.length
      ? (
          await tx
            .select({ id: s.productVariants.id, productId: s.productVariants.productId, name: s.productVariants.name, sku: s.productVariants.sku, costPrice: s.productVariants.costPrice })
            .from(s.productVariants)
            .where(and(eq(s.productVariants.tenantId, tenantId), inArray(s.productVariants.id, variantIds), isNull(s.productVariants.deletedAt)))
        ).map((v) => [v.id, v])
      : [],
  )

  for (const m of inputs) {
    const p = productsById.get(m.productId)
    if (!p) throw new DomainError("item_not_found", "One of the items no longer exists in this workspace.", { productId: m.productId })
    if (m.variantId) {
      const v = variantsById.get(m.variantId)
      if (!v || v.productId !== m.productId) throw new DomainError("item_not_found", `That variant of ${p.name} no longer exists.`)
    } else if (p.hasVariants) {
      throw new DomainError("variant_required", `${p.name} has variants. Choose a specific variant to move stock.`)
    }
    for (const id of [m.fromLocationId, m.toLocationId]) {
      const l = locations.get(id)
      if (!l) throw new DomainError("location_not_found", "One of the locations no longer exists in this workspace.", { locationId: id })
      if (l.archivedAt || !l.isActive) throw new DomainError("location_inactive", `${l.code} is archived. Reactivate it to move stock there.`)
    }
    if (!D(m.qty).gt(0)) throw new DomainError("invalid_qty", "Quantities must be greater than zero.")
    if (m.fromLocationId === m.toLocationId && (m.fromStatus ?? "available") === (m.toStatus ?? "available")) {
      throw new DomainError("same_location", "Choose a different destination.")
    }
    const occurred = m.occurredAt ?? now
    if (settings.lockDate && occurred.toISOString().slice(0, 10) <= settings.lockDate) {
      throw new DomainError("period_locked", `The books are locked through ${settings.lockDate}. Post this with a later date.`)
    }
    if (occurred.getTime() > now.getTime() + 24 * 3600 * 1000) {
      throw new DomainError("future_date", "Stock can't be moved more than a day in the future.")
    }
  }

  // --- Lock items, so concurrent commands on the same item queue up --------
  const itemKeys = [...new Map(inputs.map((m) => [keyString(itemKeyOf(tenantId, m)), itemKeyOf(tenantId, m)])).values()]
  await lockItems(tx, itemKeys)

  // --- Post -----------------------------------------------------------------
  const posted: Move[] = []
  for (const m of inputs) {
    const k = itemKeyOf(tenantId, m)
    const from = locations.get(m.fromLocationId)!
    const to = locations.get(m.toLocationId)!
    const q = D(m.qty)
    const fromStatus = m.fromStatus ?? "available"
    const toStatus = m.toStatus ?? "available"
    const label = itemLabel(productsById.get(m.productId)!, m.variantId ? variantsById.get(m.variantId) : undefined)
    const moveId = crypto.randomUUID()
    const occurredAt = m.occurredAt ?? now

    if (tracksStock(from)) await takeFromQuant(tx, k, from, m.lotId ?? null, fromStatus, q, label)
    if (tracksStock(to)) await addToQuant(tx, k, to, m.lotId ?? null, toStatus, q)

    // Valuation only changes when stock crosses the boundary of what we own.
    const entering = !from.isValued && to.isValued
    let unitCost: Decimal
    if (entering) {
      unitCost = m.unitCost != null && m.unitCost !== "" ? D(m.unitCost) : await defaultUnitCost(tx, k, productsById.get(m.productId)!, m.variantId ? variantsById.get(m.variantId) : undefined)
      if (unitCost.lt(0)) throw new DomainError("invalid_cost", "Unit cost can't be negative.")
    } else if (from.isValued && !to.isValued) {
      unitCost = (await valueOut(tx, settings.costingMethod, k, q, m.reversalOf)).div(q)
    } else {
      unitCost = unitCostOf(await itemCost(tx, k))
    }

    const [row] = await tx
      .insert(s.manifestStockMoves)
      .values({
        id: moveId,
        tenantId,
        commandId: cmd.id,
        productId: m.productId,
        variantId: m.variantId ?? null,
        lotId: m.lotId ?? null,
        fromLocationId: from.id,
        toLocationId: to.id,
        fromStatus,
        toStatus,
        qty: toDb(q),
        unitCost: toDb(unitCost),
        totalCost: toDb(unitCost.mul(q)),
        docType: m.docType,
        docId: m.docId ?? null,
        docLineId: m.docLineId ?? null,
        docNumber: m.docNumber ?? null,
        reason: m.reason ?? null,
        note: m.note ?? null,
        actorId: cmd.actor.userId,
        occurredAt,
        reversalOf: m.reversalOf ?? null,
      })
      .returning()
    // The cost layer points at the move, so it's opened once the move exists.
    if (entering) await valueIn(tx, settings.costingMethod, k, q, unitCost, moveId, occurredAt)
    posted.push(row)
  }

  if (settings.syncLegacy) await syncLegacy(tx, tenantId, itemKeys)
  cmd.emit("stock.changed", { items: itemKeys.map(({ productId, variantId }) => ({ productId, variantId })), moves: posted.length })
  return posted
}

function itemLabel(p: { name: string; sku: string | null }, v?: { name: string | null; sku: string | null }) {
  const sku = v?.sku ?? p.sku
  const name = v?.name ? `${p.name} (${v.name})` : p.name
  return sku ? `${sku} · ${name}` : name
}

async function defaultUnitCost(tx: Db, k: ItemKey, p: { costPrice: string | null }, v?: { costPrice: string | null }) {
  const cur = await itemCost(tx, k)
  if (cur && (D(cur.qty).gt(0) || D(cur.lastUnitCost).gt(0))) return unitCostOf(cur)
  return D(v?.costPrice ?? p.costPrice ?? 0)
}

function quantWhere(k: ItemKey, locationId: string, lotId: string | null, status: StockStatus) {
  return and(
    eq(s.manifestQuants.tenantId, k.tenantId),
    eq(s.manifestQuants.productId, k.productId),
    eqOrNull(s.manifestQuants.variantId, k.variantId),
    eq(s.manifestQuants.locationId, locationId),
    eqOrNull(s.manifestQuants.lotId, lotId),
    eq(s.manifestQuants.status, status),
  )
}

async function takeFromQuant(tx: Db, k: ItemKey, loc: Location, lotId: string | null, status: StockStatus, q: Decimal, label: string) {
  const [quant] = await tx.select().from(s.manifestQuants).where(quantWhere(k, loc.id, lotId, status)).for("update").limit(1)
  const onHand = D(quant?.onHand)
  const reserved = D(quant?.reserved)
  const after = onHand.sub(q)
  if (!loc.allowNegative && after.lt(reserved)) {
    const available = Decimal.max(onHand.sub(reserved), 0)
    throw new DomainError(
      "insufficient_stock",
      reserved.gt(0) && onHand.gte(q)
        ? `${label}: ${fmt(available)} available at ${loc.code}; the rest is reserved for orders.`
        : `${label}: only ${fmt(available)} available at ${loc.code}, tried to take ${fmt(q)}.`,
      { productId: k.productId, variantId: k.variantId, locationId: loc.id, available: available.toString(), requested: q.toString() },
    )
  }
  if (quant) {
    await tx.update(s.manifestQuants).set({ onHand: toDb(after), updatedAt: new Date() }).where(eq(s.manifestQuants.id, quant.id))
  } else {
    await tx.insert(s.manifestQuants).values({ ...k, locationId: loc.id, lotId, status, onHand: toDb(after) })
  }
}

async function addToQuant(tx: Db, k: ItemKey, loc: Location, lotId: string | null, status: StockStatus, q: Decimal) {
  await tx
    .insert(s.manifestQuants)
    .values({ ...k, locationId: loc.id, lotId, status, onHand: toDb(q) })
    .onConflictDoUpdate({
      target: [s.manifestQuants.tenantId, s.manifestQuants.productId, s.manifestQuants.variantId, s.manifestQuants.locationId, s.manifestQuants.lotId, s.manifestQuants.status],
      set: { onHand: sql`${s.manifestQuants.onHand} + ${toDb(q)}`, updatedAt: new Date() },
    })
}

const fmt = (d: Decimal) => (d.isInteger() ? d.toString() : d.toDecimalPlaces(4).toString())

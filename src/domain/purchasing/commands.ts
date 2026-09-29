import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { can } from "@/lib/permissions"
import { runCommand, type Actor } from "../command"
import { D, Decimal, toDb, ZERO } from "../decimal"
import { DomainError } from "../errors"
import { capitalize } from "../ledger/costing"
import { lockItems } from "../ledger/locks"
import { postMoves } from "../ledger/post"
import { nextNumber } from "../sequences"
import { decimal, parse } from "../validate"
import { ensureWorkspace, virtualLocation } from "../workspace"
import { PO_EDITABLE, PO_RECEIVABLE, poMachine, type PoEvent, type PoStatus } from "./machine"

type Po = typeof s.manifestPurchaseOrders.$inferSelect
type PoLine = typeof s.manifestPoLines.$inferSelect

const positive = decimal.refine((v) => D(v).gt(0), "Must be more than zero")
const nonNegative = decimal.refine((v) => D(v).gte(0), "Can't be negative")

const lineInput = z.object({
  /** Present for lines that already exist; omitted for new ones. */
  id: z.string().uuid().nullish(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
  supplierSku: z.string().trim().max(80).nullish(),
  qtyOrdered: positive,
  unitCost: nonNegative,
})

const header = {
  supplierId: z.string().uuid(),
  currency: z.string().trim().length(3).transform((c) => c.toUpperCase()).optional(),
  exchangeRate: positive.optional(),
  destinationId: z.string().uuid().nullish(),
  expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  supplierReference: z.string().trim().max(120).nullish(),
  taxAmount: nonNegative.optional(),
  shippingAmount: nonNegative.optional(),
  note: z.string().max(4000).nullish(),
}

export const createPoInput = z.object({ ...header, lines: z.array(lineInput).min(1, "Add at least one item"), idempotencyKey: z.string().max(200).nullish() })
export const updatePoInput = z.object({ id: z.string().uuid(), ...header, lines: z.array(lineInput).min(1, "An order needs at least one line") })

export async function createPurchaseOrder(db: Db, actor: Actor, raw: z.input<typeof createPoInput>) {
  const input = parse(createPoInput, raw)
  return runCommand(
    db,
    actor,
    { name: "po.create", permission: "purchasing.manage", input, entity: { type: "purchase_order" }, idempotencyKey: input.idempotencyKey },
    async (tx, cmd) => {
      const settings = await ensureWorkspace(tx, actor.tenantId)
      const supplier = await supplierOf(tx, actor.tenantId, input.supplierId)
      await assertItems(tx, actor.tenantId, input.lines)
      if (input.destinationId) await physical(tx, actor.tenantId, input.destinationId)
      const currency = input.currency ?? supplier.currency ?? settings.baseCurrency
      const number = await nextNumber(tx, actor.tenantId, "purchase_order")
      const [po] = await tx
        .insert(s.manifestPurchaseOrders)
        .values({
          tenantId: actor.tenantId,
          number,
          supplierId: supplier.id,
          currency,
          exchangeRate: currency === settings.baseCurrency ? "1" : toDb(input.exchangeRate ?? "1"),
          destinationId: input.destinationId ?? null,
          expectedOn: input.expectedOn || (supplier.leadTimeDays ? daysFromNow(supplier.leadTimeDays) : null),
          supplierReference: input.supplierReference ?? null,
          taxAmount: toDb(input.taxAmount ?? "0"),
          shippingAmount: toDb(input.shippingAmount ?? "0"),
          note: input.note ?? null,
          createdBy: actor.userId,
        })
        .returning()
      await tx.insert(s.manifestPoLines).values(input.lines.map((l, i) => lineRow(actor.tenantId, po.id, i + 1, l)))
      cmd.emit("po.created", { id: po.id, number })
      return { id: po.id, number }
    },
  )
}

/**
 * Edits an order. Before anything is received, everything can change. After,
 * the history is protected: a line can't drop below what's been received,
 * a received line's cost is fixed, and a line with receipts can't be removed.
 * Editing an approved order sends it back to draft for re-approval.
 */
export async function updatePurchaseOrder(db: Db, actor: Actor, raw: z.input<typeof updatePoInput>) {
  const input = parse(updatePoInput, raw)
  return runCommand(db, actor, { name: "po.update", permission: "purchasing.manage", input, entity: { type: "purchase_order", id: input.id } }, async (tx, cmd) => {
    const settings = await ensureWorkspace(tx, actor.tenantId)
    const po = await lockPo(tx, actor.tenantId, input.id)
    if (!PO_EDITABLE.includes(po.status)) throw new DomainError("po_locked", `A ${label(po.status)} order can't be edited.`)
    const placed = po.status === "sent" || po.status === "partially_received"
    if (input.supplierId !== po.supplierId) {
      if (placed) throw new DomainError("po_supplier_locked", "The supplier can't change once the order has been sent.")
      await supplierOf(tx, actor.tenantId, input.supplierId)
    }
    await assertItems(tx, actor.tenantId, input.lines)
    if (input.destinationId) await physical(tx, actor.tenantId, input.destinationId)

    const existing = await tx.select().from(s.manifestPoLines).where(eq(s.manifestPoLines.poId, po.id)).orderBy(asc(s.manifestPoLines.lineNo))
    const byId = new Map(existing.map((l) => [l.id, l]))
    const kept = new Set(input.lines.map((l) => l.id).filter(Boolean))
    for (const old of existing) {
      if (!kept.has(old.id) && D(old.qtyReceived).gt(0)) throw new DomainError("po_line_received", `Line ${old.lineNo} has been received and can't be removed. Reduce it to what arrived instead.`)
    }
    const removed = existing.filter((l) => !kept.has(l.id)).map((l) => l.id)
    if (removed.length) await tx.delete(s.manifestPoLines).where(inArray(s.manifestPoLines.id, removed))

    let lineNo = Math.max(0, ...existing.map((l) => l.lineNo))
    for (const l of input.lines) {
      const old = l.id ? byId.get(l.id) : undefined
      if (l.id && !old) throw new DomainError("not_found", "One of the lines no longer exists. Reload and try again.")
      if (!old) {
        await tx.insert(s.manifestPoLines).values(lineRow(actor.tenantId, po.id, ++lineNo, l))
        continue
      }
      const received = D(old.qtyReceived)
      if (received.gt(0)) {
        if (old.productId !== l.productId || (old.variantId ?? null) !== (l.variantId ?? null)) throw new DomainError("po_line_received", `Line ${old.lineNo} has been received; its item can't change.`)
        if (!D(old.unitCost).eq(l.unitCost)) throw new DomainError("po_line_received", `Line ${old.lineNo} has been received at ${D(old.unitCost).toFixed(2)}; its cost is fixed. Use a landed cost for extra charges.`)
        if (D(l.qtyOrdered).lt(received)) throw new DomainError("po_line_received", `Line ${old.lineNo}: ${received.toString()} already received, so it can't be less than that.`)
      }
      await tx
        .update(s.manifestPoLines)
        .set({ productId: l.productId, variantId: l.variantId ?? null, supplierSku: l.supplierSku ?? null, qtyOrdered: toDb(l.qtyOrdered), unitCost: toDb(l.unitCost) })
        .where(eq(s.manifestPoLines.id, old.id))
    }

    const currency = placed ? po.currency : (input.currency ?? po.currency)
    let status: PoStatus = po.status === "approved" ? "draft" : po.status
    if (placed) status = await receivingStatus(tx, po.id, po.status)
    await tx
      .update(s.manifestPurchaseOrders)
      .set({
        supplierId: input.supplierId,
        currency,
        exchangeRate: currency === settings.baseCurrency ? "1" : toDb(input.exchangeRate ?? po.exchangeRate),
        destinationId: input.destinationId ?? null,
        expectedOn: input.expectedOn || null,
        supplierReference: input.supplierReference ?? null,
        taxAmount: toDb(input.taxAmount ?? po.taxAmount),
        shippingAmount: toDb(input.shippingAmount ?? po.shippingAmount),
        note: input.note ?? null,
        status,
        ...(po.status === "approved" && { approvedBy: null, approvedAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(s.manifestPurchaseOrders.id, po.id))
    cmd.emit("po.updated", { id: po.id, number: po.number })
    return { id: po.id, status }
  })
}

/** approve · place (approve and send) · send · cancel · close */
export async function transitionPurchaseOrder(db: Db, actor: Actor, input: { id: string; event: PoEvent }) {
  const needs = input.event === "approve" ? "purchasing.approve" : "purchasing.manage"
  return runCommand(db, actor, { name: `po.${input.event}`, permission: needs, input, entity: { type: "purchase_order", id: input.id } }, async (tx, cmd) => {
    const settings = await ensureWorkspace(tx, actor.tenantId)
    const po = await lockPo(tx, actor.tenantId, input.id)
    const status = poMachine.next(po.status, input.event)
    const now = new Date()
    const patch: Partial<Po> = { status, updatedAt: now }

    if (input.event === "place") {
      const total = await orderTotal(tx, po)
      const threshold = settings.poApprovalThreshold
      if (threshold != null && total.mul(po.exchangeRate).gte(threshold) && !can(actor.role, "purchasing.approve")) {
        throw new DomainError("po_needs_approval", `Orders of ${D(threshold).toFixed(2)} ${settings.baseCurrency} or more need a manager's approval first.`)
      }
      Object.assign(patch, { approvedBy: actor.userId, approvedAt: now, sentAt: now })
    }
    if (input.event === "approve") Object.assign(patch, { approvedBy: actor.userId, approvedAt: now })
    if (input.event === "send") patch.sentAt = now
    if (input.event === "close" || input.event === "cancel") patch.closedAt = now
    if (input.event === "place" || input.event === "send") await rememberPrices(tx, po)

    await tx.update(s.manifestPurchaseOrders).set(patch).where(eq(s.manifestPurchaseOrders.id, po.id))
    cmd.emit(`po.${status}`, { id: po.id, number: po.number })
    return { id: po.id, status }
  })
}

export const receiveInput = z.object({
  poId: z.string().uuid(),
  receivedAt: z.coerce.date().optional(),
  reference: z.string().trim().max(120).nullish(),
  note: z.string().max(2000).nullish(),
  /** Base per unit of the order currency, if it differs from the rate on the order. */
  exchangeRate: positive.optional(),
  /** Accept more than ordered plus tolerance. Needs purchasing.approve. */
  allowOver: z.boolean().default(false),
  lines: z
    .array(z.object({ poLineId: z.string().uuid(), qty: positive, locationId: z.string().uuid().nullish(), quarantine: z.boolean().default(false) }))
    .min(1, "Enter what arrived"),
  idempotencyKey: z.string().max(200).nullish(),
})

/**
 * Receives stock against an order: one goods receipt, one move per line from
 * the supplier into the chosen bin, each valued at the order cost converted
 * to base currency. The order's received quantities and status follow.
 */
export async function receivePurchaseOrder(db: Db, actor: Actor, raw: z.input<typeof receiveInput>) {
  const input = parse(receiveInput, raw)
  return runCommand(
    db,
    actor,
    { name: "po.receive", permission: "purchasing.receive", input, entity: { type: "purchase_order", id: input.poId }, idempotencyKey: input.idempotencyKey },
    async (tx, cmd) => {
      const settings = await ensureWorkspace(tx, actor.tenantId)
      const po = await lockPo(tx, actor.tenantId, input.poId)
      if (!PO_RECEIVABLE.includes(po.status)) throw new DomainError("po_not_receivable", `A ${label(po.status)} order can't be received.`)
      const lines = new Map((await tx.select().from(s.manifestPoLines).where(eq(s.manifestPoLines.poId, po.id)).for("update")).map((l) => [l.id, l]))
      const supplierLoc = await virtualLocation(tx, actor.tenantId, "supplier")
      const rate = D(input.exchangeRate ?? po.exchangeRate)
      const tolerance = D(settings.overReceiptPct).div(100)
      const receivedAt = input.receivedAt ?? new Date()

      const planned = []
      for (const r of input.lines) {
        const line = lines.get(r.poLineId)
        if (!line) throw new DomainError("not_found", "One of those lines isn't on this order.")
        const outstanding = D(line.qtyOrdered).sub(line.qtyReceived)
        const limit = outstanding.add(D(line.qtyOrdered).mul(tolerance))
        if (D(r.qty).gt(limit) && !(input.allowOver && can(actor.role, "purchasing.approve"))) {
          throw new DomainError("over_receipt", `Line ${line.lineNo}: receiving ${D(r.qty).toString()} but only ${Decimal.max(outstanding, 0).toString()} is outstanding. A manager can accept the extra.`, {
            poLineId: line.id,
          })
        }
        const locationId = r.locationId ?? po.destinationId
        if (!locationId) throw new DomainError("location_required", `Choose where line ${line.lineNo} is going.`)
        await physical(tx, actor.tenantId, locationId)
        planned.push({ line, qty: D(r.qty), locationId, quarantine: r.quarantine, unitCost: D(line.unitCost).mul(rate) })
      }

      const number = await nextNumber(tx, actor.tenantId, "receipt")
      const receiptId = crypto.randomUUID()
      const moves = await postMoves(
        tx,
        cmd,
        planned.map((p) => ({
          productId: p.line.productId,
          variantId: p.line.variantId,
          fromLocationId: supplierLoc.id,
          toLocationId: p.locationId,
          toStatus: p.quarantine ? "quarantine" : "available",
          qty: p.qty,
          unitCost: p.unitCost,
          docType: "receipt",
          docId: receiptId,
          docLineId: p.line.id,
          docNumber: number,
          note: `${po.number}${input.reference ? ` · ${input.reference}` : ""}`,
          occurredAt: receivedAt,
        })),
      )
      await tx.insert(s.manifestReceipts).values({
        id: receiptId,
        tenantId: actor.tenantId,
        number,
        poId: po.id,
        supplierId: po.supplierId,
        exchangeRate: toDb(rate),
        receivedAt,
        reference: input.reference ?? null,
        note: input.note ?? null,
        receivedBy: actor.userId,
        commandId: cmd.id,
      })
      await tx.insert(s.manifestReceiptLines).values(
        planned.map((p, i) => ({
          tenantId: actor.tenantId,
          receiptId,
          poLineId: p.line.id,
          productId: p.line.productId,
          variantId: p.line.variantId,
          locationId: p.locationId,
          qty: toDb(p.qty),
          unitCost: toDb(p.unitCost),
          quarantined: p.quarantine ? ("yes" as const) : ("no" as const),
          moveId: moves[i].id,
        })),
      )
      for (const p of planned) {
        await tx
          .update(s.manifestPoLines)
          .set({ qtyReceived: sql`${s.manifestPoLines.qtyReceived} + ${toDb(p.qty)}` })
          .where(eq(s.manifestPoLines.id, p.line.id))
      }
      const status = await receivingStatus(tx, po.id, po.status)
      await tx.update(s.manifestPurchaseOrders).set({ status, sentAt: po.sentAt ?? receivedAt, updatedAt: new Date() }).where(eq(s.manifestPurchaseOrders.id, po.id))
      cmd.emit("po.received", { id: po.id, number: po.number, receipt: number, status })
      return { id: receiptId, number, commandId: cmd.id, status, fullyReceived: status === "received" }
    },
  )
}

/**
 * Called when a receipt's moves are reversed (Undo): takes the quantities back
 * off the order and marks the receipt reversed. Receipts that already carry
 * landed costs can't be undone, since that value has been spread into stock.
 */
export async function assertReceiptReversible(tx: Db, tenantId: string, receiptId: string) {
  const [receipt] = await tx
    .select()
    .from(s.manifestReceipts)
    .where(and(eq(s.manifestReceipts.tenantId, tenantId), eq(s.manifestReceipts.id, receiptId)))
    .for("update")
  if (!receipt) return null
  const [landed] = await tx.select({ id: s.manifestLandedCosts.id }).from(s.manifestLandedCosts).where(eq(s.manifestLandedCosts.receiptId, receipt.id)).limit(1)
  if (landed) throw new DomainError("receipt_has_landed_costs", `${receipt.number} has landed costs on it, so it can't be undone. Post a return to the supplier instead.`)
  return receipt
}

export async function afterReceiptReversed(tx: Db, tenantId: string, receiptId: string) {
  const receipt = await assertReceiptReversible(tx, tenantId, receiptId)
  if (!receipt) return
  const lines = await tx.select().from(s.manifestReceiptLines).where(eq(s.manifestReceiptLines.receiptId, receipt.id))
  for (const l of lines) {
    if (!l.poLineId) continue
    await tx
      .update(s.manifestPoLines)
      .set({ qtyReceived: sql`greatest(${s.manifestPoLines.qtyReceived} - ${l.qty}, 0)` })
      .where(eq(s.manifestPoLines.id, l.poLineId))
  }
  await tx.update(s.manifestReceipts).set({ status: "reversed" }).where(eq(s.manifestReceipts.id, receipt.id))
  if (receipt.poId) {
    const po = await lockPo(tx, tenantId, receipt.poId)
    if (po.status !== "closed") {
      const status = await receivingStatus(tx, po.id, po.status)
      await tx.update(s.manifestPurchaseOrders).set({ status, updatedAt: new Date() }).where(eq(s.manifestPurchaseOrders.id, po.id))
    }
  }
}

export const landedCostInput = z.object({
  receiptId: z.string().uuid(),
  description: z.string().trim().min(1, "Describe the charge").max(200),
  amount: decimal.refine((v) => !D(v).isZero(), "Enter an amount"),
  method: z.enum(["value", "quantity"]).default("value"),
})

/**
 * Spreads freight, duty or fees over a receipt's lines (by value or by
 * quantity) and raises the cost of what's still on hand. Negative amounts are
 * credits. Final once posted: correct with another landed cost.
 */
export async function addLandedCost(db: Db, actor: Actor, raw: z.input<typeof landedCostInput>) {
  const input = parse(landedCostInput, raw)
  return runCommand(db, actor, { name: "receipt.landed_cost", permission: "purchasing.manage", input, entity: { type: "receipt", id: input.receiptId } }, async (tx, cmd) => {
    const settings = await ensureWorkspace(tx, actor.tenantId)
    const [receipt] = await tx
      .select()
      .from(s.manifestReceipts)
      .where(and(eq(s.manifestReceipts.tenantId, actor.tenantId), eq(s.manifestReceipts.id, input.receiptId)))
      .for("update")
    if (!receipt) throw new DomainError("not_found", "That receipt doesn't exist in this workspace.")
    if (receipt.status !== "posted") throw new DomainError("receipt_reversed", `${receipt.number} was undone; landed costs can't go on it.`)
    const lines = await tx.select().from(s.manifestReceiptLines).where(eq(s.manifestReceiptLines.receiptId, receipt.id)).orderBy(asc(s.manifestReceiptLines.id))
    await lockItems(tx, lines.map((l) => ({ tenantId: actor.tenantId, productId: l.productId, variantId: l.variantId })))

    const amount = D(input.amount)
    const basis = lines.map((l) => (input.method === "value" ? D(l.qty).mul(l.unitCost) : D(l.qty)))
    const total = basis.reduce((a, b) => a.add(b), ZERO)
    if (total.isZero()) throw new DomainError("no_basis", "These lines have no value to spread a cost over. Split it by quantity instead.")

    const [lc] = await tx
      .insert(s.manifestLandedCosts)
      .values({ tenantId: actor.tenantId, receiptId: receipt.id, description: input.description, amount: toDb(amount), method: input.method, postedBy: actor.userId, commandId: cmd.id })
      .returning()
    let left = amount
    let capitalizedTotal = ZERO
    for (const [i, l] of lines.entries()) {
      // The last line takes the rounding remainder, so shares always sum to the amount.
      const share = i === lines.length - 1 ? left : amount.mul(basis[i]).div(total).toDecimalPlaces(4)
      left = left.sub(share)
      const capitalized = l.moveId
        ? await capitalize(tx, settings.costingMethod, { tenantId: actor.tenantId, productId: l.productId, variantId: l.variantId }, l.moveId, D(l.qty), share)
        : ZERO
      capitalizedTotal = capitalizedTotal.add(capitalized)
      await tx.insert(s.manifestLandedCostAllocations).values({
        tenantId: actor.tenantId,
        landedCostId: lc.id,
        receiptLineId: l.id,
        productId: l.productId,
        variantId: l.variantId,
        amount: toDb(share),
        capitalized: toDb(capitalized),
        expensed: toDb(share.sub(capitalized)),
      })
    }
    cmd.emit("valuation.changed", { receiptId: receipt.id, landedCostId: lc.id, capitalized: capitalizedTotal.toFixed(4) })
    return { id: lc.id, capitalized: capitalizedTotal.toFixed(4), expensed: amount.sub(capitalizedTotal).toFixed(4) }
  })
}

// --- helpers -------------------------------------------------------------------

function lineRow(tenantId: string, poId: string, lineNo: number, l: z.output<typeof lineInput>) {
  return {
    tenantId,
    poId,
    lineNo,
    productId: l.productId,
    variantId: l.variantId ?? null,
    supplierSku: l.supplierSku ?? null,
    qtyOrdered: toDb(l.qtyOrdered),
    unitCost: toDb(l.unitCost),
  }
}

const label = (status: string) => status.replaceAll("_", " ")
const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function lockPo(tx: Db, tenantId: string, id: string) {
  const [po] = await tx
    .select()
    .from(s.manifestPurchaseOrders)
    .where(and(eq(s.manifestPurchaseOrders.tenantId, tenantId), eq(s.manifestPurchaseOrders.id, id)))
    .for("update")
  if (!po) throw new DomainError("not_found", "That purchase order doesn't exist in this workspace.")
  return po
}

async function supplierOf(tx: Db, tenantId: string, id: string) {
  const [supplier] = await tx
    .select()
    .from(s.suppliers)
    .where(and(eq(s.suppliers.tenantId, tenantId), eq(s.suppliers.id, id), isNull(s.suppliers.deletedAt)))
  if (!supplier) throw new DomainError("supplier_not_found", "That supplier doesn't exist in this workspace.")
  if (supplier.isActive === false) throw new DomainError("supplier_inactive", `${supplier.name} is inactive. Reactivate them to order.`)
  return supplier
}

async function physical(tx: Db, tenantId: string, id: string) {
  const [loc] = await tx.select().from(s.manifestLocations).where(and(eq(s.manifestLocations.tenantId, tenantId), eq(s.manifestLocations.id, id)))
  if (!loc || loc.isVirtual || loc.archivedAt) throw new DomainError("location_not_found", "Choose an active location in this workspace.")
  return loc
}

async function assertItems(tx: Db, tenantId: string, lines: { productId: string; variantId?: string | null }[]) {
  const ids = [...new Set(lines.map((l) => l.productId))]
  const rows = await tx
    .select({ id: s.products.id, name: s.products.name, hasVariants: s.products.hasVariants })
    .from(s.products)
    .where(and(eq(s.products.tenantId, tenantId), inArray(s.products.id, ids), isNull(s.products.deletedAt)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const l of lines) {
    const p = byId.get(l.productId)
    if (!p) throw new DomainError("item_not_found", "One of the items no longer exists in this workspace.")
    if (p.hasVariants && !l.variantId) throw new DomainError("variant_required", `${p.name} has variants. Order a specific one.`)
  }
}

async function orderTotal(tx: Db, po: Po) {
  const [row] = await tx
    .select({ subtotal: sql<string>`coalesce(sum(${s.manifestPoLines.qtyOrdered} * ${s.manifestPoLines.unitCost}), 0)` })
    .from(s.manifestPoLines)
    .where(eq(s.manifestPoLines.poId, po.id))
  return D(row?.subtotal).add(po.taxAmount).add(po.shippingAmount)
}

/** Status implied by the received quantities, for orders already placed. */
async function receivingStatus(tx: Db, poId: string, current: PoStatus): Promise<PoStatus> {
  const lines: PoLine[] = await tx.select().from(s.manifestPoLines).where(eq(s.manifestPoLines.poId, poId))
  const any = lines.some((l) => D(l.qtyReceived).gt(0))
  const all = lines.every((l) => D(l.qtyReceived).gte(l.qtyOrdered))
  if (all) return "received"
  if (any) return "partially_received"
  return current === "approved" || current === "draft" ? current : "sent"
}

/** Placing an order teaches Manifest the supplier's current prices. */
async function rememberPrices(tx: Db, po: Po) {
  const lines = await tx.select().from(s.manifestPoLines).where(eq(s.manifestPoLines.poId, po.id))
  const now = new Date()
  for (const l of lines) {
    const values = { unitCost: l.unitCost, currency: po.currency, supplierSku: l.supplierSku, lastOrderedAt: now, updatedAt: now }
    await tx
      .insert(s.manifestSupplierItems)
      .values({ tenantId: po.tenantId, supplierId: po.supplierId, productId: l.productId, variantId: l.variantId, ...values })
      .onConflictDoUpdate({
        target: [s.manifestSupplierItems.tenantId, s.manifestSupplierItems.supplierId, s.manifestSupplierItems.productId, s.manifestSupplierItems.variantId],
        set: { ...values, supplierSku: sql`coalesce(${l.supplierSku}, ${s.manifestSupplierItems.supplierSku})` },
      })
  }
}

/** Best starting cost for a new PO line: this supplier's last price, else the item's catalog cost. */
export async function suggestedLine(db: Db, tenantId: string, supplierId: string, productId: string, variantId: string | null) {
  const [known] = await db
    .select()
    .from(s.manifestSupplierItems)
    .where(
      and(
        eq(s.manifestSupplierItems.tenantId, tenantId),
        eq(s.manifestSupplierItems.supplierId, supplierId),
        eq(s.manifestSupplierItems.productId, productId),
        variantId ? eq(s.manifestSupplierItems.variantId, variantId) : isNull(s.manifestSupplierItems.variantId),
      ),
    )
    .orderBy(desc(s.manifestSupplierItems.updatedAt))
    .limit(1)
  if (known) return { unitCost: known.unitCost, currency: known.currency, supplierSku: known.supplierSku, minQty: known.minQty, source: "supplier" as const }
  const [item] = variantId
    ? await db.select({ cost: s.productVariants.costPrice }).from(s.productVariants).where(eq(s.productVariants.id, variantId))
    : await db.select({ cost: s.products.costPrice }).from(s.products).where(eq(s.products.id, productId))
  return { unitCost: item?.cost ?? null, currency: null, supplierSku: null, minQty: null, source: "catalog" as const }
}

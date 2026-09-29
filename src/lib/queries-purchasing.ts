import "server-only"
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db, schema as s } from "@/lib/db"
import { outer } from "@/lib/db/sql"

const itemName = sql<string>`${s.products.name} || coalesce(' (' || ${s.productVariants.name} || ')', '')`
const itemSku = sql<string | null>`coalesce(${s.productVariants.sku}, ${s.products.sku})`

export const PO_TABS = {
  draft: ["draft", "approved"],
  open: ["sent", "partially_received"],
  received: ["received"],
  closed: ["closed", "cancelled"],
} as const
export type PoTab = keyof typeof PO_TABS

export async function listPurchaseOrders(tenantId: string, tab?: PoTab, supplierId?: string) {
  return db
    .select({
      id: s.manifestPurchaseOrders.id,
      number: s.manifestPurchaseOrders.number,
      status: s.manifestPurchaseOrders.status,
      supplierId: s.manifestPurchaseOrders.supplierId,
      supplier: s.suppliers.name,
      currency: s.manifestPurchaseOrders.currency,
      expectedOn: s.manifestPurchaseOrders.expectedOn,
      createdAt: s.manifestPurchaseOrders.createdAt,
      subtotal: sql<string>`coalesce((SELECT sum(l.qty_ordered * l.unit_cost) FROM ${s.manifestPoLines} l WHERE l.po_id = ${outer(s.manifestPurchaseOrders.id)}), 0)`,
      total: sql<string>`coalesce((SELECT sum(l.qty_ordered * l.unit_cost) FROM ${s.manifestPoLines} l WHERE l.po_id = ${outer(s.manifestPurchaseOrders.id)}), 0) + ${outer(s.manifestPurchaseOrders.taxAmount)} + ${outer(s.manifestPurchaseOrders.shippingAmount)}`,
      ordered: sql<string>`coalesce((SELECT sum(l.qty_ordered) FROM ${s.manifestPoLines} l WHERE l.po_id = ${outer(s.manifestPurchaseOrders.id)}), 0)`,
      received: sql<string>`coalesce((SELECT sum(least(l.qty_received, l.qty_ordered)) FROM ${s.manifestPoLines} l WHERE l.po_id = ${outer(s.manifestPurchaseOrders.id)}), 0)`,
      lines: sql<number>`(SELECT count(*) FROM ${s.manifestPoLines} l WHERE l.po_id = ${outer(s.manifestPurchaseOrders.id)})::int`,
    })
    .from(s.manifestPurchaseOrders)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.manifestPurchaseOrders.supplierId))
    .where(
      and(
        eq(s.manifestPurchaseOrders.tenantId, tenantId),
        tab ? inArray(s.manifestPurchaseOrders.status, [...PO_TABS[tab]]) : undefined,
        supplierId ? eq(s.manifestPurchaseOrders.supplierId, supplierId) : undefined,
      ),
    )
    .orderBy(desc(s.manifestPurchaseOrders.createdAt))
    .limit(300)
}

export async function poTabCounts(tenantId: string) {
  const rows = await db
    .select({ status: s.manifestPurchaseOrders.status, n: sql<number>`count(*)::int` })
    .from(s.manifestPurchaseOrders)
    .where(eq(s.manifestPurchaseOrders.tenantId, tenantId))
    .groupBy(s.manifestPurchaseOrders.status)
  const count = (statuses: readonly string[]) => rows.filter((r) => statuses.includes(r.status)).reduce((a, r) => a + r.n, 0)
  return Object.fromEntries(Object.entries(PO_TABS).map(([k, v]) => [k, count(v)])) as Record<PoTab, number>
}

export async function getPurchaseOrder(tenantId: string, id: string) {
  const destination = alias(s.manifestLocations, "destination")
  const [row] = await db
    .select({ po: s.manifestPurchaseOrders, supplier: s.suppliers, destination: { id: destination.id, code: destination.code, path: destination.path }, author: s.user.name })
    .from(s.manifestPurchaseOrders)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.manifestPurchaseOrders.supplierId))
    .leftJoin(destination, eq(destination.id, s.manifestPurchaseOrders.destinationId))
    .leftJoin(s.user, eq(s.user.id, s.manifestPurchaseOrders.createdBy))
    .where(and(eq(s.manifestPurchaseOrders.tenantId, tenantId), eq(s.manifestPurchaseOrders.id, id)))
  if (!row) return null
  const lines = await db
    .select({
      id: s.manifestPoLines.id,
      lineNo: s.manifestPoLines.lineNo,
      productId: s.manifestPoLines.productId,
      variantId: s.manifestPoLines.variantId,
      name: itemName,
      sku: itemSku,
      supplierSku: s.manifestPoLines.supplierSku,
      barcode: sql<string | null>`coalesce(${s.productVariants.barcode}, ${s.products.barcode})`,
      qtyOrdered: s.manifestPoLines.qtyOrdered,
      qtyReceived: s.manifestPoLines.qtyReceived,
      unitCost: s.manifestPoLines.unitCost,
    })
    .from(s.manifestPoLines)
    .innerJoin(s.products, eq(s.products.id, s.manifestPoLines.productId))
    .leftJoin(s.productVariants, eq(s.productVariants.id, s.manifestPoLines.variantId))
    .where(eq(s.manifestPoLines.poId, id))
    .orderBy(asc(s.manifestPoLines.lineNo))
  const receipts = await db
    .select({
      id: s.manifestReceipts.id,
      number: s.manifestReceipts.number,
      status: s.manifestReceipts.status,
      receivedAt: s.manifestReceipts.receivedAt,
      reference: s.manifestReceipts.reference,
      by: s.user.name,
      units: sql<string>`(SELECT sum(l.qty) FROM ${s.manifestReceiptLines} l WHERE l.receipt_id = ${outer(s.manifestReceipts.id)})`,
      landed: sql<string | null>`(SELECT sum(c.amount) FROM ${s.manifestLandedCosts} c WHERE c.receipt_id = ${outer(s.manifestReceipts.id)})`,
    })
    .from(s.manifestReceipts)
    .leftJoin(s.user, eq(s.user.id, s.manifestReceipts.receivedBy))
    .where(eq(s.manifestReceipts.poId, id))
    .orderBy(desc(s.manifestReceipts.receivedAt))
  return { ...row, lines, receipts }
}

export async function getReceipt(tenantId: string, id: string) {
  const [row] = await db
    .select({ receipt: s.manifestReceipts, supplier: s.suppliers.name, po: { id: s.manifestPurchaseOrders.id, number: s.manifestPurchaseOrders.number, currency: s.manifestPurchaseOrders.currency }, by: s.user.name })
    .from(s.manifestReceipts)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.manifestReceipts.supplierId))
    .leftJoin(s.manifestPurchaseOrders, eq(s.manifestPurchaseOrders.id, s.manifestReceipts.poId))
    .leftJoin(s.user, eq(s.user.id, s.manifestReceipts.receivedBy))
    .where(and(eq(s.manifestReceipts.tenantId, tenantId), eq(s.manifestReceipts.id, id)))
  if (!row) return null
  const lines = await db
    .select({
      id: s.manifestReceiptLines.id,
      productId: s.manifestReceiptLines.productId,
      variantId: s.manifestReceiptLines.variantId,
      name: itemName,
      sku: itemSku,
      qty: s.manifestReceiptLines.qty,
      unitCost: s.manifestReceiptLines.unitCost,
      location: s.manifestLocations.path,
      quarantined: s.manifestReceiptLines.quarantined,
      landed: sql<string>`coalesce((SELECT sum(a.amount) FROM ${s.manifestLandedCostAllocations} a WHERE a.receipt_line_id = ${outer(s.manifestReceiptLines.id)}), 0)`,
    })
    .from(s.manifestReceiptLines)
    .innerJoin(s.products, eq(s.products.id, s.manifestReceiptLines.productId))
    .leftJoin(s.productVariants, eq(s.productVariants.id, s.manifestReceiptLines.variantId))
    .innerJoin(s.manifestLocations, eq(s.manifestLocations.id, s.manifestReceiptLines.locationId))
    .where(eq(s.manifestReceiptLines.receiptId, id))
  const landedCosts = await db
    .select({
      id: s.manifestLandedCosts.id,
      description: s.manifestLandedCosts.description,
      amount: s.manifestLandedCosts.amount,
      method: s.manifestLandedCosts.method,
      createdAt: s.manifestLandedCosts.createdAt,
      capitalized: sql<string>`(SELECT sum(a.capitalized) FROM ${s.manifestLandedCostAllocations} a WHERE a.landed_cost_id = ${outer(s.manifestLandedCosts.id)})`,
      expensed: sql<string>`(SELECT sum(a.expensed) FROM ${s.manifestLandedCostAllocations} a WHERE a.landed_cost_id = ${outer(s.manifestLandedCosts.id)})`,
    })
    .from(s.manifestLandedCosts)
    .where(eq(s.manifestLandedCosts.receiptId, id))
    .orderBy(asc(s.manifestLandedCosts.createdAt))
  return { ...row, lines, landedCosts }
}

/** Placed orders expected within the next few days (or late), for the Today inbox. */
export async function receiptsDue(tenantId: string, days = 3) {
  const horizon = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
  return db
    .select({ id: s.manifestPurchaseOrders.id, number: s.manifestPurchaseOrders.number, supplier: s.suppliers.name, expectedOn: s.manifestPurchaseOrders.expectedOn, status: s.manifestPurchaseOrders.status })
    .from(s.manifestPurchaseOrders)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.manifestPurchaseOrders.supplierId))
    .where(
      and(
        eq(s.manifestPurchaseOrders.tenantId, tenantId),
        inArray(s.manifestPurchaseOrders.status, ["sent", "partially_received"]),
        lte(s.manifestPurchaseOrders.expectedOn, horizon),
      ),
    )
    .orderBy(asc(s.manifestPurchaseOrders.expectedOn))
    .limit(8)
}

export async function listSuppliers(tenantId: string) {
  return db
    .select({ id: s.suppliers.id, name: s.suppliers.name, currency: s.suppliers.currency, leadTimeDays: s.suppliers.leadTimeDays, isActive: s.suppliers.isActive })
    .from(s.suppliers)
    .where(and(eq(s.suppliers.tenantId, tenantId), isNull(s.suppliers.deletedAt)))
    .orderBy(asc(s.suppliers.name))
}

export async function poIdByNumber(tenantId: string, number: string) {
  const [row] = await db
    .select({ id: s.manifestPurchaseOrders.id })
    .from(s.manifestPurchaseOrders)
    .where(and(eq(s.manifestPurchaseOrders.tenantId, tenantId), sql`upper(${s.manifestPurchaseOrders.number}) = upper(${number})`))
  return row?.id ?? null
}

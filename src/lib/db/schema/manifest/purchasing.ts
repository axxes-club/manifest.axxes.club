import { sql } from "drizzle-orm"
import { check, date, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { tenants } from "../tenants"
import { products, productVariants } from "../inventory"
import { suppliers } from "../inventree"
import { manifestLocations, manifestStockMoves, money, qty } from "./core"

const at = (name: string) => timestamp(name, { withTimezone: true })
/** Exchange rates: base currency per one unit of the document currency. */
const rate = (name: string) => qty(name)

export const manifestPoStatus = pgEnum("manifest_po_status", ["draft", "approved", "sent", "partially_received", "received", "closed", "cancelled"])

export const manifestPurchaseOrders = pgTable(
  "manifest_purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    status: manifestPoStatus("status").notNull().default("draft"),
    currency: text("currency").notNull(),
    /** Snapshotted when the order is placed; receipts value stock at this rate unless overridden. */
    exchangeRate: rate("exchange_rate").notNull().default("1"),
    /** Where it's being delivered; receiving defaults here. */
    destinationId: uuid("destination_id").references(() => manifestLocations.id),
    expectedOn: date("expected_on"),
    supplierReference: text("supplier_reference"),
    taxAmount: money("tax_amount").notNull().default("0"),
    shippingAmount: money("shipping_amount").notNull().default("0"),
    note: text("note"),
    createdBy: text("created_by"),
    approvedBy: text("approved_by"),
    approvedAt: at("approved_at"),
    sentAt: at("sent_at"),
    closedAt: at("closed_at"),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("manifest_purchase_orders_number_uq").on(t.tenantId, t.number),
    index("manifest_purchase_orders_status_idx").on(t.tenantId, t.status),
    index("manifest_purchase_orders_supplier_idx").on(t.tenantId, t.supplierId),
  ],
)

export const manifestPoLines = pgTable(
  "manifest_po_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    poId: uuid("po_id").notNull().references(() => manifestPurchaseOrders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull().references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    supplierSku: text("supplier_sku"),
    qtyOrdered: qty("qty_ordered").notNull(),
    /** Maintained by receipts (and their reversals). Never edited directly. */
    qtyReceived: qty("qty_received").notNull().default("0"),
    /** In the order's currency. */
    unitCost: money("unit_cost").notNull(),
  },
  (t) => [
    index("manifest_po_lines_po_idx").on(t.poId),
    check("manifest_po_lines_qty", sql`${t.qtyOrdered} > 0 AND ${t.qtyReceived} >= 0`),
  ],
)

export const manifestReceiptStatus = pgEnum("manifest_receipt_status", ["posted", "reversed"])

/** A goods receipt (GRN): what physically arrived, where it went, at what cost. */
export const manifestReceipts = pgTable(
  "manifest_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    poId: uuid("po_id").references(() => manifestPurchaseOrders.id),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    status: manifestReceiptStatus("status").notNull().default("posted"),
    exchangeRate: rate("exchange_rate").notNull().default("1"),
    receivedAt: at("received_at").notNull(),
    reference: text("reference"),
    note: text("note"),
    receivedBy: text("received_by"),
    commandId: uuid("command_id").notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("manifest_receipts_number_uq").on(t.tenantId, t.number), index("manifest_receipts_po_idx").on(t.poId)],
)

export const manifestReceiptLines = pgTable(
  "manifest_receipt_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id").notNull().references(() => manifestReceipts.id, { onDelete: "cascade" }),
    poLineId: uuid("po_line_id").references(() => manifestPoLines.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    locationId: uuid("location_id").notNull().references(() => manifestLocations.id),
    qty: qty("qty").notNull(),
    /** Base currency, after the exchange rate. */
    unitCost: money("unit_cost").notNull(),
    quarantined: text("quarantined").$type<"yes" | "no">().notNull().default("no"),
    moveId: uuid("move_id").references(() => manifestStockMoves.id),
  },
  (t) => [index("manifest_receipt_lines_receipt_idx").on(t.receiptId), check("manifest_receipt_lines_qty", sql`${t.qty} > 0`)],
)

export const manifestLandedCostMethod = pgEnum("manifest_landed_cost_method", ["value", "quantity"])

/** Freight, duty and fees spread over a receipt's lines, raising their cost. */
export const manifestLandedCosts = pgTable(
  "manifest_landed_costs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id").notNull().references(() => manifestReceipts.id),
    description: text("description").notNull(),
    /** Base currency. Negative for a credit (a refunded fee). */
    amount: money("amount").notNull(),
    method: manifestLandedCostMethod("method").notNull().default("value"),
    postedBy: text("posted_by"),
    commandId: uuid("command_id").notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
  },
  (t) => [index("manifest_landed_costs_receipt_idx").on(t.receiptId)],
)

/**
 * Where each landed cost went. The share on stock still on hand is added to
 * its cost (capitalized); the share on stock already sold or scrapped can't be
 * put back on the shelf, so it's recorded as a cost variance (expensed).
 */
export const manifestLandedCostAllocations = pgTable(
  "manifest_landed_cost_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    landedCostId: uuid("landed_cost_id").notNull().references(() => manifestLandedCosts.id, { onDelete: "cascade" }),
    receiptLineId: uuid("receipt_line_id").notNull().references(() => manifestReceiptLines.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    amount: money("amount").notNull(),
    capitalized: money("capitalized").notNull(),
    expensed: money("expensed").notNull(),
  },
  (t) => [index("manifest_landed_cost_allocations_lc_idx").on(t.landedCostId)],
)

/** What a supplier sells an item for: pre-fills PO lines and feeds reorder suggestions. */
export const manifestSupplierItems = pgTable(
  "manifest_supplier_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    supplierSku: text("supplier_sku"),
    /** In the supplier's currency. Updated from the last placed order. */
    unitCost: money("unit_cost").notNull(),
    currency: text("currency").notNull(),
    minQty: qty("min_qty"),
    leadTimeDays: integer("lead_time_days"),
    lastOrderedAt: at("last_ordered_at"),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("manifest_supplier_items_uq").on(t.tenantId, t.supplierId, t.productId, t.variantId).nullsNotDistinct()],
)

import { sql } from "drizzle-orm"
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { tenants } from "../tenants"
import { inventoryLocations, products, productVariants } from "../inventory"

/** Quantities are always in the item's base unit. */
export const qty = (name: string) => numeric(name, { precision: 18, scale: 4 })
/** Money is in the tenant's base currency unless a column says otherwise. */
export const money = (name: string) => numeric(name, { precision: 18, scale: 4 })
const at = (name: string) => timestamp(name, { withTimezone: true })

export const manifestCostingMethod = pgEnum("manifest_costing_method", ["fifo", "average"])

/** One row per workspace. Created lazily on first use. */
export const manifestSettings = pgTable("manifest_settings", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  blueprint: text("blueprint").notNull().default("brand"),
  costingMethod: manifestCostingMethod("costing_method").notNull().default("fifo"),
  baseCurrency: text("base_currency").notNull().default("USD"),
  locale: text("locale").notNull().default("en-US"),
  /** Nothing may post with an occurred date on or before this day. */
  lockDate: date("lock_date"),
  /** Mirror ledger totals into products.quantity / inventory_levels for members, Pulse and the storefront feed. */
  syncLegacy: boolean("sync_legacy").notNull().default(true),
  /** How far over the ordered quantity a receipt may go without an override, in percent. */
  overReceiptPct: numeric("over_receipt_pct", { precision: 6, scale: 2 }).notNull().default("0"),
  /** Orders at or above this total (base currency) need a manager to approve them. Null means no approval step. */
  poApprovalThreshold: numeric("po_approval_threshold", { precision: 18, scale: 4 }),
  onboardedAt: at("onboarded_at"),
  createdAt: at("created_at").defaultNow().notNull(),
  updatedAt: at("updated_at").defaultNow().notNull(),
})

/** Gap-free document numbers per workspace, e.g. ADJ-000042. */
export const manifestSequences = pgTable(
  "manifest_sequences",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    prefix: text("prefix").notNull(),
    next: integer("next").notNull().default(1),
    padding: integer("padding").notNull().default(6),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
)

export const manifestLocationKind = pgEnum("manifest_location_kind", [
  // Physical
  "warehouse",
  "zone",
  "bin",
  "venue",
  "popup",
  "vehicle",
  // Virtual counterparts every move needs a side for
  "supplier",
  "customer",
  "adjustment",
  "production",
  "scrap",
  "transit",
  "consignee",
])

export const VIRTUAL_LOCATION_KINDS = ["supplier", "customer", "adjustment", "production", "scrap", "transit", "consignee"] as const

/** Where stock physically is, as a tree. Virtual locations are the other side of a move into or out of the business. */
export const manifestLocations = pgTable(
  "manifest_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    kind: manifestLocationKind("kind").notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    /** Materialised breadcrumb, e.g. "MAIN / A / A-01-2". Rebuilt when the tree changes. */
    path: text("path").notNull(),
    isVirtual: boolean("is_virtual").notNull().default(false),
    /** Virtual transit/consignee stock is still ours, so it counts toward valuation. */
    isValued: boolean("is_valued").notNull().default(true),
    allowNegative: boolean("allow_negative").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    address: jsonb("address").$type<{ line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }>(),
    /** members' inventory_levels row kept in sync with this location's totals. */
    legacyLocationId: uuid("legacy_location_id").references(() => inventoryLocations.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
    archivedAt: at("archived_at"),
  },
  (t) => [
    uniqueIndex("manifest_locations_code_uq").on(t.tenantId, t.code),
    index("manifest_locations_parent_idx").on(t.tenantId, t.parentId),
  ],
)

export const manifestTracking = pgEnum("manifest_tracking", ["none", "lot", "serial"])

/** Manifest's operational settings for a stockable product or variant. The catalog itself stays in the shared products tables. */
export const manifestItemProfiles = pgTable(
  "manifest_item_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    tracking: manifestTracking("tracking").notNull().default("none"),
    unit: text("unit").notNull().default("each"),
    reorderPoint: qty("reorder_point"),
    reorderQty: qty("reorder_qty"),
    safetyStock: qty("safety_stock"),
    leadTimeDays: integer("lead_time_days"),
    defaultLocationId: uuid("default_location_id").references(() => manifestLocations.id, { onDelete: "set null" }),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("manifest_item_profiles_item_uq").on(t.tenantId, t.productId, t.variantId).nullsNotDistinct()],
)

export const manifestLots = pgTable(
  "manifest_lots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    isSerial: boolean("is_serial").notNull().default(false),
    expiresOn: date("expires_on"),
    createdAt: at("created_at").defaultNow().notNull(),
  },
  (t) => [unique("manifest_lots_code_uq").on(t.tenantId, t.productId, t.variantId, t.code).nullsNotDistinct()],
)

export const manifestStockStatus = pgEnum("manifest_stock_status", ["available", "quarantine", "hold"])

/**
 * The ledger. Every change to stock is a move from one location to another, and
 * moves are never updated or deleted: a mistake is fixed with a reversal move.
 */
export const manifestStockMoves = pgTable(
  "manifest_stock_moves",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** All moves posted by one command share this, so a document's effect can be viewed or reversed as a unit. */
    commandId: uuid("command_id").notNull(),
    productId: uuid("product_id").notNull().references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    lotId: uuid("lot_id").references(() => manifestLots.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => manifestLocations.id),
    toLocationId: uuid("to_location_id").notNull().references(() => manifestLocations.id),
    fromStatus: manifestStockStatus("from_status").notNull().default("available"),
    toStatus: manifestStockStatus("to_status").notNull().default("available"),
    qty: qty("qty").notNull(),
    /** Base-currency cost per unit carried by this move (FIFO layers consumed, or the average at the time). */
    unitCost: money("unit_cost").notNull().default("0"),
    totalCost: money("total_cost").notNull().default("0"),
    docType: text("doc_type").notNull(),
    docId: uuid("doc_id"),
    docLineId: uuid("doc_line_id"),
    docNumber: text("doc_number"),
    reason: text("reason"),
    note: text("note"),
    actorId: text("actor_id"),
    occurredAt: at("occurred_at").notNull(),
    postedAt: at("posted_at").defaultNow().notNull(),
    reversalOf: uuid("reversal_of"),
  },
  (t) => [
    check("manifest_stock_moves_qty_positive", sql`${t.qty} > 0`),
    check("manifest_stock_moves_distinct_sides", sql`${t.fromLocationId} <> ${t.toLocationId} OR ${t.fromStatus} <> ${t.toStatus}`),
    index("manifest_stock_moves_item_idx").on(t.tenantId, t.productId, t.variantId, t.occurredAt),
    index("manifest_stock_moves_from_idx").on(t.tenantId, t.fromLocationId, t.occurredAt),
    index("manifest_stock_moves_to_idx").on(t.tenantId, t.toLocationId, t.occurredAt),
    index("manifest_stock_moves_doc_idx").on(t.tenantId, t.docType, t.docId),
    index("manifest_stock_moves_command_idx").on(t.commandId),
    uniqueIndex("manifest_stock_moves_reversal_uq").on(t.reversalOf),
  ],
)

/** Current stock per item, location, lot and status. A projection of the moves, updated in the same transaction. */
export const manifestQuants = pgTable(
  "manifest_quants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    locationId: uuid("location_id").notNull().references(() => manifestLocations.id),
    lotId: uuid("lot_id").references(() => manifestLots.id),
    status: manifestStockStatus("status").notNull().default("available"),
    onHand: qty("on_hand").notNull().default("0"),
    reserved: qty("reserved").notNull().default("0"),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("manifest_quants_key_uq").on(t.tenantId, t.productId, t.variantId, t.locationId, t.lotId, t.status).nullsNotDistinct(),
    index("manifest_quants_location_idx").on(t.tenantId, t.locationId),
    check("manifest_quants_reserved_nonneg", sql`${t.reserved} >= 0`),
  ],
)

/** FIFO cost layers: each valued receipt opens one, outbound moves consume the oldest first. */
export const manifestCostLayers = pgTable(
  "manifest_cost_layers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    moveId: uuid("move_id").notNull().references(() => manifestStockMoves.id),
    qtyIn: qty("qty_in").notNull(),
    qtyRemaining: qty("qty_remaining").notNull(),
    unitCost: money("unit_cost").notNull(),
    occurredAt: at("occurred_at").notNull(),
  },
  (t) => [
    index("manifest_cost_layers_open_idx").on(t.tenantId, t.productId, t.variantId, t.occurredAt),
    check("manifest_cost_layers_remaining", sql`${t.qtyRemaining} >= 0 AND ${t.qtyRemaining} <= ${t.qtyIn}`),
  ],
)

/** Running valuation per item: total valued quantity and its cost. Average cost is value / qty. */
export const manifestItemCosts = pgTable(
  "manifest_item_costs",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    qty: qty("qty").notNull().default("0"),
    value: money("value").notNull().default("0"),
    /** Last unit cost that entered stock; used when nothing is on hand to average. */
    lastUnitCost: money("last_unit_cost").notNull().default("0"),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("manifest_item_costs_item_uq").on(t.tenantId, t.productId, t.variantId).nullsNotDistinct()],
)

/** Why stock was adjusted. System codes are seeded per workspace; teams add their own. */
export const manifestReasonCodes = pgTable(
  "manifest_reason_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** in = found stock, out = lost stock, both = either direction. */
    direction: text("direction").$type<"in" | "out" | "both">().notNull().default("both"),
    /** Out-reasons that count as waste post to the scrap location instead of adjustment. */
    toScrap: boolean("to_scrap").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("manifest_reason_codes_uq").on(t.tenantId, t.code)],
)

/** Every command, written inside its transaction. If the audit write fails, the command fails. */
export const manifestAudit = pgTable(
  "manifest_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    commandId: uuid("command_id").notNull(),
    command: text("command").notNull(),
    /** Replaying a command with the same key (an offline scanner retrying) returns the first result instead of posting twice. */
    idempotencyKey: text("idempotency_key"),
    actorId: text("actor_id"),
    impersonatorId: text("impersonator_id"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    input: jsonb("input").$type<unknown>(),
    result: jsonb("result").$type<unknown>(),
    at: at("at").defaultNow().notNull(),
  },
  (t) => [
    index("manifest_audit_tenant_idx").on(t.tenantId, t.at),
    index("manifest_audit_entity_idx").on(t.tenantId, t.entityType, t.entityId),
    uniqueIndex("manifest_audit_idem_uq").on(t.tenantId, t.idempotencyKey),
  ],
)

/** Transactional outbox: webhooks, channel sync, realtime and suite projections read from here. */
export const manifestEvents = pgTable(
  "manifest_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    commandId: uuid("command_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
    deliveredAt: at("delivered_at"),
  },
  (t) => [index("manifest_events_pending_idx").on(t.deliveredAt, t.id)],
)

/** Saved grid views: filters, columns, sort. userId null means shared with the team. */
export const manifestViews = pgTable(
  "manifest_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    screen: text("screen").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: at("created_at").defaultNow().notNull(),
  },
  (t) => [index("manifest_views_screen_idx").on(t.tenantId, t.screen)],
)

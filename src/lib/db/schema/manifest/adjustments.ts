import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { tenants } from "../tenants"
import { products, productVariants } from "../inventory"
import { manifestLocations, manifestLots, money, qty } from "./core"

const at = (name: string) => timestamp(name, { withTimezone: true })

export const manifestAdjustmentStatus = pgEnum("manifest_adjustment_status", ["draft", "posted", "cancelled"])

/** A batch of stock corrections at one location. Quick adjustments are one-line adjustments posted immediately. */
export const manifestAdjustments = pgTable(
  "manifest_adjustments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    status: manifestAdjustmentStatus("status").notNull().default("draft"),
    /** opening = go-live balances from an import; adjustment = everyday corrections. */
    kind: text("kind").$type<"adjustment" | "opening">().notNull().default("adjustment"),
    locationId: uuid("location_id").notNull().references(() => manifestLocations.id),
    reason: text("reason").notNull(),
    note: text("note"),
    occurredAt: at("occurred_at").notNull(),
    createdBy: text("created_by"),
    postedBy: text("posted_by"),
    postedAt: at("posted_at"),
    commandId: uuid("command_id"),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("manifest_adjustments_number_uq").on(t.tenantId, t.number), index("manifest_adjustments_status_idx").on(t.tenantId, t.status)],
)

export const manifestAdjustmentLines = pgTable(
  "manifest_adjustment_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    adjustmentId: uuid("adjustment_id").notNull().references(() => manifestAdjustments.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    lotId: uuid("lot_id").references(() => manifestLots.id),
    /** Signed: positive adds stock, negative removes it. Filled in at posting for "set to" lines. */
    qtyDelta: qty("qty_delta"),
    /** "Set on-hand to this": the delta is worked out when the adjustment posts, under the item lock. */
    countedQty: qty("counted_qty"),
    /** On-hand just before posting, kept so the document shows "counted 12, was 15". */
    qtyBefore: qty("qty_before"),
    /** Cost for stock being added. Blank uses the item's current cost. */
    unitCost: money("unit_cost"),
  },
  (t) => [index("manifest_adjustment_lines_doc_idx").on(t.adjustmentId)],
)

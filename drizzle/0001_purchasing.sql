CREATE TYPE "public"."manifest_landed_cost_method" AS ENUM('value', 'quantity');--> statement-breakpoint
CREATE TYPE "public"."manifest_po_status" AS ENUM('draft', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."manifest_receipt_status" AS ENUM('posted', 'reversed');--> statement-breakpoint
CREATE TABLE "manifest_landed_cost_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"landed_cost_id" uuid NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"amount" numeric(18, 4) NOT NULL,
	"capitalized" numeric(18, 4) NOT NULL,
	"expensed" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_landed_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"method" "manifest_landed_cost_method" DEFAULT 'value' NOT NULL,
	"posted_by" text,
	"command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_po_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"supplier_sku" text,
	"qty_ordered" numeric(18, 4) NOT NULL,
	"qty_received" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	CONSTRAINT "manifest_po_lines_qty" CHECK ("manifest_po_lines"."qty_ordered" > 0 AND "manifest_po_lines"."qty_received" >= 0)
);
--> statement-breakpoint
CREATE TABLE "manifest_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "manifest_po_status" DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(18, 4) DEFAULT '1' NOT NULL,
	"destination_id" uuid,
	"expected_on" date,
	"supplier_reference" text,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"note" text,
	"created_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"po_line_id" uuid,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"location_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"quarantined" text DEFAULT 'no' NOT NULL,
	"move_id" uuid,
	CONSTRAINT "manifest_receipt_lines_qty" CHECK ("manifest_receipt_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "manifest_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"po_id" uuid,
	"supplier_id" uuid NOT NULL,
	"status" "manifest_receipt_status" DEFAULT 'posted' NOT NULL,
	"exchange_rate" numeric(18, 4) DEFAULT '1' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"reference" text,
	"note" text,
	"received_by" text,
	"command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_supplier_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"supplier_sku" text,
	"unit_cost" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"min_qty" numeric(18, 4),
	"lead_time_days" integer,
	"last_ordered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_supplier_items_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","supplier_id","product_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "manifest_settings" ADD COLUMN "over_receipt_pct" numeric(6, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "manifest_settings" ADD COLUMN "po_approval_threshold" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "manifest_landed_cost_allocations" ADD CONSTRAINT "manifest_landed_cost_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_landed_cost_allocations" ADD CONSTRAINT "manifest_landed_cost_allocations_landed_cost_id_manifest_landed_costs_id_fk" FOREIGN KEY ("landed_cost_id") REFERENCES "public"."manifest_landed_costs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_landed_cost_allocations" ADD CONSTRAINT "manifest_landed_cost_allocations_receipt_line_id_manifest_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."manifest_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_landed_cost_allocations" ADD CONSTRAINT "manifest_landed_cost_allocations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_landed_cost_allocations" ADD CONSTRAINT "manifest_landed_cost_allocations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_landed_costs" ADD CONSTRAINT "manifest_landed_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_landed_costs" ADD CONSTRAINT "manifest_landed_costs_receipt_id_manifest_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."manifest_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_po_lines" ADD CONSTRAINT "manifest_po_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_po_lines" ADD CONSTRAINT "manifest_po_lines_po_id_manifest_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."manifest_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_po_lines" ADD CONSTRAINT "manifest_po_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_po_lines" ADD CONSTRAINT "manifest_po_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_purchase_orders" ADD CONSTRAINT "manifest_purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_purchase_orders" ADD CONSTRAINT "manifest_purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_purchase_orders" ADD CONSTRAINT "manifest_purchase_orders_destination_id_manifest_locations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."manifest_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipt_lines" ADD CONSTRAINT "manifest_receipt_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipt_lines" ADD CONSTRAINT "manifest_receipt_lines_receipt_id_manifest_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."manifest_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipt_lines" ADD CONSTRAINT "manifest_receipt_lines_po_line_id_manifest_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."manifest_po_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipt_lines" ADD CONSTRAINT "manifest_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipt_lines" ADD CONSTRAINT "manifest_receipt_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipt_lines" ADD CONSTRAINT "manifest_receipt_lines_location_id_manifest_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."manifest_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipt_lines" ADD CONSTRAINT "manifest_receipt_lines_move_id_manifest_stock_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "public"."manifest_stock_moves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipts" ADD CONSTRAINT "manifest_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipts" ADD CONSTRAINT "manifest_receipts_po_id_manifest_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."manifest_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_receipts" ADD CONSTRAINT "manifest_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_supplier_items" ADD CONSTRAINT "manifest_supplier_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_supplier_items" ADD CONSTRAINT "manifest_supplier_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_supplier_items" ADD CONSTRAINT "manifest_supplier_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_supplier_items" ADD CONSTRAINT "manifest_supplier_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manifest_landed_cost_allocations_lc_idx" ON "manifest_landed_cost_allocations" USING btree ("landed_cost_id");--> statement-breakpoint
CREATE INDEX "manifest_landed_costs_receipt_idx" ON "manifest_landed_costs" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "manifest_po_lines_po_idx" ON "manifest_po_lines" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_purchase_orders_number_uq" ON "manifest_purchase_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "manifest_purchase_orders_status_idx" ON "manifest_purchase_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "manifest_purchase_orders_supplier_idx" ON "manifest_purchase_orders" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "manifest_receipt_lines_receipt_idx" ON "manifest_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_receipts_number_uq" ON "manifest_receipts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "manifest_receipts_po_idx" ON "manifest_receipts" USING btree ("po_id");
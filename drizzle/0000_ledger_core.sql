CREATE TYPE "public"."manifest_costing_method" AS ENUM('fifo', 'average');--> statement-breakpoint
CREATE TYPE "public"."manifest_location_kind" AS ENUM('warehouse', 'zone', 'bin', 'venue', 'popup', 'vehicle', 'supplier', 'customer', 'adjustment', 'production', 'scrap', 'transit', 'consignee');--> statement-breakpoint
CREATE TYPE "public"."manifest_stock_status" AS ENUM('available', 'quarantine', 'hold');--> statement-breakpoint
CREATE TYPE "public"."manifest_tracking" AS ENUM('none', 'lot', 'serial');--> statement-breakpoint
CREATE TYPE "public"."manifest_adjustment_status" AS ENUM('draft', 'posted', 'cancelled');--> statement-breakpoint
CREATE TABLE "manifest_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"command" text NOT NULL,
	"idempotency_key" text,
	"actor_id" text,
	"impersonator_id" text,
	"entity_type" text,
	"entity_id" text,
	"input" jsonb,
	"result" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_cost_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"move_id" uuid NOT NULL,
	"qty_in" numeric(18, 4) NOT NULL,
	"qty_remaining" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "manifest_cost_layers_remaining" CHECK ("manifest_cost_layers"."qty_remaining" >= 0 AND "manifest_cost_layers"."qty_remaining" <= "manifest_cost_layers"."qty_in")
);
--> statement-breakpoint
CREATE TABLE "manifest_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "manifest_item_costs" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"last_unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_item_costs_item_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","product_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "manifest_item_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"tracking" "manifest_tracking" DEFAULT 'none' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"reorder_point" numeric(18, 4),
	"reorder_qty" numeric(18, 4),
	"safety_stock" numeric(18, 4),
	"lead_time_days" integer,
	"default_location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_item_profiles_item_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","product_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "manifest_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "manifest_location_kind" NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"path" text NOT NULL,
	"is_virtual" boolean DEFAULT false NOT NULL,
	"is_valued" boolean DEFAULT true NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"address" jsonb,
	"legacy_location_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "manifest_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"code" text NOT NULL,
	"is_serial" boolean DEFAULT false NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_lots_code_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","product_id","variant_id","code")
);
--> statement-breakpoint
CREATE TABLE "manifest_quants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"location_id" uuid NOT NULL,
	"lot_id" uuid,
	"status" "manifest_stock_status" DEFAULT 'available' NOT NULL,
	"on_hand" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_quants_key_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","product_id","variant_id","location_id","lot_id","status"),
	CONSTRAINT "manifest_quants_reserved_nonneg" CHECK ("manifest_quants"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "manifest_reason_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"direction" text DEFAULT 'both' NOT NULL,
	"to_scrap" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_sequences" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"prefix" text NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 6 NOT NULL,
	CONSTRAINT "manifest_sequences_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "manifest_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"blueprint" text DEFAULT 'brand' NOT NULL,
	"costing_method" "manifest_costing_method" DEFAULT 'fifo' NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"lock_date" date,
	"sync_legacy" boolean DEFAULT true NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"lot_id" uuid,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"from_status" "manifest_stock_status" DEFAULT 'available' NOT NULL,
	"to_status" "manifest_stock_status" DEFAULT 'available' NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" uuid,
	"doc_line_id" uuid,
	"doc_number" text,
	"reason" text,
	"note" text,
	"actor_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversal_of" uuid,
	CONSTRAINT "manifest_stock_moves_qty_positive" CHECK ("manifest_stock_moves"."qty" > 0),
	CONSTRAINT "manifest_stock_moves_distinct_sides" CHECK ("manifest_stock_moves"."from_location_id" <> "manifest_stock_moves"."to_location_id" OR "manifest_stock_moves"."from_status" <> "manifest_stock_moves"."to_status")
);
--> statement-breakpoint
CREATE TABLE "manifest_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text,
	"screen" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_adjustment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"lot_id" uuid,
	"qty_delta" numeric(18, 4),
	"counted_qty" numeric(18, 4),
	"qty_before" numeric(18, 4),
	"unit_cost" numeric(18, 4)
);
--> statement-breakpoint
CREATE TABLE "manifest_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "manifest_adjustment_status" DEFAULT 'draft' NOT NULL,
	"kind" text DEFAULT 'adjustment' NOT NULL,
	"location_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"command_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manifest_audit" ADD CONSTRAINT "manifest_audit_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_cost_layers" ADD CONSTRAINT "manifest_cost_layers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_cost_layers" ADD CONSTRAINT "manifest_cost_layers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_cost_layers" ADD CONSTRAINT "manifest_cost_layers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_cost_layers" ADD CONSTRAINT "manifest_cost_layers_move_id_manifest_stock_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "public"."manifest_stock_moves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_events" ADD CONSTRAINT "manifest_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_item_costs" ADD CONSTRAINT "manifest_item_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_item_costs" ADD CONSTRAINT "manifest_item_costs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_item_costs" ADD CONSTRAINT "manifest_item_costs_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_item_profiles" ADD CONSTRAINT "manifest_item_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_item_profiles" ADD CONSTRAINT "manifest_item_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_item_profiles" ADD CONSTRAINT "manifest_item_profiles_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_item_profiles" ADD CONSTRAINT "manifest_item_profiles_default_location_id_manifest_locations_id_fk" FOREIGN KEY ("default_location_id") REFERENCES "public"."manifest_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_locations" ADD CONSTRAINT "manifest_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_locations" ADD CONSTRAINT "manifest_locations_legacy_location_id_inventory_locations_id_fk" FOREIGN KEY ("legacy_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_lots" ADD CONSTRAINT "manifest_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_lots" ADD CONSTRAINT "manifest_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_lots" ADD CONSTRAINT "manifest_lots_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_quants" ADD CONSTRAINT "manifest_quants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_quants" ADD CONSTRAINT "manifest_quants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_quants" ADD CONSTRAINT "manifest_quants_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_quants" ADD CONSTRAINT "manifest_quants_location_id_manifest_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."manifest_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_quants" ADD CONSTRAINT "manifest_quants_lot_id_manifest_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."manifest_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_reason_codes" ADD CONSTRAINT "manifest_reason_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_sequences" ADD CONSTRAINT "manifest_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_settings" ADD CONSTRAINT "manifest_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_stock_moves" ADD CONSTRAINT "manifest_stock_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_stock_moves" ADD CONSTRAINT "manifest_stock_moves_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_stock_moves" ADD CONSTRAINT "manifest_stock_moves_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_stock_moves" ADD CONSTRAINT "manifest_stock_moves_lot_id_manifest_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."manifest_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_stock_moves" ADD CONSTRAINT "manifest_stock_moves_from_location_id_manifest_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."manifest_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_stock_moves" ADD CONSTRAINT "manifest_stock_moves_to_location_id_manifest_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."manifest_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_views" ADD CONSTRAINT "manifest_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_adjustment_lines" ADD CONSTRAINT "manifest_adjustment_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_adjustment_lines" ADD CONSTRAINT "manifest_adjustment_lines_adjustment_id_manifest_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."manifest_adjustments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_adjustment_lines" ADD CONSTRAINT "manifest_adjustment_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_adjustment_lines" ADD CONSTRAINT "manifest_adjustment_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_adjustment_lines" ADD CONSTRAINT "manifest_adjustment_lines_lot_id_manifest_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."manifest_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_adjustments" ADD CONSTRAINT "manifest_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_adjustments" ADD CONSTRAINT "manifest_adjustments_location_id_manifest_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."manifest_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manifest_audit_tenant_idx" ON "manifest_audit" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "manifest_audit_entity_idx" ON "manifest_audit" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_audit_idem_uq" ON "manifest_audit" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "manifest_cost_layers_open_idx" ON "manifest_cost_layers" USING btree ("tenant_id","product_id","variant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "manifest_events_pending_idx" ON "manifest_events" USING btree ("delivered_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_locations_code_uq" ON "manifest_locations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "manifest_locations_parent_idx" ON "manifest_locations" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "manifest_quants_location_idx" ON "manifest_quants" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_reason_codes_uq" ON "manifest_reason_codes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "manifest_stock_moves_item_idx" ON "manifest_stock_moves" USING btree ("tenant_id","product_id","variant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "manifest_stock_moves_from_idx" ON "manifest_stock_moves" USING btree ("tenant_id","from_location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "manifest_stock_moves_to_idx" ON "manifest_stock_moves" USING btree ("tenant_id","to_location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "manifest_stock_moves_doc_idx" ON "manifest_stock_moves" USING btree ("tenant_id","doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "manifest_stock_moves_command_idx" ON "manifest_stock_moves" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_stock_moves_reversal_uq" ON "manifest_stock_moves" USING btree ("reversal_of");--> statement-breakpoint
CREATE INDEX "manifest_views_screen_idx" ON "manifest_views" USING btree ("tenant_id","screen");--> statement-breakpoint
CREATE INDEX "manifest_adjustment_lines_doc_idx" ON "manifest_adjustment_lines" USING btree ("adjustment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_adjustments_number_uq" ON "manifest_adjustments" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "manifest_adjustments_status_idx" ON "manifest_adjustments" USING btree ("tenant_id","status");
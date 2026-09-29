import { and, eq } from "drizzle-orm"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"

type VirtualKind = (typeof s.VIRTUAL_LOCATION_KINDS)[number]

/** The virtual locations every workspace gets. Transit is still our stock, so it's valued. */
export const VIRTUAL_LOCATIONS: { kind: VirtualKind; code: string; name: string; isValued: boolean }[] = [
  { kind: "supplier", code: "SUPPLIERS", name: "Suppliers", isValued: false },
  { kind: "customer", code: "CUSTOMERS", name: "Customers", isValued: false },
  { kind: "adjustment", code: "ADJUSTMENTS", name: "Inventory adjustments", isValued: false },
  { kind: "production", code: "PRODUCTION", name: "Production", isValued: false },
  { kind: "scrap", code: "SCRAP", name: "Scrap", isValued: false },
  { kind: "transit", code: "TRANSIT", name: "In transit", isValued: true },
]

export const SYSTEM_REASONS: { code: string; label: string; direction: "in" | "out" | "both"; toScrap?: boolean }[] = [
  { code: "COUNT", label: "Count correction", direction: "both" },
  { code: "FOUND", label: "Found stock", direction: "in" },
  { code: "DAMAGE", label: "Damaged", direction: "out", toScrap: true },
  { code: "EXPIRED", label: "Expired", direction: "out", toScrap: true },
  { code: "THEFT", label: "Theft or loss", direction: "out" },
  { code: "SAMPLE", label: "Sample or giveaway", direction: "out" },
  { code: "PROMO", label: "Promo or event use", direction: "out" },
  { code: "INTERNAL", label: "Internal use", direction: "out" },
  { code: "OPENING", label: "Opening balance", direction: "in" },
  { code: "OTHER", label: "Other", direction: "both" },
]

/**
 * Makes sure a workspace has its settings row, virtual locations and system
 * reason codes. Idempotent and cheap after the first call.
 */
export async function ensureWorkspace(tx: Db, tenantId: string) {
  const [existing] = await tx.select().from(s.manifestSettings).where(eq(s.manifestSettings.tenantId, tenantId)).limit(1)
  if (existing) return existing

  await tx
    .insert(s.manifestLocations)
    .values(VIRTUAL_LOCATIONS.map((v, i) => ({ tenantId, kind: v.kind, code: v.code, name: v.name, path: v.name, isVirtual: true, isValued: v.isValued, allowNegative: true, sortOrder: 1000 + i })))
    .onConflictDoNothing()
  await tx
    .insert(s.manifestReasonCodes)
    .values(SYSTEM_REASONS.map((r, i) => ({ tenantId, code: r.code, label: r.label, direction: r.direction, toScrap: r.toScrap ?? false, isSystem: true, sortOrder: i })))
    .onConflictDoNothing()
  const [created] = await tx.insert(s.manifestSettings).values({ tenantId }).onConflictDoNothing().returning()
  return created ?? (await tx.select().from(s.manifestSettings).where(eq(s.manifestSettings.tenantId, tenantId)).limit(1))[0]
}

export async function virtualLocation(tx: Db, tenantId: string, kind: VirtualKind) {
  const [loc] = await tx
    .select()
    .from(s.manifestLocations)
    .where(and(eq(s.manifestLocations.tenantId, tenantId), eq(s.manifestLocations.kind, kind), eq(s.manifestLocations.isVirtual, true)))
    .limit(1)
  if (!loc) throw new Error(`Workspace is missing its ${kind} location`)
  return loc
}

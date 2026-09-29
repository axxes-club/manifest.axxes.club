import { NextResponse, type NextRequest } from "next/server"
import { and, eq, ilike, isNull, or } from "drizzle-orm"
import { db, schema as s } from "@/lib/db"
import { getContext } from "@/lib/context"

export type SearchHit = {
  kind: "item" | "location" | "adjustment" | "purchase_order" | "receipt"
  id: string
  title: string
  subtitle?: string
  href: string
  /** For item pickers: the stockable unit this hit is. */
  productId?: string
  variantId?: string | null
  sku?: string | null
  code?: string
}

/** Record search for the command palette and item/location pickers. Tenant-scoped, prefix-and-substring, small result sets. */
export async function GET(req: NextRequest) {
  const ctx = await getContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim()
  const kinds = new Set((req.nextUrl.searchParams.get("kinds") ?? "item,location,adjustment,purchase_order,receipt").split(","))
  if (!q) return NextResponse.json({ hits: [] })
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const t = ctx.tenant.id
  const hits: SearchHit[] = []

  if (kinds.has("item")) {
    const [simple, variants] = await Promise.all([
      db
        .select({ id: s.products.id, name: s.products.name, sku: s.products.sku, hasVariants: s.products.hasVariants })
        .from(s.products)
        .where(and(eq(s.products.tenantId, t), isNull(s.products.deletedAt), or(ilike(s.products.name, like), ilike(s.products.sku, like), ilike(s.products.barcode, like))))
        .limit(8),
      db
        .select({ id: s.productVariants.id, productId: s.productVariants.productId, name: s.productVariants.name, sku: s.productVariants.sku, productName: s.products.name })
        .from(s.productVariants)
        .innerJoin(s.products, eq(s.products.id, s.productVariants.productId))
        .where(
          and(
            eq(s.productVariants.tenantId, t),
            isNull(s.productVariants.deletedAt),
            isNull(s.products.deletedAt),
            or(ilike(s.productVariants.sku, like), ilike(s.productVariants.barcode, like), ilike(s.products.name, like), ilike(s.productVariants.name, like)),
          ),
        )
        .limit(10),
    ])
    for (const p of simple.filter((p) => !p.hasVariants))
      hits.push({ kind: "item", id: p.id, title: p.name, subtitle: p.sku ?? undefined, href: `/stock/${p.id}`, productId: p.id, variantId: null, sku: p.sku })
    for (const v of variants)
      hits.push({ kind: "item", id: v.id, title: `${v.productName} (${v.name})`, subtitle: v.sku ?? undefined, href: `/stock/${v.productId}?v=${v.id}`, productId: v.productId, variantId: v.id, sku: v.sku })
  }

  if (kinds.has("location")) {
    const locs = await db
      .select({ id: s.manifestLocations.id, code: s.manifestLocations.code, name: s.manifestLocations.name, path: s.manifestLocations.path })
      .from(s.manifestLocations)
      .where(and(eq(s.manifestLocations.tenantId, t), eq(s.manifestLocations.isVirtual, false), isNull(s.manifestLocations.archivedAt), or(ilike(s.manifestLocations.code, like), ilike(s.manifestLocations.name, like))))
      .limit(8)
    for (const l of locs) hits.push({ kind: "location", id: l.id, title: l.code, subtitle: l.name !== l.code ? `${l.name} · ${l.path}` : l.path, href: `/locations/${l.id}`, code: l.code })
  }

  if (kinds.has("adjustment")) {
    const docs = await db
      .select({ id: s.manifestAdjustments.id, number: s.manifestAdjustments.number, status: s.manifestAdjustments.status, reason: s.manifestAdjustments.reason })
      .from(s.manifestAdjustments)
      .where(and(eq(s.manifestAdjustments.tenantId, t), ilike(s.manifestAdjustments.number, like)))
      .limit(5)
    for (const d of docs) hits.push({ kind: "adjustment", id: d.id, title: d.number, subtitle: `${d.status} · ${d.reason}`, href: `/adjustments/${d.id}` })
  }

  if (kinds.has("purchase_order") && ctx.can("purchasing.view")) {
    const pos = await db
      .select({ id: s.manifestPurchaseOrders.id, number: s.manifestPurchaseOrders.number, status: s.manifestPurchaseOrders.status, supplier: s.suppliers.name })
      .from(s.manifestPurchaseOrders)
      .innerJoin(s.suppliers, eq(s.suppliers.id, s.manifestPurchaseOrders.supplierId))
      .where(and(eq(s.manifestPurchaseOrders.tenantId, t), or(ilike(s.manifestPurchaseOrders.number, like), ilike(s.suppliers.name, like), ilike(s.manifestPurchaseOrders.supplierReference, like))))
      .limit(5)
    for (const p of pos) hits.push({ kind: "purchase_order", id: p.id, title: p.number, subtitle: `${p.supplier} · ${p.status.replaceAll("_", " ")}`, href: `/purchase-orders/${p.id}` })
  }
  if (kinds.has("receipt") && ctx.can("purchasing.view")) {
    const grns = await db
      .select({ id: s.manifestReceipts.id, number: s.manifestReceipts.number, reference: s.manifestReceipts.reference })
      .from(s.manifestReceipts)
      .where(and(eq(s.manifestReceipts.tenantId, t), or(ilike(s.manifestReceipts.number, like), ilike(s.manifestReceipts.reference, like))))
      .limit(5)
    for (const g of grns) hits.push({ kind: "receipt", id: g.id, title: g.number, subtitle: g.reference ? `slip ${g.reference}` : "goods receipt", href: `/receipts/${g.id}` })
  }

  return NextResponse.json({ hits })
}

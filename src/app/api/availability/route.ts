import { NextResponse, type NextRequest } from "next/server"
import { and, eq, sql } from "drizzle-orm"
import { db, schema as s } from "@/lib/db"
import { getContext } from "@/lib/context"
import { eqOrNull } from "@/domain/ledger/costing"
import { isUuid } from "@/lib/queries"

/** On-hand and available for one item at one location, for live hints in forms. */
export async function GET(req: NextRequest) {
  const ctx = await getContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const p = req.nextUrl.searchParams
  const productId = p.get("productId")
  const locationId = p.get("locationId")
  const variantId = p.get("variantId")
  if (!productId || !locationId || !isUuid(productId) || !isUuid(locationId) || (variantId && !isUuid(variantId))) return NextResponse.json({ error: "productId and locationId must be IDs" }, { status: 400 })
  const [row] = await db
    .select({
      onHand: sql<string>`coalesce(sum(${s.manifestQuants.onHand}), 0)`,
      available: sql<string>`coalesce(sum(${s.manifestQuants.onHand} - ${s.manifestQuants.reserved}), 0)`,
    })
    .from(s.manifestQuants)
    .where(
      and(
        eq(s.manifestQuants.tenantId, ctx.tenant.id),
        eq(s.manifestQuants.productId, productId),
        eqOrNull(s.manifestQuants.variantId, p.get("variantId") || null),
        eq(s.manifestQuants.locationId, locationId),
        eq(s.manifestQuants.status, "available"),
      ),
    )
  return NextResponse.json(row ?? { onHand: "0", available: "0" })
}

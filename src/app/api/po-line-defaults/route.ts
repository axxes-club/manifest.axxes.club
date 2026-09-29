import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { getContext } from "@/lib/context"
import { suggestedLine } from "@/domain/purchasing/commands"
import { isUuid } from "@/lib/queries"

/** Pre-fill for a new PO line: this supplier's last price for the item, else its catalog cost. */
export async function GET(req: NextRequest) {
  const ctx = await getContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const p = req.nextUrl.searchParams
  const supplierId = p.get("supplierId")
  const productId = p.get("productId")
  const variantId = p.get("variantId")
  if (!supplierId || !productId || !isUuid(supplierId) || !isUuid(productId) || (variantId && !isUuid(variantId))) return NextResponse.json({ error: "supplierId and productId must be IDs" }, { status: 400 })
  return NextResponse.json(await suggestedLine(db, ctx.tenant.id, supplierId, productId, p.get("variantId") || null))
}

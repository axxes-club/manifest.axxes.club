import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/context"
import { poIdByNumber } from "@/lib/queries-purchasing"

/** /purchase-orders/number/PO-000123[?to=receive], so ⌘K verbs and scanned paperwork can link by number. */
export default async function PoByNumber({ params, searchParams }: PageProps<"/purchase-orders/number/[number]">) {
  const ctx = await requirePermission("purchasing.view")
  const id = await poIdByNumber(ctx.tenant.id, decodeURIComponent((await params).number))
  if (!id) notFound()
  redirect(`/purchase-orders/${id}${(await searchParams).to === "receive" ? "/receive" : ""}`)
}

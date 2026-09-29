import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/context"
import { homeLocations, isUuid, listLocations } from "@/lib/queries"
import { getPurchaseOrder } from "@/lib/queries-purchasing"
import { PO_RECEIVABLE } from "@/domain/purchasing/machine"
import { ReceiveForm } from "@/components/receive-form"
import { PageHeader } from "@/components/ui"

export default async function ReceivePage({ params }: PageProps<"/purchase-orders/[id]/receive">) {
  const ctx = await requirePermission("purchasing.receive")
  const { id } = await params
  if (!isUuid(id)) notFound()
  const [data, locations] = await Promise.all([getPurchaseOrder(ctx.tenant.id, id), listLocations(ctx.tenant.id)])
  if (!data) notFound()
  const { po, supplier, lines } = data
  if (!PO_RECEIVABLE.includes(po.status)) redirect(`/purchase-orders/${po.id}`)
  const open = lines.filter((l) => Number(l.qtyReceived) < Number(l.qtyOrdered))
  const homes = await homeLocations(ctx.tenant.id, lines)

  return (
    <>
      <Link href={`/purchase-orders/${po.id}`} className="text-sm text-muted hover:text-text">
        ← {po.number}
      </Link>
      <div className="mt-3">
        <PageHeader title={`Receive ${po.number}`} description={`From ${supplier.name}. Check what arrived, put it away, done. Anything not received stays on order.`} />
      </div>
      <ReceiveForm
        poId={po.id}
        poNumber={po.number}
        destinationId={po.destinationId}
        canOverride={ctx.can("purchasing.approve")}
        locations={locations}
        lines={(open.length ? open : lines).map((l) => ({
          id: l.id,
          lineNo: l.lineNo,
          name: l.name,
          sku: l.sku,
          barcode: l.barcode,
          supplierSku: l.supplierSku,
          ordered: Number(l.qtyOrdered),
          received: Number(l.qtyReceived),
          defaultLocationId: po.destinationId ?? homes.get(`${l.productId}:${l.variantId ?? ""}`) ?? null,
        }))}
      />
    </>
  )
}

import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/context"
import { getLocale, listLocations, isUuid } from "@/lib/queries"
import { getPurchaseOrder, listSuppliers } from "@/lib/queries-purchasing"
import { PO_EDITABLE } from "@/domain/purchasing/machine"
import { PoEditor } from "@/components/po-editor"
import { PageHeader } from "@/components/ui"

export default async function EditPoPage({ params }: PageProps<"/purchase-orders/[id]/edit">) {
  const ctx = await requirePermission("purchasing.manage")
  const { id } = await params
  if (!isUuid(id)) notFound()
  const [data, suppliers, locations, locale] = await Promise.all([getPurchaseOrder(ctx.tenant.id, id), listSuppliers(ctx.tenant.id), listLocations(ctx.tenant.id), getLocale(ctx.tenant.id)])
  if (!data) notFound()
  const { po, lines } = data
  if (!PO_EDITABLE.includes(po.status)) redirect(`/purchase-orders/${po.id}`)
  const num = (v: string) => String(Number(v))

  return (
    <>
      <Link href={`/purchase-orders/${po.id}`} className="text-sm text-muted hover:text-text">
        ← {po.number}
      </Link>
      <div className="mt-3">
        <PageHeader
          title={`Edit ${po.number}`}
          description={po.status === "approved" ? "Saving sends it back to draft for approval." : po.status === "draft" ? undefined : "Received lines keep their item and cost; quantities can't go below what arrived."}
        />
      </div>
      <PoEditor
        suppliers={suppliers}
        locations={locations}
        baseCurrency={locale.currency}
        locale={locale.locale}
        initial={{
          id: po.id,
          supplierId: po.supplierId,
          currency: po.currency,
          exchangeRate: num(po.exchangeRate),
          destinationId: po.destinationId ?? "",
          expectedOn: po.expectedOn ?? "",
          supplierReference: po.supplierReference ?? "",
          taxAmount: Number(po.taxAmount) ? num(po.taxAmount) : "",
          shippingAmount: Number(po.shippingAmount) ? num(po.shippingAmount) : "",
          note: po.note ?? "",
          placed: po.status === "sent" || po.status === "partially_received",
          lines: lines.map((l) => ({
            id: l.id,
            item: { productId: l.productId, variantId: l.variantId, label: l.name, sku: l.sku },
            supplierSku: l.supplierSku ?? "",
            qty: num(l.qtyOrdered),
            unitCost: num(l.unitCost),
            received: Number(l.qtyReceived),
          })),
        }}
      />
    </>
  )
}

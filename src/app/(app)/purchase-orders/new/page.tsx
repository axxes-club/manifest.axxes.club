import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { findBySku, getLocale, listLocations } from "@/lib/queries"
import { listSuppliers } from "@/lib/queries-purchasing"
import { PoEditor } from "@/components/po-editor"
import { PageHeader } from "@/components/ui"

export const metadata = { title: "New purchase order" }

export default async function NewPoPage({ searchParams }: PageProps<"/purchase-orders/new">) {
  const ctx = await requirePermission("purchasing.manage")
  const sp = await searchParams
  const [suppliers, locations, locale] = await Promise.all([listSuppliers(ctx.tenant.id), listLocations(ctx.tenant.id), getLocale(ctx.tenant.id)])
  const supplierId = typeof sp.supplier === "string" ? sp.supplier : ""
  const item = typeof sp.sku === "string" ? await findBySku(ctx.tenant.id, sp.sku) : null
  const supplier = suppliers.find((s) => s.id === supplierId)

  return (
    <>
      <Link href="/purchase-orders" className="text-sm text-muted hover:text-text">
        ← Purchase orders
      </Link>
      <div className="mt-3">
        <PageHeader title="New purchase order" description="Starts as a draft. Place it when it's right; Manifest remembers what you paid for next time." />
      </div>
      <PoEditor
        suppliers={suppliers}
        locations={locations}
        baseCurrency={locale.currency}
        locale={locale.locale}
        initial={
          supplierId || item
            ? {
                supplierId,
                currency: supplier?.currency ?? locale.currency,
                exchangeRate: "1",
                destinationId: "",
                expectedOn: "",
                supplierReference: "",
                taxAmount: "",
                shippingAmount: "",
                note: "",
                placed: false,
                lines: item ? [{ id: "", item, supplierSku: "", qty: typeof sp.qty === "string" ? sp.qty : "", unitCost: "", received: 0 }] : [],
              }
            : undefined
        }
      />
    </>
  )
}

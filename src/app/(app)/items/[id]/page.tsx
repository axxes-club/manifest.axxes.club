import Link from "next/link"
import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/context"
import { getItem, isUuid } from "@/lib/queries"
import { ItemEditor } from "@/components/item-form"
import { PageHeader } from "@/components/ui"

export default async function ItemPage({ params }: PageProps<"/items/[id]">) {
  const ctx = await requirePermission("catalog.view")
  const { id } = await params
  if (!isUuid(id)) notFound()
  const item = await getItem(ctx.tenant.id, id)
  if (!item) notFound()
  const { product, variants, profiles } = item
  const profileOf = (variantId: string | null) => profiles.find((p) => p.variantId === variantId)
  const units = [
    {
      variantId: null as string | null,
      label: product.name,
      sku: product.sku,
      barcode: product.barcode,
      price: product.price,
      costPrice: product.costPrice,
      reorderPoint: profileOf(null)?.reorderPoint ?? null,
      reorderQty: profileOf(null)?.reorderQty ?? null,
      unit: profileOf(null)?.unit ?? "each",
    },
    ...variants.map((v) => ({
      variantId: v.id as string | null,
      label: v.name ?? "Variant",
      sku: v.sku,
      barcode: v.barcode,
      price: v.price,
      costPrice: v.costPrice,
      reorderPoint: profileOf(v.id)?.reorderPoint ?? null,
      reorderQty: profileOf(v.id)?.reorderQty ?? null,
      unit: profileOf(v.id)?.unit ?? "each",
    })),
  ]
  return (
    <>
      <Link href="/items" className="text-sm text-muted hover:text-text">
        ← Items
      </Link>
      <div className="mt-3">
        <PageHeader
          title={product.name}
          description={product.hasVariants ? `${variants.length} variants` : (product.sku ?? undefined)}
          action={
            <Link href={`/stock/${product.id}`} className="btn-ghost">
              View stock
            </Link>
          }
        />
      </div>
      <ItemEditor productId={product.id} name={product.name} hasVariants={!!product.hasVariants} units={units} canEdit={ctx.can("catalog.manage")} />
    </>
  )
}

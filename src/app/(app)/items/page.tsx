import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { getLocale, listItems } from "@/lib/queries"
import { fmtMoney, fmtQty } from "@/lib/format"
import { Empty, PageHeader } from "@/components/ui"

export const metadata = { title: "Items" }

export default async function ItemsPage({ searchParams }: PageProps<"/items">) {
  const ctx = await requirePermission("catalog.view")
  const q = typeof (await searchParams).q === "string" ? ((await searchParams).q as string).trim() : ""
  const [rows, locale] = await Promise.all([listItems(ctx.tenant.id, q || undefined), getLocale(ctx.tenant.id)])
  const create = ctx.can("catalog.manage") && (
    <Link href="/items/new" className="btn-primary" data-create>
      New item
    </Link>
  )
  return (
    <>
      <PageHeader title="Items" description="Everything you stock. Shared with your AXXES workspace, so the storefront and portal see the same catalog." action={create} />
      <form action="/items" className="mb-4">
        <input name="q" defaultValue={q} placeholder="Search name, SKU or barcode…  /" className="input max-w-sm" data-search autoComplete="off" />
      </form>
      {rows.length === 0 ? (
        <Empty title={q ? "No items match" : "No items yet"} body={q ? undefined : "Add items one by one, or import a spreadsheet: new SKUs are created for you."} action={create} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Item</th>
                <th className="th">SKU</th>
                <th className="th num">Variants</th>
                <th className="th num">Price</th>
                <th className="th num">Cost</th>
                <th className="th num">On hand</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-row className="border-b border-line/60 last:border-0 hover:bg-panel-2/60">
                  <td className="td">
                    <Link href={`/items/${r.id}`} className="font-medium hover:text-accent">
                      {r.name}
                    </Link>
                    {r.status !== "active" && <span className="ml-2 text-xs capitalize text-muted">{r.status.replace("_", " ")}</span>}
                  </td>
                  <td className="td font-mono text-xs text-muted">{r.sku ?? "—"}</td>
                  <td className="td num text-muted">{r.hasVariants ? r.variants : "—"}</td>
                  <td className="td num">{fmtMoney(r.price, locale)}</td>
                  <td className="td num text-muted">{r.costPrice ? fmtMoney(r.costPrice, locale) : "—"}</td>
                  <td className="td num">
                    <Link href={`/stock/${r.id}`} className="hover:text-accent">
                      {fmtQty(r.onHand, locale)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

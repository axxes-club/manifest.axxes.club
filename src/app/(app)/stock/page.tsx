import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { db } from "@/lib/db"
import { stockByItem } from "@/domain/ledger/queries"
import { getLocale, listLocations } from "@/lib/queries"
import { fmtMoney, fmtQty } from "@/lib/format"
import { Empty, PageHeader, StockBar } from "@/components/ui"

export const metadata = { title: "Stock" }

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const ctx = await requirePermission("stock.view")
  const sp = await searchParams
  const q = typeof sp.q === "string" ? sp.q.trim() : ""
  const at = typeof sp.at === "string" ? sp.at : ""
  const low = sp.low === "1"
  const [locale, locations] = await Promise.all([getLocale(ctx.tenant.id), listLocations(ctx.tenant.id)])
  const scope = locations.find((l) => l.id === at)
  const rows = await stockByItem(db, ctx.tenant.id, { q: q || undefined, locationPath: scope?.path, lowOnly: low })
  const totalValue = rows.reduce((sum, r) => sum + Number(r.onHand) * Number(r.unitCost), 0)
  const tops = locations.filter((l) => !l.parentId || l.kind === "zone")

  const actions = (
    <div className="flex gap-2">
      {ctx.can("stock.move") && <Link href="/moves/new" className="btn-ghost">Move</Link>}
      {ctx.can("stock.adjust") && (
        <Link href="/adjustments/new" className="btn-primary" data-create>
          Adjust stock
        </Link>
      )}
    </div>
  )

  return (
    <>
      <PageHeader title="Stock" description="What you have, where it is, and what it's worth. Click any number to see the moves behind it." action={actions} />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/stock">
        <input name="q" defaultValue={q} placeholder="Search name, SKU or barcode…  /" className="input max-w-xs" data-search autoComplete="off" />
        <select name="at" defaultValue={at} className="input w-auto">
          <option value="">All locations</option>
          {tops.map((l) => (
            <option key={l.id} value={l.id}>
              {l.path}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted">
          <input type="checkbox" name="low" value="1" defaultChecked={low} className="accent-[var(--accent)]" /> Low only
        </label>
        <button className="btn-ghost">Apply</button>
        <p className="ml-auto text-sm text-muted">
          <span className="tabular-nums text-text">{rows.length}</span> items · <span className="tabular-nums text-text">{fmtMoney(totalValue, locale)}</span>
        </p>
      </form>

      {rows.length === 0 ? (
        <Empty
          title={q || low || at ? "Nothing matches those filters" : "No stock yet"}
          body={q || low || at ? "Try a broader search." : "Import a spreadsheet of opening balances, or add stock with an adjustment."}
          action={
            !(q || low || at) && (
              <div className="flex gap-2">
                {ctx.can("import.run") && <Link href="/import" className="btn-primary">Import stock</Link>}
                <Link href="/adjustments/new" className="btn-ghost">Add stock</Link>
              </div>
            )
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-line">
                <th className="th">Item</th>
                <th className="th w-40">Availability</th>
                <th className="th num">On hand</th>
                <th className="th num">Reserved</th>
                <th className="th num">Available</th>
                <th className="th num">Reorder at</th>
                <th className="th num">Unit cost</th>
                <th className="th num">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const href = `/stock/${r.productId}${r.variantId ? `?v=${r.variantId}` : ""}`
                return (
                  <tr key={`${r.productId}:${r.variantId}`} data-row className="border-b border-line/60 last:border-0 hover:bg-panel-2/60">
                    <td className="td">
                      <Link href={href} className="font-medium hover:text-accent">
                        {r.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted">{r.sku}</span>
                      {r.locations > 1 && <span className="ml-2 text-xs text-muted">· {r.locations} locations</span>}
                    </td>
                    <td className="td">
                      <StockBar available={Number(r.available)} reserved={Number(r.reserved)} held={Number(r.held)} />
                    </td>
                    <td className="td num">{fmtQty(r.onHand, locale)}</td>
                    <td className="td num text-muted">{Number(r.reserved) ? fmtQty(r.reserved, locale) : "—"}</td>
                    <td className={`td num font-medium ${r.low ? (Number(r.available) <= 0 ? "text-danger" : "text-amber-300") : ""}`}>{fmtQty(r.available, locale)}</td>
                    <td className="td num text-muted">{r.reorderPoint ? fmtQty(r.reorderPoint, locale) : "—"}</td>
                    <td className="td num text-muted">{fmtMoney(r.unitCost, locale)}</td>
                    <td className="td num">{fmtMoney(Number(r.onHand) * Number(r.unitCost), locale)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

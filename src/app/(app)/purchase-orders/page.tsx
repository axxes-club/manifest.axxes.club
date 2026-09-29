import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { getLocale } from "@/lib/queries"
import { listPurchaseOrders, PO_TABS, poTabCounts, type PoTab } from "@/lib/queries-purchasing"
import { fmtDate, fmtMoney } from "@/lib/format"
import { Empty, PageHeader, StatusBadge, Tabs } from "@/components/ui"

export const metadata = { title: "Purchase orders" }

export default async function PurchaseOrdersPage({ searchParams }: PageProps<"/purchase-orders">) {
  const ctx = await requirePermission("purchasing.view")
  const raw = (await searchParams).tab
  const tab = typeof raw === "string" && raw in PO_TABS ? (raw as PoTab) : undefined
  const [rows, counts, locale] = await Promise.all([listPurchaseOrders(ctx.tenant.id, tab), poTabCounts(ctx.tenant.id), getLocale(ctx.tenant.id)])
  const today = new Date().toISOString().slice(0, 10)
  const create = ctx.can("purchasing.manage") && (
    <Link href="/purchase-orders/new" className="btn-primary" data-create>
      New order
    </Link>
  )

  return (
    <>
      <PageHeader title="Purchase orders" description="What you've ordered, what's arrived, and what it cost. Receiving puts stock straight into bins at the order's cost." action={create} />
      <Tabs
        items={[
          { href: "/purchase-orders", label: "All", active: !tab },
          { href: "/purchase-orders?tab=draft", label: "Drafts", active: tab === "draft", count: counts.draft },
          { href: "/purchase-orders?tab=open", label: "On order", active: tab === "open", count: counts.open },
          { href: "/purchase-orders?tab=received", label: "Received", active: tab === "received", count: counts.received },
          { href: "/purchase-orders?tab=closed", label: "Closed", active: tab === "closed" },
        ]}
      />
      {rows.length === 0 ? (
        <Empty title="No purchase orders here" body="Order from a supplier, then receive it when it lands. Manifest remembers each supplier's prices for next time." action={create} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Order</th>
                <th className="th">Supplier</th>
                <th className="th">Status</th>
                <th className="th w-40">Received</th>
                <th className="th">Expected</th>
                <th className="th num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = Number(r.ordered) ? Math.round((Number(r.received) / Number(r.ordered)) * 100) : 0
                const late = r.expectedOn && r.expectedOn < today && (r.status === "sent" || r.status === "partially_received")
                return (
                  <tr key={r.id} data-row className="border-b border-line/60 last:border-0 hover:bg-panel-2/60">
                    <td className="td">
                      <Link href={`/purchase-orders/${r.id}`} className="font-mono font-medium hover:text-accent">
                        {r.number}
                      </Link>
                    </td>
                    <td className="td">{r.supplier}</td>
                    <td className="td">
                      <StatusBadge value={r.status} />
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-9 text-right font-mono text-[11px] text-muted">{pct}%</span>
                      </div>
                    </td>
                    <td className={`td ${late ? "text-amber-300" : "text-muted"}`}>
                      {fmtDate(r.expectedOn ? `${r.expectedOn}T12:00:00` : null, locale)}
                      {late && " · late"}
                    </td>
                    <td className="td num">{fmtMoney(r.total, { ...locale, currency: r.currency })}</td>
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

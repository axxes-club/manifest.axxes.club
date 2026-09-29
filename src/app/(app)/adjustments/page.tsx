import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { adjustmentCounts, getLocale, listAdjustments } from "@/lib/queries"
import { fmtDate, fmtDelta, fmtMoney } from "@/lib/format"
import { Empty, PageHeader, StatusBadge, Tabs } from "@/components/ui"

export const metadata = { title: "Adjustments" }

export default async function AdjustmentsPage({ searchParams }: PageProps<"/adjustments">) {
  const ctx = await requirePermission("stock.view")
  const status = typeof (await searchParams).status === "string" ? ((await searchParams).status as string) : undefined
  const [rows, counts, locale] = await Promise.all([listAdjustments(ctx.tenant.id, status), adjustmentCounts(ctx.tenant.id), getLocale(ctx.tenant.id)])
  const create = ctx.can("stock.adjust") && (
    <Link href="/adjustments/new" className="btn-primary" data-create>
      New adjustment
    </Link>
  )

  return (
    <>
      <PageHeader title="Adjustments" description="Corrections to stock: damage, loss, found stock and counts. Each one is a document you can post, cancel or undo." action={create} />
      <Tabs
        items={[
          { href: "/adjustments", label: "All", active: !status },
          { href: "/adjustments?status=draft", label: "Drafts", active: status === "draft", count: counts.draft ?? 0 },
          { href: "/adjustments?status=posted", label: "Posted", active: status === "posted", count: counts.posted ?? 0 },
          { href: "/adjustments?status=cancelled", label: "Cancelled", active: status === "cancelled" },
        ]}
      />
      {rows.length === 0 ? (
        <Empty title="No adjustments here" body="When stock is damaged, lost, found or counted, record it as an adjustment." action={create} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Number</th>
                <th className="th">Status</th>
                <th className="th">Reason</th>
                <th className="th">Location</th>
                <th className="th num">Lines</th>
                <th className="th num">Net units</th>
                <th className="th num">Value</th>
                <th className="th">Date</th>
                <th className="th">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-row className="border-b border-line/60 last:border-0 hover:bg-panel-2/60">
                  <td className="td font-medium">
                    <Link href={`/adjustments/${r.id}`} className="font-mono hover:text-accent">
                      {r.number}
                    </Link>
                  </td>
                  <td className="td">
                    <StatusBadge value={r.status} />
                  </td>
                  <td className="td text-muted">{r.kind === "opening" ? "Opening balance" : r.reason.toLowerCase().replace(/^./, (c) => c.toUpperCase())}</td>
                  <td className="td font-mono text-xs text-muted">{r.location}</td>
                  <td className="td num text-muted">{r.lines}</td>
                  <td className="td num">{r.net != null ? fmtDelta(r.net, locale) : "—"}</td>
                  <td className="td num text-muted">{r.value != null ? fmtMoney(r.value, locale) : "—"}</td>
                  <td className="td text-muted">{fmtDate(r.occurredAt, locale)}</td>
                  <td className="td text-muted">{r.author?.split(" ")[0] ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

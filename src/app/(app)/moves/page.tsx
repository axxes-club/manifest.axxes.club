import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { db } from "@/lib/db"
import { listMoves } from "@/domain/ledger/queries"
import { getLocale } from "@/lib/queries"
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format"
import { Empty, PageHeader } from "@/components/ui"

export const metadata = { title: "Moves" }

const TYPES = [
  ["", "All"],
  ["adjustment", "Adjustments"],
  ["opening", "Opening"],
  ["receipt", "Receipts"],
  ["move", "Moves"],
  ["reversal", "Undos"],
] as const

export default async function MovesPage({ searchParams }: PageProps<"/moves">) {
  const ctx = await requirePermission("stock.view")
  const sp = await searchParams
  const q = typeof sp.q === "string" ? sp.q.trim() : ""
  const type = typeof sp.type === "string" ? sp.type : ""
  const since = typeof sp.since === "string" && sp.since ? new Date(`${sp.since}T00:00:00`) : undefined
  const [moves, locale] = await Promise.all([listMoves(db, ctx.tenant.id, { q: q || undefined, docType: type || undefined, since }, 300), getLocale(ctx.tenant.id)])
  const href = (t: string) => `/moves?${new URLSearchParams({ ...(q ? { q } : {}), ...(t ? { type: t } : {}) })}`

  return (
    <>
      <PageHeader
        title="Moves"
        description="The ledger. Every change to stock, from one place to another, with its cost and who did it. Nothing here is ever edited or deleted."
        action={
          ctx.can("stock.move") && (
            <Link href="/moves/new" className="btn-primary" data-create>
              Move stock
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-sm">
          {TYPES.map(([t, label]) => (
            <Link key={t} href={href(t)} className={`rounded-md px-3 py-1.5 ${type === t ? "bg-panel-2 text-text ring-1 ring-line" : "text-muted hover:text-text"}`}>
              {label}
            </Link>
          ))}
        </div>
        <form action="/moves" className="flex flex-1 gap-2">
          {type && <input type="hidden" name="type" value={type} />}
          <input name="q" defaultValue={q} placeholder="Item, SKU or document…  /" className="input max-w-xs" data-search autoComplete="off" />
          <input name="since" type="date" defaultValue={typeof sp.since === "string" ? sp.since : ""} className="input w-auto" aria-label="Since" />
          <button className="btn-ghost">Filter</button>
        </form>
      </div>

      {moves.length === 0 ? (
        <Empty title="No moves" body="Moves appear the moment stock changes: adjustments, imports, bin moves and undos." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">When</th>
                <th className="th">Item</th>
                <th className="th num">Qty</th>
                <th className="th">From</th>
                <th className="th">To</th>
                <th className="th">Document</th>
                <th className="th num">Cost</th>
                <th className="th">By</th>
              </tr>
            </thead>
            <tbody className="font-[450]">
              {moves.map((m) => {
                const tone = m.fromVirtual && !m.toVirtual ? "text-accent" : !m.fromVirtual && m.toVirtual ? "text-danger" : "text-sky-300"
                return (
                  <tr key={m.id} data-row className="border-b border-line/60 last:border-0 hover:bg-panel-2/60">
                    <td className="td whitespace-nowrap text-muted">{fmtDateTime(m.occurredAt, locale)}</td>
                    <td className="td">
                      <Link href={`/stock/${m.productId}${m.variantId ? `?v=${m.variantId}` : ""}`} className="hover:text-accent">
                        {m.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted">{m.sku}</span>
                    </td>
                    <td className={`td num font-semibold ${tone}`}>{fmtQty(m.qty, locale)}</td>
                    <td className={`td font-mono text-xs ${m.fromVirtual ? "text-muted" : ""}`}>{m.fromCode}</td>
                    <td className={`td font-mono text-xs ${m.toVirtual ? "text-muted" : ""}`}>{m.toCode}</td>
                    <td className="td font-mono text-xs text-muted">
                      {m.docId && m.docType !== "move" ? (
                        <Link href={m.docType === "receipt" || m.toCode === "SUPPLIERS" ? `/receipts/${m.docId}` : `/adjustments/${m.docId}`} className="hover:text-accent">
                          {m.docNumber}
                        </Link>
                      ) : (
                        (m.docNumber ?? m.docType)
                      )}
                      {m.reversalOf && " ↺"}
                    </td>
                    <td className="td num text-muted">{fmtMoney(m.totalCost, locale)}</td>
                    <td className="td text-muted">{m.actorName?.split(" ")[0] ?? "—"}</td>
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

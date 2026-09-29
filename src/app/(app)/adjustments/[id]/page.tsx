import Link from "next/link"
import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/context"
import { db } from "@/lib/db"
import { listMoves } from "@/domain/ledger/queries"
import { adjustmentMachine } from "@/domain/adjustments/machine"
import { getAdjustment, getLocale, isUuid } from "@/lib/queries"
import { fmtDate, fmtDateTime, fmtDelta, fmtMoney, fmtQty } from "@/lib/format"
import { Label, PageHeader, StatusBadge } from "@/components/ui"
import { DocumentActions } from "@/components/document-actions"

export default async function AdjustmentPage({ params }: PageProps<"/adjustments/[id]">) {
  const ctx = await requirePermission("stock.view")
  const { id } = await params
  if (!isUuid(id)) notFound()
  const [data, locale] = await Promise.all([getAdjustment(ctx.tenant.id, id), getLocale(ctx.tenant.id)])
  if (!data) notFound()
  const { doc, location, lines, author, reversal } = data
  const moves = doc.commandId ? await listMoves(db, ctx.tenant.id, { commandId: doc.commandId }) : []
  const events = adjustmentMachine.available(doc.status)
  const value = moves.reduce((sum, m) => sum + Number(m.totalCost) * (m.toId === location.id ? 1 : -1), 0)

  return (
    <>
      <Link href="/adjustments" className="text-sm text-muted hover:text-text">
        ← Adjustments
      </Link>
      <div className="mt-3">
        <PageHeader
          title={doc.number}
          description={`${doc.kind === "opening" ? "Opening balance" : doc.reason} at ${location.path}${doc.note ? ` · ${doc.note}` : ""}`}
          action={
            <div className="flex items-center gap-3">
              <StatusBadge value={reversal ? "reversed" : doc.status} />
              {ctx.can("stock.adjust") && (
                <DocumentActions
                  id={doc.id}
                  events={events}
                  commandId={doc.status === "posted" && !reversal && ctx.can("stock.reverse") ? doc.commandId : null}
                />
              )}
            </div>
          }
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Fact label="Date" value={fmtDate(doc.occurredAt, locale)} />
        <Fact label="Created by" value={author ?? "—"} />
        <Fact label="Posted" value={doc.postedAt ? fmtDateTime(doc.postedAt, locale) : "Not yet"} />
        <Fact label="Value impact" value={doc.status === "posted" ? fmtMoney(value, locale) : "—"} />
      </div>

      {reversal && (
        <p className="mb-6 rounded-lg border border-line bg-panel px-4 py-3 text-sm text-muted">
          Undone by <span className="font-mono text-text">{reversal.number}</span> on {fmtDateTime(reversal.at, locale)}. The original moves stay in the ledger with their reversal.
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="th">Item</th>
              <th className="th num">Before</th>
              <th className="th num">Counted</th>
              <th className="th num">Change</th>
              <th className="th num">Unit cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line/60 last:border-0">
                <td className="td">
                  <Link href={`/stock/${l.productId}${l.variantId ? `?v=${l.variantId}` : ""}`} className="font-medium hover:text-accent">
                    {l.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted">{l.sku}</span>
                </td>
                <td className="td num text-muted">{l.qtyBefore != null ? fmtQty(l.qtyBefore, locale) : "—"}</td>
                <td className="td num text-muted">{l.countedQty != null ? fmtQty(l.countedQty, locale) : "—"}</td>
                <td className={`td num font-medium ${l.qtyDelta == null ? "text-muted" : Number(l.qtyDelta) < 0 ? "text-danger" : "text-accent"}`}>
                  {l.qtyDelta != null ? fmtDelta(l.qtyDelta, locale) : "at posting"}
                </td>
                <td className="td num text-muted">{l.unitCost ? fmtMoney(l.unitCost, locale) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {moves.length > 0 && (
        <section className="mt-8">
          <Label className="mb-3">Ledger entries</Label>
          <div className="card divide-y divide-line/60 font-mono text-xs">
            {moves.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="w-16 text-right tabular-nums text-text">{fmtQty(m.qty, locale)}</span>
                <span className="text-muted">
                  {m.fromCode} → {m.toCode}
                </span>
                <span className="flex-1 truncate text-muted">{m.name}</span>
                <span className="tabular-nums text-muted">
                  @ {fmtMoney(m.unitCost, locale)} = {fmtMoney(m.totalCost, locale)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <Label>{label}</Label>
      <p className="mt-1.5 text-sm">{value}</p>
    </div>
  )
}

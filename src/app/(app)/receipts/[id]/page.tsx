import Link from "next/link"
import { notFound } from "next/navigation"
import { PartyPopper } from "lucide-react"
import { requirePermission } from "@/lib/context"
import { getLocale, isUuid } from "@/lib/queries"
import { getReceipt } from "@/lib/queries-purchasing"
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format"
import { Label, PageHeader, StatusBadge } from "@/components/ui"
import { LandedCostForm, ReceiptUndo } from "@/components/receipt-tools"

export default async function ReceiptPage({ params, searchParams }: PageProps<"/receipts/[id]">) {
  const ctx = await requirePermission("purchasing.view")
  const { id } = await params
  if (!isUuid(id)) notFound()
  const done = (await searchParams).done === "1"
  const [data, locale] = await Promise.all([getReceipt(ctx.tenant.id, id), getLocale(ctx.tenant.id)])
  if (!data) notFound()
  const { receipt, supplier, po, by, lines, landedCosts } = data
  const goods = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitCost), 0)
  const landed = landedCosts.reduce((s, c) => s + Number(c.amount), 0)
  const posted = receipt.status === "posted"

  return (
    <>
      {po && (
        <Link href={`/purchase-orders/${po.id}`} className="text-sm text-muted hover:text-text">
          ← {po.number}
        </Link>
      )}
      <div className="mt-3">
        <PageHeader
          title={receipt.number}
          description={`Goods receipt from ${supplier}${receipt.reference ? ` · packing slip ${receipt.reference}` : ""}`}
          action={
            <div className="flex items-center gap-2">
              <StatusBadge value={posted ? "posted" : "reversed"} />
              {posted && !landedCosts.length && ctx.can("stock.reverse") && <ReceiptUndo commandId={receipt.commandId} />}
            </div>
          }
        />
      </div>

      {done && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm motion-safe:animate-[pulse-accent_900ms_ease-out]">
          <PartyPopper className="size-4 text-accent" strokeWidth={1.5} />
          <span>
            <span className="font-medium">{po?.number} is fully received.</span> <span className="text-muted">Everything&apos;s on the shelves and valued.</span>
          </span>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Fact label="Received" value={fmtDateTime(receipt.receivedAt, locale)} hint={by ? `by ${by}` : undefined} />
        <Fact label="Goods value" value={fmtMoney(goods, locale)} hint={Number(receipt.exchangeRate) !== 1 ? `at ${Number(receipt.exchangeRate)} ${locale.currency}/${po?.currency}` : undefined} />
        <Fact label="Landed costs" value={fmtMoney(landed, locale)} />
        <Fact label="Landed value" value={fmtMoney(goods + landed, locale)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="th">Item</th>
              <th className="th">Put away in</th>
              <th className="th num">Qty</th>
              <th className="th num">Unit cost</th>
              <th className="th num">Landed</th>
              <th className="th num">Landed unit</th>
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
                  {l.quarantined === "yes" && <span className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">QC hold</span>}
                </td>
                <td className="td font-mono text-xs text-muted">{l.location}</td>
                <td className="td num">{fmtQty(l.qty, locale)}</td>
                <td className="td num text-muted">{fmtMoney(l.unitCost, locale)}</td>
                <td className="td num text-muted">{Number(l.landed) ? fmtMoney(l.landed, locale) : "—"}</td>
                <td className="td num">{fmtMoney(Number(l.unitCost) + Number(l.landed) / Number(l.qty), locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Label className="mb-3">Landed costs</Label>
          {landedCosts.length === 0 ? (
            <div className="card px-4 py-6 text-sm text-muted">
              Freight, duty, brokerage or fees that belong to this delivery. Add them here and Manifest spreads them over the lines, raising the cost of what&apos;s still on hand.
            </div>
          ) : (
            <div className="card divide-y divide-line/60">
              {landedCosts.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="font-medium">{c.description}</span>
                  <span className="text-xs text-muted">by {c.method}</span>
                  <span className="ml-auto tabular-nums">{fmtMoney(c.amount, locale)}</span>
                  <span className="w-full text-xs text-muted sm:w-auto">
                    {fmtMoney(c.capitalized, locale)} into stock
                    {Number(c.expensed) ? ` · ${fmtMoney(c.expensed, locale)} on goods already gone` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {posted && ctx.can("purchasing.manage") && (
          <aside>
            <Label className="mb-3">Add a landed cost</Label>
            <LandedCostForm receiptId={receipt.id} currency={locale.currency} />
          </aside>
        )}
      </section>
    </>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <Label>{label}</Label>
      <p className="mt-1.5 text-sm font-medium tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

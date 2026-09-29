import Link from "next/link"
import { notFound } from "next/navigation"
import { Printer } from "lucide-react"
import { requirePermission } from "@/lib/context"
import { getLocale, isUuid } from "@/lib/queries"
import { getPurchaseOrder } from "@/lib/queries-purchasing"
import { PO_EDITABLE, PO_RECEIVABLE, PO_USER_EVENTS, poMachine } from "@/domain/purchasing/machine"
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/format"
import { Label, PageHeader, StatusBadge } from "@/components/ui"
import { PoActions } from "@/components/po-actions"

export default async function PurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]">) {
  const ctx = await requirePermission("purchasing.view")
  const { id } = await params
  if (!isUuid(id)) notFound()
  const [data, locale] = await Promise.all([getPurchaseOrder(ctx.tenant.id, id), getLocale(ctx.tenant.id)])
  if (!data) notFound()
  const { po, supplier, destination, lines, receipts, author } = data
  const docMoney = { ...locale, currency: po.currency }
  const subtotal = lines.reduce((s, l) => s + Number(l.qtyOrdered) * Number(l.unitCost), 0)
  const total = subtotal + Number(po.taxAmount) + Number(po.shippingAmount)
  const ordered = lines.reduce((s, l) => s + Number(l.qtyOrdered), 0)
  const received = lines.reduce((s, l) => s + Math.min(Number(l.qtyReceived), Number(l.qtyOrdered)), 0)
  const events = poMachine.available(po.status).filter((e) => PO_USER_EVENTS.includes(e)).filter((e) => (e === "approve" ? ctx.can("purchasing.approve") : ctx.can("purchasing.manage")))
  const receivable = PO_RECEIVABLE.includes(po.status) && ctx.can("purchasing.receive")
  const editable = PO_EDITABLE.includes(po.status) && ctx.can("purchasing.manage")

  return (
    <>
      <Link href="/purchase-orders" className="text-sm text-muted hover:text-text">
        ← Purchase orders
      </Link>
      <div className="mt-3">
        <PageHeader
          title={po.number}
          description={`${supplier.name}${po.supplierReference ? ` · ref ${po.supplierReference}` : ""}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={po.status} />
              <a href={`/print/purchase-orders/${po.id}`} target="_blank" className="btn-ghost px-3" title="Print or save as PDF">
                <Printer className="size-4" strokeWidth={1.5} />
              </a>
              {editable && (
                <Link href={`/purchase-orders/${po.id}/edit`} className="btn-ghost">
                  Edit
                </Link>
              )}
              <PoActions id={po.id} events={events} />
              {receivable && (
                <Link href={`/purchase-orders/${po.id}/receive`} className="btn-primary" data-create>
                  Receive
                </Link>
              )}
            </div>
          }
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Fact label="Total" value={fmtMoney(total, docMoney)} hint={po.currency !== locale.currency ? `${fmtMoney(total * Number(po.exchangeRate), locale)} at ${Number(po.exchangeRate)}` : undefined} />
        <Fact label="Received" value={`${fmtQty(received, locale)} of ${fmtQty(ordered, locale)}`} hint={ordered ? `${Math.round((received / ordered) * 100)}%` : undefined} />
        <Fact label="Expected" value={fmtDate(po.expectedOn ? `${po.expectedOn}T12:00:00` : null, locale)} hint={supplier.leadTimeDays ? `${supplier.leadTimeDays}-day lead time` : undefined} />
        <Fact label="Deliver to" value={destination?.path ?? "Chosen at receiving"} />
        <Fact label="Created" value={fmtDate(po.createdAt, locale)} hint={author ? `by ${author}` : undefined} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="th w-10">#</th>
              <th className="th">Item</th>
              <th className="th num">Ordered</th>
              <th className="th w-44">Received</th>
              <th className="th num">Unit</th>
              <th className="th num">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const pct = Math.min(100, (Number(l.qtyReceived) / Number(l.qtyOrdered)) * 100)
              return (
                <tr key={l.id} className="border-b border-line/60 last:border-0">
                  <td className="td font-mono text-xs text-muted">{l.lineNo}</td>
                  <td className="td">
                    <Link href={`/stock/${l.productId}${l.variantId ? `?v=${l.variantId}` : ""}`} className="font-medium hover:text-accent">
                      {l.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted">{l.sku}</span>
                    {l.supplierSku && <span className="ml-2 font-mono text-xs text-muted/70">· theirs {l.supplierSku}</span>}
                  </td>
                  <td className="td num">{fmtQty(l.qtyOrdered, locale)}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                        <div className={`h-full ${pct >= 100 ? "bg-accent" : "bg-sky-400/80"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 text-right tabular-nums text-muted">{fmtQty(l.qtyReceived, locale)}</span>
                    </div>
                  </td>
                  <td className="td num text-muted">{fmtMoney(l.unitCost, docMoney)}</td>
                  <td className="td num">{fmtMoney(Number(l.qtyOrdered) * Number(l.unitCost), docMoney)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="text-sm">
            <Tot label="Subtotal" value={fmtMoney(subtotal, docMoney)} />
            {Number(po.taxAmount) > 0 && <Tot label="Tax" value={fmtMoney(po.taxAmount, docMoney)} />}
            {Number(po.shippingAmount) > 0 && <Tot label="Shipping" value={fmtMoney(po.shippingAmount, docMoney)} />}
            <Tot label="Total" value={fmtMoney(total, docMoney)} strong />
          </tfoot>
        </table>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <Label className="mb-3">Receipts</Label>
          {receipts.length === 0 ? (
            <div className="card px-4 py-8 text-center text-sm text-muted">Nothing received yet.</div>
          ) : (
            <div className="card divide-y divide-line/60">
              {receipts.map((r) => (
                <Link key={r.id} href={`/receipts/${r.id}`} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-panel-2/60">
                  <span className="font-mono font-medium">{r.number}</span>
                  {r.status === "reversed" && <StatusBadge value="reversed" />}
                  <span className="flex-1 text-muted">
                    {fmtQty(r.units, locale)} units{r.reference ? ` · slip ${r.reference}` : ""}
                    {r.landed ? ` · ${fmtMoney(r.landed, locale)} landed` : ""}
                  </span>
                  <span className="text-xs text-muted">
                    {fmtDateTime(r.receivedAt, locale)}
                    {r.by ? ` · ${r.by.split(" ")[0]}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <aside>
          <Label className="mb-3">Timeline</Label>
          <ol className="card space-y-3 p-4 text-sm">
            <Event on={fmtDateTime(po.createdAt, locale)} text="Drafted" />
            {po.approvedAt && <Event on={fmtDateTime(po.approvedAt, locale)} text="Approved" />}
            {po.sentAt && <Event on={fmtDateTime(po.sentAt, locale)} text="Placed with supplier" />}
            {receipts
              .slice()
              .reverse()
              .map((r) => (
                <Event key={r.id} on={fmtDateTime(r.receivedAt, locale)} text={`${r.number}${r.status === "reversed" ? " (undone)" : ""}`} />
              ))}
            {po.closedAt && <Event on={fmtDateTime(po.closedAt, locale)} text={po.status === "cancelled" ? "Cancelled" : "Closed"} />}
          </ol>
          {po.note && (
            <>
              <Label className="mb-3 mt-6">Note to supplier</Label>
              <p className="card whitespace-pre-wrap p-4 text-sm text-muted">{po.note}</p>
            </>
          )}
        </aside>
      </div>
    </>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <Label>{label}</Label>
      <p className="mt-1.5 truncate text-sm font-medium">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

function Tot({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td colSpan={5} className={`px-4 py-1.5 text-right ${strong ? "font-medium" : "text-muted"}`}>
        {label}
      </td>
      <td className={`px-4 py-1.5 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</td>
    </tr>
  )
}

function Event({ on, text }: { on: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
      <span className="flex-1">{text}</span>
      <span className="text-xs text-muted">{on}</span>
    </li>
  )
}

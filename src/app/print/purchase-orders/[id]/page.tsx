import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/context"
import { getLocale, isUuid } from "@/lib/queries"
import { getPurchaseOrder } from "@/lib/queries-purchasing"
import { fmtDate, fmtMoney, fmtQty } from "@/lib/format"
import { PrintButton } from "./print-button"

/** A clean, light, paper-ready purchase order. Print or "Save as PDF" from the browser. */
export default async function PrintPo({ params }: PageProps<"/print/purchase-orders/[id]">) {
  const ctx = await requirePermission("purchasing.view")
  const { id } = await params
  if (!isUuid(id)) notFound()
  const [data, locale] = await Promise.all([getPurchaseOrder(ctx.tenant.id, id), getLocale(ctx.tenant.id)])
  if (!data) notFound()
  const { po, supplier, destination, lines } = data
  const m = { ...locale, currency: po.currency }
  const subtotal = lines.reduce((s, l) => s + Number(l.qtyOrdered) * Number(l.unitCost), 0)
  const total = subtotal + Number(po.taxAmount) + Number(po.shippingAmount)
  const addr = [supplier.addressLine1, supplier.addressLine2, [supplier.city, supplier.state, supplier.postalCode].filter(Boolean).join(", "), supplier.country].filter(Boolean)

  return (
    <div className="min-h-dvh bg-white text-neutral-900 print:min-h-0" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-3xl px-10 py-12 print:p-0">
        <div className="mb-8 flex justify-end print:hidden">
          <PrintButton />
        </div>
        <header className="flex items-start justify-between border-b border-neutral-200 pb-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">Purchase order</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{po.number}</h1>
            <p className="mt-1 text-sm text-neutral-500">{ctx.tenant.name}</p>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-right text-sm">
            <dt className="text-neutral-500">Date</dt>
            <dd>{fmtDate(po.sentAt ?? po.createdAt, locale)}</dd>
            {po.expectedOn && (
              <>
                <dt className="text-neutral-500">Deliver by</dt>
                <dd>{fmtDate(`${po.expectedOn}T12:00:00`, locale)}</dd>
              </>
            )}
            {po.supplierReference && (
              <>
                <dt className="text-neutral-500">Your ref</dt>
                <dd>{po.supplierReference}</dd>
              </>
            )}
            <dt className="text-neutral-500">Currency</dt>
            <dd>{po.currency}</dd>
          </dl>
        </header>
        <section className="grid grid-cols-2 gap-8 py-6 text-sm">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">Supplier</p>
            <p className="font-medium">{supplier.name}</p>
            {addr.map((a) => (
              <p key={a}>{a}</p>
            ))}
            {supplier.email && <p>{supplier.email}</p>}
          </div>
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">Ship to</p>
            <p className="font-medium">{ctx.tenant.name}</p>
            <p>{destination?.path ?? "—"}</p>
            {supplier.paymentTerms && <p className="mt-2 text-neutral-500">Terms: {supplier.paymentTerms}</p>}
          </div>
        </section>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-neutral-200 text-left font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500">
              <th className="py-2 pr-2">#</th>
              <th className="py-2">Item</th>
              <th className="py-2">Your SKU</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-neutral-100">
                <td className="py-2 pr-2 text-neutral-400">{l.lineNo}</td>
                <td className="py-2">
                  {l.name} <span className="font-mono text-xs text-neutral-500">{l.sku}</span>
                </td>
                <td className="py-2 font-mono text-xs">{l.supplierSku ?? "—"}</td>
                <td className="py-2 text-right tabular-nums">{fmtQty(l.qtyOrdered, locale)}</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(l.unitCost, m)}</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(Number(l.qtyOrdered) * Number(l.unitCost), m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 grid w-64 grid-cols-2 gap-y-1 text-sm">
          <dt className="text-neutral-500">Subtotal</dt>
          <dd className="text-right tabular-nums">{fmtMoney(subtotal, m)}</dd>
          {Number(po.taxAmount) > 0 && (
            <>
              <dt className="text-neutral-500">Tax</dt>
              <dd className="text-right tabular-nums">{fmtMoney(po.taxAmount, m)}</dd>
            </>
          )}
          {Number(po.shippingAmount) > 0 && (
            <>
              <dt className="text-neutral-500">Shipping</dt>
              <dd className="text-right tabular-nums">{fmtMoney(po.shippingAmount, m)}</dd>
            </>
          )}
          <dt className="border-t border-neutral-200 pt-1 font-semibold">Total</dt>
          <dd className="border-t border-neutral-200 pt-1 text-right font-semibold tabular-nums">{fmtMoney(total, m)}</dd>
        </dl>
        {po.note && <p className="mt-10 whitespace-pre-wrap border-t border-neutral-200 pt-4 text-sm">{po.note}</p>}
        <p className="mt-16 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400">Issued with Manifest by AXXES</p>
      </div>
    </div>
  )
}

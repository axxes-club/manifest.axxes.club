"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { Lock, Plus, X } from "lucide-react"
import { createPoAction, updatePoAction } from "@/lib/actions/purchasing"
import { ItemPicker, LocationSelect, type LocationOption, type PickedItem } from "@/components/pickers"
import { useToast } from "@/components/shell/toaster"
import { Kbd, Label } from "@/components/ui"

type Supplier = { id: string; name: string; currency: string | null; leadTimeDays: number | null; isActive: boolean | null }
type Line = { key: number; id?: string; item: PickedItem | null; supplierSku: string; qty: string; unitCost: string; received: number; hint?: string }

export type PoDraft = {
  id?: string
  supplierId: string
  currency: string
  exchangeRate: string
  destinationId: string
  expectedOn: string
  supplierReference: string
  taxAmount: string
  shippingAmount: string
  note: string
  placed: boolean
  lines: { id: string; item: PickedItem; supplierSku: string; qty: string; unitCost: string; received: number }[]
}

let seq = 0
const blank = (): Line => ({ key: ++seq, item: null, supplierSku: "", qty: "", unitCost: "", received: 0 })
const n = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? 0 : Number(v))

export function PoEditor({
  suppliers,
  locations,
  baseCurrency,
  initial,
  locale,
}: {
  suppliers: Supplier[]
  locations: LocationOption[]
  baseCurrency: string
  initial?: PoDraft
  locale: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "")
  const supplier = suppliers.find((s) => s.id === supplierId)
  const [currency, setCurrency] = useState(initial?.currency ?? baseCurrency)
  const [rate, setRate] = useState(initial?.exchangeRate ?? "1")
  const [destinationId, setDestinationId] = useState(initial?.destinationId ?? (locations.length === 1 ? locations[0].id : ""))
  const [expectedOn, setExpectedOn] = useState(initial?.expectedOn ?? "")
  const [reference, setReference] = useState(initial?.supplierReference ?? "")
  const [tax, setTax] = useState(initial?.taxAmount ?? "")
  const [shipping, setShipping] = useState(initial?.shippingAmount ?? "")
  const [note, setNote] = useState(initial?.note ?? "")
  const [lines, setLines] = useState<Line[]>(() => (initial?.lines.length ? initial.lines.map((l) => ({ ...l, key: ++seq })) : [blank()]))
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const placed = initial?.placed ?? false
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency }), [locale, currency])

  // A new supplier brings its currency and lead time.
  const chooseSupplier = (id: string) => {
    setSupplierId(id)
    const s = suppliers.find((x) => x.id === id)
    if (s?.currency && !placed) setCurrency(s.currency)
    if (s?.leadTimeDays && !expectedOn) setExpectedOn(new Date(Date.now() + s.leadTimeDays * 86400000).toISOString().slice(0, 10))
  }

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const pickItem = async (key: number, item: PickedItem | null) => {
    update(key, { item, hint: undefined })
    if (!item || !supplierId) return
    const qs = new URLSearchParams({ supplierId, productId: item.productId, ...(item.variantId ? { variantId: item.variantId } : {}) })
    const res = await fetch(`/api/po-line-defaults?${qs}`)
    if (!res.ok) return
    const d = await res.json()
    setLines((ls) =>
      ls.map((l) =>
        l.key === key
          ? {
              ...l,
              unitCost: l.unitCost || (d.unitCost != null ? String(Number(d.unitCost)) : ""),
              supplierSku: l.supplierSku || (d.supplierSku ?? ""),
              qty: l.qty || (d.minQty ? String(Number(d.minQty)) : ""),
              hint: d.source === "supplier" ? "Last price from this supplier" : d.unitCost ? "Catalog cost" : undefined,
            }
          : l,
      ),
    )
  }

  const subtotal = lines.reduce((sum, l) => sum + n(l.qty) * n(l.unitCost), 0)
  const total = subtotal + n(tax) + n(shipping)

  const save = useCallback(() => {
    setError(undefined)
    const ready = lines.filter((l) => l.item)
    if (!supplierId) return setError("Choose a supplier.")
    if (!ready.length) return setError("Add at least one item.")
    const bad = ready.find((l) => n(l.qty) <= 0)
    if (bad) return setError(`${bad.item!.label} needs a quantity.`)
    const payload = {
      supplierId,
      currency,
      exchangeRate: currency === baseCurrency ? "1" : rate || "1",
      destinationId: destinationId || null,
      expectedOn: expectedOn || null,
      supplierReference: reference || null,
      taxAmount: tax || "0",
      shippingAmount: shipping || "0",
      note: note || null,
      lines: ready.map((l) => ({ id: l.id || null, productId: l.item!.productId, variantId: l.item!.variantId, supplierSku: l.supplierSku || null, qtyOrdered: l.qty, unitCost: l.unitCost || "0" })),
    }
    start(async () => {
      const r = initial?.id ? await updatePoAction({ id: initial.id, ...payload }) : await createPoAction({ ...payload, idempotencyKey: crypto.randomUUID() })
      if (!r.ok) return setError(r.error)
      toast({ title: initial?.id ? "Order updated" : `Created ${"number" in r.data ? r.data.number : "order"}` })
      router.push(`/purchase-orders/${r.data.id}`)
      router.refresh()
    })
  }, [lines, supplierId, currency, baseCurrency, rate, destinationId, expectedOn, reference, tax, shipping, note, initial, toast, router])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") (e.preventDefault(), save())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [save])

  return (
    <div className="space-y-4">
      <div className="card grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted">Supplier</span>
          <select className="input" value={supplierId} onChange={(e) => chooseSupplier(e.target.value)} disabled={placed} required>
            <option value="">Who are you buying from?</option>
            {suppliers
              .filter((s) => s.isActive !== false || s.id === supplierId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          {!suppliers.length && (
            <a href="/suppliers/new" className="mt-1 block text-xs text-accent hover:underline">
              Add your first supplier
            </a>
          )}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Deliver to</span>
          <LocationSelect locations={locations} value={destinationId} onChange={setDestinationId} placeholder="Choose at receiving" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Expected</span>
          <input type="date" className="input" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
          {supplier?.leadTimeDays && <span className="mt-1 block text-xs text-muted">{supplier.leadTimeDays}-day lead time</span>}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Currency</span>
          <input className="input font-mono uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} disabled={placed} />
        </label>
        {currency !== baseCurrency && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">
              {baseCurrency} per {currency}
            </span>
            <input className="input tabular-nums" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            <span className="mt-1 block text-xs text-muted">Stock is valued in {baseCurrency} at this rate.</span>
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Supplier reference</span>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Their quote or order #" />
        </label>
      </div>

      <div className="card">
        <div className="hidden grid-cols-[minmax(0,1fr)_8rem_6rem_7rem_7rem_2rem] gap-3 border-b border-line px-5 py-2.5 sm:grid">
          {["Item", "Supplier SKU", "Qty", `Unit (${currency})`, "Line total", ""].map((h) => (
            <span key={h} className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              {h}
            </span>
          ))}
        </div>
        <div className="divide-y divide-line/60">
          {lines.map((l, i) => {
            const locked = l.received > 0
            return (
              <div key={l.key} className="grid items-start gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_7rem_7rem_2rem]">
                <div>
                  {locked ? (
                    <div className="input flex items-center gap-2 text-muted">
                      <Lock className="size-3.5" /> {l.item?.label}
                    </div>
                  ) : (
                    <ItemPicker value={l.item} onChange={(item) => pickItem(l.key, item)} autoFocus={i > 0 && i === lines.length - 1 && !l.item} />
                  )}
                  {(l.hint || locked) && <p className="mt-1 text-xs text-muted">{locked ? `${l.received} received · item and cost are fixed` : l.hint}</p>}
                </div>
                <input className="input font-mono text-xs" value={l.supplierSku} onChange={(e) => update(l.key, { supplierSku: e.target.value })} placeholder="Optional" />
                <input
                  className="input text-right tabular-nums"
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => update(l.key, { qty: e.target.value.replace(/[^\d.]/g, "") })}
                  onKeyDown={(e) => e.key === "Enter" && !e.metaKey && !e.ctrlKey && i === lines.length - 1 && (e.preventDefault(), setLines((ls) => [...ls, blank()]))}
                  placeholder="Qty"
                />
                <input
                  className="input text-right tabular-nums disabled:opacity-50"
                  inputMode="decimal"
                  value={l.unitCost}
                  disabled={locked}
                  onChange={(e) => update(l.key, { unitCost: e.target.value.replace(/[^\d.]/g, "") })}
                  placeholder="0.00"
                />
                <span className="py-2 text-right text-sm tabular-nums">{money.format(n(l.qty) * n(l.unitCost))}</span>
                <button
                  className="mt-1.5 rounded-md p-1 text-muted hover:text-danger disabled:invisible"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  disabled={locked || lines.length === 1}
                  aria-label="Remove line"
                >
                  <X className="size-4" />
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex flex-col gap-4 border-t border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <button className="flex items-center gap-1.5 self-start text-sm text-muted hover:text-text" onClick={() => setLines((ls) => [...ls, blank()])}>
            <Plus className="size-4" strokeWidth={1.5} /> Add line
          </button>
          <dl className="grid w-full max-w-xs grid-cols-[1fr_7rem] items-center gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-right tabular-nums">{money.format(subtotal)}</dd>
            <dt className="text-muted">Tax</dt>
            <dd>
              <input className="input py-1 text-right tabular-nums" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" />
            </dd>
            <dt className="text-muted">Shipping</dt>
            <dd>
              <input className="input py-1 text-right tabular-nums" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0.00" />
            </dd>
            <dt className="border-t border-line pt-2 font-medium">Total</dt>
            <dd className="border-t border-line pt-2 text-right font-semibold tabular-nums">{money.format(total)}</dd>
          </dl>
        </div>
      </div>

      <div className="card p-5">
        <Label className="mb-2">Note to supplier</Label>
        <textarea className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delivery instructions, packaging, anything they should know. Printed on the order." />
      </div>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border border-line bg-panel/95 p-3 backdrop-blur">
        <span className="mr-auto hidden text-xs text-muted sm:inline">
          Shipping here is what the supplier charges on the order. Freight and duty that arrive later go on the receipt as landed costs. <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> saves.
        </span>
        <button className="btn-primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : initial?.id ? "Save changes" : "Create draft"}
        </button>
      </div>
    </div>
  )
}

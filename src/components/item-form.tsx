"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { Plus, X } from "lucide-react"
import { createItemAction, updateItemAction } from "@/lib/actions/catalog"
import { useToast } from "@/components/shell/toaster"
import { Label } from "@/components/ui"

type Axis = { key: number; name: string; values: string }
let seq = 0

export function ItemForm() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [sku, setSku] = useState("")
  const [barcode, setBarcode] = useState("")
  const [price, setPrice] = useState("")
  const [cost, setCost] = useState("")
  const [reorderPoint, setReorderPoint] = useState("")
  const [axes, setAxes] = useState<Axis[]>([])
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

  const options = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const a of axes) {
      const values = a.values.split(",").map((v) => v.trim()).filter(Boolean)
      if (a.name.trim() && values.length) out[a.name.trim()] = values
    }
    return out
  }, [axes])
  const combos = Object.values(options).reduce((n, v) => n * v.length, Object.keys(options).length ? 1 : 0)
  const preview = useMemo(() => {
    const entries = Object.entries(options)
    if (!entries.length) return []
    return entries
      .reduce<string[][]>((acc, [, values]) => acc.flatMap((c) => values.map((v) => [...c, v])), [[]])
      .slice(0, 12)
      .map((c) => (sku ? [sku, ...c].join("-").toUpperCase().replace(/\s+/g, "") : c.join(" / ")))
  }, [options, sku])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    start(async () => {
      const r = await createItemAction({
        name,
        sku: sku || null,
        barcode: barcode || null,
        price: price || "0",
        costPrice: cost || null,
        reorderPoint: reorderPoint || null,
        options: combos ? options : null,
      })
      if (!r.ok) return setError(r.error)
      router.push(`/items/${r.data.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="card grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Name" className="sm:col-span-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Logo tee" required autoFocus />
        </Field>
        <Field label="SKU" hint={combos ? "Variant SKUs are built from this plus each option." : undefined}>
          <input className="input font-mono uppercase" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder="TEE" />
        </Field>
        <Field label="Barcode">
          <input className="input font-mono" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type" />
        </Field>
        <Field label="Price">
          <input className="input tabular-nums" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Cost" hint="Starting cost. Receipts and adjustments set the real cost from then on.">
          <input className="input tabular-nums" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Reorder at" hint="Flag it as low when available drops to this.">
          <input className="input tabular-nums" inputMode="decimal" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <div className="card p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <Label>Options</Label>
          <button type="button" className="flex items-center gap-1.5 text-sm text-muted hover:text-text" onClick={() => setAxes([...axes, { key: ++seq, name: axes.length ? "Color" : "Size", values: "" }])}>
            <Plus className="size-4" strokeWidth={1.5} /> Add option
          </button>
        </div>
        {axes.length === 0 ? (
          <p className="mt-2 text-sm text-muted">One item, one SKU. Add options like size or color to make variants.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {axes.map((a) => (
              <div key={a.key} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                <input className="input" value={a.name} onChange={(e) => setAxes(axes.map((x) => (x.key === a.key ? { ...x, name: e.target.value } : x)))} placeholder="Size" />
                <input
                  className="input"
                  value={a.values}
                  onChange={(e) => setAxes(axes.map((x) => (x.key === a.key ? { ...x, values: e.target.value } : x)))}
                  placeholder="S, M, L, XL"
                />
                <button type="button" onClick={() => setAxes(axes.filter((x) => x.key !== a.key))} className="rounded-md p-2 text-muted hover:text-danger" aria-label="Remove option">
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {combos > 0 && (
              <div className="rounded-xl bg-panel-2/60 p-3">
                <p className="text-xs text-muted">
                  {combos} variant{combos === 1 ? "" : "s"}
                  {combos > 12 ? ", first 12 shown" : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {preview.map((p) => (
                    <span key={p} className="rounded-md bg-panel px-2 py-1 font-mono text-[11px] ring-1 ring-line">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : combos ? `Create item and ${combos} variants` : "Create item"}
        </button>
      </div>
    </form>
  )
}

type Unit = {
  variantId: string | null
  label: string
  sku: string | null
  barcode: string | null
  price: string
  costPrice: string | null
  reorderPoint: string | null
  reorderQty: string | null
  unit: string
}

export function ItemEditor({ productId, name, hasVariants, units, canEdit }: { productId: string; name: string; hasVariants: boolean; units: Unit[]; canEdit: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [title, setTitle] = useState(name)
  const [pending, start] = useTransition()
  const rows = hasVariants ? units.filter((u) => u.variantId) : units.slice(0, 1)

  const save = (u: Unit, form: HTMLFormElement) => {
    const f = new FormData(form)
    const v = (k: string) => String(f.get(k) ?? "").trim()
    start(async () => {
      const r = await updateItemAction({
        productId,
        variantId: u.variantId,
        ...(u.variantId ? {} : { name: title }),
        sku: v("sku") || null,
        barcode: v("barcode") || null,
        price: v("price") || "0",
        costPrice: v("costPrice") || null,
        reorderPoint: v("reorderPoint") || null,
        reorderQty: v("reorderQty") || null,
      })
      toast(r.ok ? { title: `${u.variantId ? u.label : "Item"} saved` } : { title: "Couldn't save", description: r.error, tone: "error" })
      if (r.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {hasVariants && canEdit && (
        <form
          className="card flex gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
              const r = await updateItemAction({ productId, name: title })
              toast(r.ok ? { title: "Name saved" } : { title: "Couldn't save", description: r.error, tone: "error" })
              if (r.ok) router.refresh()
            })
          }}
        >
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Item name" />
          <button className="btn-ghost" disabled={pending}>
            Rename
          </button>
        </form>
      )}
      <div className="card overflow-x-auto">
        <div className="grid min-w-[860px] grid-cols-[minmax(8rem,1.2fr)_1fr_1fr_6rem_6rem_6rem_6rem_auto] items-center gap-2 border-b border-line px-4 py-2.5">
          {["", "SKU", "Barcode", "Price", "Cost", "Reorder at", "Reorder qty", ""].map((h, i) => (
            <span key={i} className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              {h}
            </span>
          ))}
        </div>
        {rows.map((u) => (
          <form
            key={u.variantId ?? "base"}
            onSubmit={(e) => (e.preventDefault(), save(u, e.currentTarget))}
            className="grid min-w-[860px] grid-cols-[minmax(8rem,1.2fr)_1fr_1fr_6rem_6rem_6rem_6rem_auto] items-center gap-2 border-b border-line/60 px-4 py-2 last:border-0"
          >
            {u.variantId ? (
              <span className="truncate text-sm font-medium">{u.label}</span>
            ) : (
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} aria-label="Name" />
            )}
            <input name="sku" defaultValue={u.sku ?? ""} className="input font-mono text-xs uppercase" disabled={!canEdit} />
            <input name="barcode" defaultValue={u.barcode ?? ""} className="input font-mono text-xs" disabled={!canEdit} />
            <input name="price" defaultValue={u.price} className="input text-right tabular-nums" inputMode="decimal" disabled={!canEdit} />
            <input name="costPrice" defaultValue={u.costPrice ?? ""} className="input text-right tabular-nums" inputMode="decimal" disabled={!canEdit} />
            <input name="reorderPoint" defaultValue={u.reorderPoint ? String(Number(u.reorderPoint)) : ""} className="input text-right tabular-nums" inputMode="decimal" disabled={!canEdit} />
            <input name="reorderQty" defaultValue={u.reorderQty ? String(Number(u.reorderQty)) : ""} className="input text-right tabular-nums" inputMode="decimal" disabled={!canEdit} />
            {canEdit ? (
              <button className="btn-ghost px-3" disabled={pending}>
                Save
              </button>
            ) : (
              <span />
            )}
          </form>
        ))}
      </div>
      <p className="text-xs text-muted">Quantities aren&apos;t edited here. Stock only changes through adjustments, moves and receipts, so every number has a history.</p>
    </div>
  )
}

function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { ClipboardPaste, Plus, X } from "lucide-react"
import { createAdjustmentAction, undoAction } from "@/lib/actions/stock"
import { ItemPicker, LocationSelect, type LocationOption, type PickedItem } from "@/components/pickers"
import { useAvailability } from "@/components/use-availability"
import { useToast } from "@/components/shell/toaster"
import { Kbd, Label } from "@/components/ui"
import type { SearchHit } from "@/app/api/search/route"

type Mode = "add" | "remove" | "set"
type Line = { key: number; item: PickedItem | null; mode: Mode; qty: string; unitCost: string }
type Reason = { code: string; label: string; direction: "in" | "out" | "both" }

let seq = 0
const blank = (mode: Mode = "add"): Line => ({ key: ++seq, item: null, mode, qty: "", unitCost: "" })

export function AdjustmentEditor({
  locations,
  reasons,
  initial,
}: {
  locations: LocationOption[]
  reasons: Reason[]
  initial: { locationId?: string; reason?: string; item?: PickedItem | null; mode?: Mode; qty?: string }
}) {
  const router = useRouter()
  const toast = useToast()
  const [locationId, setLocationId] = useState(initial.locationId ?? (locations.length === 1 ? locations[0].id : ""))
  const [reason, setReason] = useState(initial.reason ?? "")
  const [date, setDate] = useState("")
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<Line[]>(() => [initial.item ? { ...blank(initial.mode), item: initial.item, qty: initial.qty ?? "" } : blank(initial.mode)])
  const [error, setError] = useState<string>()
  const [pasting, setPasting] = useState(false)
  const [pending, start] = useTransition()
  const reasonInfo = reasons.find((r) => r.code === reason)

  // The reason decides which way stock can go; keep line modes consistent with it.
  useEffect(() => {
    if (!reasonInfo) return
    setLines((ls) =>
      ls.map((l) => ({
        ...l,
        mode: reasonInfo.direction === "out" && l.mode === "add" ? "remove" : reasonInfo.direction === "in" && l.mode === "remove" ? "add" : l.mode,
      })),
    )
  }, [reasonInfo])

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = useCallback(() => setLines((ls) => [...ls, blank(reasonInfo?.direction === "out" ? "remove" : "add")]), [reasonInfo])

  const submit = useCallback(
    (post: boolean) => {
      setError(undefined)
      const ready = lines.filter((l) => l.item && l.qty.trim() !== "")
      if (!locationId) return setError("Choose a location.")
      if (!reason) return setError("Choose a reason.")
      if (!ready.length) return setError("Add at least one item with a quantity.")
      start(async () => {
        const r = await createAdjustmentAction({
          locationId,
          reason,
          note: note || null,
          occurredAt: date ? new Date(`${date}T12:00:00`) : undefined,
          post,
          idempotencyKey: crypto.randomUUID(),
          lines: ready.map((l) => ({
            productId: l.item!.productId,
            variantId: l.item!.variantId,
            ...(l.mode === "set" ? { countedQty: l.qty } : { qtyDelta: l.mode === "remove" ? `-${l.qty}` : l.qty }),
            unitCost: l.mode === "add" && l.unitCost ? l.unitCost : null,
          })),
        })
        if (!r.ok) return setError(r.error)
        const commandId = r.data.commandId
        toast({
          title: post ? `Posted ${r.data.number}` : `Saved ${r.data.number} as a draft`,
          description: post ? `${ready.length} line${ready.length === 1 ? "" : "s"} · stock updated` : "Post it when you're ready.",
          action: post
            ? {
                label: "Undo",
                onClick: async () => {
                  const u = await undoAction(commandId)
                  toast(u.ok ? { title: `Undone as ${u.data.number}` } : { title: "Couldn't undo", description: u.error, tone: "error" })
                  router.refresh()
                },
              }
            : undefined,
        })
        router.push(`/adjustments/${r.data.id}`)
      })
    },
    [lines, locationId, reason, note, date, toast, router],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") (e.preventDefault(), submit(true))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [submit])

  return (
    <div className="space-y-4">
      <div className="card grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted">Location</span>
          <LocationSelect locations={locations} value={locationId} onChange={setLocationId} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Reason</span>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Why is stock changing?</option>
            {reasons
              .filter((r) => r.code !== "OPENING")
              .map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                  {r.direction === "in" ? " (+)" : r.direction === "out" ? " (−)" : ""}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} placeholder="Today" />
        </label>
        <label className="block sm:col-span-2 lg:col-span-4">
          <span className="mb-1.5 block text-xs font-medium text-muted">Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: what happened, who found it, ticket number…" />
        </label>
      </div>

      <div className="card">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <Label>Lines</Label>
          <button type="button" className="flex items-center gap-1.5 text-xs text-muted hover:text-text" onClick={() => setPasting(!pasting)}>
            <ClipboardPaste className="size-3.5" strokeWidth={1.5} /> Paste from a spreadsheet
          </button>
        </div>
        {pasting && <PasteBox onDone={(ls) => (setLines((cur) => [...cur.filter((l) => l.item), ...ls]), setPasting(false))} defaultMode={reasonInfo?.direction === "out" ? "remove" : "add"} />}
        <div className="divide-y divide-line/60">
          {lines.map((l, i) => (
            <LineRow
              key={l.key}
              line={l}
              locationId={locationId}
              direction={reasonInfo?.direction ?? "both"}
              autoFocus={i === lines.length - 1 && i > 0}
              onChange={(patch) => update(l.key, patch)}
              onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((x) => x.key !== l.key)) : undefined}
              onEnter={i === lines.length - 1 ? addLine : undefined}
            />
          ))}
        </div>
        <div className="border-t border-line px-5 py-3">
          <button type="button" className="flex items-center gap-1.5 text-sm text-muted hover:text-text" onClick={addLine}>
            <Plus className="size-4" strokeWidth={1.5} /> Add line
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-xl border border-line bg-panel/95 p-3 backdrop-blur">
        <p className="mr-auto hidden text-xs text-muted sm:block">
          Posting updates stock immediately and can be undone. <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> posts.
        </p>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => submit(false)}>
          Save draft
        </button>
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit(true)}>
          {pending ? "Posting…" : "Post adjustment"}
        </button>
      </div>
    </div>
  )
}

function LineRow({
  line,
  locationId,
  direction,
  autoFocus,
  onChange,
  onRemove,
  onEnter,
}: {
  line: Line
  locationId: string
  direction: "in" | "out" | "both"
  autoFocus?: boolean
  onChange: (patch: Partial<Line>) => void
  onRemove?: () => void
  onEnter?: () => void
}) {
  const stock = useAvailability(line.item?.productId, line.item?.variantId, locationId)
  const qtyRef = useRef<HTMLInputElement>(null)
  const n = Number(line.qty || 0)
  const after = stock == null ? null : line.mode === "set" ? n : line.mode === "add" ? stock.onHand + n : stock.onHand - n
  const short = after != null && after < 0

  return (
    <div className="grid items-start gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_7rem_7rem_auto]">
      <ItemPicker value={line.item} autoFocus={autoFocus} onChange={(item) => (onChange({ item }), item && setTimeout(() => qtyRef.current?.focus(), 0))} />
      <div className="flex rounded-lg border border-line bg-panel-2 p-0.5 text-xs">
        {(["add", "remove", "set"] as Mode[]).map((m) => {
          const disabled = (m === "add" && direction === "out") || (m === "remove" && direction === "in")
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ mode: m })}
              className={`rounded-md px-2.5 py-1.5 capitalize transition disabled:opacity-30 ${line.mode === m ? "bg-panel text-text shadow ring-1 ring-line" : "text-muted hover:text-text"}`}
            >
              {m === "set" ? "Set to" : m}
            </button>
          )
        })}
      </div>
      <div>
        <input
          ref={qtyRef}
          className={`input text-right tabular-nums ${short ? "border-danger/60" : ""}`}
          inputMode="decimal"
          placeholder="Qty"
          value={line.qty}
          onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d.]/g, "") })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && onEnter) (e.preventDefault(), onEnter())
          }}
        />
        {stock && (
          <p className={`mt-1 text-right font-mono text-[10px] ${short ? "text-danger" : "text-muted"}`}>
            {stock.onHand} → {after}
          </p>
        )}
      </div>
      <input
        className="input text-right tabular-nums disabled:opacity-40"
        inputMode="decimal"
        placeholder="Unit cost"
        title="Cost per unit for stock being added. Leave blank to use the item's current cost."
        disabled={line.mode !== "add"}
        value={line.mode === "add" ? line.unitCost : ""}
        onChange={(e) => onChange({ unitCost: e.target.value.replace(/[^\d.]/g, "") })}
      />
      <button type="button" className="mt-2 rounded-md p-1 text-muted hover:text-danger disabled:invisible" onClick={onRemove} disabled={!onRemove} aria-label="Remove line">
        <X className="size-4" />
      </button>
    </div>
  )
}

/** Paste "SKU<tab>qty<tab>cost" rows from any spreadsheet; SKUs resolve against the catalog. */
function PasteBox({ onDone, defaultMode }: { onDone: (lines: Line[]) => void; defaultMode: Mode }) {
  const [text, setText] = useState("")
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const apply = async () => {
    setBusy(true)
    const out: Line[] = []
    const bad: string[] = []
    for (const raw of text.split(/\r?\n/).filter((r) => r.trim())) {
      const [sku, qty, cost] = raw.split(/\t|,/).map((c) => c.trim())
      if (!sku || !qty || Number.isNaN(Number(qty))) {
        bad.push(`“${raw}” needs a SKU and a quantity`)
        continue
      }
      const res = await fetch(`/api/search?kinds=item&q=${encodeURIComponent(sku)}`)
      const hits: SearchHit[] = res.ok ? (await res.json()).hits : []
      const hit = hits.find((h) => h.sku?.toLowerCase() === sku.toLowerCase())
      if (!hit) {
        bad.push(`No item with SKU ${sku}`)
        continue
      }
      const n = Number(qty)
      out.push({
        ...blank(n < 0 ? "remove" : defaultMode),
        item: { productId: hit.productId!, variantId: hit.variantId ?? null, label: hit.title, sku: hit.sku ?? null },
        qty: String(Math.abs(n)),
        unitCost: cost ?? "",
      })
    }
    setBusy(false)
    setProblems(bad)
    if (out.length) onDone(out)
  }

  return (
    <div className="space-y-2 border-b border-line bg-panel-2/40 px-5 py-4">
      <textarea
        className="input min-h-24 font-mono text-xs"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"TEE-BLK-M\t12\t4.20\nMUG-01\t-3"}
      />
      {problems.length > 0 && (
        <ul className="text-xs text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button type="button" className="btn-ghost" disabled={busy || !text.trim()} onClick={apply}>
          {busy ? "Matching…" : "Add lines"}
        </button>
      </div>
    </div>
  )
}

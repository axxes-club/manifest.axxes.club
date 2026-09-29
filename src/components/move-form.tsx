"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState, useTransition } from "react"
import { ArrowRight, Plus, X } from "lucide-react"
import { moveStockAction, undoAction } from "@/lib/actions/stock"
import { ItemPicker, LocationSelect, type LocationOption, type PickedItem } from "@/components/pickers"
import { useAvailability } from "@/components/use-availability"
import { useToast } from "@/components/shell/toaster"
import { Kbd } from "@/components/ui"

type Line = { key: number; item: PickedItem | null; qty: string }
let seq = 0

export function MoveForm({ locations, initial }: { locations: LocationOption[]; initial: { item: PickedItem | null; qty: string; from?: string; to?: string } }) {
  const router = useRouter()
  const toast = useToast()
  const [from, setFrom] = useState(initial.from ?? "")
  const [to, setTo] = useState(initial.to ?? "")
  const [lines, setLines] = useState<Line[]>([{ key: ++seq, item: initial.item, qty: initial.qty }])
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

  const submit = useCallback(() => {
    setError(undefined)
    const ready = lines.filter((l) => l.item && Number(l.qty) > 0)
    if (!from || !to) return setError("Choose where it's coming from and going to.")
    if (!ready.length) return setError("Add an item and a quantity.")
    start(async () => {
      const r = await moveStockAction({
        fromLocationId: from,
        toLocationId: to,
        idempotencyKey: crypto.randomUUID(),
        lines: ready.map((l) => ({ productId: l.item!.productId, variantId: l.item!.variantId, qty: l.qty })),
      })
      if (!r.ok) return setError(r.error)
      const fromCode = locations.find((l) => l.id === from)?.code
      const toCode = locations.find((l) => l.id === to)?.code
      toast({
        title: `Moved to ${toCode}`,
        description: `${ready.length} item${ready.length === 1 ? "" : "s"} from ${fromCode}`,
        action: {
          label: "Undo",
          onClick: async () => {
            const u = await undoAction(r.data.commandId)
            toast(u.ok ? { title: "Move undone" } : { title: "Couldn't undo", description: u.error, tone: "error" })
            router.refresh()
          },
        },
      })
      setLines([{ key: ++seq, item: null, qty: "" }])
      router.refresh()
    })
  }, [from, to, lines, locations, toast, router])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") (e.preventDefault(), submit())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [submit])

  return (
    <div className="space-y-4">
      <div className="card grid items-end gap-4 p-5 sm:grid-cols-[1fr_auto_1fr]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">From</span>
          <LocationSelect locations={locations} value={from} onChange={setFrom} exclude={to} />
        </label>
        <ArrowRight className="mb-2.5 hidden size-4 text-muted sm:block" />
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">To</span>
          <LocationSelect locations={locations} value={to} onChange={setTo} exclude={from} />
        </label>
      </div>
      <div className="card divide-y divide-line/60">
        {lines.map((l, i) => (
          <MoveLine
            key={l.key}
            line={l}
            from={from}
            autoFocus={i > 0 && i === lines.length - 1}
            onChange={(patch) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...patch } : x)))}
            onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((x) => x.key !== l.key)) : undefined}
            onEnter={() => setLines((ls) => [...ls, { key: ++seq, item: null, qty: "" }])}
          />
        ))}
        <div className="px-5 py-3">
          <button type="button" className="flex items-center gap-1.5 text-sm text-muted hover:text-text" onClick={() => setLines((ls) => [...ls, { key: ++seq, item: null, qty: "" }])}>
            <Plus className="size-4" strokeWidth={1.5} /> Add item
          </button>
        </div>
      </div>
      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <span className="hidden text-xs text-muted sm:inline">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> to move
        </span>
        <button className="btn-primary" disabled={pending} onClick={submit}>
          {pending ? "Moving…" : "Move stock"}
        </button>
      </div>
    </div>
  )
}

function MoveLine({
  line,
  from,
  autoFocus,
  onChange,
  onRemove,
  onEnter,
}: {
  line: Line
  from: string
  autoFocus?: boolean
  onChange: (p: Partial<Line>) => void
  onRemove?: () => void
  onEnter: () => void
}) {
  const stock = useAvailability(line.item?.productId, line.item?.variantId, from)
  const over = stock != null && Number(line.qty) > stock.available
  return (
    <div className="grid items-start gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
      <ItemPicker value={line.item} onChange={(item) => onChange({ item })} autoFocus={autoFocus} />
      <div>
        <input
          className={`input text-right tabular-nums ${over ? "border-danger/60" : ""}`}
          inputMode="decimal"
          placeholder="Qty"
          value={line.qty}
          onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d.]/g, "") })}
          onKeyDown={(e) => e.key === "Enter" && !e.metaKey && !e.ctrlKey && (e.preventDefault(), onEnter())}
        />
        {stock && (
          <button
            type="button"
            className={`mt-1 w-full text-right font-mono text-[10px] ${over ? "text-danger" : "text-muted hover:text-accent"}`}
            onClick={() => onChange({ qty: String(stock.available) })}
            title="Move everything available"
          >
            {stock.available} available
          </button>
        )}
      </div>
      <button type="button" className="mt-2 rounded-md p-1 text-muted hover:text-danger disabled:invisible" onClick={onRemove} disabled={!onRemove} aria-label="Remove">
        <X className="size-4" />
      </button>
    </div>
  )
}

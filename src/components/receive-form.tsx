"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { ScanLine } from "lucide-react"
import { receivePoAction } from "@/lib/actions/purchasing"
import { undoAction } from "@/lib/actions/stock"
import { LocationSelect, type LocationOption } from "@/components/pickers"
import { useToast } from "@/components/shell/toaster"
import { Kbd } from "@/components/ui"

export type ReceivableLine = { id: string; lineNo: number; name: string; sku: string | null; barcode: string | null; supplierSku: string | null; ordered: number; received: number; defaultLocationId: string | null }

type Row = { qty: string; locationId: string; quarantine: boolean }

export function ReceiveForm({
  poId,
  poNumber,
  lines,
  locations,
  destinationId,
  canOverride,
}: {
  poId: string
  poNumber: string
  lines: ReceivableLine[]
  locations: LocationOption[]
  destinationId: string | null
  canOverride: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { qty: String(Math.max(l.ordered - l.received, 0) || ""), locationId: l.defaultLocationId ?? destinationId ?? "", quarantine: false }])),
  )
  const [reference, setReference] = useState("")
  const [allowOver, setAllowOver] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [scan, setScan] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const scanRef = useRef<HTMLInputElement>(null)
  const idempotencyKey = useRef(crypto.randomUUID())

  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))
  const setAllLocations = (locationId: string) => setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, locationId }])))

  // Scanning counts from zero: the first scan of a line replaces the prefilled
  // outstanding quantity, then each scan adds one.
  const scanned = useRef(new Set<string>())
  const onScan = (code: string) => {
    const c = code.trim().toLowerCase()
    const line = lines.find((l) => [l.sku, l.barcode, l.supplierSku].some((x) => x?.toLowerCase() === c))
    if (!line) return setError(`Nothing on ${poNumber} matches “${code}”.`)
    setError(undefined)
    const first = !scanned.current.has(line.id)
    scanned.current.add(line.id)
    setRows((r) => ({ ...r, [line.id]: { ...r[line.id], qty: String(first ? 1 : Number(r[line.id].qty || 0) + 1) } }))
    setFlash(line.id)
    setTimeout(() => setFlash(null), 400)
  }

  const submit = useCallback(() => {
    setError(undefined)
    const chosen = lines.filter((l) => Number(rows[l.id].qty) > 0)
    if (!chosen.length) return setError("Enter what arrived.")
    start(async () => {
      const r = await receivePoAction({
        poId,
        reference: reference || null,
        allowOver,
        idempotencyKey: idempotencyKey.current,
        lines: chosen.map((l) => ({ poLineId: l.id, qty: rows[l.id].qty, locationId: rows[l.id].locationId || null, quarantine: rows[l.id].quarantine })),
      })
      if (!r.ok) {
        idempotencyKey.current = crypto.randomUUID()
        return setError(r.error)
      }
      toast({
        title: r.data.fullyReceived ? `${poNumber} fully received` : `Received on ${r.data.number}`,
        description: `${chosen.length} line${chosen.length === 1 ? "" : "s"} put away`,
        action: {
          label: "Undo",
          onClick: async () => {
            const u = await undoAction(r.data.commandId)
            toast(u.ok ? { title: `${r.data.number} undone` } : { title: "Couldn't undo", description: u.error, tone: "error" })
            router.refresh()
          },
        },
      })
      router.push(`/receipts/${r.data.id}${r.data.fullyReceived ? "?done=1" : ""}`)
    })
  }, [lines, rows, poId, reference, allowOver, poNumber, toast, router])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") (e.preventDefault(), submit())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [submit])

  return (
    <div className="space-y-4">
      <div className="card grid gap-4 p-5 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <ScanLine className="size-3.5" /> Scan to count
          </span>
          <input
            ref={scanRef}
            autoFocus
            className="input font-mono"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (scan.trim()) onScan(scan)
                setScan("")
              }
            }}
            placeholder="SKU or barcode, then ↵"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Put everything in</span>
          <LocationSelect locations={locations} value="" onChange={setAllLocations} placeholder="Per line (below)" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Packing slip #</span>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
        </label>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="th">Item</th>
              <th className="th num">Ordered</th>
              <th className="th num">Received</th>
              <th className="th w-28 num">Receiving now</th>
              <th className="th w-64">Put away in</th>
              <th className="th">QC hold</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const row = rows[l.id]
              const outstanding = Math.max(l.ordered - l.received, 0)
              const over = Number(row.qty) > outstanding
              return (
                <tr key={l.id} className={`border-b border-line/60 transition-colors last:border-0 ${flash === l.id ? "bg-accent/10" : ""}`}>
                  <td className="td">
                    <span className="font-medium">{l.name}</span>
                    <span className="ml-2 font-mono text-xs text-muted">{l.sku}</span>
                  </td>
                  <td className="td num text-muted">{l.ordered}</td>
                  <td className="td num text-muted">{l.received || "—"}</td>
                  <td className="td">
                    <input
                      className={`input text-right tabular-nums ${over ? "border-amber-400/60" : ""}`}
                      inputMode="decimal"
                      value={row.qty}
                      onChange={(e) => set(l.id, { qty: e.target.value.replace(/[^\d.]/g, "") })}
                    />
                    {over && <span className="mt-1 block text-right text-[10px] text-amber-300">{Number(row.qty) - outstanding} over</span>}
                  </td>
                  <td className="td">
                    <LocationSelect locations={locations} value={row.locationId} onChange={(v) => set(l.id, { locationId: v })} />
                  </td>
                  <td className="td">
                    <input
                      type="checkbox"
                      checked={row.quarantine}
                      onChange={(e) => set(l.id, { quarantine: e.target.checked })}
                      className="size-4 accent-[var(--accent)]"
                      title="Hold for inspection: counted in stock, but not available to sell"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-line bg-panel/95 p-3 backdrop-blur">
        {canOverride && (
          <label className="mr-auto flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={allowOver} onChange={(e) => setAllowOver(e.target.checked)} className="accent-[var(--accent)]" />
            Accept more than ordered
          </label>
        )}
        <button className="btn-ghost" onClick={() => setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, qty: "" }])))}>
          Clear
        </button>
        <span className="hidden text-xs text-muted sm:inline">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
        </span>
        <button className="btn-primary" disabled={pending} onClick={submit}>
          {pending ? "Receiving…" : "Receive and put away"}
        </button>
      </div>
    </div>
  )
}

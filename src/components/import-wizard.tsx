"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"
import { FileSpreadsheet, Upload } from "lucide-react"
import { commitImportAction, previewImportAction } from "@/lib/actions/imports"
import type { Column, PreviewRow } from "@/domain/imports/opening"
import { useToast } from "@/components/shell/toaster"
import { Label } from "@/components/ui"

const COLS: { key: Column; label: string; required?: boolean }[] = [
  { key: "sku", label: "SKU", required: true },
  { key: "qty", label: "Quantity", required: true },
  { key: "location", label: "Location code" },
  { key: "name", label: "Item name" },
  { key: "unitCost", label: "Unit cost" },
  { key: "price", label: "Price" },
  { key: "barcode", label: "Barcode" },
]

const SAMPLE = "SKU,Name,Location,Qty,Unit cost,Price\nTEE-BLK-M,Logo tee (black M),MAIN,24,6.50,30\nCAP-01,Dad cap,MAIN,40,4.10,25\n"

export function ImportWizard({ locations }: { locations: { code: string; path: string }[] }) {
  const router = useRouter()
  const toast = useToast()
  const [csv, setCsv] = useState("")
  const [header, setHeader] = useState<string[]>([])
  const [mapping, setMapping] = useState<Partial<Record<Column, number>>>({})
  const [rows, setRows] = useState<PreviewRow[] | null>(null)
  const [defaultLocation, setDefaultLocation] = useState(locations.length === 1 ? locations[0].code : "")
  const [createMissing, setCreateMissing] = useState(true)
  const [goLive, setGoLive] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const key = useRef(crypto.randomUUID())
  const file = useRef<HTMLInputElement>(null)

  const preview = (o: { text?: string; map?: Partial<Record<Column, number>>; loc?: string; create?: boolean } = {}) =>
    start(async () => {
      setError(undefined)
      const r = await previewImportAction({
        csv: o.text ?? csv,
        mapping: o.map,
        defaultLocation: (o.loc ?? defaultLocation) || null,
        createMissing: o.create ?? createMissing,
      })
      if (!r.ok) return setError(r.error)
      setHeader(r.data.header)
      setMapping(r.data.mapping)
      setRows(r.data.preview)
      key.current = crypto.randomUUID()
    })

  const load = async (f: File) => {
    const text = await f.text()
    setCsv(text)
    preview({ text })
  }

  const commit = () =>
    start(async () => {
      const r = await commitImportAction({ csv, mapping, defaultLocation: defaultLocation || null, createMissing, goLive: goLive || undefined, idempotencyKey: key.current })
      if (!r.ok) return setError(r.error)
      toast({ title: `Imported ${r.data.imported} rows`, description: `${r.data.itemsCreated} new items · ${r.data.documents.join(", ")}` })
      router.push("/stock")
    })

  const counts = rows ? { ok: rows.filter((r) => r.status === "ok").length, create: rows.filter((r) => r.status === "create").length, skip: rows.filter((r) => r.status === "skip").length } : null
  const missingLocation = rows && mapping.location == null && !defaultLocation

  if (!locations.length)
    return (
      <div className="card p-8 text-center text-sm text-muted">
        Add a location first, so imported stock has somewhere to live.{" "}
        <Link href="/locations/new" className="text-accent hover:underline">
          Add a location
        </Link>
      </div>
    )

  return (
    <div className="space-y-6">
      {!rows && (
        <div
          className="card grid gap-6 p-6 lg:grid-cols-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) void load(f)
          }}
        >
          <button
            type="button"
            onClick={() => file.current?.click()}
            className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-12 text-center transition hover:border-accent/50"
          >
            <Upload className="mb-3 size-6 text-muted" strokeWidth={1.5} />
            <span className="font-medium">Drop a CSV here, or choose a file</span>
            <span className="mt-1 text-sm text-muted">Exports from any tool work. Columns are matched by name.</span>
            <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          </button>
          <div className="flex flex-col">
            <Label className="mb-2">Or paste from a spreadsheet</Label>
            <textarea className="input min-h-40 flex-1 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} />
            <div className="mt-3 flex items-center justify-between">
              <button type="button" className="flex items-center gap-1.5 text-xs text-muted hover:text-text" onClick={() => setCsv(SAMPLE.replaceAll("MAIN", locations[0].code))}>
                <FileSpreadsheet className="size-3.5" strokeWidth={1.5} /> Use sample
              </button>
              <button className="btn-primary" disabled={!csv.trim() || pending} onClick={() => preview()}>
                {pending ? "Checking…" : "Check rows"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rows && counts && (
        <>
          <div className="card grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <Label className="mb-3">Columns</Label>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {COLS.map((c) => (
                  <label key={c.key} className="block">
                    <span className="mb-1 block text-xs text-muted">
                      {c.label}
                      {c.required && <span className="text-accent"> *</span>}
                    </span>
                    <select
                      className="input py-1.5"
                      value={mapping[c.key] ?? ""}
                      onChange={(e) => {
                        const next = { ...mapping, [c.key]: e.target.value === "" ? undefined : Number(e.target.value) }
                        setMapping(next)
                        preview({ map: next })
                      }}
                    >
                      <option value="">Not in file</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Rows without a location go to</span>
                <select className="input py-1.5" value={defaultLocation} onChange={(e) => (setDefaultLocation(e.target.value), preview({ map: mapping, loc: e.target.value }))}>
                  <option value="">Skip them</option>
                  {locations.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.path}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Go-live date (the balances' date)</span>
                <input type="date" className="input py-1.5" value={goLive} onChange={(e) => setGoLive(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={createMissing} onChange={(e) => (setCreateMissing(e.target.checked), preview({ map: mapping, create: e.target.checked }))} className="accent-[var(--accent)]" />
                Create items for unknown SKUs
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-emerald-300 ring-1 ring-emerald-400/20">{counts.ok} match existing items</span>
            <span className="rounded-full bg-sky-400/10 px-3 py-1 text-sky-300 ring-1 ring-sky-400/20">{counts.create} new items</span>
            <span className="rounded-full bg-amber-400/10 px-3 py-1 text-amber-300 ring-1 ring-amber-400/20">{counts.skip} skipped</span>
            {missingLocation && <span className="text-amber-300">Map a location column or choose a default location.</span>}
          </div>

          <div className="card max-h-[50vh] overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-line">
                  <th className="th w-14">Row</th>
                  <th className="th">SKU</th>
                  <th className="th">Name</th>
                  <th className="th">Location</th>
                  <th className="th num">Qty</th>
                  <th className="th num">Unit cost</th>
                  <th className="th">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className={`border-b border-line/60 last:border-0 ${r.status === "skip" ? "text-muted" : ""}`}>
                    <td className="td font-mono text-xs text-muted">{r.row}</td>
                    <td className="td font-mono text-xs">{r.sku ?? "—"}</td>
                    <td className="td">{r.name ?? "—"}</td>
                    <td className="td font-mono text-xs">{r.location ?? (defaultLocation || "—")}</td>
                    <td className="td num">{r.qty ?? "—"}</td>
                    <td className="td num">{r.unitCost ?? "—"}</td>
                    <td className="td text-xs">
                      {r.status === "ok" ? (
                        <span className="text-emerald-300">Ready</span>
                      ) : r.status === "create" ? (
                        <span className="text-sky-300">New item</span>
                      ) : (
                        <span className="text-amber-300">{r.problem}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="sticky bottom-4 flex items-center justify-end gap-2 rounded-xl border border-line bg-panel/95 p-3 backdrop-blur">
            <button className="btn-ghost mr-auto" onClick={() => (setRows(null), setError(undefined))}>
              Start over
            </button>
            <button className="btn-primary" disabled={pending || counts.ok + counts.create === 0} onClick={commit}>
              {pending ? "Importing…" : `Import ${counts.ok + counts.create} rows`}
            </button>
          </div>
        </>
      )}
      {error && !rows && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  )
}

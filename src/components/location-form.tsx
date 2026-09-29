"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { archiveLocationAction, createLocationAction, generateBinsAction, updateLocationAction } from "@/lib/actions/locations"
import { useToast } from "@/components/shell/toaster"
import { Label } from "@/components/ui"
import type { LocationOption } from "@/components/pickers"

const KINDS = [
  { value: "warehouse", label: "Warehouse", hint: "A building you store stock in", top: true },
  { value: "venue", label: "Venue", hint: "A bar, club or store with a back of house", top: true },
  { value: "popup", label: "Pop-up", hint: "An event, market or temporary shop", top: true },
  { value: "vehicle", label: "Vehicle", hint: "A van or truck that carries stock", top: true },
  { value: "zone", label: "Zone", hint: "An area inside a warehouse or venue", top: false },
  { value: "bin", label: "Bin", hint: "A shelf, rack position or box", top: false },
] as const

export function LocationForm({ parents, initialParent }: { parents: (LocationOption & { kind: string })[]; initialParent: string }) {
  const router = useRouter()
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>(initialParent ? "bin" : "warehouse")
  const [parentId, setParentId] = useState(initialParent)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [codeTouched, setCodeTouched] = useState(false)
  const [pattern, setPattern] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const top = KINDS.find((k) => k.value === kind)!.top
  const suggested = useMemo(() => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 12), [name])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    start(async () => {
      const r = await createLocationAction({ kind, name, code: codeTouched ? code : suggested, parentId: top ? null : parentId || null })
      if (!r.ok) return setError(r.error)
      if (pattern.trim()) {
        const b = await generateBinsAction(r.data.id, pattern)
        if (!b.ok) return setError(`Location created, but bins weren't: ${b.error}`)
      }
      router.push(`/locations/${r.data.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="card space-y-6 p-5 sm:p-6">
      <div>
        <span className="mb-2 block text-xs font-medium text-muted">What is it?</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <button
              type="button"
              key={k.value}
              onClick={() => setKind(k.value)}
              className={`rounded-xl border p-3 text-left transition ${kind === k.value ? "border-accent/60 bg-accent/5" : "border-line hover:border-muted/40"}`}
            >
              <span className="block text-sm font-medium">{k.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{k.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {!top && (
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-muted">Inside</span>
            <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)} required>
              <option value="">Choose where it sits</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.path}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={top ? "Main warehouse" : "Aisle A"} required autoFocus />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Code</span>
          <input
            className="input font-mono uppercase"
            value={codeTouched ? code : suggested}
            onChange={(e) => (setCode(e.target.value.toUpperCase()), setCodeTouched(true))}
            placeholder="MAIN"
            required
          />
          <span className="mt-1 block text-xs text-muted">Printed on labels and typed in commands. Unique in this workspace.</span>
        </label>
      </div>
      {kind !== "bin" && (
        <div className="rounded-xl border border-dashed border-line p-4">
          <Label>Generate bins (optional)</Label>
          <input className="input mt-2 font-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="A-{01..12}-{1..4}" />
          <p className="mt-1.5 text-xs text-muted">
            Ranges in braces expand: <span className="font-mono">A-{"{01..12}"}-{"{1..4}"}</span> makes 48 bins, A-01-1 to A-12-4. Letters work too: <span className="font-mono">{"{A..D}"}</span>.
          </p>
        </div>
      )}
      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end border-t border-line pt-5">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create location"}
        </button>
      </div>
    </form>
  )
}

/** Side panel on a location: rename, generate bins, archive. */
export function LocationTools({ location }: { location: { id: string; code: string; name: string; kind: string; allowNegative: boolean } }) {
  const router = useRouter()
  const toast = useToast()
  const [name, setName] = useState(location.name)
  const [code, setCode] = useState(location.code)
  const [pattern, setPattern] = useState("")
  const [pending, start] = useTransition()
  const done = (r: { ok: true } | { ok: false; error: string }, title: string) => {
    toast(r.ok ? { title } : { title: "Couldn't do that", description: r.error, tone: "error" })
    if (r.ok) router.refresh()
  }

  return (
    <div className="space-y-6">
      <section>
        <Label className="mb-3">Details</Label>
        <form
          className="card space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            start(async () => done(await updateLocationAction({ id: location.id, name, code }), "Location updated"))
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <input className="input font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Code" />
          <p className="text-xs text-muted">Renaming a code updates every bin inside it.</p>
          <button className="btn-ghost w-full" disabled={pending}>
            Save
          </button>
        </form>
      </section>
      {location.kind !== "bin" && (
        <section>
          <Label className="mb-3">Add bins</Label>
          <form
            className="card space-y-3 p-4"
            onSubmit={(e) => {
              e.preventDefault()
              start(async () => {
                const r = await generateBinsAction(location.id, pattern)
                done(r, r.ok ? `${r.data.created} bins created${r.data.skipped ? `, ${r.data.skipped} already existed` : ""}` : "")
                if (r.ok) setPattern("")
              })
            }}
          >
            <input className="input font-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={`${location.code}-{01..20}`} required />
            <button className="btn-ghost w-full" disabled={pending}>
              Generate
            </button>
          </form>
        </section>
      )}
      <button
        className="btn-danger w-full"
        disabled={pending}
        onClick={() =>
          confirm(`Archive ${location.code} and everything inside it? It must be empty.`) &&
          start(async () => {
            const r = await archiveLocationAction(location.id)
            done(r, `${location.code} archived`)
            if (r.ok) router.push("/locations")
          })
        }
      >
        Archive location
      </button>
    </div>
  )
}

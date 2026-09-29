"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { addReasonAction, saveSettingsAction, toggleReasonAction } from "@/lib/actions/settings"
import { useToast } from "@/components/shell/toaster"

type Settings = { costingMethod: "fifo" | "average"; baseCurrency: string; locale: string; lockDate: string; syncLegacy: boolean; overReceiptPct: string; poApprovalThreshold: string }

export function SettingsForm({ initial, canEdit, costingLocked }: { initial: Settings; canEdit: boolean; costingLocked: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState(initial)
  const [pending, start] = useTransition()
  const set = <K extends keyof Settings>(k: K, value: Settings[K]) => setV({ ...v, [k]: value })

  return (
    <form
      className="card divide-y divide-line/60"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await saveSettingsAction(v)
          toast(r.ok ? { title: "Settings saved" } : { title: "Couldn't save", description: r.error, tone: "error" })
          if (r.ok) router.refresh()
        })
      }}
    >
      <Row title="Costing method" body={costingLocked ? "Fixed now that stock has moved; changing it would rewrite history." : "How the cost of stock leaving is worked out. FIFO uses the oldest cost first; average blends them."}>
        <div className="flex rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
          {(["fifo", "average"] as const).map((m) => (
            <button
              type="button"
              key={m}
              disabled={!canEdit || costingLocked}
              onClick={() => set("costingMethod", m)}
              className={`rounded-md px-3 py-1.5 disabled:cursor-not-allowed ${v.costingMethod === m ? "bg-panel text-text ring-1 ring-line" : "text-muted"}`}
            >
              {m === "fifo" ? "FIFO" : "Average"}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Currency" body="All costs and values are kept in this currency.">
        <input className="input w-24 font-mono uppercase" value={v.baseCurrency} maxLength={3} onChange={(e) => set("baseCurrency", e.target.value.toUpperCase())} disabled={!canEdit || costingLocked} />
      </Row>
      <Row title="Number format" body="How numbers, money and dates look.">
        <select className="input w-44" value={v.locale} onChange={(e) => set("locale", e.target.value)} disabled={!canEdit}>
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="es-US">Español (EE. UU.)</option>
          <option value="es-PR">Español (Puerto Rico)</option>
          <option value="es-MX">Español (México)</option>
        </select>
      </Row>
      <Row title="Books locked through" body="Nothing can be posted on or before this date. Corrections post as new moves dated after it.">
        <input type="date" className="input w-44" value={v.lockDate} onChange={(e) => set("lockDate", e.target.value)} disabled={!canEdit} />
      </Row>
      <Row title="Purchase approval" body="Orders at or above this total need a manager to approve them. Leave empty for no approval step.">
        <input className="input w-36 text-right tabular-nums" inputMode="decimal" placeholder="No limit" value={v.poApprovalThreshold} onChange={(e) => set("poApprovalThreshold", e.target.value)} disabled={!canEdit} />
      </Row>
      <Row title="Over-receipt tolerance" body="How far over the ordered quantity anyone can receive. Beyond it, a manager has to accept the extra.">
        <div className="flex items-center gap-2">
          <input className="input w-20 text-right tabular-nums" inputMode="decimal" value={v.overReceiptPct} onChange={(e) => set("overReceiptPct", e.target.value)} disabled={!canEdit} />
          <span className="text-sm text-muted">%</span>
        </div>
      </Row>
      <Row title="Keep the AXXES portal in sync" body="Mirror stock levels into your workspace's shared catalog, so the portal, Pulse and your storefront show the same numbers.">
        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={v.syncLegacy} onChange={(e) => set("syncLegacy", e.target.checked)} disabled={!canEdit} />
      </Row>
      {canEdit && (
        <div className="flex justify-end p-4">
          <button className="btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}
    </form>
  )
}

function Row({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{body}</p>
      </div>
      {children}
    </div>
  )
}

type Reason = { id: string; code: string; label: string; direction: "in" | "out" | "both"; toScrap: boolean; isSystem: boolean; isActive: boolean }

export function ReasonsEditor({ reasons, canEdit }: { reasons: Reason[]; canEdit: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [draft, setDraft] = useState({ code: "", label: "", direction: "out" as Reason["direction"], toScrap: false })

  return (
    <div className="card divide-y divide-line/60">
      {reasons.map((r) => (
        <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${r.isActive ? "" : "opacity-50"}`}>
          <span className="w-24 font-mono text-xs">{r.code}</span>
          <span className="flex-1">{r.label}</span>
          <span className="w-20 text-xs text-muted">{r.direction === "in" ? "adds" : r.direction === "out" ? "removes" : "either"}</span>
          <span className="w-16 text-xs text-muted">{r.toScrap ? "→ scrap" : ""}</span>
          {canEdit && !r.isSystem ? (
            <button
              className="text-xs text-muted hover:text-text"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await toggleReasonAction(r.id, !r.isActive)
                  if (!res.ok) toast({ title: "Couldn't change it", description: res.error, tone: "error" })
                  router.refresh()
                })
              }
            >
              {r.isActive ? "Retire" : "Restore"}
            </button>
          ) : (
            <span className="w-12 text-right font-mono text-[10px] uppercase text-muted/60">{r.isSystem ? "built-in" : ""}</span>
          )}
        </div>
      ))}
      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
              const res = await addReasonAction(draft)
              toast(res.ok ? { title: `${res.data.code} added` } : { title: "Couldn't add it", description: res.error, tone: "error" })
              if (res.ok) (setDraft({ code: "", label: "", direction: "out", toScrap: false }), router.refresh())
            })
          }}
        >
          <input className="input w-28 font-mono uppercase" placeholder="CODE" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} required />
          <input className="input min-w-40 flex-1" placeholder="Spilled at event" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required />
          <select className="input w-auto" value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as Reason["direction"] })}>
            <option value="out">Removes</option>
            <option value="in">Adds</option>
            <option value="both">Either</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={draft.toScrap} onChange={(e) => setDraft({ ...draft, toScrap: e.target.checked })} className="accent-[var(--accent)]" /> Scrap
          </label>
          <button className="btn-ghost" disabled={pending}>
            Add reason
          </button>
        </form>
      )}
    </div>
  )
}

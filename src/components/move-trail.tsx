import Link from "next/link"
import { Undo2 } from "lucide-react"

export type TrailRow = {
  id: string
  when: string
  /** "+12", "−3", or "12" for a move inside the building. */
  qty: string
  direction: "in" | "out" | "internal"
  from: string
  to: string
  doc: string
  docHref: string | null
  reason: string | null
  note: string | null
  actor: string | null
  cost: string
  reversal: boolean
}

/** The ledger for one item: every change that produced today's number, newest first. */
export function MoveTrail({ rows }: { rows: TrailRow[] }) {
  if (!rows.length) return <div className="card px-4 py-8 text-center text-sm text-muted">No moves yet. The first adjustment or receipt starts the trail.</div>
  return (
    <ol className="card divide-y divide-line/60">
      {rows.map((m) => (
        <li key={m.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-2.5 text-sm">
          <span
            className={`text-right font-semibold tabular-nums ${m.direction === "in" ? "text-accent" : m.direction === "out" ? "text-danger" : "text-sky-300"}`}
          >
            {m.qty}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-mono text-xs">
              {m.reversal && <Undo2 className="size-3 text-muted" aria-label="Reversal" />}
              <span className="text-text">{m.from}</span>
              <span className="text-muted">→</span>
              <span className="text-text">{m.to}</span>
              {m.docHref ? (
                <Link href={m.docHref} className="text-muted hover:text-accent">
                  {m.doc}
                </Link>
              ) : (
                <span className="text-muted">{m.doc}</span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {[m.reason && m.reason.toLowerCase(), m.note, m.actor].filter(Boolean).join(" · ") || " "}
            </span>
          </span>
          <span className="text-right text-xs text-muted">
            <span className="block">{m.when}</span>
            <span className="block font-mono text-[10px]">@ {m.cost}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

import Link from "next/link"

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

const TONES: Record<string, string> = {
  good: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  warn: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
  bad: "bg-red-400/10 text-red-300 ring-red-400/20",
  info: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
  muted: "bg-white/5 text-muted ring-white/10",
}
const GOOD = /^(posted|active|published|sent|received|complete|completed|delivered|passed|approved|confirmed|captured|fulfilled|succeeded|paid|refunded)$/
const BAD = /^(failed|cancelled|rejected|quarantine|discrepancy_found|archived|out_of_stock|deleted|bounced)$/
const INFO = /^(reversed|in_progress|in_transit|sending|shipped|processing|scheduled|partially_.*|partial|authorized)$/

export function StatusBadge({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>
  const v = String(value)
  const tone = GOOD.test(v) ? "good" : BAD.test(v) ? "bad" : INFO.test(v) ? "info" : v === "draft" ? "muted" : "warn"
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${TONES[tone]}`}>{v.replaceAll("_", " ")}</span>
}

export function Stat({ label, value, hint, href }: { label: string; value: React.ReactNode; hint?: string; href?: string }) {
  const body = (
    <div className="card h-full p-5 transition hover:border-accent/40">
      <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="card grid place-items-center px-6 py-16 text-center">
      <div className="mb-4 size-10 rounded-full border border-dashed border-line" />
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Mono uppercase micro-label: the signature section heading. */
export function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`font-mono text-[11px] uppercase tracking-[0.15em] text-muted ${className}`}>{children}</p>
}

/** A keyboard key, for shortcut hints. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-panel-2 px-1 font-mono text-[10px] font-medium text-muted">
      {children}
    </kbd>
  )
}

/**
 * On-hand split into available, reserved and held, as one segmented bar. Every
 * stock number in Manifest is shown with its parts, never as a lone total.
 */
export function StockBar({ available, reserved = 0, held = 0, className = "" }: { available: number; reserved?: number; held?: number; className?: string }) {
  const total = Math.max(available, 0) + Math.max(reserved, 0) + Math.max(held, 0)
  const pct = (n: number) => (total > 0 ? `${(Math.max(n, 0) / total) * 100}%` : "0%")
  return (
    <div className={`flex h-1.5 w-full overflow-hidden rounded-full bg-panel-2 ${className}`} role="img" aria-label={`${available} available, ${reserved} reserved, ${held} held`}>
      <span className="h-full bg-accent" style={{ width: pct(available) }} />
      <span className="h-full bg-sky-400/70" style={{ width: pct(reserved) }} />
      <span className="h-full bg-amber-400/70" style={{ width: pct(held) }} />
    </div>
  )
}

/** Tiny inline trend line. */
export function Sparkline({ values, className = "", height = 28 }: { values: number[]; className?: string; height?: number }) {
  if (values.length < 2) return null
  const w = 100
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - 2 - ((v - min) / span) * (height - 4)}`)
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={`w-full ${className}`} style={{ height }} aria-hidden>
      <polyline points={`0,${height} ${pts.join(" ")} ${w},${height}`} fill="var(--accent)" fillOpacity="0.08" stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/** Link-based tabs; the active one gets the accent underline. */
export function Tabs({ items }: { items: { href: string; label: string; active: boolean; count?: number }[] }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${t.active ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
        >
          {t.label}
          {t.count != null && <span className="rounded-full bg-panel-2 px-1.5 font-mono text-[10px] text-muted">{t.count}</span>}
        </Link>
      ))}
    </nav>
  )
}

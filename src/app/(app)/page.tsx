import Link from "next/link"
import { ArrowUpRight, CircleCheck } from "lucide-react"
import { requireContext } from "@/lib/context"
import { db } from "@/lib/db"
import { listMoves, stockByItem, stockTotals } from "@/domain/ledger/queries"
import { draftAdjustments, getLocale, getSettings, listLocations, valueSeries } from "@/lib/queries"
import { receiptsDue } from "@/lib/queries-purchasing"
import { fmtDelta, fmtMoney, fmtQty, fmtRelative } from "@/lib/format"
import { Label, Sparkline, StockBar } from "@/components/ui"

export default async function TodayPage() {
  const ctx = await requireContext()
  const t = ctx.tenant.id
  const [locale, settings, totals, grid, drafts, recent, series, locations, due] = await Promise.all([
    getLocale(t),
    getSettings(t),
    stockTotals(db, t),
    stockByItem(db, t),
    draftAdjustments(t),
    listMoves(db, t, {}, 12),
    valueSeries(t, 30),
    listLocations(t),
    ctx.can("purchasing.view") ? receiptsDue(t) : Promise.resolve([]),
  ])
  const today = new Date().toISOString().slice(0, 10)
  const low = grid.filter((r) => r.low)
  const out = grid.filter((r) => Number(r.available) <= 0)
  const firstRun = !settings?.onboardedAt && recent.length === 0
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const first = ctx.user.name.split(" ")[0]
  const valueDelta = series.length > 1 ? series[series.length - 1].value - series[0].value : 0

  return (
    <>
      <div className="mb-8">
        <Label>{new Date().toLocaleDateString(locale.locale, { weekday: "long", month: "long", day: "numeric" })}</Label>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting}, {first}.
        </h1>
      </div>

      {firstRun && <Onboarding hasLocations={locations.length > 0} canImport={ctx.can("import.run")} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-5 sm:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <Label>Inventory value</Label>
              <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{fmtMoney(totals.value, locale)}</p>
              <p className="mt-1 text-xs text-muted">
                <span className={valueDelta >= 0 ? "text-accent" : "text-danger"}>
                  {valueDelta >= 0 ? "+" : "−"}
                  {fmtMoney(Math.abs(valueDelta), locale, { compact: true })}
                </span>{" "}
                over 30 days · {settings?.costingMethod === "average" ? "average cost" : "FIFO"}
              </p>
            </div>
          </div>
          <Sparkline values={series.map((p) => p.value)} className="mt-4" height={48} />
        </div>
        <Kpi label="Units on hand" value={fmtQty(totals.units, locale)} hint={`${totals.items} items in stock`} href="/stock" />
        <Kpi
          label="Low or out"
          value={String(low.length)}
          hint={out.length ? `${out.length} out of stock` : "Nothing out of stock"}
          href="/stock?low=1"
          tone={low.length ? "warn" : undefined}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <Label>Needs attention</Label>
          </div>
          <div className="card divide-y divide-line/60">
            {low.length === 0 && drafts.length === 0 && due.length === 0 ? (
              <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted">
                <CircleCheck className="size-5 text-accent" strokeWidth={1.5} />
                Inbox zero. Nothing is running low and nothing is waiting on you.
              </div>
            ) : (
              <>
                {due.map((p) => {
                  const late = !!p.expectedOn && p.expectedOn < today
                  return (
                    <Link key={p.id} href={ctx.can("purchasing.receive") ? `/purchase-orders/${p.id}/receive` : `/purchase-orders/${p.id}`} className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-panel-2/60">
                      <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ${late ? "bg-amber-400/10 text-amber-300 ring-amber-400/20" : "bg-sky-400/10 text-sky-300 ring-sky-400/20"}`}>
                        {late ? "Late" : "Arriving"}
                      </span>
                      <span className="flex-1">
                        <span className="font-medium">{p.number}</span> <span className="text-muted">from {p.supplier}{p.status === "partially_received" ? " · rest of it" : ""}</span>
                      </span>
                      <span className="text-xs text-muted">{p.expectedOn === today ? "today" : fmtRelative(`${p.expectedOn}T12:00:00`, locale).replace("ago", "late")}</span>
                    </Link>
                  )
                })}
                {drafts.map((d) => (
                  <Link key={d.id} href={`/adjustments/${d.id}`} className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-panel-2/60">
                    <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted ring-1 ring-white/10">Draft</span>
                    <span className="flex-1">
                      <span className="font-medium">{d.number}</span> <span className="text-muted">waiting to be posted · {d.reason.toLowerCase()}</span>
                    </span>
                    <span className="text-xs text-muted">{fmtRelative(d.createdAt, locale)}</span>
                  </Link>
                ))}
                {low.slice(0, 8).map((r) => (
                  <Link
                    key={`${r.productId}:${r.variantId}`}
                    href={`/stock/${r.productId}${r.variantId ? `?v=${r.variantId}` : ""}`}
                    className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-panel-2/60"
                  >
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ${Number(r.available) <= 0 ? "bg-red-400/10 text-red-300 ring-red-400/20" : "bg-amber-400/10 text-amber-300 ring-amber-400/20"}`}>
                      {Number(r.available) <= 0 ? "Out" : "Low"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{r.name}</span> <span className="font-mono text-xs text-muted">{r.sku}</span>
                    </span>
                    <span className="w-28">
                      <StockBar available={Number(r.available)} reserved={Number(r.reserved)} held={Number(r.held)} />
                    </span>
                    <span className="w-24 text-right text-xs tabular-nums text-muted">
                      {fmtQty(r.available, locale)} / {fmtQty(r.reorderPoint, locale)}
                    </span>
                  </Link>
                ))}
              </>
            )}
          </div>
        </section>

        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <Label>Activity</Label>
            <Link href="/moves" className="flex items-center gap-1 text-xs text-muted hover:text-text">
              All moves <ArrowUpRight className="size-3" />
            </Link>
          </div>
          <div className="card p-2">
            {recent.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">Moves will appear here as stock changes.</p>
            ) : (
              <ol>
                {recent.map((m) => {
                  const inbound = m.fromVirtual && !m.toVirtual
                  const outbound = !m.fromVirtual && m.toVirtual
                  return (
                    <li key={m.id} className="flex items-start gap-3 rounded-lg px-3 py-2 text-sm hover:bg-panel-2/60">
                      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${inbound ? "bg-accent" : outbound ? "bg-danger" : "bg-sky-400"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          <span className="font-medium tabular-nums">{inbound ? fmtDelta(m.qty, locale) : outbound ? fmtDelta(-Number(m.qty), locale) : fmtQty(m.qty, locale)}</span>{" "}
                          <Link href={`/stock/${m.productId}${m.variantId ? `?v=${m.variantId}` : ""}`} className="hover:text-accent">
                            {m.name}
                          </Link>
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted">
                          {m.fromCode} → {m.toCode} · {m.docNumber ?? m.docType}
                          {m.actorName ? ` · ${m.actorName.split(" ")[0]}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{fmtRelative(m.occurredAt, locale)}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

function Kpi({ label, value, hint, href, tone }: { label: string; value: string; hint?: string; href: string; tone?: "warn" }) {
  return (
    <Link href={href} className="card block p-5 transition hover:border-accent/40">
      <Label>{label}</Label>
      <p className={`mt-3 text-3xl font-semibold tracking-tight tabular-nums ${tone === "warn" ? "text-amber-300" : ""}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Link>
  )
}

function Onboarding({ hasLocations, canImport }: { hasLocations: boolean; canImport: boolean }) {
  const steps = [
    { done: hasLocations, title: "Map your space", body: "Add a warehouse, stockroom or venue, then generate its bins in one go.", href: "/locations/new", cta: "Add a location" },
    { done: false, title: "Bring in your stock", body: "Paste or upload a spreadsheet. You'll see every row checked before anything posts.", href: canImport ? "/import" : "/adjustments/new", cta: canImport ? "Import" : "Add stock" },
    { done: false, title: "Learn the shortcuts", body: "Press ⌘K anywhere, then try “move 12 TEE-1 to A-02”. Press ? for everything else.", href: "/stock", cta: "Open Stock" },
  ]
  return (
    <section className="card mb-8 overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <Label>Get set up</Label>
        <p className="mt-1 text-sm text-muted">Three steps to your first trustworthy stock number. Most teams finish in ten minutes.</p>
      </div>
      <ol className="grid divide-y divide-line/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col p-5">
            <span className={`grid size-6 place-items-center rounded-full font-mono text-xs ${s.done ? "bg-accent text-accent-ink" : "bg-panel-2 text-muted ring-1 ring-line"}`}>
              {s.done ? "✓" : i + 1}
            </span>
            <p className="mt-3 font-medium">{s.title}</p>
            <p className="mt-1 flex-1 text-sm text-muted">{s.body}</p>
            <Link href={s.href} className="btn-ghost mt-4 self-start">
              {s.cta}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

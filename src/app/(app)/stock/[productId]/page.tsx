import Link from "next/link"
import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/context"
import { db } from "@/lib/db"
import { listMoves, onHandAsOf, onHandSeries, stockByItem, stockByLocation } from "@/domain/ledger/queries"
import { getItem, getLocale, isUuid } from "@/lib/queries"
import { fmtDate, fmtDelta, fmtMoney, fmtQty, fmtRelative } from "@/lib/format"
import { Label, PageHeader, Sparkline, StockBar } from "@/components/ui"
import { MoveTrail } from "@/components/move-trail"

export default async function ItemStockPage({ params, searchParams }: PageProps<"/stock/[productId]">) {
  const ctx = await requirePermission("stock.view")
  const { productId } = await params
  if (!isUuid(productId)) notFound()
  const sp = await searchParams
  const item = await getItem(ctx.tenant.id, productId)
  if (!item) notFound()
  const { product, variants, profiles } = item
  const variantId = typeof sp.v === "string" ? sp.v : product.hasVariants ? (variants[0]?.id ?? null) : null
  const variant = variants.find((v) => v.id === variantId) ?? null
  const asOf = typeof sp.asof === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.asof) ? sp.asof : null

  const [locale, [row], byLocation, series, moves, past] = await Promise.all([
    getLocale(ctx.tenant.id),
    stockByItem(db, ctx.tenant.id, { productId }).then((rows) => rows.filter((r) => r.variantId === variantId)),
    stockByLocation(db, ctx.tenant.id, productId, variantId),
    onHandSeries(db, ctx.tenant.id, productId, variantId, 90),
    listMoves(db, ctx.tenant.id, { productId, variantId }, 100),
    asOf ? onHandAsOf(db, ctx.tenant.id, new Date(`${asOf}T23:59:59.999`), { productId, variantId }) : Promise.resolve(null),
  ])
  const profile = profiles.find((p) => p.variantId === variantId)
  const onHand = Number(row?.onHand ?? 0)
  const available = Number(row?.available ?? 0)
  const reserved = Number(row?.reserved ?? 0)
  const held = Number(row?.held ?? 0)
  const unitCost = Number(row?.unitCost ?? 0)
  const sku = variant?.sku ?? product.sku
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(sku ? { sku } : {}), ...extra })
    return p.toString()
  }

  const actions = (
    <div className="flex gap-2">
      {ctx.can("catalog.manage") && (
        <Link href={`/items/${product.id}`} className="btn-ghost">
          Edit item
        </Link>
      )}
      {ctx.can("purchasing.manage") && (
        <Link href={`/purchase-orders/new?${q({})}`} className="btn-ghost">
          Order
        </Link>
      )}
      {ctx.can("stock.move") && onHand > 0 && (
        <Link href={`/moves/new?${q({})}`} className="btn-ghost">
          Move
        </Link>
      )}
      {ctx.can("stock.adjust") && (
        <Link href={`/adjustments/new?${q({})}`} className="btn-primary" data-create>
          Adjust
        </Link>
      )}
    </div>
  )

  return (
    <>
      <Link href="/stock" className="text-sm text-muted hover:text-text">
        ← Stock
      </Link>
      <div className="mt-3">
        <PageHeader title={variant ? `${product.name} · ${variant.name}` : product.name} description={[sku, product.barcode].filter(Boolean).join(" · ") || undefined} action={actions} />
      </div>

      {product.hasVariants && variants.length > 0 && (
        <div className="-mt-4 mb-6 flex flex-wrap gap-1.5">
          {variants.map((v) => (
            <Link
              key={v.id}
              href={`/stock/${product.id}?v=${v.id}`}
              className={`rounded-full px-3 py-1 text-xs ring-1 transition ${v.id === variantId ? "bg-accent text-accent-ink ring-accent" : "text-muted ring-line hover:text-text"}`}
            >
              {v.name}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <Figure label="Available" value={fmtQty(available, locale)} accent />
            <Figure label="On hand" value={fmtQty(onHand, locale)} />
            <Figure label="Reserved" value={fmtQty(reserved, locale)} />
            {held > 0 && <Figure label="Held" value={fmtQty(held, locale)} />}
            <Figure label="Value" value={fmtMoney(onHand * unitCost, locale)} />
            <Figure label="Unit cost" value={fmtMoney(unitCost, locale)} />
          </div>
          <StockBar available={available} reserved={reserved} held={held} className="mt-5 h-2" />
          <div className="mt-2 flex gap-4 font-mono text-[10px] uppercase tracking-wider text-muted">
            <span className="flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-accent" /> available
            </span>
            <span className="flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-sky-400/70" /> reserved
            </span>
            <span className="flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-amber-400/70" /> held
            </span>
            {profile?.reorderPoint && <span className="ml-auto normal-case tracking-normal">Reorder at {fmtQty(profile.reorderPoint, locale)}</span>}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <Label>90 days</Label>
            <span className="font-mono text-[11px] text-muted">
              {fmtQty(Math.min(...series.map((s) => s.onHand)), locale)}–{fmtQty(Math.max(...series.map((s) => s.onHand)), locale)}
            </span>
          </div>
          <Sparkline values={series.map((s) => s.onHand)} height={64} className="mt-3" />
          <form className="mt-4 flex items-center gap-2" action={`/stock/${product.id}`}>
            {variantId && <input type="hidden" name="v" value={variantId} />}
            <label className="text-xs text-muted" htmlFor="asof">
              On hand as of
            </label>
            <input id="asof" name="asof" type="date" defaultValue={asOf ?? ""} className="input h-8 flex-1 py-1 text-xs" />
            <button className="btn-ghost h-8 px-3 py-1 text-xs">Go</button>
          </form>
          {past && (
            <p className="mt-2 text-sm">
              <span className="font-semibold tabular-nums">{fmtQty(past[0]?.onHand ?? 0, locale)}</span>{" "}
              <span className="text-muted">on hand at the end of {fmtDate(`${asOf}T12:00:00`, locale)}, rebuilt from the ledger.</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <Label className="mb-3">Where it is</Label>
          <div className="card divide-y divide-line/60">
            {byLocation.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Not stocked anywhere yet.</p>
            ) : (
              byLocation
                .filter((l) => l.kind !== "transit" || Number(l.onHand) !== 0)
                .map((l) => (
                  <div key={`${l.locationId}:${l.status}:${l.lotId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Link href={`/locations/${l.locationId}`} className="font-mono text-xs hover:text-accent">
                      {l.path}
                    </Link>
                    {l.status !== "available" && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] capitalize text-amber-300">{l.status}</span>}
                    <span className="ml-auto tabular-nums">{fmtQty(l.onHand, locale)}</span>
                    {ctx.can("stock.adjust") && (
                      <Link href={`/adjustments/new?${q({ location: l.locationId, set: String(Number(l.onHand)), reason: "COUNT" })}`} className="text-xs text-muted hover:text-accent" title="Count this bin">
                        Count
                      </Link>
                    )}
                  </div>
                ))
            )}
          </div>
        </section>

        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <Label>Move trail</Label>
            <span className="text-xs text-muted">
              {moves.length ? `Last move ${fmtRelative(moves[0].occurredAt, locale)}` : ""} · every change, newest first
            </span>
          </div>
          <MoveTrail
            rows={moves.map((m) => {
              const direction = m.fromVirtual && !m.toVirtual ? "in" : !m.fromVirtual && m.toVirtual ? "out" : "internal"
              return {
                id: m.id,
                when: fmtRelative(m.occurredAt, locale),
                qty: direction === "in" ? fmtDelta(m.qty, locale) : direction === "out" ? fmtDelta(-Number(m.qty), locale) : fmtQty(m.qty, locale),
                direction,
                from: m.fromCode,
                to: m.toCode,
                doc: m.docNumber ?? m.docType,
                docHref: !m.docId ? null : m.docType === "receipt" || (m.docType === "reversal" && m.fromVirtual === false && m.toCode === "SUPPLIERS") ? `/receipts/${m.docId}` : m.docType === "move" ? null : `/adjustments/${m.docId}`,
                reason: m.reason,
                note: m.note,
                actor: m.actorName,
                cost: fmtMoney(m.unitCost, locale),
                reversal: !!m.reversalOf,
              }
            })}
          />
        </section>
      </div>
    </>
  )
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className={`mt-1.5 font-semibold tracking-tight tabular-nums ${accent ? "text-3xl text-accent" : "text-xl"}`}>{value}</p>
    </div>
  )
}

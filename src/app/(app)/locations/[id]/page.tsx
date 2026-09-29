import Link from "next/link"
import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/context"
import { db } from "@/lib/db"
import { stockByItem } from "@/domain/ledger/queries"
import { getLocale, getLocation, listLocations, isUuid } from "@/lib/queries"
import { fmtMoney, fmtQty } from "@/lib/format"
import { Label, PageHeader, StockBar } from "@/components/ui"
import { LocationTools } from "@/components/location-form"

export default async function LocationPage({ params }: PageProps<"/locations/[id]">) {
  const ctx = await requirePermission("stock.view")
  const { id } = await params
  if (!isUuid(id)) notFound()
  const loc = await getLocation(ctx.tenant.id, id)
  if (!loc || loc.isVirtual) notFound()
  const [rows, all, locale] = await Promise.all([stockByItem(db, ctx.tenant.id, { locationPath: loc.path }), listLocations(ctx.tenant.id), getLocale(ctx.tenant.id)])
  const children = all.filter((l) => l.parentId === loc.id)
  const value = rows.reduce((s, r) => s + Number(r.onHand) * Number(r.unitCost), 0)
  const units = rows.reduce((s, r) => s + Number(r.onHand), 0)
  const parent = all.find((l) => l.id === loc.parentId)

  return (
    <>
      <Link href={parent ? `/locations/${parent.id}` : "/locations"} className="text-sm text-muted hover:text-text">
        ← {parent ? parent.code : "Locations"}
      </Link>
      <div className="mt-3">
        <PageHeader
          title={loc.code}
          description={`${loc.name !== loc.code ? `${loc.name} · ` : ""}${loc.path}${loc.archivedAt ? " · archived" : ""}`}
          action={
            <div className="flex gap-2">
              {ctx.can("stock.adjust") && !loc.archivedAt && (
                <Link href={`/adjustments/new?location=${loc.id}`} className="btn-ghost">
                  Adjust here
                </Link>
              )}
              {ctx.can("stock.move") && units > 0 && (
                <Link href={`/moves/new?from=${encodeURIComponent(loc.code)}`} className="btn-primary">
                  Move out
                </Link>
              )}
            </div>
          }
        />
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="card p-5">
          <Label>Items</Label>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{rows.length}</p>
        </div>
        <div className="card p-5">
          <Label>Units</Label>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtQty(units, locale)}</p>
        </div>
        <div className="card p-5">
          <Label>Value</Label>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtMoney(value, locale)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <Label className="mb-3">Contents{children.length ? " (including everything inside)" : ""}</Label>
          <div className="card divide-y divide-line/60">
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Empty.</p>
            ) : (
              rows.map((r) => (
                <div key={`${r.productId}:${r.variantId}`} data-row className="flex items-center gap-4 px-4 py-2.5 text-sm">
                  <Link href={`/stock/${r.productId}${r.variantId ? `?v=${r.variantId}` : ""}`} className="min-w-0 flex-1 truncate hover:text-accent">
                    {r.name} <span className="font-mono text-xs text-muted">{r.sku}</span>
                  </Link>
                  <span className="w-24">
                    <StockBar available={Number(r.available)} reserved={Number(r.reserved)} held={Number(r.held)} />
                  </span>
                  <span className="w-16 text-right tabular-nums">{fmtQty(r.onHand, locale)}</span>
                </div>
              ))
            )}
          </div>
        </section>
        <aside className="space-y-6">
          {children.length > 0 && (
            <section>
              <Label className="mb-3">Inside ({children.length})</Label>
              <div className="card flex flex-wrap gap-1.5 p-3">
                {children.map((c) => (
                  <Link
                    key={c.id}
                    href={`/locations/${c.id}`}
                    className={`rounded-md px-2 py-1 font-mono text-xs ring-1 transition hover:ring-accent/50 ${Number(c.units) > 0 ? "bg-accent/10 text-text ring-accent/25" : "text-muted ring-line"}`}
                    title={`${fmtQty(c.units, locale)} units`}
                  >
                    {c.code}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {ctx.can("locations.manage") && !loc.archivedAt && (
            <LocationTools location={{ id: loc.id, code: loc.code, name: loc.name, kind: loc.kind, allowNegative: loc.allowNegative }} />
          )}
        </aside>
      </div>
    </>
  )
}

import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { getLocale, listLocations } from "@/lib/queries"
import { fmtQty } from "@/lib/format"
import { Empty, PageHeader } from "@/components/ui"
import { PATH_SEPARATOR } from "@/domain/ledger/paths"

export const metadata = { title: "Locations" }

const KIND_LABEL: Record<string, string> = { warehouse: "Warehouse", zone: "Zone", bin: "Bin", venue: "Venue", popup: "Pop-up", vehicle: "Vehicle" }

export default async function LocationsPage() {
  const ctx = await requirePermission("stock.view")
  const [locations, locale] = await Promise.all([listLocations(ctx.tenant.id), getLocale(ctx.tenant.id)])
  // Roll units up the tree so a warehouse shows everything inside it.
  const rolled = new Map(locations.map((l) => [l.id, Number(l.units)]))
  for (const l of [...locations].sort((a, b) => b.path.length - a.path.length)) {
    if (l.parentId && rolled.has(l.parentId)) rolled.set(l.parentId, rolled.get(l.parentId)! + rolled.get(l.id)!)
  }
  const create = ctx.can("locations.manage") && (
    <Link href="/locations/new" className="btn-primary" data-create>
      New location
    </Link>
  )

  return (
    <>
      <PageHeader title="Locations" description="Warehouses, stockrooms, venues, pop-ups and vans, down to the bin. Stock always lives somewhere specific." action={create} />
      {locations.length === 0 ? (
        <Empty title="No locations yet" body="Start with where your stock lives: a warehouse, a stockroom or a venue. You can generate its bins in one step." action={create} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Location</th>
                <th className="th">Kind</th>
                <th className="th num">Items</th>
                <th className="th num">Units (incl. inside)</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => {
                const depth = l.path.split(PATH_SEPARATOR).length - 1
                return (
                  <tr key={l.id} data-row className="border-b border-line/60 last:border-0 hover:bg-panel-2/60">
                    <td className="td">
                      <span style={{ paddingLeft: depth * 20 }} className="flex items-center gap-2">
                        {depth > 0 && <span className="text-line">└</span>}
                        <Link href={`/locations/${l.id}`} className="font-mono font-medium hover:text-accent">
                          {l.code}
                        </Link>
                        {l.name !== l.code && <span className="text-muted">{l.name}</span>}
                      </span>
                    </td>
                    <td className="td text-muted">{KIND_LABEL[l.kind] ?? l.kind}</td>
                    <td className="td num text-muted">{l.skus || "—"}</td>
                    <td className="td num">{rolled.get(l.id) ? fmtQty(rolled.get(l.id)!, locale) : <span className="text-muted">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

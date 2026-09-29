import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { findBySku, listLocations, listReasons } from "@/lib/queries"
import { AdjustmentEditor } from "@/components/adjustment-editor"
import { PageHeader } from "@/components/ui"

export const metadata = { title: "New adjustment" }

export default async function NewAdjustmentPage({ searchParams }: PageProps<"/adjustments/new">) {
  const ctx = await requirePermission("stock.adjust")
  const sp = await searchParams
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)
  const [locations, reasons] = await Promise.all([listLocations(ctx.tenant.id), listReasons(ctx.tenant.id)])

  // Prefill from a ⌘K verb or an item page: ?sku=&qty=&at=&set=&reason=&location=&product=
  const item = str("sku") ? await findBySku(ctx.tenant.id, str("sku")!) : null
  const at = str("at") ? locations.find((l) => l.code === str("at")!.toUpperCase())?.id : str("location")
  const qty = str("set") ?? str("qty")
  const mode = str("set") ? "set" : qty?.startsWith("-") ? "remove" : "add"
  const reason = str("reason") ?? (mode === "remove" ? undefined : mode === "set" ? "COUNT" : undefined)

  return (
    <>
      <Link href="/adjustments" className="text-sm text-muted hover:text-text">
        ← Adjustments
      </Link>
      <div className="mt-3">
        <PageHeader title="New adjustment" description="Pick where, why, and what changed. Post now, or save a draft for someone to review." />
      </div>
      {locations.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          Add a location first, so Manifest knows where the stock is.{" "}
          <Link href="/locations/new" className="text-accent hover:underline">
            Add a location
          </Link>
        </div>
      ) : (
        <AdjustmentEditor
          locations={locations}
          reasons={reasons.map((r) => ({ code: r.code, label: r.label, direction: r.direction }))}
          initial={{ locationId: at, reason, item, mode, qty: qty?.replace(/^-/, "") }}
        />
      )}
    </>
  )
}

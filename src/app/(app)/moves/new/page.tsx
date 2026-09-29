import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { findBySku, listLocations } from "@/lib/queries"
import { MoveForm } from "@/components/move-form"
import { PageHeader } from "@/components/ui"

export const metadata = { title: "Move stock" }

export default async function NewMovePage({ searchParams }: PageProps<"/moves/new">) {
  const ctx = await requirePermission("stock.move")
  const sp = await searchParams
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).toUpperCase() : undefined)
  const locations = await listLocations(ctx.tenant.id)
  const item = typeof sp.sku === "string" ? await findBySku(ctx.tenant.id, sp.sku) : null
  const byCode = (c?: string) => (c ? locations.find((l) => l.code === c)?.id : undefined)

  return (
    <>
      <Link href="/moves" className="text-sm text-muted hover:text-text">
        ← Moves
      </Link>
      <div className="mt-3">
        <PageHeader title="Move stock" description="Put stock somewhere else in the building: bin to bin, shelf to van. Value doesn't change; only where it sits." />
      </div>
      <MoveForm locations={locations} initial={{ item, qty: typeof sp.qty === "string" ? sp.qty : "", from: byCode(str("from")), to: byCode(str("to")) }} />
    </>
  )
}

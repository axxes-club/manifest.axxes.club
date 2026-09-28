import Link from "next/link"
import { requireContext } from "@/lib/context"
import { countRows } from "@/lib/data"
import { PageHeader, Stat } from "@/components/ui"
import { product } from "@/product.config"

export default async function OverviewPage() {
  const ctx = await requireContext()
  const counts = await Promise.all(product.resources.map((r) => countRows(r.table, ctx.tenant.id)))

  return (
    <>
      <PageHeader title={product.name} description={product.tagline} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {product.resources.map((r, i) => (
          <Stat key={r.key} label={r.label} value={counts[i]} href={`/${r.key}`} />
        ))}
      </div>
      <section className="mt-10">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.15em] text-muted">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {product.resources.map((r) => (
            <Link key={r.key} href={`/${r.key}/new`} className="btn-ghost">+ New {r.singular.toLowerCase()}</Link>
          ))}
        </div>
      </section>
    </>
  )
}

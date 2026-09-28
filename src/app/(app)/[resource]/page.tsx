import Link from "next/link"
import { notFound } from "next/navigation"
import { requireContext } from "@/lib/context"
import { getResource, listRows, refOptions } from "@/lib/data"
import { formatValue, humanize } from "@/lib/resource"
import { Empty, PageHeader, StatusBadge } from "@/components/ui"

export default async function ResourceListPage({ params }: PageProps<"/[resource]">) {
  const { resource: key } = await params
  const resource = getResource(key)
  if (!resource) notFound()
  const ctx = await requireContext()
  const [rows, refs] = await Promise.all([listRows(resource, ctx.tenant.id), refOptions(resource, ctx.tenant.id)])
  const refLabel = (field: string, value: unknown) => refs[field]?.find((o) => o.value === String(value))?.label

  const newButton = <Link href={`/${key}/new`} className="btn-primary">+ New {resource.singular.toLowerCase()}</Link>

  return (
    <>
      <PageHeader title={resource.label} description={resource.description} action={newButton} />
      {rows.length === 0 ? (
        <Empty title={`No ${resource.label.toLowerCase()} yet`} body={resource.description} action={newButton} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {resource.list.map((c) => (
                  <th key={c} className="px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-muted">{humanize(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} className="border-b border-line/60 last:border-0 hover:bg-panel-2/60">
                  {resource.list.map((c, i) => {
                    const v = row[c]
                    const content =
                      c === resource.status ? <StatusBadge value={v} /> : (refLabel(c, v) ?? formatValue(resource, c, v))
                    return (
                      <td key={c} className={`px-4 py-3 ${i === 0 ? "font-medium" : "text-muted"} ${resource.money?.includes(c) ? "tabular-nums" : ""}`}>
                        {i === 0 ? <Link href={`/${key}/${row.id}`} className="hover:text-accent">{content}</Link> : content}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

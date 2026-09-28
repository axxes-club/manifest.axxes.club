import Link from "next/link"
import { notFound } from "next/navigation"
import { requireContext } from "@/lib/context"
import { getResource, getRow, refOptions } from "@/lib/data"
import { fieldsFor, formatValue, toInputValue } from "@/lib/resource"
import { deleteRecord, updateRecord } from "@/lib/actions"
import { RecordForm } from "@/components/record-form"
import { PageHeader, StatusBadge } from "@/components/ui"

export default async function RecordPage({ params }: PageProps<"/[resource]/[id]">) {
  const { resource: key, id } = await params
  const resource = getResource(key)
  if (!resource) notFound()
  const ctx = await requireContext()
  const row = await getRow(resource, ctx.tenant.id, id)
  if (!row) notFound()
  const refs = await refOptions(resource, ctx.tenant.id)
  const fields = fieldsFor(resource).map((f) => ({ ...f, value: toInputValue(f.kind, row[f.name]) }))
  const title = formatValue(resource, resource.list[0], row[resource.list[0]])

  return (
    <>
      <Link href={`/${key}`} className="text-sm text-muted hover:text-text">← {resource.label}</Link>
      <div className="mt-3">
        <PageHeader
          title={title}
          description={row.createdAt instanceof Date ? `Created ${row.createdAt.toLocaleString("en-US")}` : undefined}
          action={resource.status ? <StatusBadge value={row[resource.status]} /> : undefined}
        />
      </div>
      <RecordForm fields={fields} refs={refs} action={updateRecord.bind(null, key, id)} submitLabel="Save changes" />
      <form action={deleteRecord.bind(null, key, id)} className="mt-6 flex justify-end">
        <button className="btn-danger">Delete {resource.singular.toLowerCase()}</button>
      </form>
    </>
  )
}

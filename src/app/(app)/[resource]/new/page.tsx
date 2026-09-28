import Link from "next/link"
import { notFound } from "next/navigation"
import { requireContext } from "@/lib/context"
import { getResource, refOptions } from "@/lib/data"
import { fieldsFor, generateValue } from "@/lib/resource"
import { createRecord } from "@/lib/actions"
import { RecordForm } from "@/components/record-form"
import { PageHeader } from "@/components/ui"

export default async function NewRecordPage({ params }: PageProps<"/[resource]/new">) {
  const { resource: key } = await params
  const resource = getResource(key)
  if (!resource) notFound()
  const ctx = await requireContext()
  const refs = await refOptions(resource, ctx.tenant.id)
  const fields = fieldsFor(resource).map((f) => ({
    ...f,
    value: resource.generate?.[f.name] ? generateValue(resource.generate[f.name]) : f.kind === "enum" && f.options ? f.options[0] : "",
  }))

  return (
    <>
      <Link href={`/${key}`} className="text-sm text-muted hover:text-text">← {resource.label}</Link>
      <div className="mt-3">
        <PageHeader title={`New ${resource.singular.toLowerCase()}`} />
      </div>
      <RecordForm fields={fields} refs={refs} action={createRecord.bind(null, key)} submitLabel={`Create ${resource.singular.toLowerCase()}`} />
    </>
  )
}

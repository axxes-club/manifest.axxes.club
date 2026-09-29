import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { ItemForm } from "@/components/item-form"
import { PageHeader } from "@/components/ui"

export const metadata = { title: "New item" }

export default async function NewItemPage() {
  await requirePermission("catalog.manage")
  return (
    <>
      <Link href="/items" className="text-sm text-muted hover:text-text">
        ← Items
      </Link>
      <div className="mt-3">
        <PageHeader title="New item" description="Name it, give it a SKU, and add options like size or color to generate every variant at once." />
      </div>
      <ItemForm />
    </>
  )
}

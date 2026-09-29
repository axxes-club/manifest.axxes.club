import { requirePermission } from "@/lib/context"
import { listLocations } from "@/lib/queries"
import { ImportWizard } from "@/components/import-wizard"
import { PageHeader } from "@/components/ui"

export const metadata = { title: "Import" }

export default async function ImportPage() {
  const ctx = await requirePermission("import.run")
  const locations = await listLocations(ctx.tenant.id)
  return (
    <>
      <PageHeader
        title="Import opening balances"
        description="Bring your stock in from a spreadsheet: Shopify, Sortly, inFlow, noventory or your own. Every row is checked before anything posts, and it all lands in one go or not at all."
      />
      <ImportWizard locations={locations.map((l) => ({ code: l.code, path: l.path }))} />
    </>
  )
}

import Link from "next/link"
import { requirePermission } from "@/lib/context"
import { listLocations } from "@/lib/queries"
import { LocationForm } from "@/components/location-form"
import { PageHeader } from "@/components/ui"

export const metadata = { title: "New location" }

export default async function NewLocationPage({ searchParams }: PageProps<"/locations/new">) {
  const ctx = await requirePermission("locations.manage")
  const parent = (await searchParams).parent
  const locations = await listLocations(ctx.tenant.id)
  return (
    <>
      <Link href="/locations" className="text-sm text-muted hover:text-text">
        ← Locations
      </Link>
      <div className="mt-3">
        <PageHeader title="New location" description="Top-level places (warehouse, venue, pop-up, vehicle) hold zones and bins." />
      </div>
      <LocationForm parents={locations.filter((l) => l.kind !== "bin")} initialParent={typeof parent === "string" ? parent : ""} />
    </>
  )
}

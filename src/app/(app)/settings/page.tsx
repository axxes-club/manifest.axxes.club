import { requirePermission } from "@/lib/context"
import { db, schema as s } from "@/lib/db"
import { eq } from "drizzle-orm"
import { reconcile } from "@/domain/ledger/reconcile"
import { getSettings, listReasons } from "@/lib/queries"
import { SettingsForm, ReasonsEditor } from "@/components/settings-form"
import { Label, PageHeader } from "@/components/ui"

export const metadata = { title: "Settings" }

export default async function SettingsPage() {
  const ctx = await requirePermission("stock.view")
  const [settings, reasons, [moved], drift] = await Promise.all([
    getSettings(ctx.tenant.id),
    listReasons(ctx.tenant.id, true),
    db.select({ id: s.manifestStockMoves.id }).from(s.manifestStockMoves).where(eq(s.manifestStockMoves.tenantId, ctx.tenant.id)).limit(1),
    ctx.can("audit.view") ? reconcile(db, ctx.tenant.id) : Promise.resolve(null),
  ])
  const canEdit = ctx.can("settings.manage")

  return (
    <>
      <PageHeader title="Settings" description={`How Manifest keeps the books for ${ctx.tenant.name}.`} />
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <section>
            <Label className="mb-3">Ledger</Label>
            <SettingsForm
              canEdit={canEdit}
              costingLocked={!!moved}
              initial={{
                costingMethod: settings?.costingMethod ?? "fifo",
                baseCurrency: settings?.baseCurrency ?? "USD",
                locale: settings?.locale ?? "en-US",
                lockDate: settings?.lockDate ?? "",
                syncLegacy: settings?.syncLegacy ?? true,
                overReceiptPct: String(Number(settings?.overReceiptPct ?? 0)),
                poApprovalThreshold: settings?.poApprovalThreshold ? String(Number(settings.poApprovalThreshold)) : "",
              }}
            />
          </section>
          <section>
            <Label className="mb-3">Adjustment reasons</Label>
            <ReasonsEditor canEdit={canEdit} reasons={reasons.map((r) => ({ id: r.id, code: r.code, label: r.label, direction: r.direction, toScrap: r.toScrap, isSystem: r.isSystem, isActive: r.isActive }))} />
          </section>
        </div>
        <aside className="space-y-6">
          {drift && (
            <section>
              <Label className="mb-3">Ledger health</Label>
              <div className="card p-4 text-sm">
                {drift.length === 0 ? (
                  <p>
                    <span className="mr-2 inline-block size-2 rounded-full bg-accent" />
                    Every stock level and valuation matches the moves that made it.
                  </p>
                ) : (
                  <p className="text-amber-300">{drift.length} figures disagree with the ledger. Contact support; nothing is lost, the moves are the record.</p>
                )}
              </div>
            </section>
          )}
          <section>
            <Label className="mb-3">Your access</Label>
            <div className="card p-4 text-sm text-muted">
              You're <span className="capitalize text-text">{ctx.role}</span> in {ctx.tenant.name}. Roles are managed in the AXXES portal.
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}

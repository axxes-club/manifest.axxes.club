"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db, schema as s } from "@/lib/db"
import { requireContext } from "@/lib/context"
import { runCommand } from "@/domain/command"
import { DomainError } from "@/domain/errors"
import { parse } from "@/domain/validate"
import { ensureWorkspace } from "@/domain/workspace"
import { attempt } from "./result"

const settingsInput = z.object({
  costingMethod: z.enum(["fifo", "average"]),
  baseCurrency: z.string().trim().length(3, "Use a 3-letter currency code").transform((c) => c.toUpperCase()),
  locale: z.string().trim().min(2).max(20),
  lockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  syncLegacy: z.boolean(),
  overReceiptPct: z.coerce.number().min(0).max(100),
  poApprovalThreshold: z.union([z.literal(""), z.null(), z.coerce.number().positive()]).transform((v) => (v === "" || v == null ? null : String(v))),
})

export async function saveSettingsAction(raw: z.input<typeof settingsInput>) {
  const ctx = await requireContext()
  const r = await attempt(async () => {
    const input = parse(settingsInput, raw)
    return runCommand(db, ctx.actor, { name: "settings.update", permission: "settings.manage", input, entity: { type: "settings", id: ctx.tenant.id } }, async (tx) => {
      const current = await ensureWorkspace(tx, ctx.tenant.id)
      if (current.costingMethod !== input.costingMethod) {
        const [moved] = await tx.select({ id: s.manifestStockMoves.id }).from(s.manifestStockMoves).where(eq(s.manifestStockMoves.tenantId, ctx.tenant.id)).limit(1)
        if (moved) throw new DomainError("costing_locked", "The costing method is fixed once stock has moved. Changing it would rewrite history.")
      }
      await tx
        .update(s.manifestSettings)
        .set({ ...input, lockDate: input.lockDate || null, overReceiptPct: String(input.overReceiptPct), updatedAt: new Date() })
        .where(eq(s.manifestSettings.tenantId, ctx.tenant.id))
      return { id: ctx.tenant.id }
    })
  })
  if (r.ok) revalidatePath("/", "layout")
  return r
}

const reasonInput = z.object({
  code: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes").transform((c) => c.toUpperCase()),
  label: z.string().trim().min(1).max(60),
  direction: z.enum(["in", "out", "both"]),
  toScrap: z.boolean().default(false),
})

export async function addReasonAction(raw: z.input<typeof reasonInput>) {
  const ctx = await requireContext()
  const r = await attempt(async () => {
    const input = parse(reasonInput, raw)
    return runCommand(db, ctx.actor, { name: "reason.create", permission: "settings.manage", input, entity: { type: "reason" } }, async (tx) => {
      await ensureWorkspace(tx, ctx.tenant.id)
      const [clash] = await tx
        .select({ id: s.manifestReasonCodes.id })
        .from(s.manifestReasonCodes)
        .where(and(eq(s.manifestReasonCodes.tenantId, ctx.tenant.id), eq(s.manifestReasonCodes.code, input.code)))
      if (clash) throw new DomainError("code_taken", `${input.code} already exists.`)
      const [row] = await tx.insert(s.manifestReasonCodes).values({ tenantId: ctx.tenant.id, ...input, sortOrder: 500 }).returning()
      return row
    })
  })
  if (r.ok) revalidatePath("/settings")
  return r
}

export async function toggleReasonAction(id: string, isActive: boolean) {
  const ctx = await requireContext()
  const r = await attempt(() =>
    runCommand(db, ctx.actor, { name: "reason.toggle", permission: "settings.manage", input: { id, isActive }, entity: { type: "reason", id } }, async (tx) => {
      await tx.update(s.manifestReasonCodes).set({ isActive }).where(and(eq(s.manifestReasonCodes.tenantId, ctx.tenant.id), eq(s.manifestReasonCodes.id, id)))
      return { id }
    }),
  )
  if (r.ok) revalidatePath("/settings")
  return r
}

"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireContext } from "@/lib/context"
import { cancelAdjustment, createAdjustment, postAdjustment, type CreateAdjustmentInput } from "@/domain/adjustments/commands"
import { reverseCommand } from "@/domain/ledger/reverse"
import { moveStock } from "@/domain/moves/commands"
import { attempt } from "./result"

function refresh() {
  for (const p of ["/", "/stock", "/moves", "/adjustments", "/items", "/locations"]) revalidatePath(p, "layout")
}

export async function createAdjustmentAction(input: CreateAdjustmentInput) {
  const ctx = await requireContext()
  const r = await attempt(() => createAdjustment(db, ctx.actor, input))
  if (r.ok) refresh()
  return r
}

export async function postAdjustmentAction(id: string, idempotencyKey?: string) {
  const ctx = await requireContext()
  const r = await attempt(() => postAdjustment(db, ctx.actor, { id, idempotencyKey }))
  if (r.ok) refresh()
  return r
}

export async function cancelAdjustmentAction(id: string) {
  const ctx = await requireContext()
  const r = await attempt(() => cancelAdjustment(db, ctx.actor, { id }))
  if (r.ok) refresh()
  return r
}

export async function moveStockAction(input: Parameters<typeof moveStock>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => moveStock(db, ctx.actor, input))
  if (r.ok) refresh()
  return r
}

/** Undo: posts reversal moves for everything a command did. */
export async function undoAction(commandId: string) {
  const ctx = await requireContext()
  const r = await attempt(() => reverseCommand(db, ctx.actor, { commandId, idempotencyKey: `undo:${commandId}` }))
  if (r.ok) refresh()
  return r
}

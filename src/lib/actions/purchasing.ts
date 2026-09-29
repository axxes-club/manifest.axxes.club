"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireContext } from "@/lib/context"
import {
  addLandedCost,
  createPurchaseOrder,
  receivePurchaseOrder,
  transitionPurchaseOrder,
  updatePurchaseOrder,
} from "@/domain/purchasing/commands"
import type { PoEvent } from "@/domain/purchasing/machine"
import { attempt } from "./result"

function refresh() {
  for (const p of ["/", "/purchase-orders", "/receipts", "/stock", "/moves"]) revalidatePath(p, "layout")
}

export async function createPoAction(input: Parameters<typeof createPurchaseOrder>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => createPurchaseOrder(db, ctx.actor, input))
  if (r.ok) refresh()
  return r
}

export async function updatePoAction(input: Parameters<typeof updatePurchaseOrder>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => updatePurchaseOrder(db, ctx.actor, input))
  if (r.ok) refresh()
  return r
}

export async function transitionPoAction(id: string, event: PoEvent) {
  const ctx = await requireContext()
  const r = await attempt(() => transitionPurchaseOrder(db, ctx.actor, { id, event }))
  if (r.ok) refresh()
  return r
}

export async function receivePoAction(input: Parameters<typeof receivePurchaseOrder>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => receivePurchaseOrder(db, ctx.actor, input))
  if (r.ok) refresh()
  return r
}

export async function addLandedCostAction(input: Parameters<typeof addLandedCost>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => addLandedCost(db, ctx.actor, input))
  if (r.ok) refresh()
  return r
}

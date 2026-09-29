"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireContext } from "@/lib/context"
import { createItem, updateItem } from "@/domain/catalog/commands"
import { attempt } from "./result"

export async function createItemAction(input: Parameters<typeof createItem>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => createItem(db, ctx.actor, input))
  if (r.ok) revalidatePath("/items")
  return r
}

export async function updateItemAction(input: Parameters<typeof updateItem>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => updateItem(db, ctx.actor, input))
  if (r.ok) {
    revalidatePath("/items")
    revalidatePath("/stock", "layout")
  }
  return r
}

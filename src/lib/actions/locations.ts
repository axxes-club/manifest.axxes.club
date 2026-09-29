"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireContext } from "@/lib/context"
import { archiveLocation, createLocation, generateBins, updateLocation } from "@/domain/locations/commands"
import { attempt } from "./result"

const refresh = () => revalidatePath("/locations", "layout")

export async function createLocationAction(input: Parameters<typeof createLocation>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => createLocation(db, ctx.actor, input))
  if (r.ok) refresh()
  return r
}

export async function updateLocationAction(input: Parameters<typeof updateLocation>[2]) {
  const ctx = await requireContext()
  const r = await attempt(() => updateLocation(db, ctx.actor, input))
  if (r.ok) refresh()
  return r
}

export async function generateBinsAction(parentId: string, pattern: string) {
  const ctx = await requireContext()
  const r = await attempt(() => generateBins(db, ctx.actor, { parentId, pattern }))
  if (r.ok) refresh()
  return r
}

export async function archiveLocationAction(id: string) {
  const ctx = await requireContext()
  const r = await attempt(() => archiveLocation(db, ctx.actor, { id }))
  if (r.ok) refresh()
  return r
}

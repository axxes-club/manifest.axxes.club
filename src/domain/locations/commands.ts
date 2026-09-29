import { and, eq, ne, sql } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { runCommand, type Actor } from "../command"
import { DomainError } from "../errors"
import { inSubtree, PATH_SEPARATOR } from "../ledger/paths"
import { parse } from "../validate"
import { ensureWorkspace } from "../workspace"

const PHYSICAL_KINDS = ["warehouse", "zone", "bin", "venue", "popup", "vehicle"] as const
/** Which kinds may sit under which. Top-level kinds have no parent. */
const PARENTS: Record<(typeof PHYSICAL_KINDS)[number], readonly string[] | null> = {
  warehouse: null,
  venue: null,
  popup: null,
  vehicle: null,
  zone: ["warehouse", "venue", "zone"],
  bin: ["warehouse", "venue", "zone", "vehicle", "popup"],
}

const code = z
  .string()
  .trim()
  .min(1, "Give it a short code")
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Codes use letters, numbers, dots, dashes and underscores")
  .transform((c) => c.toUpperCase())

export const createLocationInput = z.object({
  kind: z.enum(PHYSICAL_KINDS),
  parentId: z.string().uuid().nullish(),
  name: z.string().trim().min(1, "Name it").max(120),
  code,
  allowNegative: z.boolean().default(false),
  address: z
    .object({ line1: z.string().optional(), line2: z.string().optional(), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), country: z.string().optional() })
    .nullish(),
  legacyLocationId: z.string().uuid().nullish(),
})

export async function createLocation(db: Db, actor: Actor, raw: z.input<typeof createLocationInput>) {
  const input = parse(createLocationInput, raw)
  return runCommand(db, actor, { name: "location.create", permission: "locations.manage", input, entity: { type: "location" } }, async (tx, cmd) => {
    await ensureWorkspace(tx, actor.tenantId)
    const parent = await parentFor(tx, actor.tenantId, input.kind, input.parentId)
    await assertCodeFree(tx, actor.tenantId, input.code)
    const [loc] = await tx
      .insert(s.manifestLocations)
      .values({
        tenantId: actor.tenantId,
        parentId: parent?.id ?? null,
        kind: input.kind,
        name: input.name,
        code: input.code,
        path: parent ? parent.path + PATH_SEPARATOR + input.code : input.code,
        allowNegative: input.allowNegative,
        address: input.address ?? null,
        legacyLocationId: input.legacyLocationId ?? null,
      })
      .returning()
    cmd.emit("location.created", { id: loc.id, code: loc.code })
    return loc
  })
}

export const updateLocationInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  code: code.optional(),
  allowNegative: z.boolean().optional(),
  address: createLocationInput.shape.address,
})

export async function updateLocation(db: Db, actor: Actor, raw: z.input<typeof updateLocationInput>) {
  const input = parse(updateLocationInput, raw)
  return runCommand(db, actor, { name: "location.update", permission: "locations.manage", input, entity: { type: "location", id: input.id } }, async (tx) => {
    const loc = await physical(tx, actor.tenantId, input.id)
    const patch: Partial<typeof s.manifestLocations.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) patch.name = input.name
    if (input.allowNegative !== undefined) patch.allowNegative = input.allowNegative
    if (input.address !== undefined) patch.address = input.address ?? null
    if (input.code && input.code !== loc.code) {
      await assertCodeFree(tx, actor.tenantId, input.code, loc.id)
      const newPath = loc.path.slice(0, loc.path.length - loc.code.length) + input.code
      // Re-root every descendant's breadcrumb onto the new path.
      await tx
        .update(s.manifestLocations)
        .set({ path: sql`${newPath} || substr(${s.manifestLocations.path}, ${loc.path.length + 1})` })
        .where(and(eq(s.manifestLocations.tenantId, actor.tenantId), inSubtree(s.manifestLocations.path, loc.path), ne(s.manifestLocations.id, loc.id)))
      patch.code = input.code
      patch.path = newPath
    }
    const [row] = await tx.update(s.manifestLocations).set(patch).where(eq(s.manifestLocations.id, loc.id)).returning()
    return row
  })
}

/** Archive a location and everything under it. Refused while any of it holds stock, so nothing goes missing. */
export async function archiveLocation(db: Db, actor: Actor, input: { id: string }) {
  return runCommand(db, actor, { name: "location.archive", permission: "locations.manage", input, entity: { type: "location", id: input.id } }, async (tx, cmd) => {
    const loc = await physical(tx, actor.tenantId, input.id)
    const [held] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(s.manifestQuants)
      .innerJoin(s.manifestLocations, eq(s.manifestLocations.id, s.manifestQuants.locationId))
      .where(and(eq(s.manifestQuants.tenantId, actor.tenantId), inSubtree(s.manifestLocations.path, loc.path), sql`(${s.manifestQuants.onHand} <> 0 OR ${s.manifestQuants.reserved} <> 0)`))
    if (Number(held?.n) > 0) throw new DomainError("location_has_stock", `${loc.code} still holds stock. Move or adjust it out first.`)
    await tx
      .update(s.manifestLocations)
      .set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(and(eq(s.manifestLocations.tenantId, actor.tenantId), inSubtree(s.manifestLocations.path, loc.path)))
    cmd.emit("location.archived", { id: loc.id })
    return { id: loc.id }
  })
}

/**
 * Expands a bin pattern into codes: "A-{01..03}-{1..2}" gives A-01-1, A-01-2,
 * A-02-1 … A-03-2. Ranges keep their zero-padding; letters work too ({A..C}).
 */
export function expandPattern(pattern: string, max = 2000): string[] {
  const parts = pattern.split(/(\{[^}]+\})/).filter(Boolean)
  let out = [""]
  for (const part of parts) {
    const m = part.match(/^\{([A-Za-z0-9]+)\.\.([A-Za-z0-9]+)\}$/)
    let options: string[]
    if (!m) options = [part]
    else if (/^\d+$/.test(m[1]) && /^\d+$/.test(m[2])) {
      const [a, b] = [Number(m[1]), Number(m[2])]
      const width = m[1].length > 1 && m[1].startsWith("0") ? m[1].length : 0
      options = []
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) options.push(String(i).padStart(width, "0"))
    } else if (/^[A-Za-z]$/.test(m[1]) && /^[A-Za-z]$/.test(m[2])) {
      options = []
      for (let c = m[1].charCodeAt(0); c <= m[2].charCodeAt(0); c++) options.push(String.fromCharCode(c))
    } else throw new DomainError("invalid_pattern", `Can't expand ${part}. Use ranges like {01..12} or {A..D}.`)
    out = out.flatMap((prefix) => options.map((o) => prefix + o))
    if (out.length > max) throw new DomainError("pattern_too_large", `That pattern makes more than ${max} bins. Split it up.`)
  }
  return out
}

export async function generateBins(db: Db, actor: Actor, input: { parentId: string; pattern: string }) {
  return runCommand(db, actor, { name: "location.generate_bins", permission: "locations.manage", input, entity: { type: "location", id: input.parentId } }, async (tx, cmd) => {
    const parent = await parentFor(tx, actor.tenantId, "bin", input.parentId)
    const codes = expandPattern(input.pattern.trim()).map((c) => parse(code, c))
    const taken = new Set(
      (await tx.select({ code: s.manifestLocations.code }).from(s.manifestLocations).where(eq(s.manifestLocations.tenantId, actor.tenantId))).map((r) => r.code),
    )
    const fresh = codes.filter((c) => !taken.has(c))
    if (fresh.length) {
      await tx.insert(s.manifestLocations).values(
        fresh.map((c, i) => ({ tenantId: actor.tenantId, parentId: parent!.id, kind: "bin" as const, name: c, code: c, path: parent!.path + PATH_SEPARATOR + c, sortOrder: i })),
      )
    }
    cmd.emit("location.bins_generated", { parentId: parent!.id, created: fresh.length })
    return { created: fresh.length, skipped: codes.length - fresh.length }
  })
}

async function physical(tx: Db, tenantId: string, id: string) {
  const [loc] = await tx.select().from(s.manifestLocations).where(and(eq(s.manifestLocations.tenantId, tenantId), eq(s.manifestLocations.id, id))).limit(1)
  if (!loc) throw new DomainError("location_not_found", "That location doesn't exist in this workspace.")
  if (loc.isVirtual) throw new DomainError("location_virtual", "System locations can't be changed.")
  return loc
}

async function parentFor(tx: Db, tenantId: string, kind: (typeof PHYSICAL_KINDS)[number], parentId: string | null | undefined) {
  const allowed = PARENTS[kind]
  if (!parentId) {
    if (allowed) throw new DomainError("parent_required", `A ${kind} has to sit inside another location.`)
    return null
  }
  const parent = await physical(tx, tenantId, parentId)
  if (!allowed) throw new DomainError("parent_not_allowed", `A ${kind} is a top-level location.`)
  if (!allowed.includes(parent.kind)) throw new DomainError("parent_not_allowed", `A ${kind} can't go inside a ${parent.kind}.`)
  if (parent.archivedAt) throw new DomainError("location_inactive", `${parent.code} is archived.`)
  return parent
}

async function assertCodeFree(tx: Db, tenantId: string, c: string, exceptId?: string) {
  const [clash] = await tx
    .select({ id: s.manifestLocations.id })
    .from(s.manifestLocations)
    .where(and(eq(s.manifestLocations.tenantId, tenantId), eq(s.manifestLocations.code, c), exceptId ? ne(s.manifestLocations.id, exceptId) : undefined))
    .limit(1)
  if (clash) throw new DomainError("code_taken", `${c} is already used by another location.`)
}

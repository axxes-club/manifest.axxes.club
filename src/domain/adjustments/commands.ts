import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { runCommand, type Actor, type CommandScope } from "../command"
import { D, toDb } from "../decimal"
import { DomainError } from "../errors"
import { eqOrNull } from "../ledger/costing"
import { lockItems } from "../ledger/locks"
import { postMoves, type MoveInput } from "../ledger/post"
import { nextNumber } from "../sequences"
import { ensureWorkspace, virtualLocation } from "../workspace"
import { decimal, parse } from "../validate"
import { adjustmentMachine } from "./machine"


const line = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullish(),
    /** Add or remove this many. */
    qtyDelta: decimal.nullish(),
    /** Or: set on-hand at the location to exactly this many. */
    countedQty: decimal.nullish(),
    unitCost: decimal.nullish(),
  })
  .refine((l) => (l.qtyDelta != null) !== (l.countedQty != null), "Each line needs either a change or a counted quantity")
  .refine((l) => l.qtyDelta == null || !D(l.qtyDelta).isZero(), "A change of zero does nothing")
  .refine((l) => l.countedQty == null || D(l.countedQty).gte(0), "Counted quantity can't be negative")

export const createAdjustmentInput = z.object({
  locationId: z.string().uuid(),
  reason: z.string().min(1, "Choose a reason"),
  note: z.string().max(2000).nullish(),
  occurredAt: z.coerce.date().optional(),
  kind: z.enum(["adjustment", "opening"]).default("adjustment"),
  lines: z.array(line).min(1, "Add at least one item"),
  /** Post straight away (quick adjust, opening balances) instead of leaving a draft. */
  post: z.boolean().default(false),
  idempotencyKey: z.string().max(200).nullish(),
})
export type CreateAdjustmentInput = z.input<typeof createAdjustmentInput>

export async function createAdjustment(db: Db, actor: Actor, raw: CreateAdjustmentInput) {
  const input = parse(createAdjustmentInput, raw)
  return runCommand(
    db,
    actor,
    { name: "adjustment.create", permission: "stock.adjust", input, entity: { type: "adjustment" }, idempotencyKey: input.idempotencyKey },
    (tx, cmd) => createAdjustmentTx(tx, cmd, input),
  )
}

/** Creates (and optionally posts) an adjustment inside an existing command, e.g. an import. */
export async function createAdjustmentTx(tx: Db, cmd: CommandScope, input: z.output<typeof createAdjustmentInput>) {
  const tenantId = cmd.actor.tenantId
  await ensureWorkspace(tx, tenantId)
  const location = await physicalLocation(tx, tenantId, input.locationId)
  const reason = await reasonCode(tx, tenantId, input.kind === "opening" ? "OPENING" : input.reason)
  const number = await nextNumber(tx, tenantId, input.kind === "opening" ? "opening" : "adjustment")
  const [doc] = await tx
    .insert(s.manifestAdjustments)
    .values({
      tenantId,
      number,
      kind: input.kind,
      locationId: location.id,
      reason: reason.code,
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      createdBy: cmd.actor.userId,
    })
    .returning()
  await tx.insert(s.manifestAdjustmentLines).values(
    input.lines.map((l) => ({
      tenantId,
      adjustmentId: doc.id,
      productId: l.productId,
      variantId: l.variantId ?? null,
      qtyDelta: l.qtyDelta != null ? toDb(l.qtyDelta) : null,
      countedQty: l.countedQty != null ? toDb(l.countedQty) : null,
      unitCost: l.unitCost != null && l.unitCost !== "" ? toDb(l.unitCost) : null,
    })),
  )
  cmd.emit("adjustment.created", { id: doc.id, number })
  if (!input.post) return { id: doc.id, number, status: doc.status, commandId: cmd.id }
  const posted = await post(tx, cmd, doc.id)
  return { id: doc.id, number, status: posted.status, commandId: cmd.id, moves: posted.moves }
}

export async function postAdjustment(db: Db, actor: Actor, input: { id: string; idempotencyKey?: string | null }) {
  return runCommand(
    db,
    actor,
    { name: "adjustment.post", permission: "stock.adjust", input, entity: { type: "adjustment", id: input.id }, idempotencyKey: input.idempotencyKey },
    async (tx, cmd) => ({ id: input.id, commandId: cmd.id, ...(await post(tx, cmd, input.id)) }),
  )
}

export async function cancelAdjustment(db: Db, actor: Actor, input: { id: string }) {
  return runCommand(db, actor, { name: "adjustment.cancel", permission: "stock.adjust", input, entity: { type: "adjustment", id: input.id } }, async (tx, cmd) => {
    const doc = await lockDoc(tx, actor.tenantId, input.id)
    const status = adjustmentMachine.next(doc.status, "cancel")
    await tx.update(s.manifestAdjustments).set({ status, updatedAt: new Date() }).where(eq(s.manifestAdjustments.id, doc.id))
    cmd.emit("adjustment.cancelled", { id: doc.id, number: doc.number })
    return { id: doc.id, status }
  })
}

async function post(tx: Db, cmd: CommandScope, id: string) {
  const tenantId = cmd.actor.tenantId
  const doc = await lockDoc(tx, tenantId, id)
  const status = adjustmentMachine.next(doc.status, "post")
  const lines = await tx.select().from(s.manifestAdjustmentLines).where(eq(s.manifestAdjustmentLines.adjustmentId, doc.id))
  const location = await physicalLocation(tx, tenantId, doc.locationId)
  const reason = await reasonCode(tx, tenantId, doc.reason)
  const adjustLoc = await virtualLocation(tx, tenantId, "adjustment")
  const scrapLoc = reason.toScrap ? await virtualLocation(tx, tenantId, "scrap") : adjustLoc

  // Lock the items before reading on-hand, so "set to" lines can't race another posting.
  await lockItems(tx, lines.map((l) => ({ tenantId, productId: l.productId, variantId: l.variantId })))

  const moves: MoveInput[] = []
  for (const l of lines) {
    const before = await onHandAt(tx, tenantId, l.productId, l.variantId, location.id)
    const delta = l.countedQty != null ? D(l.countedQty).sub(before) : D(l.qtyDelta)
    await tx
      .update(s.manifestAdjustmentLines)
      .set({ qtyDelta: toDb(delta), qtyBefore: toDb(before) })
      .where(eq(s.manifestAdjustmentLines.id, l.id))
    if (delta.isZero()) continue
    if (delta.gt(0) && reason.direction === "out") throw new DomainError("reason_direction", `"${reason.label}" can only remove stock.`)
    if (delta.lt(0) && reason.direction === "in") throw new DomainError("reason_direction", `"${reason.label}" can only add stock.`)
    const common = { productId: l.productId, variantId: l.variantId, docType: doc.kind, docId: doc.id, docLineId: l.id, docNumber: doc.number, reason: reason.code, note: doc.note, occurredAt: doc.occurredAt }
    moves.push(
      delta.gt(0)
        ? { ...common, fromLocationId: adjustLoc.id, toLocationId: location.id, qty: delta, unitCost: l.unitCost }
        : { ...common, fromLocationId: location.id, toLocationId: scrapLoc.id, qty: delta.abs() },
    )
  }

  const posted = await postMoves(tx, cmd, moves)
  await tx
    .update(s.manifestAdjustments)
    .set({ status, postedAt: new Date(), postedBy: cmd.actor.userId, commandId: cmd.id, updatedAt: new Date() })
    .where(eq(s.manifestAdjustments.id, doc.id))
  cmd.emit("adjustment.posted", { id: doc.id, number: doc.number, moves: posted.length })
  return { status, moves: posted.length }
}

async function lockDoc(tx: Db, tenantId: string, id: string) {
  const [doc] = await tx
    .select()
    .from(s.manifestAdjustments)
    .where(and(eq(s.manifestAdjustments.tenantId, tenantId), eq(s.manifestAdjustments.id, id)))
    .for("update")
    .limit(1)
  if (!doc) throw new DomainError("not_found", "That adjustment doesn't exist in this workspace.")
  return doc
}

async function physicalLocation(tx: Db, tenantId: string, id: string) {
  const [loc] = await tx
    .select()
    .from(s.manifestLocations)
    .where(and(eq(s.manifestLocations.tenantId, tenantId), eq(s.manifestLocations.id, id)))
    .limit(1)
  if (!loc) throw new DomainError("location_not_found", "That location doesn't exist in this workspace.")
  if (loc.isVirtual) throw new DomainError("location_virtual", `${loc.name} isn't a physical location.`)
  return loc
}

async function reasonCode(tx: Db, tenantId: string, code: string) {
  const [r] = await tx
    .select()
    .from(s.manifestReasonCodes)
    .where(and(eq(s.manifestReasonCodes.tenantId, tenantId), eq(s.manifestReasonCodes.code, code), eq(s.manifestReasonCodes.isActive, true)))
    .limit(1)
  if (!r) throw new DomainError("reason_not_found", "Choose a reason from the list.")
  return r
}

async function onHandAt(tx: Db, tenantId: string, productId: string, variantId: string | null, locationId: string) {
  const [row] = await tx
    .select({ q: sql<string>`coalesce(sum(${s.manifestQuants.onHand}), 0)` })
    .from(s.manifestQuants)
    .where(
      and(
        eq(s.manifestQuants.tenantId, tenantId),
        eq(s.manifestQuants.productId, productId),
        eqOrNull(s.manifestQuants.variantId, variantId),
        eq(s.manifestQuants.locationId, locationId),
        eq(s.manifestQuants.status, "available"),
      ),
    )
  return D(row?.q)
}

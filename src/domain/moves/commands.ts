import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { runCommand, type Actor } from "../command"
import { DomainError } from "../errors"
import { postMoves } from "../ledger/post"
import { decimal, parse } from "../validate"

export const moveStockInput = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  lines: z
    .array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid().nullish(), qty: decimal }))
    .min(1, "Add at least one item"),
  note: z.string().max(2000).nullish(),
  idempotencyKey: z.string().max(200).nullish(),
})

/**
 * Put stock somewhere else in the building: bin to bin, or into a van. A
 * one-step move with no paperwork. Transfers between sites (with transit and
 * receiving) are their own document.
 */
export async function moveStock(db: Db, actor: Actor, raw: z.input<typeof moveStockInput>) {
  const input = parse(moveStockInput, raw)
  return runCommand(
    db,
    actor,
    { name: "stock.move", permission: "stock.move", input, entity: { type: "location", id: input.toLocationId }, idempotencyKey: input.idempotencyKey },
    async (tx, cmd) => {
      const locs = await tx
        .select()
        .from(s.manifestLocations)
        .where(and(eq(s.manifestLocations.tenantId, actor.tenantId), inArray(s.manifestLocations.id, [input.fromLocationId, input.toLocationId])))
      if (locs.some((l) => l.isVirtual)) throw new DomainError("location_virtual", "Moves go between physical locations. Use an adjustment to add or remove stock.")
      const moves = await postMoves(
        tx,
        cmd,
        input.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId ?? null,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          qty: l.qty,
          docType: "move",
          note: input.note ?? null,
        })),
      )
      return { id: cmd.id, commandId: cmd.id, moves: moves.length }
    },
  )
}

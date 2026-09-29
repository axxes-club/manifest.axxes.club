import { and, eq, inArray } from "drizzle-orm"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { runCommand, type Actor } from "../command"
import { DomainError } from "../errors"
import { nextNumber } from "../sequences"
import { afterReceiptReversed, assertReceiptReversible } from "../purchasing/commands"
import { postMoves } from "./post"

/**
 * Undo: posts the mirror image of every move a command made. The originals
 * stay in the ledger untouched, so history always shows what happened and
 * how it was corrected. Each move can be reversed once.
 */
export async function reverseCommand(db: Db, actor: Actor, input: { commandId: string; note?: string | null; idempotencyKey?: string | null }) {
  return runCommand(
    db,
    actor,
    { name: "ledger.reverse", permission: "stock.reverse", input, entity: { type: "command", id: input.commandId }, idempotencyKey: input.idempotencyKey },
    async (tx, cmd) => {
      const originals = await tx
        .select()
        .from(s.manifestStockMoves)
        .where(and(eq(s.manifestStockMoves.tenantId, actor.tenantId), eq(s.manifestStockMoves.commandId, input.commandId)))
      if (!originals.length) throw new DomainError("not_found", "There's nothing to undo for that action.")
      if (originals.some((m) => m.reversalOf)) throw new DomainError("already_reversal", "That was already an undo. Post a new adjustment instead.")
      const done = await tx
        .select({ id: s.manifestStockMoves.reversalOf })
        .from(s.manifestStockMoves)
        .where(inArray(s.manifestStockMoves.reversalOf, originals.map((m) => m.id)))
      if (done.length) throw new DomainError("already_reversed", "This has already been undone.")

      const receiptIds = [...new Set(originals.filter((m) => m.docType === "receipt" && m.docId).map((m) => m.docId!))]
      for (const id of receiptIds) await assertReceiptReversible(tx, actor.tenantId, id)

      const number = await nextNumber(tx, actor.tenantId, "reversal")
      const moves = await postMoves(
        tx,
        cmd,
        originals.map((m) => ({
          productId: m.productId,
          variantId: m.variantId,
          lotId: m.lotId,
          fromLocationId: m.toLocationId,
          toLocationId: m.fromLocationId,
          fromStatus: m.toStatus,
          toStatus: m.fromStatus,
          qty: m.qty,
          unitCost: m.unitCost,
          docType: "reversal",
          docId: m.docId,
          docLineId: m.docLineId,
          docNumber: number,
          reason: m.reason,
          note: input.note ?? `Undo of ${m.docNumber ?? m.docType}`,
          reversalOf: m.id,
        })),
      )
      // Documents whose own records track what their moves did get to catch up.
      for (const id of receiptIds) await afterReceiptReversed(tx, actor.tenantId, id)
      cmd.emit("ledger.reversed", { commandId: input.commandId, number })
      return { id: cmd.id, number, moves: moves.length }
    },
  )
}

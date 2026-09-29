import { and, eq, sql } from "drizzle-orm"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { can, type Permission } from "@/lib/permissions"
import { DomainError } from "./errors"

/** Who is acting, and in which workspace. Every command needs one. */
export type Actor = {
  tenantId: string
  userId: string | null
  role: string
  /** Set when a superadmin is acting as someone else; recorded in the audit log. */
  impersonatorId?: string | null
}

export type CommandScope = {
  id: string
  actor: Actor
  /** Queue an outbox event; it's written in the same transaction as the change. */
  emit(type: string, payload: Record<string, unknown>): void
}

type Spec<I> = {
  name: string
  permission: Permission
  input: I
  entity?: { type: string; id?: string | null }
  /** Replays with the same key return the stored result instead of running again. */
  idempotencyKey?: string | null
}

/**
 * Runs one business command atomically: permission check, the change itself,
 * the audit row and the outbox events all commit together or not at all.
 * This is the only way anything in Manifest writes stock.
 */
export async function runCommand<I, R>(db: Db, actor: Actor, spec: Spec<I>, fn: (tx: Db, cmd: CommandScope) => Promise<R>): Promise<R> {
  if (!can(actor.role, spec.permission)) {
    throw new DomainError("forbidden", "You don't have permission to do that in this workspace.", { permission: spec.permission })
  }

  if (spec.idempotencyKey) {
    const prior = await findPrior(db, actor.tenantId, spec.idempotencyKey)
    if (prior) return prior.result as R
  }

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '8s'`)
      const events: { type: string; payload: Record<string, unknown> }[] = []
      const cmd: CommandScope = {
        id: crypto.randomUUID(),
        actor,
        emit: (type, payload) => void events.push({ type, payload }),
      }

      const result = await fn(tx as unknown as Db, cmd)

      await tx.insert(s.manifestAudit).values({
        tenantId: actor.tenantId,
        commandId: cmd.id,
        command: spec.name,
        idempotencyKey: spec.idempotencyKey ?? null,
        actorId: actor.userId,
        impersonatorId: actor.impersonatorId ?? null,
        entityType: spec.entity?.type ?? null,
        entityId: spec.entity?.id ?? entityIdOf(result),
        input: spec.input as unknown,
        result: result as unknown,
      })
      if (events.length) {
        await tx.insert(s.manifestEvents).values(events.map((e) => ({ tenantId: actor.tenantId, commandId: cmd.id, ...e })))
      }
      return result
    })
  } catch (e) {
    // Two replays racing: the loser hits the unique key and returns the winner's result.
    if (spec.idempotencyKey && isUniqueViolation(e)) {
      const prior = await findPrior(db, actor.tenantId, spec.idempotencyKey)
      if (prior) return prior.result as R
    }
    throw e
  }
}

async function findPrior(db: Db, tenantId: string, key: string) {
  const [row] = await db
    .select({ result: s.manifestAudit.result })
    .from(s.manifestAudit)
    .where(and(eq(s.manifestAudit.tenantId, tenantId), eq(s.manifestAudit.idempotencyKey, key)))
    .limit(1)
  return row
}

function entityIdOf(result: unknown) {
  const id = (result as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : null
}

function isUniqueViolation(e: unknown) {
  for (let err = e as { code?: string; cause?: unknown } | undefined; err; err = err.cause as typeof err) {
    if (err.code === "23505") return true
  }
  return false
}

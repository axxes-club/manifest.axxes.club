import "server-only"
import { isDomainError } from "@/domain/errors"

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code?: string }

/**
 * Runs a domain call for a server action. Business-rule failures come back as
 * their message; anything unexpected is logged and shown generically, so
 * Postgres internals never reach the screen.
 */
export async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    if (isDomainError(e)) return { ok: false, error: e.message, code: e.code }
    console.error(e)
    return { ok: false, error: "Something went wrong. Nothing was saved; try again." }
  }
}

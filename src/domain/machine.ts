import { DomainError } from "./errors"

/**
 * A document's lifecycle. Status only ever changes through a named event, and
 * the UI shows exactly the events `available()` returns, so the buttons and
 * the rules can't disagree.
 */
export function machine<S extends string, E extends string>(name: string, transitions: Record<S, Partial<Record<E, S>>>) {
  return {
    name,
    can: (state: S, event: E) => transitions[state]?.[event] !== undefined,
    available: (state: S) => Object.keys(transitions[state] ?? {}) as E[],
    next(state: S, event: E): S {
      const to = transitions[state]?.[event]
      if (!to) throw new DomainError("invalid_transition", `A ${state.replaceAll("_", " ")} ${name} can't be ${String(event).replaceAll("_", " ")}.`, { state, event })
      return to
    },
  }
}

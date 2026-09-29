import { z } from "zod"
import { DomainError } from "./errors"

/** Validates command input, turning the first problem into a message a person can act on. */
export function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const r = schema.safeParse(raw)
  if (!r.success) {
    const issue = r.error.issues[0]
    throw new DomainError("invalid_input", issue?.message ?? "Check the values and try again.", { path: issue?.path })
  }
  return r.data
}

/** A number arriving from a form or JSON, kept as a string so it never passes through a float. */
export const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => v !== "" && !Number.isNaN(Number(v)), "Must be a number")

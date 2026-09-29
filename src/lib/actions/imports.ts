"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireContext } from "@/lib/context"
import { commitOpening, detectMapping, parseCsv, previewOpening, toRows, type Column } from "@/domain/imports/opening"
import { DomainError } from "@/domain/errors"
import { ensureWorkspace } from "@/domain/workspace"
import { attempt } from "./result"

type Options = { csv: string; mapping?: Partial<Record<Column, number>>; defaultLocation?: string | null; createMissing: boolean }

function rowsFrom(o: Options) {
  const table = parseCsv(o.csv)
  if (table.length < 2) return { header: table[0] ?? [], mapping: {}, rows: [] }
  const mapping = o.mapping ?? detectMapping(table[0])
  return { header: table[0], mapping, rows: toRows(table, mapping) }
}

export async function previewImportAction(o: Options) {
  const ctx = await requireContext()
  return attempt(async () => {
    if (!ctx.can("import.run")) throw new DomainError("forbidden", "You don't have permission to import in this workspace.")
    await ensureWorkspace(db, ctx.tenant.id)
    const { header, mapping, rows } = rowsFrom(o)
    return { header, mapping, preview: await previewOpening(db, ctx.tenant.id, rows, o) }
  })
}

export async function commitImportAction(o: Options & { goLive?: string; idempotencyKey: string }) {
  const ctx = await requireContext()
  const r = await attempt(() =>
    commitOpening(db, ctx.actor, { ...o, rows: rowsFrom(o).rows, goLive: o.goLive ? new Date(o.goLive) : undefined, idempotencyKey: o.idempotencyKey }),
  )
  if (r.ok) revalidatePath("/", "layout")
  return r
}

import { sql, type SQL } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"

export const PATH_SEPARATOR = " / "

/** A location and everything under it, matched on the materialised path. */
export function inSubtree(pathCol: PgColumn, path: string): SQL {
  const escaped = path.replace(/[\\%_]/g, (c) => `\\${c}`)
  return sql`(${pathCol} = ${path} OR ${pathCol} LIKE ${escaped + PATH_SEPARATOR + "%"})`
}

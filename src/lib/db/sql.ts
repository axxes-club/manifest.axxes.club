import { getTableName, sql, type Column } from "drizzle-orm"

/**
 * A column reference that always carries its table name. Drizzle leaves
 * columns unqualified in single-table selects, and inside a correlated
 * subquery an unqualified "id" silently binds to the subquery's own table.
 * Use this for every outer-row reference inside a raw subquery.
 */
export function outer(col: Column) {
  return sql.raw(`"${getTableName(col.table)}"."${col.name}"`)
}

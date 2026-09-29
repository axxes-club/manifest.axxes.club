import Decimal from "decimal.js"

// Quantities and money never touch JS floats. Columns are numeric(18,4), and
// every value is rounded to 4 places on the way back to the database.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })

export { Decimal }
export type Num = Decimal.Value

export const D = (v: Num | null | undefined) => new Decimal(v ?? 0)

/** Database representation: fixed 4 decimal places. */
export const toDb = (v: Num) => new Decimal(v).toFixed(4)

export const ZERO = new Decimal(0)

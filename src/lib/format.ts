/** Display formatting. Values arrive as numeric strings from Postgres and are only turned into numbers for display. */

export type Locale = { locale: string; currency: string }
export const DEFAULT_LOCALE: Locale = { locale: "en-US", currency: "USD" }

export function fmtQty(v: string | number | null | undefined, l: Locale = DEFAULT_LOCALE) {
  if (v === null || v === undefined || v === "") return "—"
  const n = Number(v)
  return n.toLocaleString(l.locale, { maximumFractionDigits: 4 })
}

export function fmtMoney(v: string | number | null | undefined, l: Locale = DEFAULT_LOCALE, opts: { compact?: boolean } = {}) {
  if (v === null || v === undefined || v === "") return "—"
  const n = Number(v)
  return n.toLocaleString(l.locale, {
    style: "currency",
    currency: l.currency,
    notation: opts.compact && Math.abs(n) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
  })
}

export function fmtDate(v: Date | string | null | undefined, l: Locale = DEFAULT_LOCALE) {
  if (!v) return "—"
  return new Date(v).toLocaleDateString(l.locale, { month: "short", day: "numeric", year: "numeric" })
}

export function fmtDateTime(v: Date | string | null | undefined, l: Locale = DEFAULT_LOCALE) {
  if (!v) return "—"
  return new Date(v).toLocaleString(l.locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** "3m ago", "yesterday", then a date. */
export function fmtRelative(v: Date | string, l: Locale = DEFAULT_LOCALE, now = Date.now()) {
  const s = Math.round((now - new Date(v).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(l.locale, { numeric: "auto", style: "short" })
  if (s < 45) return rtf.format(0, "second")
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute")
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour")
  if (s < 7 * 86400) return rtf.format(-Math.round(s / 86400), "day")
  return fmtDate(v, l)
}

/** Signed quantity for ledgers: +12, −3. */
export function fmtDelta(v: string | number, l: Locale = DEFAULT_LOCALE) {
  const n = Number(v)
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString(l.locale, { maximumFractionDigits: 4 })}`
}

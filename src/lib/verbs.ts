/**
 * Command-palette verbs. Typing what you'd say out loud ("move 12 TEE-1 to
 * A-02") becomes a prefilled form, so the fastest path through Manifest is
 * the keyboard. Parsing is pure; the palette turns a verb into a URL.
 */
export type Verb =
  | { kind: "move"; qty: string; sku: string; to: string; from?: string }
  | { kind: "adjust"; qty: string; sku: string; at?: string }
  | { kind: "set"; qty: string; sku: string; at?: string }
  | { kind: "receive"; po: string }
  | { kind: "order"; qty?: string; sku: string }
  | { kind: "find"; query: string }

const QTY = String.raw`(\d+(?:\.\d+)?)`
const TOKEN = String.raw`(\S+)`

export function parseVerb(input: string): Verb | null {
  const text = input.trim().replace(/\s+/g, " ")
  let m: RegExpMatchArray | null

  // move 12 TEE-1 to A-02 | move 12 x TEE-1 from A-01 to A-02
  if ((m = text.match(new RegExp(`^(?:move|mv) ${QTY}(?: ?[x×])? ${TOKEN}(?: from ${TOKEN})? (?:to|->|→) ${TOKEN}$`, "i")))) {
    return { kind: "move", qty: m[1], sku: m[2], from: m[3]?.toUpperCase(), to: m[4].toUpperCase() }
  }
  // add 5 TEE-1 at A-01 | remove 2 TEE-1 at A-01 | adjust TEE-1 -2 at A-01
  if ((m = text.match(new RegExp(`^(add|remove|rm) ${QTY}(?: ?[x×])? ${TOKEN}(?: (?:at|in|@) ${TOKEN})?$`, "i")))) {
    const sign = m[1].toLowerCase() === "add" ? "" : "-"
    return { kind: "adjust", qty: sign + m[2], sku: m[3], at: m[4]?.toUpperCase() }
  }
  if ((m = text.match(new RegExp(`^adjust ${TOKEN} ([+-]?\\d+(?:\\.\\d+)?)(?: (?:at|in|@) ${TOKEN})?$`, "i")))) {
    return { kind: "adjust", qty: m[2].replace(/^\+/, ""), sku: m[1], at: m[3]?.toUpperCase() }
  }
  // set TEE-1 to 40 at A-01 | count TEE-1 40 at A-01
  if ((m = text.match(new RegExp(`^(?:set|count) ${TOKEN} (?:to )?${QTY}(?: (?:at|in|@) ${TOKEN})?$`, "i")))) {
    return { kind: "set", qty: m[2], sku: m[1], at: m[3]?.toUpperCase() }
  }
  // receive PO-000123 | receive po 123
  if ((m = text.match(/^receive (?:po[- ]?)?#?(\d+)$/i))) return { kind: "receive", po: `PO-${m[1].padStart(6, "0")}` }
  if ((m = text.match(new RegExp(`^receive ${TOKEN}$`, "i")))) return { kind: "receive", po: m[1].toUpperCase() }
  // order 50 CAP-01 | reorder CAP-01
  if ((m = text.match(new RegExp(`^(?:order|reorder|buy) (?:${QTY}(?: ?[x×])? )?${TOKEN}$`, "i")))) return { kind: "order", qty: m[1], sku: m[2] }
  if ((m = text.match(/^(?:find|where is|where's) (.+)$/i))) return { kind: "find", query: m[1] }
  return null
}

export function verbLabel(v: Verb): string {
  switch (v.kind) {
    case "move":
      return `Move ${v.qty} × ${v.sku}${v.from ? ` from ${v.from}` : ""} → ${v.to}`
    case "adjust":
      return `${v.qty.startsWith("-") ? "Remove" : "Add"} ${v.qty.replace(/^-/, "")} × ${v.sku}${v.at ? ` at ${v.at}` : ""}`
    case "set":
      return `Set ${v.sku} to ${v.qty}${v.at ? ` at ${v.at}` : ""}`
    case "receive":
      return `Receive ${v.po}`
    case "order":
      return `Order ${v.qty ? `${v.qty} × ` : ""}${v.sku}`
    case "find":
      return `Find ${v.query}`
  }
}

export function verbHref(v: Verb): string {
  const q = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString()
  switch (v.kind) {
    case "move":
      return `/moves/new?${q({ sku: v.sku, qty: v.qty, from: v.from, to: v.to })}`
    case "adjust":
      return `/adjustments/new?${q({ sku: v.sku, qty: v.qty, at: v.at })}`
    case "set":
      return `/adjustments/new?${q({ sku: v.sku, set: v.qty, at: v.at, reason: "COUNT" })}`
    case "receive":
      return `/purchase-orders/number/${encodeURIComponent(v.po)}?to=receive`
    case "order":
      return `/purchase-orders/new?${q({ sku: v.sku, qty: v.qty })}`
    case "find":
      return `/stock?${q({ q: v.query })}`
  }
}

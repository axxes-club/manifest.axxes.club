import { and, eq, isNull } from "drizzle-orm"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { createAdjustmentTx } from "../adjustments/commands"
import { runCommand, type Actor } from "../command"
import { D } from "../decimal"
import { DomainError } from "../errors"
import { ensureWorkspace } from "../workspace"

/**
 * Opening balances from a spreadsheet: one row per item per location.
 * Columns are matched by name, loosely ("Qty", "quantity", "On hand" all work),
 * so most exports from Shopify, Sortly, inFlow or noventory import as-is.
 */
export const COLUMNS = {
  sku: ["sku", "item sku", "variant sku", "product sku", "code", "item code"],
  name: ["name", "item", "item name", "product", "product name", "title", "description"],
  location: ["location", "location code", "bin", "warehouse", "site"],
  qty: ["qty", "quantity", "on hand", "onhand", "stock", "count", "available", "quantity on hand"],
  unitCost: ["unit cost", "cost", "cost price", "unitcost", "avg cost", "average cost"],
  price: ["price", "retail price", "sell price", "unit price"],
  barcode: ["barcode", "upc", "ean", "gtin"],
} as const
export type Column = keyof typeof COLUMNS

export type ImportRow = {
  row: number
  sku: string | null
  name: string | null
  location: string | null
  qty: string | null
  unitCost: string | null
  price: string | null
  barcode: string | null
}

export type PreviewRow = ImportRow & {
  status: "ok" | "create" | "skip"
  problem?: string
  productId?: string
  variantId?: string | null
  locationId?: string
}

/** Minimal RFC 4180 CSV: quoted fields, escaped quotes, commas and newlines inside quotes, tabs pasted from a sheet. */
export function parseCsv(text: string): string[][] {
  const delimiter = text.split("\n", 1)[0].includes("\t") && !text.split("\n", 1)[0].includes(",") ? "\t" : ","
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === "") quoted = true
    else if (c === delimiter) row.push(field), (field = "")
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field), rows.push(row), (row = []), (field = "")
    } else field += c
  }
  if (field !== "" || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((f) => f.trim() !== ""))
}

/** Works out which spreadsheet column is which. Unmatched columns are ignored. */
export function detectMapping(header: string[]): Partial<Record<Column, number>> {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " "))
  const map: Partial<Record<Column, number>> = {}
  for (const [col, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    const i = norm.findIndex((h) => names.includes(h))
    if (i >= 0) map[col] = i
  }
  return map
}

export function toRows(table: string[][], mapping: Partial<Record<Column, number>>): ImportRow[] {
  const cell = (r: string[], c: Column) => {
    const i = mapping[c]
    const v = i == null ? "" : (r[i] ?? "").trim()
    return v === "" ? null : v
  }
  const money = (v: string | null) => (v == null ? null : v.replace(/[$€£,\s]/g, ""))
  return table.slice(1).map((r, i) => ({
    row: i + 2,
    sku: cell(r, "sku"),
    name: cell(r, "name"),
    location: cell(r, "location")?.toUpperCase() ?? null,
    qty: money(cell(r, "qty")),
    unitCost: money(cell(r, "unitCost")),
    price: money(cell(r, "price")),
    barcode: cell(r, "barcode"),
  }))
}

/**
 * Checks every row against the workspace without writing anything, so people
 * see exactly what will happen, row by row, before they commit.
 */
export async function previewOpening(db: Db, tenantId: string, rows: ImportRow[], opts: { defaultLocation?: string | null; createMissing: boolean }) {
  const locations = await db
    .select({ id: s.manifestLocations.id, code: s.manifestLocations.code })
    .from(s.manifestLocations)
    .where(and(eq(s.manifestLocations.tenantId, tenantId), eq(s.manifestLocations.isVirtual, false), isNull(s.manifestLocations.archivedAt)))
  const locByCode = new Map(locations.map((l) => [l.code.toUpperCase(), l.id]))
  const products = await db
    .select({ id: s.products.id, sku: s.products.sku, hasVariants: s.products.hasVariants })
    .from(s.products)
    .where(and(eq(s.products.tenantId, tenantId), isNull(s.products.deletedAt)))
  const variants = await db
    .select({ id: s.productVariants.id, productId: s.productVariants.productId, sku: s.productVariants.sku })
    .from(s.productVariants)
    .where(and(eq(s.productVariants.tenantId, tenantId), isNull(s.productVariants.deletedAt)))
  const bySku = new Map<string, { productId: string; variantId: string | null; hasVariants: boolean }>()
  for (const p of products) if (p.sku) bySku.set(p.sku.toLowerCase(), { productId: p.id, variantId: null, hasVariants: !!p.hasVariants })
  for (const v of variants) if (v.sku) bySku.set(v.sku.toLowerCase(), { productId: v.productId, variantId: v.id, hasVariants: false })

  // Sheets often name an item once and leave the name blank on its other location rows.
  const nameBySku = new Map<string, string>()
  for (const r of rows) if (r.sku && r.name && !nameBySku.has(r.sku.toLowerCase())) nameBySku.set(r.sku.toLowerCase(), r.name)

  const seen = new Set<string>()
  return rows.map((row): PreviewRow => {
    const r = { ...row, name: row.name ?? (row.sku ? (nameBySku.get(row.sku.toLowerCase()) ?? null) : null) }
    const skip = (problem: string): PreviewRow => ({ ...r, status: "skip", problem })
    if (!r.sku) return skip("No SKU")
    if (r.qty == null) return skip("No quantity")
    if (Number.isNaN(Number(r.qty))) return skip(`Quantity "${r.qty}" isn't a number`)
    if (D(r.qty).lt(0)) return skip("Opening quantities can't be negative")
    if (r.unitCost != null && (Number.isNaN(Number(r.unitCost)) || D(r.unitCost).lt(0))) return skip(`Unit cost "${r.unitCost}" isn't valid`)
    const code = r.location ?? opts.defaultLocation?.toUpperCase() ?? null
    if (!code) return skip("No location, and no default chosen")
    const locationId = locByCode.get(code)
    if (!locationId) return skip(`No location with code ${code}`)
    const key = `${r.sku.toLowerCase()}@${code}`
    if (seen.has(key)) return skip("Same SKU and location as an earlier row")
    seen.add(key)
    const item = bySku.get(r.sku.toLowerCase())
    if (item?.hasVariants) return skip(`${r.sku} has variants. Use the variant SKUs.`)
    if (item) return { ...r, location: code, status: "ok", productId: item.productId, variantId: item.variantId, locationId }
    if (!opts.createMissing) return skip(`No item with SKU ${r.sku}`)
    if (!r.name) return skip("New item needs a name")
    return { ...r, location: code, status: "create", locationId }
  })
}

/**
 * Commits a previewed import as one command: creates missing items, then posts
 * one opening-balance adjustment per location, dated on the go-live date. It
 * all lands or none of it does.
 */
export async function commitOpening(
  db: Db,
  actor: Actor,
  input: { rows: ImportRow[]; defaultLocation?: string | null; createMissing: boolean; goLive?: Date; idempotencyKey?: string | null },
) {
  return runCommand(
    db,
    actor,
    { name: "import.opening", permission: "import.run", input: { rows: input.rows.length, createMissing: input.createMissing }, entity: { type: "import" }, idempotencyKey: input.idempotencyKey },
    async (tx, cmd) => {
      await ensureWorkspace(tx, actor.tenantId)
      const preview = await previewOpening(tx, actor.tenantId, input.rows, input)
      const usable = preview.filter((r) => r.status !== "skip")
      if (!usable.length) throw new DomainError("nothing_to_import", "None of the rows can be imported. Fix the problems shown and try again.")

      const created = new Map<string, string>()
      for (const r of usable.filter((r) => r.status === "create")) {
        const sku = r.sku!.toLowerCase()
        if (!created.has(sku)) {
          const [p] = await tx
            .insert(s.products)
            .values({
              tenantId: actor.tenantId,
              name: r.name!,
              sku: r.sku,
              barcode: r.barcode,
              price: r.price && !Number.isNaN(Number(r.price)) ? D(r.price).toFixed(2) : "0.00",
              costPrice: r.unitCost ? D(r.unitCost).toFixed(2) : null,
              status: "active",
              quantity: 0,
            })
            .returning({ id: s.products.id })
          await tx.insert(s.manifestItemProfiles).values({ tenantId: actor.tenantId, productId: p.id, variantId: null })
          created.set(sku, p.id)
        }
        r.productId = created.get(sku)
        r.variantId = null
      }

      const byLocation = new Map<string, PreviewRow[]>()
      for (const r of usable) if (D(r.qty).gt(0)) byLocation.set(r.locationId!, [...(byLocation.get(r.locationId!) ?? []), r])
      const documents: string[] = []
      for (const [locationId, lines] of byLocation) {
        const doc = await createAdjustmentTx(tx, cmd, {
          kind: "opening",
          reason: "OPENING",
          locationId,
          occurredAt: input.goLive,
          note: "Opening balances from import",
          post: true,
          lines: lines.map((l) => ({ productId: l.productId!, variantId: l.variantId ?? null, qtyDelta: l.qty!, unitCost: l.unitCost ?? null })),
        })
        documents.push(doc.number)
      }
      await tx.update(s.manifestSettings).set({ onboardedAt: new Date() }).where(and(eq(s.manifestSettings.tenantId, actor.tenantId), isNull(s.manifestSettings.onboardedAt)))
      cmd.emit("import.completed", { imported: usable.length, created: created.size, documents })
      return {
        id: cmd.id,
        imported: usable.length,
        itemsCreated: created.size,
        documents,
        skipped: preview.filter((r) => r.status === "skip").map((r) => ({ row: r.row, reason: r.problem! })),
      }
    },
  )
}

import { and, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { runCommand, type Actor } from "../command"
import { D, toDb } from "../decimal"
import { DomainError } from "../errors"
import { decimal, parse } from "../validate"
import { ensureWorkspace } from "../workspace"

const money = decimal.refine((v) => Number(v) >= 0, "Can't be negative")

export const createItemInput = z.object({
  name: z.string().trim().min(1, "Name the item").max(200),
  sku: z.string().trim().max(80).nullish(),
  barcode: z.string().trim().max(80).nullish(),
  price: money.default("0"),
  costPrice: money.nullish(),
  unit: z.string().trim().max(20).default("each"),
  tracking: z.enum(["none", "lot", "serial"]).default("none"),
  reorderPoint: decimal.nullish(),
  reorderQty: decimal.nullish(),
  /**
   * Option axes, e.g. { Size: ["S","M","L"], Color: ["Black"] }. Every
   * combination becomes a variant with its own SKU (base SKU + values).
   */
  options: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)).nullish(),
})

export async function createItem(db: Db, actor: Actor, raw: z.input<typeof createItemInput>) {
  const input = parse(createItemInput, raw)
  return runCommand(db, actor, { name: "item.create", permission: "catalog.manage", input, entity: { type: "item" } }, async (tx, cmd) => {
    await ensureWorkspace(tx, actor.tenantId)
    const combos = combinations(input.options ?? {})
    if (combos.length > 250) throw new DomainError("too_many_variants", "That makes more than 250 variants. Trim the options.")
    const hasVariants = combos.length > 0
    const variantSkus = combos.map((c) => (input.sku ? [input.sku, ...Object.values(c)].join("-").toUpperCase().replace(/\s+/g, "") : null))
    await assertSkusFree(tx, actor.tenantId, [input.sku, ...variantSkus].filter((x): x is string => !!x))

    const [product] = await tx
      .insert(s.products)
      .values({
        tenantId: actor.tenantId,
        name: input.name,
        sku: input.sku || null,
        barcode: input.barcode || null,
        price: toCents(input.price)!,
        costPrice: toCents(input.costPrice),
        status: "active",
        trackInventory: true,
        hasVariants,
        quantity: 0,
      })
      .returning()

    const variants = hasVariants
      ? await tx
          .insert(s.productVariants)
          .values(
            combos.map((c, i) => ({
              tenantId: actor.tenantId,
              productId: product.id,
              name: Object.values(c).join(" / "),
              options: c,
              price: product.price,
              costPrice: product.costPrice,
              sku: variantSkus[i],
              sortOrder: i,
              isDefault: i === 0,
              quantity: 0,
            })),
          )
          .returning()
      : []

    const profileBase = {
      tenantId: actor.tenantId,
      productId: product.id,
      unit: input.unit,
      tracking: input.tracking,
      reorderPoint: input.reorderPoint != null ? toDb(input.reorderPoint) : null,
      reorderQty: input.reorderQty != null ? toDb(input.reorderQty) : null,
    }
    await tx
      .insert(s.manifestItemProfiles)
      .values(hasVariants ? variants.map((v) => ({ ...profileBase, variantId: v.id })) : [{ ...profileBase, variantId: null }])

    cmd.emit("item.created", { id: product.id, variants: variants.length })
    return { id: product.id, variants: variants.length }
  })
}

export const updateItemInput = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(200).optional(),
  sku: z.string().trim().max(80).nullish(),
  barcode: z.string().trim().max(80).nullish(),
  price: money.optional(),
  costPrice: money.nullish(),
  unit: z.string().trim().max(20).optional(),
  tracking: z.enum(["none", "lot", "serial"]).optional(),
  reorderPoint: decimal.nullish(),
  reorderQty: decimal.nullish(),
})

/** Edits catalog details and Manifest settings. Never touches quantity: only the ledger does that. */
export async function updateItem(db: Db, actor: Actor, raw: z.input<typeof updateItemInput>) {
  const input = parse(updateItemInput, raw)
  return runCommand(db, actor, { name: "item.update", permission: "catalog.manage", input, entity: { type: "item", id: input.productId } }, async (tx) => {
    const [product] = await tx.select().from(s.products).where(and(eq(s.products.tenantId, actor.tenantId), eq(s.products.id, input.productId), isNull(s.products.deletedAt))).limit(1)
    if (!product) throw new DomainError("item_not_found", "That item doesn't exist in this workspace.")
    if (input.sku) await assertSkusFree(tx, actor.tenantId, [input.sku], input.variantId ?? input.productId)
    const now = new Date()

    if (input.variantId) {
      await tx
        .update(s.productVariants)
        .set({
          ...(input.sku !== undefined && { sku: input.sku || null }),
          ...(input.barcode !== undefined && { barcode: input.barcode || null }),
          ...(input.price !== undefined && { price: toCents(input.price)! }),
          ...(input.costPrice !== undefined && { costPrice: toCents(input.costPrice) }),
          updatedAt: now,
        })
        .where(and(eq(s.productVariants.tenantId, actor.tenantId), eq(s.productVariants.id, input.variantId), eq(s.productVariants.productId, product.id)))
    } else {
      await tx
        .update(s.products)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.sku !== undefined && { sku: input.sku || null }),
          ...(input.barcode !== undefined && { barcode: input.barcode || null }),
          ...(input.price !== undefined && { price: toCents(input.price)! }),
          ...(input.costPrice !== undefined && { costPrice: toCents(input.costPrice) }),
          updatedAt: now,
        })
        .where(eq(s.products.id, product.id))
    }

    const profile = {
      ...(input.unit !== undefined && { unit: input.unit }),
      ...(input.tracking !== undefined && { tracking: input.tracking }),
      ...(input.reorderPoint !== undefined && { reorderPoint: input.reorderPoint != null && input.reorderPoint !== "" ? toDb(input.reorderPoint) : null }),
      ...(input.reorderQty !== undefined && { reorderQty: input.reorderQty != null && input.reorderQty !== "" ? toDb(input.reorderQty) : null }),
    }
    if (Object.keys(profile).length) {
      await tx
        .insert(s.manifestItemProfiles)
        .values({ tenantId: actor.tenantId, productId: product.id, variantId: input.variantId ?? null, ...profile })
        .onConflictDoUpdate({
          target: [s.manifestItemProfiles.tenantId, s.manifestItemProfiles.productId, s.manifestItemProfiles.variantId],
          set: { ...profile, updatedAt: now },
        })
    }
    return { id: product.id }
  })
}

/** The shared catalog stores prices with 2 decimals. */
const toCents = (v: string | null | undefined) => (v == null || v === "" ? null : D(v).toFixed(2))

function combinations(options: Record<string, string[]>): Record<string, string>[] {
  const axes = Object.entries(options).filter(([, v]) => v.length)
  if (!axes.length) return []
  return axes.reduce<Record<string, string>[]>((acc, [axis, values]) => acc.flatMap((c) => values.map((v) => ({ ...c, [axis]: v }))), [{}])
}

async function assertSkusFree(tx: Db, tenantId: string, skus: string[], exceptId?: string) {
  if (!skus.length) return
  const lower = skus.map((x) => x.toLowerCase())
  if (new Set(lower).size !== lower.length) throw new DomainError("sku_taken", "Two variants would share a SKU.")
  const list = sql.join(lower.map((x) => sql`${x}`), sql`, `)
  const clash = await tx.execute(sql`
    SELECT sku FROM ${s.products} WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND lower(sku) IN (${list}) ${exceptId ? sql`AND id <> ${exceptId}` : sql``}
    UNION ALL
    SELECT sku FROM ${s.productVariants} WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND lower(sku) IN (${list}) ${exceptId ? sql`AND id <> ${exceptId}` : sql``}
    LIMIT 1`)
  const rows = Array.isArray(clash) ? clash : (clash as { rows: { sku: string }[] }).rows
  if (rows.length) throw new DomainError("sku_taken", `SKU ${(rows[0] as { sku: string }).sku} is already used by another item.`)
}

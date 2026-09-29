import { and, eq, isNotNull, sql } from "drizzle-orm"
import type { Db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { D } from "../decimal"
import { eqOrNull, type ItemKey } from "./costing"
import { inSubtree } from "./paths"

/**
 * members.axxes.club, Pulse and the public storefront feed read stock from the
 * shared products / product_variants / inventory_levels columns. Manifest's
 * ledger is the source of truth, so after every posting it rewrites those
 * columns for the items it touched. They're whole numbers there, so values are
 * floored: a storefront never promises a fraction it can't ship.
 */
export async function syncLegacy(tx: Db, tenantId: string, items: ItemKey[]) {
  if (!items.length) return
  const mapped = await tx
    .select({ id: s.manifestLocations.id, path: s.manifestLocations.path, legacyId: s.manifestLocations.legacyLocationId })
    .from(s.manifestLocations)
    .where(and(eq(s.manifestLocations.tenantId, tenantId), isNotNull(s.manifestLocations.legacyLocationId)))

  const now = new Date()
  const touchedProducts = new Set<string>()

  for (const k of items) {
    const sellable = await physicalTotal(tx, k)
    const whole = Math.floor(D(sellable.available).toNumber())
    if (k.variantId) {
      await tx.update(s.productVariants).set({ quantity: whole, updatedAt: now }).where(and(eq(s.productVariants.id, k.variantId), eq(s.productVariants.tenantId, tenantId)))
      touchedProducts.add(k.productId)
    } else {
      await tx.update(s.products).set({ quantity: whole, updatedAt: now }).where(and(eq(s.products.id, k.productId), eq(s.products.tenantId, tenantId)))
    }

    for (const loc of mapped) {
      const t = await physicalTotal(tx, k, loc.path)
      const values = { quantityOnHand: Math.floor(D(t.onHand).toNumber()), quantityCommitted: Math.floor(D(t.reserved).toNumber()), updatedAt: now }
      const levelWhere = and(
        eq(s.inventoryLevels.tenantId, tenantId),
        eq(s.inventoryLevels.locationId, loc.legacyId!),
        eqOrNull(s.inventoryLevels.productId, k.variantId ? null : k.productId),
        eqOrNull(s.inventoryLevels.variantId, k.variantId),
      )
      const updated = await tx.update(s.inventoryLevels).set(values).where(levelWhere).returning({ id: s.inventoryLevels.id })
      if (!updated.length) {
        await tx.insert(s.inventoryLevels).values({
          tenantId,
          locationId: loc.legacyId!,
          productId: k.variantId ? null : k.productId,
          variantId: k.variantId,
          ...values,
        })
      }
    }
  }

  // A product with variants shows the sum of its variants.
  for (const productId of touchedProducts) {
    await tx
      .update(s.products)
      .set({
        quantity: sql`(SELECT coalesce(sum(${s.productVariants.quantity}), 0) FROM ${s.productVariants} WHERE ${s.productVariants.productId} = ${productId} AND ${s.productVariants.deletedAt} IS NULL)`,
        updatedAt: now,
      })
      .where(and(eq(s.products.id, productId), eq(s.products.tenantId, tenantId)))
  }
}

/** On-hand, reserved and available across physical locations, optionally limited to one location's subtree. */
async function physicalTotal(tx: Db, k: ItemKey, underPath?: string) {
  const [row] = await tx
    .select({
      onHand: sql<string>`coalesce(sum(${s.manifestQuants.onHand}), 0)`,
      reserved: sql<string>`coalesce(sum(${s.manifestQuants.reserved}), 0)`,
      available: sql<string>`coalesce(sum(${s.manifestQuants.onHand} - ${s.manifestQuants.reserved}), 0)`,
    })
    .from(s.manifestQuants)
    .innerJoin(s.manifestLocations, eq(s.manifestLocations.id, s.manifestQuants.locationId))
    .where(
      and(
        eq(s.manifestQuants.tenantId, k.tenantId),
        eq(s.manifestQuants.productId, k.productId),
        eqOrNull(s.manifestQuants.variantId, k.variantId),
        eq(s.manifestQuants.status, "available"),
        eq(s.manifestLocations.isVirtual, false),
        underPath ? inSubtree(s.manifestLocations.path, underPath) : undefined,
      ),
    )
  return row ?? { onHand: "0", reserved: "0", available: "0" }
}

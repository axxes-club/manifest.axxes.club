"use client"

import { useEffect, useState } from "react"

/** Live on-hand for an item at a location; null while unknown. */
export function useAvailability(productId?: string | null, variantId?: string | null, locationId?: string | null) {
  const [data, setData] = useState<{ onHand: number; available: number } | null>(null)
  useEffect(() => {
    setData(null)
    if (!productId || !locationId) return
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ productId, locationId, ...(variantId ? { variantId } : {}) })
    fetch(`/api/availability?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setData({ onHand: Number(j.onHand), available: Number(j.available) }))
      .catch(() => {})
    return () => ctrl.abort()
  }, [productId, variantId, locationId])
  return data
}

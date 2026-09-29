"use client"

import { useEffect, useId, useRef, useState } from "react"
import type { SearchHit } from "@/app/api/search/route"

export type PickedItem = { productId: string; variantId: string | null; label: string; sku: string | null }

/**
 * Item combobox. Type a name, SKU or barcode. A barcode scanner works too: it
 * types the code and presses Enter, and an exact SKU match is picked at once.
 */
export function ItemPicker({
  value,
  onChange,
  autoFocus,
  placeholder = "Item name, SKU or scan…",
  inputRef,
}: {
  value: PickedItem | null
  onChange: (item: PickedItem | null) => void
  autoFocus?: boolean
  placeholder?: string
  inputRef?: React.Ref<HTMLInputElement>
}) {
  const [q, setQ] = useState(value?.label ?? "")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const listId = useId()
  const pendingEnter = useRef(false)

  useEffect(() => setQ(value ? `${value.label}${value.sku ? ` · ${value.sku}` : ""}` : ""), [value])

  useEffect(() => {
    if (!open || q.trim().length < 1) return setHits([])
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?kinds=item&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        if (!res.ok) return
        const found: SearchHit[] = (await res.json()).hits
        setHits(found)
        setCursor(0)
        if (pendingEnter.current) {
          pendingEnter.current = false
          const exact = found.find((h) => h.sku?.toLowerCase() === q.trim().toLowerCase()) ?? (found.length === 1 ? found[0] : undefined)
          if (exact) pick(exact)
        }
      } catch {}
    }, 90)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open])

  const pick = (h: SearchHit) => {
    onChange({ productId: h.productId!, variantId: h.variantId ?? null, label: h.title, sku: h.sku ?? null })
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className="input"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          if (value) onChange(null)
        }}
        onFocus={() => q && !value && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(c + 1, hits.length - 1)))
          else if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(c - 1, 0)))
          else if (e.key === "Enter" && !value) {
            e.preventDefault()
            if (hits[cursor]) pick(hits[cursor])
            else pendingEnter.current = true
          } else if (e.key === "Escape") setOpen(false)
        }}
      />
      {open && hits.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-panel-2 p-1 shadow-2xl shadow-black/60">
          {hits.map((h, i) => (
            <li
              key={h.id}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={(e) => (e.preventDefault(), pick(h))}
              onMouseMove={() => setCursor(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm ${i === cursor ? "bg-panel text-text" : "text-muted"}`}
            >
              <span className="truncate">{h.title}</span>
              <span className="font-mono text-xs text-muted">{h.subtitle}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export type LocationOption = { id: string; code: string; path: string; name: string }

/** Location select showing the breadcrumb, so A-01 in two warehouses can't be confused. */
export function LocationSelect({
  locations,
  value,
  onChange,
  name,
  placeholder = "Choose a location",
  exclude,
}: {
  locations: LocationOption[]
  value: string
  onChange?: (id: string) => void
  name?: string
  placeholder?: string
  exclude?: string
}) {
  return (
    <select className="input" name={name} value={value} onChange={(e) => onChange?.(e.target.value)} required>
      <option value="">{placeholder}</option>
      {locations
        .filter((l) => l.id !== exclude)
        .map((l) => (
          <option key={l.id} value={l.id}>
            {l.path}
            {l.name !== l.code ? ` — ${l.name}` : ""}
          </option>
        ))}
    </select>
  )
}

"use client"

import { useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, CornerDownLeft, Search, Sparkles, Box, MapPin, FileText, Plus } from "lucide-react"
import type { NavItem } from "@/lib/product"
import { parseVerb, verbHref, verbLabel } from "@/lib/verbs"
import type { SearchHit } from "@/app/api/search/route"
import { Icon } from "./icons"

type Entry = { id: string; group: string; title: string; subtitle?: string; hint?: string; href: string; icon: React.ReactNode }

const ACTIONS: { title: string; href: string; hint?: string; keywords: string }[] = [
  { title: "New adjustment", href: "/adjustments/new", hint: "c on Adjustments", keywords: "add remove correct stock damage count" },
  { title: "Move stock", href: "/moves/new", keywords: "bin transfer put away relocate" },
  { title: "New purchase order", href: "/purchase-orders/new", keywords: "buy order supplier po restock" },
  { title: "Receive a delivery", href: "/purchase-orders?tab=open", keywords: "receive grn arrived delivery dock" },
  { title: "New item", href: "/items/new", keywords: "product sku create catalog variant" },
  { title: "New location", href: "/locations/new", keywords: "warehouse bin zone venue popup van" },
  { title: "Import opening balances", href: "/import", keywords: "csv spreadsheet upload onboarding" },
  { title: "Low stock", href: "/stock?low=1", keywords: "reorder short running out" },
]

const PaletteContext = createContext<() => void>(() => {})
export const useOpenPalette = () => useContext(PaletteContext)

/** Subsequence match with a bonus for word starts. 0 means no match. */
function score(text: string, q: string) {
  const t = text.toLowerCase()
  const needle = q.toLowerCase()
  if (!needle) return 1
  if (t.includes(needle)) return 100 - t.indexOf(needle)
  let ti = 0
  let s = 0
  for (const ch of needle) {
    const i = t.indexOf(ch, ti)
    if (i < 0) return 0
    s += i === 0 || t[i - 1] === " " ? 3 : 1
    ti = i + 1
  }
  return s
}

export function CommandPalette({ nav, children }: { nav: NavItem[]; children: React.ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    setOpen(true)
    setQ("")
    setHits([])
    setCursor(0)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        if (open) setOpen(false)
        else show()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, show])

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus())
  }, [open])

  // Record search, debounced; stale responses are dropped.
  useEffect(() => {
    if (!open || q.trim().length < 2) return setHits([])
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      const verb = parseVerb(q)
      const term = !verb ? q : verb.kind === "find" ? verb.query : verb.kind === "receive" ? verb.po : verb.sku
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        if (res.ok) setHits((await res.json()).hits)
      } catch {}
    }, 120)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, open])

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    const verb = parseVerb(q)
    if (verb) out.push({ id: "verb", group: "Do", title: verbLabel(verb), hint: "Opens prefilled", href: verbHref(verb), icon: <Sparkles className="size-4 text-accent" strokeWidth={1.5} /> })
    const rank = <T,>(xs: T[], text: (x: T) => string) =>
      xs
        .map((x) => [x, score(text(x), q)] as const)
        .filter(([, s]) => s > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([x]) => x)
    for (const a of rank(ACTIONS, (a) => `${a.title} ${a.keywords}`).slice(0, q ? 4 : 6))
      out.push({ id: `a:${a.href}`, group: "Do", title: a.title, hint: a.hint, href: a.href, icon: <Plus className="size-4" strokeWidth={1.5} /> })
    for (const n of rank(nav, (n) => n.label))
      out.push({ id: `n:${n.href}`, group: "Go to", title: n.label, hint: n.chord ? `g ${n.chord}` : undefined, href: n.href, icon: <Icon name={n.icon} /> })
    const doc = <FileText className="size-4" strokeWidth={1.5} />
    const kindIcon = { item: <Box className="size-4" strokeWidth={1.5} />, location: <MapPin className="size-4" strokeWidth={1.5} />, adjustment: doc, purchase_order: doc, receipt: doc }
    const groupName = { item: "Items", location: "Locations", adjustment: "Documents", purchase_order: "Documents", receipt: "Documents" }
    for (const h of hits) out.push({ id: `${h.kind}:${h.id}`, group: groupName[h.kind], title: h.title, subtitle: h.subtitle, href: h.href, icon: kindIcon[h.kind] })
    return out
  }, [q, hits, nav])

  useEffect(() => setCursor(0), [q])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  const go = (e: Entry | undefined) => {
    if (!e) return
    setOpen(false)
    router.push(e.href)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) (e.preventDefault(), setCursor((c) => Math.min(c + 1, entries.length - 1)))
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) (e.preventDefault(), setCursor((c) => Math.max(c - 1, 0)))
    else if (e.key === "Enter") (e.preventDefault(), go(entries[cursor]))
    else if (e.key === "Escape") setOpen(false)
  }

  let lastGroup = ""
  return (
    <PaletteContext.Provider value={show}>
      {children}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Command palette"
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/70"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-muted" strokeWidth={1.5} />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search, or type: move 12 TEE-1 to A-02"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/60"
                role="combobox"
                aria-expanded
                aria-controls="palette-list"
                aria-activedescendant={entries[cursor] ? `pe-${cursor}` : undefined}
              />
              <kbd className="font-mono text-[10px] text-muted">esc</kbd>
            </div>
            <div ref={list} id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
              {entries.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{q}”.</p>}
              {entries.map((e, i) => {
                const header = e.group !== lastGroup ? e.group : null
                lastGroup = e.group
                return (
                  <div key={e.id}>
                    {header && <p className="px-2.5 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">{header}</p>}
                    <button
                      id={`pe-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === cursor}
                      onMouseMove={() => setCursor(i)}
                      onClick={() => go(e)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${i === cursor ? "bg-panel-2 text-text" : "text-muted"}`}
                    >
                      <span className={i === cursor ? "text-text" : ""}>{e.icon}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className={i === cursor ? "text-text" : "text-text/90"}>{e.title}</span>
                        {e.subtitle && <span className="ml-2 font-mono text-xs text-muted">{e.subtitle}</span>}
                      </span>
                      {e.hint && <span className="font-mono text-[10px] text-muted/70">{e.hint}</span>}
                      {i === cursor && (e.id === "verb" ? <CornerDownLeft className="size-3.5 text-accent" /> : <ArrowRight className="size-3.5 text-muted" />)}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 font-mono text-[10px] text-muted">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span className="ml-auto">verbs: move · add · remove · set · order · receive · find</span>
            </div>
          </div>
        </div>
      )}
    </PaletteContext.Provider>
  )
}

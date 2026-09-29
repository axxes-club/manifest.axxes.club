"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import type { NavItem } from "@/lib/product"
import { Kbd } from "@/components/ui"
import { setSidebarCollapsed } from "@/lib/actions/shell"

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))

/**
 * Global keyboard layer:
 *   g + key   go to a section (chords from product.config)
 *   /         focus the page's search field ([data-search])
 *   c         the page's create action ([data-create])
 *   j / k     move through table rows ([data-row]); ↵ opens the row
 *   [         collapse the sidebar
 *   ?         this cheat sheet
 */
export function Shortcuts({ nav }: { nav: NavItem[] }) {
  const router = useRouter()
  const [help, setHelp] = useState(false)
  const pendingG = useRef<number | null>(null)
  const row = useRef(-1)

  useEffect(() => {
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-row]"))
    const focusRow = (i: number) => {
      const all = rows()
      if (!all.length) return
      row.current = Math.max(0, Math.min(i, all.length - 1))
      all.forEach((r, j) => r.toggleAttribute("data-active", j === row.current))
      all[row.current].scrollIntoView({ block: "nearest" })
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) {
        if (e.key === "Escape" && typing(e.target)) (e.target as HTMLElement).blur()
        return
      }
      if (pendingG.current) {
        window.clearTimeout(pendingG.current)
        pendingG.current = null
        const target = nav.find((n) => n.chord === e.key)
        if (target) (e.preventDefault(), router.push(target.href))
        return
      }
      switch (e.key) {
        case "g":
          pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200)
          return
        case "?":
          return setHelp((h) => !h)
        case "Escape":
          return setHelp(false)
        case "/": {
          const el = document.querySelector<HTMLElement>("[data-search]")
          if (el) (e.preventDefault(), el.focus())
          return
        }
        case "c":
          return document.querySelector<HTMLElement>("[data-create]")?.click()
        case "j":
          return focusRow(row.current + 1)
        case "k":
          return focusRow(row.current - 1)
        case "Enter": {
          const active = document.querySelector<HTMLElement>("[data-row][data-active]")
          const link = active?.querySelector<HTMLAnchorElement>("a[href]")
          if (link) (e.preventDefault(), router.push(link.getAttribute("href")!))
          return
        }
        case "[": {
          const aside = document.querySelector("aside[data-collapsed]")
          const collapsed = aside?.getAttribute("data-collapsed") === "true"
          void setSidebarCollapsed(!collapsed).then(() => router.refresh())
          return
        }
      }
    }
    const reset = () => (row.current = -1)
    window.addEventListener("keydown", onKey)
    window.addEventListener("popstate", reset)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("popstate", reset)
    }
  }, [nav, router])

  if (!help) return null
  const groups: [string, [React.ReactNode, string][]][] = [
    ["Anywhere", [[<><Kbd>⌘</Kbd><Kbd>K</Kbd></>, "Search and commands"], [<Kbd key="q">?</Kbd>, "This sheet"], [<Kbd key="b">[</Kbd>, "Collapse sidebar"]]],
    ["Go to", nav.filter((n) => n.chord).map((n) => [<><Kbd>g</Kbd><Kbd>{n.chord}</Kbd></>, n.label])],
    ["Lists", [[<Kbd key="s">/</Kbd>, "Search this list"], [<Kbd key="c">c</Kbd>, "Create"], [<><Kbd>j</Kbd><Kbd>k</Kbd></>, "Next / previous row"], [<Kbd key="e">↵</Kbd>, "Open row"]]],
    ["Forms", [[<><Kbd>⌘</Kbd><Kbd>↵</Kbd></>, "Save or post"], [<Kbd key="esc">esc</Kbd>, "Leave field"]]],
  ]
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setHelp(false)}>
      <div className="w-full max-w-2xl rounded-2xl border border-line bg-panel p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Keyboard shortcuts</h2>
          <Kbd>esc</Kbd>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map(([title, items]) => (
            <div key={title}>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{title}</p>
              <ul className="space-y-1.5">
                {items.map(([keys, label], i) => (
                  <li key={i} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-muted">{label}</span>
                    <span className="flex gap-1">{keys}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

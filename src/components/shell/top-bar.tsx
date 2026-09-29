"use client"

import { Search } from "lucide-react"
import { useOpenPalette } from "./command-palette"

export function TopBar({ userName }: { userName: string }) {
  const open = useOpenPalette()
  const initials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  return (
    <div className="sticky top-0 z-20 hidden h-14 items-center gap-3 border-b border-line bg-bg/85 px-8 backdrop-blur lg:flex">
      <button
        onClick={open}
        className="group flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-line bg-panel px-3 text-sm text-muted transition hover:border-accent/40 hover:text-text"
      >
        <Search className="size-4" strokeWidth={1.5} />
        <span className="flex-1 text-left">Search or run a command…</span>
        <span className="font-mono text-[10px] text-muted/70">⌘K</span>
      </button>
      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}
          className="grid size-8 place-items-center rounded-lg border border-line font-mono text-xs text-muted hover:text-text"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
        <span className="grid size-8 place-items-center rounded-full bg-panel-2 font-mono text-[11px] font-medium ring-1 ring-line" title={userName}>
          {initials}
        </span>
      </div>
    </div>
  )
}

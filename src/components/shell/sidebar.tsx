"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { ChevronsUpDown, Check } from "lucide-react"
import type { NavSection } from "@/lib/product"
import type { Workspace } from "@/lib/context"
import { switchWorkspace, setSidebarCollapsed } from "@/lib/actions/shell"
import { Icon } from "./icons"

type Props = {
  sections: NavSection[]
  logo: React.ReactNode
  mark: React.ReactNode
  collapsed: boolean
  workspace: { id: string; name: string; role: string }
  workspaces: Workspace[]
  user: { name: string; email: string }
}

export function Sidebar({ sections, logo, mark, collapsed: initialCollapsed, workspace, workspaces, user }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [switching, setSwitching] = useState(false)
  const [pending, start] = useTransition()
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"))

  const toggle = () => {
    setCollapsed(!collapsed)
    void setSidebarCollapsed(!collapsed)
  }

  // "[" collapses the rail, matching every other AXXES product.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed])

  const chooseWorkspace = (id: string) =>
    start(async () => {
      await switchWorkspace(id)
      setSwitching(false)
      router.push("/")
      router.refresh()
    })

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
        {logo}
        <button className="btn-ghost px-3" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
          {open ? "Close" : "Menu"}
        </button>
      </header>
      <aside
        data-collapsed={collapsed}
        className={`${open ? "flex" : "hidden"} fixed inset-x-0 top-[57px] bottom-0 z-20 flex-col overflow-y-auto border-r border-line bg-panel p-3 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:shrink-0 lg:transition-[width] ${collapsed ? "lg:w-[60px]" : "lg:w-60"}`}
      >
        <div className={`mb-6 hidden items-center lg:flex ${collapsed ? "justify-center" : "justify-between px-1"}`}>
          {collapsed ? mark : logo}
        </div>
        <nav className="flex-1 space-y-5">
          {sections.map((section, i) => (
            <div key={section.title ?? i}>
              {section.title && !collapsed && (
                <p className="mb-1.5 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">{section.title}</p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const on = active(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      onClick={() => setOpen(false)}
                      aria-current={on ? "page" : undefined}
                      className={`group relative flex items-center gap-2.5 rounded-lg py-2 text-sm transition ${collapsed ? "justify-center px-0" : "px-3"} ${on ? "bg-panel-2 font-medium text-text" : "text-muted hover:bg-panel-2 hover:text-text"}`}
                    >
                      {on && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
                      <Icon name={item.icon} className={on ? "text-accent" : ""} />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && item.chord && (
                        <span className="hidden font-mono text-[10px] text-muted/50 group-hover:inline">g {item.chord}</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-6 space-y-2 border-t border-line pt-3">
          <div className="relative">
            <button
              onClick={() => setSwitching(!switching)}
              className={`flex w-full items-center gap-2.5 rounded-lg py-2 text-left text-xs transition hover:bg-panel-2 ${collapsed ? "justify-center px-0" : "px-2"}`}
              title={collapsed ? workspace.name : undefined}
              aria-expanded={switching}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-panel-2 font-mono text-[11px] font-semibold text-text ring-1 ring-line">
                {workspace.name.slice(0, 2).toUpperCase()}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text">{workspace.name}</span>
                    <span className="block truncate text-muted">{user.email}</span>
                  </span>
                  <ChevronsUpDown className="size-3.5 text-muted" strokeWidth={1.5} />
                </>
              )}
            </button>
            {switching && (
              <div className="absolute bottom-full left-0 z-40 mb-2 w-60 rounded-xl border border-line bg-panel-2 p-1 shadow-2xl shadow-black/60">
                <p className="px-2 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Workspaces</p>
                {workspaces.map((w) => (
                  <button
                    key={w.id}
                    disabled={pending}
                    onClick={() => chooseWorkspace(w.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-panel"
                  >
                    <span className="flex-1 truncate">{w.name}</span>
                    <span className="font-mono text-[10px] capitalize text-muted">{w.role}</span>
                    {w.id === workspace.id && <Check className="size-3.5 text-accent" />}
                  </button>
                ))}
                <div className="mt-1 border-t border-line pt-1">
                  <a className="block rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-panel hover:text-text" href="https://members.axxes.club/dashboard">
                    AXXES portal ↗
                  </a>
                  <a className="block rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-panel hover:text-text" href="/sign-out">
                    Sign out
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* The recognisable AXXES control: a round button riding the rail's edge.
            It replaces the labelled "Collapse" row that used to sit down here, so
            there is one control doing one thing, in the same place as every other
            AXXES product. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
          className="absolute -right-3 top-20 hidden size-6 place-items-center rounded-full border border-line bg-panel text-muted shadow-sm transition hover:text-text lg:grid"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
            {collapsed && <path d="m16 15-3-3 3-3" />}
          </svg>
        </button>
      </aside>
    </>
  )
}

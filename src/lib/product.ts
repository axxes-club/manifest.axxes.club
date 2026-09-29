import type { Permission } from "@/lib/permissions"
import type { Resource } from "@/lib/resource"

/** Icon names the sidebar and command palette know how to draw. */
export type IconName =
  | "today"
  | "stock"
  | "moves"
  | "adjust"
  | "items"
  | "locations"
  | "orders"
  | "suppliers"
  | "prices"
  | "import"
  | "settings"

export type NavItem = {
  href: string
  label: string
  icon: IconName
  /** Second key of the "g" chord, e.g. "s" for g s. */
  chord?: string
  /** Hidden from people without it. */
  permission?: Permission
}

export type NavSection = { title: string | null; items: NavItem[] }

export type Product = {
  /** Codename shown in the UI. */
  name: string
  tagline: string
  /** Brand accent (CSS color). */
  accent: string
  nav: NavSection[]
  /** Master data edited with the generic list/form screens. Documents that move stock have their own screens. */
  resources: (Resource & { icon: IconName; section: string })[]
}

export function defineProduct(p: Product) {
  return p
}

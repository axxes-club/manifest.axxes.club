"use server"

import { cookies } from "next/headers"
import { getContext, WORKSPACE_COOKIE } from "@/lib/context"

const YEAR = 60 * 60 * 24 * 365

/** Switch the active workspace. Only workspaces the person belongs to are accepted. */
export async function switchWorkspace(tenantId: string) {
  const ctx = await getContext()
  if (!ctx?.workspaces.some((w) => w.id === tenantId)) return { error: "You no longer have access to this organization." }
  ;(await cookies()).set(WORKSPACE_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: YEAR })
  return {}
}

export async function setSidebarCollapsed(collapsed: boolean) {
  ;(await cookies()).set("manifest_sidebar", collapsed ? "collapsed" : "open", { sameSite: "lax", path: "/", maxAge: YEAR })
}

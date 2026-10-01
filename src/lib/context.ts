import "server-only"
import { cache } from "react"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, schema } from "@/lib/db"
import type { Actor } from "@/domain/command"
import { can, type Permission } from "@/lib/permissions"

/** Host-only cookie holding the workspace this browser last switched to. */
export const WORKSPACE_COOKIE = "manifest_workspace"

export type Workspace = { id: string; name: string; slug: string; role: string }

export type AppContext = {
  userId: string
  user: { name: string; email: string; isSuperadmin: boolean }
  tenant: { id: string; name: string; slug: string }
  role: string
  workspaces: Workspace[]
  actor: Actor
  can: (permission: Permission) => boolean
}

// Resolves the signed-in user and the workspace they're working in: the one
// they last switched to, else their primary AXXES workspace. Every page and
// server action goes through this, so all data access is tenant-scoped.
export const getContext = cache(async (): Promise<AppContext | null> => {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  const memberships = await db
    .select({
      role: schema.tenantMemberships.role,
      isPrimary: schema.tenantMemberships.isPrimary,
      id: schema.tenants.id,
      name: schema.tenants.name,
      slug: schema.tenants.slug,
    })
    .from(schema.tenantMemberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
    .where(
      and(
        eq(schema.tenantMemberships.userId, session.user.id),
        isNull(schema.tenantMemberships.deletedAt),
        isNull(schema.tenants.deletedAt),
        ne(schema.tenants.status, "suspended"),
        ne(schema.tenants.status, "cancelled"),
      ),
    )
    .orderBy(desc(schema.tenantMemberships.isPrimary), asc(schema.tenants.name))

  if (!memberships.length) return null
  const chosen = (await cookies()).get(WORKSPACE_COOKIE)?.value
  const current = memberships.find((m) => m.id === chosen) ?? memberships[0]
  const isSuperadmin = Boolean((session.user as { isSuperadmin?: boolean }).isSuperadmin)

  return {
    userId: session.user.id,
    user: { name: session.user.name, email: session.user.email, isSuperadmin },
    tenant: { id: current.id, name: current.name, slug: current.slug },
    role: current.role,
    workspaces: memberships.map(({ id, name, slug, role }) => ({ id, name, slug, role })),
    actor: { tenantId: current.id, userId: session.user.id, role: current.role },
    can: (p) => can(current.role, p),
  }
})

export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext()
  if (!ctx) {
    const session = await auth.api.getSession({ headers: await headers() })
    redirect(session ? "/no-tenant" : "/sign-in")
  }
  return ctx
}

/** For pages that need a permission: sends people without it back to Today. */
export async function requirePermission(permission: Permission) {
  const ctx = await requireContext()
  if (!ctx.can(permission)) redirect("/?denied=" + encodeURIComponent(permission))
  return ctx
}

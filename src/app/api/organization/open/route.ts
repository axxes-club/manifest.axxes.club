import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { and, eq, isNull, ne } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, schema } from "@/lib/db"
import { WORKSPACE_COOKIE } from "@/lib/context"

export async function GET(request: Request) {
  const tenant = new URL(request.url).searchParams.get("tenant")
  if (!tenant || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)) return NextResponse.json({ error: "Invalid organization." }, { status: 400 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Please sign in." }, { status: 401 })
  const [membership] = await db.select({ id: schema.tenantMemberships.id })
    .from(schema.tenantMemberships).innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
    .where(and(eq(schema.tenantMemberships.userId, session.user.id), eq(schema.tenantMemberships.tenantId, tenant), isNull(schema.tenantMemberships.deletedAt), isNull(schema.tenants.deletedAt), ne(schema.tenants.status, "suspended"), ne(schema.tenants.status, "cancelled"))).limit(1)
  if (!membership) return NextResponse.json({ error: "You do not have access to this organization." }, { status: 403 })
  const response = NextResponse.redirect(new URL("/", request.url))
  response.cookies.set(WORKSPACE_COOKIE, tenant, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 31536000 })
  return response
}

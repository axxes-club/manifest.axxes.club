import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

// A fast first gate: no session cookie means straight to sign-in, before any
// page renders. It only checks the cookie exists; requireContext() still
// validates the session and workspace on every page and action.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next()
  const url = new URL("/sign-in", request.url)
  const back = request.nextUrl.pathname + request.nextUrl.search
  if (back !== "/") url.searchParams.set("next", back)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!api/|_next/|sign-in|sign-out|no-tenant|favicon\\.ico|manifest\\.webmanifest|icon|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
}

"use client"

import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"

export function SignOut() {
  const router = useRouter()
  return (
    <button
      className="text-xs text-muted hover:text-text"
      onClick={async () => {
        await authClient.signOut()
        router.replace("/sign-in")
      }}
    >
      Sign out
    </button>
  )
}

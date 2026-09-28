import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db, schema } from "@/lib/db"

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")

// Shares the user/session/account tables with members.axxes.club, so every
// AXXES account can sign in here with the same credentials.
export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [baseURL, ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : [])],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
})

import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

config({ path: ".env.local" })

// Manifest shares the AXXES database with members.axxes.club, which owns every
// other table. Only manifest_* tables are generated or migrated from here.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/manifest/index.ts",
  out: "./drizzle",
  tablesFilter: ["manifest_*"],
  migrations: { table: "__manifest_migrations", schema: "public" },
  dbCredentials: { url: process.env.DATABASE_URL! },
})

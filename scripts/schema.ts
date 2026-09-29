import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { PGlite } from "@electric-sql/pglite"
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api"
import * as schema from "../src/lib/db/schema"

/**
 * Builds a fresh database for tests and local development: the shared AXXES
 * tables from their Drizzle definitions, then Manifest's own tables by running
 * the real migration files, exactly as production would.
 */
export async function applySchema(client: PGlite) {
  const shared = Object.fromEntries(Object.entries(schema).filter(([k]) => !k.startsWith("manifest") && k !== "VIRTUAL_LOCATION_KINDS"))
  for (const st of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(shared))) {
    try {
      await client.exec(st)
    } catch (e) {
      // The copied portal schema has a few FKs whose column types disagree
      // (uuid → text). They're members' tables, not ours; skip just those.
      if (!/foreign key constraint .* cannot be implemented/.test(String(e))) throw e
    }
  }
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (st.trim()) await client.exec(st)
    }
  }
}

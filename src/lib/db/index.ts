import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import pg from "pg"
import ws from "ws"
import * as schema from "./schema"

// The ledger needs interactive transactions and row locks, which the Neon HTTP
// driver can't do, so this uses the WebSocket pool. Node < 22 has no global
// WebSocket, so fall back to `ws` there.
if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws

// Placeholder keeps `next build` working when DATABASE_URL isn't set. Pools
// connect lazily, on the first query.
const url = process.env.DATABASE_URL || "postgresql://placeholder:placeholder@placeholder/placeholder"

// Neon endpoints speak WebSockets; Cloud SQL and local Postgres use pg.
const usesNeon = new URL(url).hostname.endsWith(".neon.tech")
const neonDb = () => drizzle(new NeonPool({ connectionString: url, max: 2 }), { schema })
const globalForDb = globalThis as unknown as { axxesPgPool?: pg.Pool }
function postgresDb() {
  const pool = globalForDb.axxesPgPool ??= new pg.Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  })
  if (pool.listenerCount("error") === 0) {
    pool.on("error", (error: NodeJS.ErrnoException) => {
      console.error("[db] PostgreSQL idle connection error", { code: error.code ?? "unknown" });
    });
  }
  return drizzlePg(pool, { schema })
}
export const db: ReturnType<typeof neonDb> = usesNeon
  ? neonDb()
  : postgresDb() as unknown as ReturnType<typeof neonDb>

/** Any database handle the domain layer can write through: the app pool, a transaction, or a test database. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export { schema }

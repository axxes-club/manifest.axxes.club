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

// A localhost URL means the local dev database (`npm run db:local`), which
// speaks plain Postgres rather than Neon's WebSocket protocol.
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)

const neonDb = () => drizzle(new NeonPool({ connectionString: url }), { schema })

export const db: ReturnType<typeof neonDb> = isLocal
  ? (drizzlePg(new pg.Pool({ connectionString: url, max: 4 }), { schema }) as unknown as ReturnType<typeof neonDb>)
  : neonDb()

/** Any database handle the domain layer can write through: the app pool, a transaction, or a test database. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export { schema }

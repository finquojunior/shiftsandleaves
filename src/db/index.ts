import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import postgres from "postgres";
import * as schema from "./schema";

// Supabase in production: DATABASE_URL is the transaction pooler (port 6543), which can't use prepared statements.
// Anything else (unset, a folder, memory://) runs PGlite, an in-process Postgres, for local dev and tests.
// Module scope so Fluid Compute reuses the connection across requests.
const url = process.env.DATABASE_URL || "./data/pglite"; // empty counts as unset
export const db: PostgresJsDatabase<typeof schema> = url.startsWith("postgres")
  ? drizzlePg(postgres(url, { prepare: false }), { schema })
  : (drizzleLite(url, { schema }) as unknown as PostgresJsDatabase<typeof schema>); // ponytail: same query API, one type keeps call sites simple
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** pass as `columns` on user queries: avatar bytes never leave the database except via /avatar/[id] */
export const noAvatar = { avatar: false } as const;
export { schema };

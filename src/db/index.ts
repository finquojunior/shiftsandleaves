import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

// ponytail: on Supabase swap to drizzle-orm/postgres-js with postgres(url, { prepare: false }) on the transaction pooler (port 6543).
// Keep the client at module scope so Fluid Compute reuses it across requests.
const client = createClient({ url: process.env.DATABASE_URL ?? "file:./data/app.db" });
export const db = drizzle(client, { schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** pass as `columns` on user queries: avatar bytes never leave the database except via /avatar/[id] */
export const noAvatar = { avatar: false } as const;
export { schema };

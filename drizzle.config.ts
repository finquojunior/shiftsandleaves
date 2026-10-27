import { defineConfig } from "drizzle-kit";

// same rule as src/db/index.ts: a postgres:// URL is Supabase, anything else is a local PGlite folder
const url = process.env.DATABASE_URL || "./data/pglite";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(url.startsWith("postgres") ? { dbCredentials: { url } } : { driver: "pglite", dbCredentials: { url } }),
});

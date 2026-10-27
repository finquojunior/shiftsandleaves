// one-off: wrap each weekday {start,end} into a slot list. Safe to re-run.
import { eq } from "drizzle-orm";
import { db, schema } from "./index";

async function main() {
  const users = await db.select().from(schema.users);
  for (const u of users) {
    const sched = u.schedule as unknown as ({ start: number; end: number } | { start: number; end: number }[])[];
    if (sched.length && !Array.isArray(sched[0])) {
      await db.update(schema.users).set({ schedule: sched.map((d) => [d as { start: number; end: number }]) }).where(eq(schema.users.id, u.id));
      console.log("converted", u.name);
    }
  }
  const reqs = await db.select().from(schema.requests);
  for (const r of reqs) {
    const p = r.payload as unknown as ({ start: number; end: number } | { start: number; end: number }[])[] | null;
    if (p && p.length && !Array.isArray(p[0])) {
      await db.update(schema.requests).set({ payload: p.map((d) => [d as { start: number; end: number }]) }).where(eq(schema.requests.id, r.id));
    }
  }
  console.log("done");
}
main();

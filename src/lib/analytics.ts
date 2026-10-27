import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LeaveType, RequestStatus } from "@/db/schema";
import { avatarUrl, effectiveDay, getAllUsers, getDayRows, getDepartments, type DayState } from "./data";
import { addDays, format, parseISO } from "date-fns";
import { dayWeight } from "./rules";

export type HistoryItem = { date: string; kind: "leave" | "wfh" | "hours" | "schedule"; label: string; status: RequestStatus; weight: number; late: boolean; over: boolean; requestId: number };
export type PersonStats = {
  id: number; name: string; color: string; avatar: string | null; department: string; role: string; remote: boolean; leftOn: string | null;
  casual: number; festive: number; sick: number; extended: number; wfh: number; hoursChanges: number; scheduleChanges: number; shortNotice: number; overThreshold: number;
  history: HistoryItem[];
};
export type Filters = { from: string; to: string; dept: number | null; users: number[]; status: "approved" | "all" };

export async function analytics(f: Filters) {
  const statuses: RequestStatus[] = f.status === "all" ? ["approved", "pending"] : ["approved"];
  const [users, depts, rows] = await Promise.all([getAllUsers(), getDepartments(), getDayRows(f.from, f.to, statuses)]);
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  // request-level flags (late, over threshold, notes) for the day rows we have
  const reqIds = [...new Set(rows.map((r) => r.requestId))];
  const reqs = reqIds.length ? await db.select().from(schema.requests).where(inArray(schema.requests.id, reqIds)) : [];
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  // schedule changes have no day rows: count by decision date
  const sched = await db
    .select()
    .from(schema.requests)
    .where(and(eq(schema.requests.kind, "schedule"), inArray(schema.requests.status, statuses), gte(schema.requests.createdAt, f.from), lte(schema.requests.createdAt, `${f.to}T23:59:59Z`)));

  const picked = users.filter((u) => (f.dept == null || u.departmentId === f.dept) && (f.users.length === 0 || f.users.includes(u.id)));
  const people: PersonStats[] = picked.map((u) => {
    const mine = rows.filter((r) => r.userId === u.id);
    const p: PersonStats = {
      id: u.id, name: u.name, color: u.color, avatar: avatarUrl(u), department: u.departmentId ? deptName.get(u.departmentId) ?? "—" : "—", role: u.role, remote: u.remote, leftOn: u.leftOn,
      casual: 0, festive: 0, sick: 0, extended: 0, wfh: 0, hoursChanges: 0, scheduleChanges: 0, shortNotice: 0, overThreshold: 0, history: [],
    };
    const seenReq = new Set<number>();
    for (const r of mine) {
      const req = reqById.get(r.requestId);
      const late = !!req?.isLate, over = !!req?.overThreshold;
      if (r.kind === "leave") {
        const w = dayWeight(r.half);
        p[r.leaveType as LeaveType] += w;
        p.history.push({ date: r.date, kind: "leave", label: `${r.leaveType} leave${r.half ? ` (${r.half} off)` : ""}`, status: r.status, weight: w, late, over, requestId: r.requestId });
      } else if (r.kind === "wfh") {
        p.wfh += 1;
        p.history.push({ date: r.date, kind: "wfh", label: "work from home", status: r.status, weight: 1, late, over, requestId: r.requestId });
      } else if (r.kind === "hours") {
        if (!seenReq.has(r.requestId)) { p.hoursChanges += 1; seenReq.add(r.requestId); }
        const existing = p.history.find((h) => h.requestId === r.requestId);
        const slot = `${String(Math.floor(r.start! / 60) % 24).padStart(2, "0")}:${String(r.start! % 60).padStart(2, "0")}–${String(Math.floor(r.end! / 60) % 24).padStart(2, "0")}:${String(r.end! % 60).padStart(2, "0")}`;
        if (existing) existing.label += ` · ${slot}`;
        else p.history.push({ date: r.date, kind: "hours", label: `hours changed to ${slot}`, status: r.status, weight: 0, late, over, requestId: r.requestId });
      }
    }
    // per-request counters
    const myReqs = reqs.filter((q) => q.userId === u.id);
    p.shortNotice = myReqs.filter((q) => q.isLate).length;
    p.overThreshold = myReqs.filter((q) => q.overThreshold).length;
    for (const sc of sched.filter((q) => q.userId === u.id)) {
      p.scheduleChanges += 1;
      const d1 = sc.payload?.[1]?.map((x) => `${String(Math.floor(x.start / 60) % 24).padStart(2, "0")}:${String(x.start % 60).padStart(2, "0")}–${String(Math.floor(x.end / 60) % 24).padStart(2, "0")}:${String(x.end % 60).padStart(2, "0")}`).join(" · ");
      p.history.push({ date: sc.createdAt.slice(0, 10), kind: "schedule", label: `default hours → ${d1 ?? ""}`, status: sc.status, weight: 0, late: false, over: false, requestId: sc.id });
    }
    p.history.sort((a, b) => a.date.localeCompare(b.date));
    return p;
  });

  const byDept = depts.map((d) => {
    const ps = people.filter((p) => p.department === d.name);
    const sum = (k: keyof PersonStats) => ps.reduce((a, p) => a + (p[k] as number), 0);
    return { id: d.id, name: d.name, people: ps.length, casual: sum("casual"), festive: sum("festive"), sick: sum("sick"), extended: sum("extended"), wfh: sum("wfh"), hoursChanges: sum("hoursChanges"), scheduleChanges: sum("scheduleChanges"), shortNotice: sum("shortNotice"), overThreshold: sum("overThreshold") };
  }).filter((d) => d.people > 0);

  // one person selected: their day-by-day state for a personal month calendar
  let personDays: { date: string; state: DayState | null }[] | null = null;
  if (f.users.length === 1) {
    const u = users.find((x) => x.id === f.users[0]);
    if (u) {
      personDays = [];
      const mine = rows.filter((r) => r.userId === u.id);
      for (let d = parseISO(f.from); format(d, "yyyy-MM-dd") <= f.to; d = addDays(d, 1)) {
        const ds = format(d, "yyyy-MM-dd");
        personDays.push({ date: ds, state: effectiveDay(u, ds, mine.filter((r) => r.date === ds)) });
      }
    }
  }

  return { people, byDept, depts, personDays, allUsers: users.map((u) => ({ id: u.id, name: u.name, departmentId: u.departmentId, leftOn: u.leftOn })) };
}

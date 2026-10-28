/**
 * End-to-end scenario suite. Drives the real server actions against an in-memory Postgres (PGlite).
 * Run: pnpm test:e2e
 * Each group reseeds the database. A FAIL means behaviour differs from the agreed spec.
 */
import { and, desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { seed } from "@/db/seed";
import { db, schema } from "@/db";
import { currentUser, setSession, verifyPassword } from "@/lib/auth";
import { cookies } from "next/headers";
import robots from "@/app/robots";
import { avatarUrl, effectiveDay, getAllUsers, getDayRows, getRequestDetail, getRequestsFor, coverageFor } from "@/lib/data";
import { analytics } from "@/lib/analytics";
import { login } from "@/actions/auth";
import { cancelRequest, decide, logDiscussion, markNotificationRead, markNotificationsRead, submitHours, submitLeave, submitReopen, submitSchedule, submitWfh, type Result } from "@/actions/requests";
import { dateRange } from "@/lib/time";
import { addFestiveDay, saveDepartment, saveSetting, saveUser } from "@/actions/admin";
import { changePassword, saveAvatar, updateTimezone } from "@/actions/profile";
import { GET as avatarGET } from "@/app/avatar/[id]/route";
import { passkeyLogin, passkeyLoginOptions, passkeyRegister, passkeyRegisterOptions, removePasskey } from "@/actions/passkeys";
import { createHash, generateKeyPairSync, randomBytes, sign as ecSign } from "node:crypto";

// ---------- tiny harness ----------
type Outcome = { group: string; name: string; ok: boolean; detail?: string };
const results: Outcome[] = [];
let group = "";
const check = (name: string, ok: boolean, detail?: string) => results.push({ group, name, ok, detail });
const ok = (name: string, r: Result | { ok: boolean; error?: string }) => check(name, r.ok, r.ok ? undefined : (r as { error: string }).error);
const fails = (name: string, r: Result | { ok: boolean; error?: string }, re?: RegExp) =>
  check(name, !r.ok && (!re || re.test((r as { error: string }).error)), r.ok ? "unexpectedly succeeded" : (r as { error: string }).error);
async function throws(name: string, fn: () => Promise<unknown>) {
  try { await fn(); check(name, false, "did not throw"); } catch { check(name, true); }
}
async function safe<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e) { check(name, false, `threw: ${String(e).slice(0, 160)}`); return undefined; }
}

const U = async (email: string) => (await db.query.users.findFirst({ where: eq(schema.users.email, email) }))!;
const as = async (who: string) => { const u = await U(`${who}@team.local`); await setSession(u); return u; };
const req = async (id: number) => (await db.query.requests.findFirst({ where: eq(schema.requests.id, id) }))!;
const lastNotes = async (who: string, n = 5) => db.query.notifications.findMany({ where: eq(schema.notifications.userId, (await U(`${who}@team.local`)).id), orderBy: desc(schema.notifications.id), limit: n });
const events = async (id: number) => db.select().from(schema.events).where(eq(schema.events.requestId, id));
const dayState = async (who: string, date: string) => {
  const u = await U(`${who}@team.local`);
  return effectiveDay(u, date, (await getDayRows(date, date)).filter((r) => r.userId === u.id));
};
const id = (r: Result) => (r.ok ? r.id : -1);
const leave = (leaveType: "casual" | "sick" | "festive" | "extended", dates: string[], extra: Partial<Parameters<typeof submitLeave>[0]> = {}) =>
  submitLeave({ leaveType, days: dates.map((date) => ({ date, half: null })), ...extra });
const approve = async (approver: string, rid: number, note?: string) => { await as(approver); return decide(rid, true, note); };
const day = (s: number, e: number) => Array.from({ length: 7 }, () => [{ start: s, end: e }]);

async function G(name: string, fn: () => Promise<void>) {
  group = name;
  await seed();
  try { await fn(); } catch (e) { check("group crashed", false, String(e).slice(0, 300)); }
}

// ---------- scenarios ----------
async function main() {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: "drizzle" });

  await G("01 Auth and passwords", async () => {
    const f = new FormData(); f.set("email", "mei@team.local"); f.set("password", "nope");
    check("wrong password rejected", (await login(null, f))?.error === "Wrong email or password");
    f.set("password", "password");
    await login(null, f).then(() => check("correct password logs in", false, "no redirect")).catch((e) => check("correct password logs in", String(e).includes("redirect")));
    const f2 = new FormData(); f2.set("email", "ravi@team.local"); f2.set("password", "password");
    check("former member cannot sign in", (await login(null, f2))?.error === "Wrong email or password");
    const f3 = new FormData(); f3.set("email", "  MEI@team.local "); f3.set("password", "password");
    await login(null, f3).then(() => check("email is case/space insensitive", false)).catch((e) => check("email is case/space insensitive", String(e).includes("redirect")));

    await as("mei");
    fails("short new password rejected", await changePassword("password", "short"), /8 characters/);
    fails("wrong current password rejected", await changePassword("bad", "newpass123"), /Current password/);
    ok("self password change", await changePassword("password", "newpass123"));
    check("new password stored", verifyPassword("newpass123", (await U("mei@team.local")).passwordHash));

    await as("admin");
    const mei = await U("mei@team.local");
    ok("admin resets password", await saveUser({ ...mei, password: "temp1234" }));
    check("reset forces change", (await U("mei@team.local")).mustChangePassword === true);
    await as("mei");
    ok("forced change needs no current password", await changePassword("", "brandnew1"));
    check("flag cleared after change", (await U("mei@team.local")).mustChangePassword === false);
  });

  await G("02 Casual leave lifecycle", async () => {
    await as("mei");
    const r = await leave("casual", ["2026-11-10"], { note: "errand" });
    ok("submit casual leave", r);
    check("request is pending", (await req(id(r))).status === "pending");
    check("HR notified", (await lastNotes("hr"))[0]?.title.includes("Mei Lin"));
    fails("duplicate day rejected", await leave("sick", ["2026-11-10"]), /already have leave/);
    await as("hr");
    fails("reject needs a reason", await decide(id(r), false, ""), /reason/);
    ok("HR approves", await decide(id(r), true));
    fails("cannot decide twice", await decide(id(r), true), /no longer pending/);
    check("requester notified", (await lastNotes("mei"))[0]?.title.includes("approved"));
    check("team broadcast", (await lastNotes("sara"))[0]?.title.includes("on leave"));
    check("approver not double-notified with broadcast", !(await lastNotes("hr"))[0]?.title.includes("on leave"));
    check("calendar shows off", (await dayState("mei", "2026-11-10"))?.kind === "off");
    check("activity has submitted + approved", (await events(id(r))).map((e) => e.action).join(",") === "submitted,approved");
  });

  await G("03 Casual quota and half days", async () => {
    await as("mei");
    ok("5 casual days in December", await leave("casual", ["2026-12-01", "2026-12-03", "2026-12-07", "2026-12-09", "2026-12-14"]));
    ok("half day brings it to 5.5", await submitLeave({ leaveType: "casual", days: [{ date: "2026-12-16", half: "am" }] }));
    ok("second half day brings it to 6", await submitLeave({ leaveType: "casual", days: [{ date: "2026-12-17", half: "pm" }] }));
    fails("a further half day exceeds 6", await submitLeave({ leaveType: "casual", days: [{ date: "2026-12-18", half: "am" }] }), /quota/i);
    ok("sick leave has no quota", await leave("sick", ["2026-12-21"]));
    ok("extended leave has no quota", await leave("extended", ["2026-12-28", "2026-12-29"], { note: "family" }));
    ok("casual quota resets next month", await leave("casual", ["2027-01-05"]));
    const half = await dayState("mei", "2026-12-16");
    check("half day keeps second half of shift", half?.kind === "half" && half.half === "am");
  });

  await G("04 Festive leave", async () => {
    await as("lucas");
    fails("no festive day in block", await leave("festive", ["2026-11-11", "2026-11-12"]), /at least one festive day/);
    fails("non-consecutive block", await leave("festive", ["2026-11-08", "2026-11-10"]), /consecutive/);
    ok("block around Diwali", await leave("festive", ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]));
    fails("7th festive day in a year", await leave("festive", ["2026-12-24", "2026-12-25", "2026-12-26"]), /Festive quota/);
    ok("exactly 6 days in a year", await leave("festive", ["2026-12-25", "2026-12-26"]));
    ok("next year's festival uses next year's quota", await leave("festive", ["2027-01-01"]));
    await as("tomasz");
    const cross = await leave("festive", ["2026-12-31", "2027-01-01"]);
    ok("block spanning new year accepted", cross);
    await as("tomasz");
    // 1 day already counted in 2027 for this block; 2027 should have 5 left
    const r2027 = await leave("festive", ["2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15", "2027-01-16"]);
    ok("cross-year block splits quota by calendar year (2027 has 5 left)", r2027);
  });

  await G("05 Extended leave and HR conversation", async () => {
    await as("mei");
    fails("needs a reason", await leave("extended", ["2026-11-16"]), /Tell HR/);
    fails("over a year in one request", await leave("extended", dateRange("2027-01-01", "2028-01-02"), { note: "x" }), /more than a year/);
    fails("not allowed in a monthly plan", await leave("extended", ["2026-11-16"], { note: "x", planMonth: "2026-11" }), /monthly plan/);
    const r = await leave("extended", ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"], { note: "family" });
    ok("extended leave submitted", r);
    await as("hr");
    fails("cannot approve before conversation", await decide(id(r), true), /conversation/);
    fails("conversation needs details", await logDiscussion(id(r), " "), /details/);
    await as("mei");
    fails("employee cannot log conversation", await logDiscussion(id(r), "call"), /can't handle/);
    await as("hr");
    ok("HR logs conversation", await logDiscussion(id(r), "Call Tue 3pm"));
    check("person notified about conversation", (await lastNotes("mei"))[0]?.title.includes("talk about"));
    ok("approve after conversation", await decide(id(r), true));
    const a = await analytics({ from: "2026-11-01", to: "2026-11-30", dept: null, users: [(await U("mei@team.local")).id], status: "approved" });
    check("analytics counts 5 extended, 0 casual", a.people[0].extended === 5 && a.people[0].casual === 0);
  });

  await G("06 Monthly plan, deadline and reopen", async () => {
    await as("mei");
    fails("plan must cover every full week", await leave("casual", ["2026-11-04"], { planMonth: "2026-11" }), /Every week/);
    fails("plan days must be inside the month", await leave("casual", ["2026-12-02", "2026-11-04"], { planMonth: "2026-11" }), /inside the month/);
    ok("valid November plan (one day per week)", await leave("casual", ["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"], { planMonth: "2026-11" }));
    fails("October deadline has passed", await leave("casual", ["2026-10-28"], { planMonth: "2026-10" }), /deadline/);
    const ro = await submitReopen("2026-10");
    ok("reopen requested", ro);
    fails("duplicate reopen blocked", await submitReopen("2026-10"), /pending/);
    await approve("hr", id(ro));
    await as("mei");
    ok("plan accepted after reopen", await leave("casual", ["2026-10-06", "2026-10-13", "2026-10-20"], { planMonth: "2026-10" }));

    // emergency change to an approved plan after the deadline (spec: allowed, goes to approval)
    const sara = await U("sara@team.local");
    const [old] = await db.insert(schema.requests).values({ userId: sara.id, kind: "leave", leaveType: "casual", status: "approved", planMonth: "2026-10" }).returning();
    await db.insert(schema.requestDays).values([{ requestId: old.id, date: "2026-10-07" }, { requestId: old.id, date: "2026-10-14" }, { requestId: old.id, date: "2026-10-21" }, { requestId: old.id, date: "2026-10-28" }]);
    await as("sara");
    ok("emergency edit of an approved plan after the deadline", await leave("casual", ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-29"], { planMonth: "2026-10", replaceId: old.id }));
  });

  await G("07 Department minimum and exceptions", async () => {
    // Engineering: Asha, Mei, Diego, Priya active, minimum 2
    await as("mei"); const a = await leave("casual", ["2026-11-17"]); await approve("hr", id(a));
    await as("priya"); ok("second person out still meets minimum", await leave("casual", ["2026-11-17"]));
    await as("diego");
    const b = await leave("casual", ["2026-11-17"]);
    fails("third person blocked below minimum", b, /minimum 2/);
    check("breach details returned", !b.ok && !!b.breaches?.length && b.breaches[0].remaining === 1);
    fails("blank exception reason still blocked", await leave("casual", ["2026-11-17"], { exceptionReason: "  " }), /minimum/);
    const ex = await leave("casual", ["2026-11-17"], { exceptionReason: "visa appointment" });
    ok("exception with a reason accepted", ex);
    check("flagged over threshold", (await req(id(ex))).overThreshold === true);
    ok("approved over threshold", await approve("hr", id(ex)));
    check("approval logged as over threshold", (await events(id(ex))).some((e) => e.action === "approved" && /over threshold/.test(e.detail ?? "")));
    ok("half days don't count against minimum", await (async () => { await as("asha".replace("asha", "admin")); return submitLeave({ leaveType: "casual", days: [{ date: "2026-11-17", half: "pm" }] }); })());

    // future joiner should not count as available staff before joining
    await as("admin");
    ok("add future joiner to Engineering", await saveUser({ name: "Nina New", email: "nina@team.local", role: "employee", departmentId: (await U("mei@team.local")).departmentId, timezone: "Asia/Kolkata", remote: false, color: "#000000", schedule: day(540, 1080), password: "temp1234", joinedOn: "2026-12-01" }));
    await as("mei"); await approve("hr", id(await (async () => { await as("mei"); return leave("casual", ["2026-11-24"]); })()));
    await as("priya"); await approve("hr", id(await (async () => { await as("priya"); return leave("casual", ["2026-11-24"]); })()));
    await as("diego");
    const cov = await coverageFor(await U("diego@team.local"), ["2026-11-24"]);
    fails("future joiner not counted as cover", await leave("casual", ["2026-11-24"]), /minimum/);
    check("coverage reports 1 left (Asha only)", cov[0]?.remaining === 1, `reported ${cov[0]?.remaining}`);
  });

  await G("08 Approval chain", async () => {
    await as("hr");
    const r = await leave("casual", ["2026-11-12"]);
    check("HR request goes to admin", (await lastNotes("admin"))[0]?.title.includes("Omar"));
    fails("HR cannot approve own request", await decide(id(r), true), /can't approve/);
    await as("mei"); fails("employee cannot approve", await decide(id(r), true), /can't approve/);
    ok("admin approves HR", await approve("admin", id(r)));

    await as("admin");
    const self = await leave("casual", ["2026-11-13"]);
    check("sole admin auto-approved", (await req(id(self))).status === "approved");
    check("auto-approval logged", (await events(id(self))).some((e) => e.action === "auto-approved"));

    ok("admin adds a second HR", await saveUser({ name: "Hal HR", email: "hal@team.local", role: "hr", departmentId: (await U("hr@team.local")).departmentId, timezone: "Asia/Kolkata", remote: false, color: "#000000", schedule: day(540, 1080), password: "temp1234" }));
    await as("hal");
    const h = await leave("casual", ["2026-11-19"]);
    await as("hr"); fails("HR cannot approve another HR", await decide(id(h), true), /can't approve/);
    check("HR inbox excludes other HR", !(await getRequestsFor(await U("hr@team.local"))).inbox.some((x) => x.id === id(h)));
    check("admin inbox includes HR request", (await getRequestsFor(await U("admin@team.local"))).inbox.some((x) => x.id === id(h)));
  });

  await G("09 No HR on the team", async () => {
    await as("admin");
    const omar = await U("hr@team.local");
    ok("HR leaves the company", await saveUser({ ...omar, leftOn: "2026-10-25" }));
    await as("mei");
    const r = await leave("casual", ["2026-11-10"]);
    check("employee request is not self-approved when no HR exists", (await req(id(r))).status === "pending", `status ${(await req(id(r))).status}`);
    check("admin sees it in their inbox", (await getRequestsFor(await U("admin@team.local"))).inbox.some((x) => x.id === id(r)));
  });

  await G("10 Editing approved and pending requests", async () => {
    await as("mei");
    const orig = await leave("casual", ["2026-11-10"]); await approve("hr", id(orig));
    await as("mei");
    const rep = await leave("casual", ["2026-11-12"], { replaceId: id(orig) });
    ok("edit creates replacement", rep);
    check("original still approved while pending", (await req(id(orig))).status === "approved");
    check("original day still off", (await dayState("mei", "2026-11-10"))?.kind === "off");
    await approve("hr", id(rep));
    check("original replaced after approval", (await req(id(orig))).status === "cancelled");
    check("old day back to working", (await dayState("mei", "2026-11-10"))?.kind === "work");
    check("new day off", (await dayState("mei", "2026-11-12"))?.kind === "off");
    check("single 'changed' broadcast", (await lastNotes("sara"))[0]?.title.includes("leave changed"));

    await as("mei");
    const o2 = await leave("casual", ["2026-11-19"]); await approve("hr", id(o2));
    await as("mei"); const r2 = await leave("casual", ["2026-11-20"], { replaceId: id(o2) });
    await as("hr"); await decide(id(r2), false, "keep it");
    check("rejected edit leaves original intact", (await req(id(o2))).status === "approved");

    await as("mei");
    const p = await leave("casual", ["2026-11-24"]);
    const p2 = await leave("casual", ["2026-11-25"], { replaceId: id(p) });
    check("editing a pending request cancels the old one", (await req(id(p))).status === "cancelled");
    await approve("hr", id(p2));
    const note = (await lastNotes("sara"))[0];
    check("approving an edited *pending* request is announced as a new leave, not a change", !!note && !note.title.includes("changed"), note?.title + " / " + note?.body);

    await as("priya");
    fails("cannot edit someone else's leave", await leave("casual", ["2026-11-26"], { replaceId: id(p2) }), /no longer open/);
  });

  await G("11 Cancelling", async () => {
    await as("mei");
    const r = await leave("casual", ["2026-11-10"]); await approve("hr", id(r));
    await as("hr"); fails("HR cannot cancel an employee's leave", await cancelRequest(id(r)), /Not yours/);
    await as("mei"); ok("owner cancels approved leave", await cancelRequest(id(r)));
    check("team told about cancellation", (await lastNotes("sara"))[0]?.title.includes("cancelled"));
    fails("cannot cancel twice", await cancelRequest(id(r)), /closed/);
    check("day back to working", (await dayState("mei", "2026-11-10"))?.kind === "work");
    await as("mei"); const p = await leave("casual", ["2026-11-11"]);
    await as("admin"); ok("admin can cancel anyone's", await cancelRequest(id(p)));
  });

  await G("12 Hours changes and split slots", async () => {
    await as("mei");
    fails("under 8 hours rejected", await submitHours({ date: "2026-11-10", slots: [{ start: 540, end: 840 }] }), /8 hours/);
    fails("split day rejected for in-office", await submitHours({ date: "2026-11-10", slots: [{ start: 540, end: 780 }, { start: 900, end: 1140 }] }), /remote/);
    ok("overnight shift accepted", await submitHours({ date: "2026-11-11", slots: [{ start: 1320, end: 1800 }] }));
    fails("second change same day rejected", await submitHours({ date: "2026-11-11", slots: [{ start: 600, end: 1140 }] }), /already have/);
    const lv = await leave("casual", ["2026-11-13"]);
    fails("no hours change on a leave day", await submitHours({ date: "2026-11-13", slots: [{ start: 600, end: 1140 }] }), /on leave/);
    void lv;
    await as("diego");
    fails("overlapping slots rejected", await submitHours({ date: "2026-11-10", slots: [{ start: 540, end: 900 }, { start: 840, end: 1200 }] }), /overlap/i);
    fails("slots wider than 24h rejected", await submitHours({ date: "2026-11-10", slots: [{ start: 60, end: 400 }, { start: 1380, end: 1700 }] }), /24 hours/);
    const pend = await submitHours({ date: "2026-11-20", slots: [{ start: 540, end: 1080 }] });
    await leave("casual", ["2026-11-21"]);
    fails("failed edit of a pending hours change", await submitHours({ date: "2026-11-21", slots: [{ start: 540, end: 1080 }], replaceId: id(pend) }), /on leave/);
    check("failed edit keeps the original pending", (await req(id(pend))).status === "pending");
    const sp = await submitHours({ date: "2026-11-10", slots: [{ start: 1020, end: 1260 }, { start: 540, end: 780 }] });
    ok("split day accepted for remote (unsorted input)", sp);
    await approve("hr", id(sp));
    const st = await dayState("diego", "2026-11-10");
    check("two sorted slots on the calendar", st?.kind === "work" && st.slots.length === 2 && st.slots[0].start === 540);
  });

  await G("13 Default hours (schedule) changes", async () => {
    await as("mei");
    fails("schedule needs 7 days", await submitSchedule({ schedule: day(600, 1140).slice(0, 6) }), /7 days/);
    fails("short day in schedule rejected", await submitSchedule({ schedule: [...day(600, 1140).slice(0, 6), [{ start: 600, end: 800 }]] }), /8 hours/);
    const r = await submitSchedule({ schedule: day(600, 1140), note: "later start" });
    ok("schedule change submitted", r);
    check("not applied before approval", (await U("mei@team.local")).schedule[1][0].start === 480);
    await approve("hr", id(r));
    check("applied after approval", (await U("mei@team.local")).schedule[1][0].start === 600);
    await as("diego");
    ok("remote split schedule", await submitSchedule({ schedule: Array.from({ length: 7 }, () => [{ start: 540, end: 780 }, { start: 1020, end: 1260 }]) }));
  });

  await G("14 Work from home", async () => {
    await as("diego"); fails("remote members can't request WFH", await submitWfh({ days: ["2026-11-10"] }), /remote/);
    await as("mei");
    fails("bad date rejected", await submitWfh({ days: ["10/11/2026"] }), /at least one/);
    const r = await submitWfh({ days: ["2026-11-11", "2026-11-12", "2026-11-11"] });
    ok("WFH submitted (duplicates collapsed)", r);
    check("two day rows stored", (await db.select().from(schema.requestDays).where(eq(schema.requestDays.requestId, id(r)))).length === 2);
    fails("duplicate WFH day rejected", await submitWfh({ days: ["2026-11-12"] }), /already/);
    await leave("casual", ["2026-11-13"]);
    fails("WFH on a leave day rejected", await submitWfh({ days: ["2026-11-13"] }), /on leave/);
    let s = await dayState("mei", "2026-11-11");
    check("pending WFH shown as pending", s?.kind === "work" && s.wfh === "pending");
    await approve("hr", id(r));
    s = await dayState("mei", "2026-11-11");
    check("approved WFH keeps hours, marked home", s?.kind === "work" && s.wfh === "yes" && s.slots[0].start === 480);
    check("broadcast says working from home", (await lastNotes("sara"))[0]?.title.includes("working from home"));
    await as("mei");
    fails("leave on an approved WFH day should be blocked or replace it", await leave("casual", ["2026-11-12"]), /home|already/);
  });

  await G("15 People management", async () => {
    const engId = (await U("mei@team.local")).departmentId!;
    await as("mei");
    const base = { role: "employee" as const, departmentId: engId, timezone: "Asia/Kolkata", remote: false, color: "#000000", schedule: day(540, 1080) };
    await throws("employee cannot manage people", () => saveUser({ ...base, name: "X", email: "x@team.local", password: "temp1234" }));
    await as("hr");
    fails("HR cannot create an admin", await saveUser({ ...base, role: "admin", name: "X", email: "x@team.local", password: "temp1234" }), /admin/);
    fails("unknown role rejected", await saveUser({ ...base, role: "owner" as never, name: "X", email: "x@team.local", password: "temp1234" }), /role/);
    const victim = await U("priya@team.local");
    await saveUser({ ...victim, passwordHash: "forged", mustChangePassword: false, avatar: "data:x", avatarVersion: 9 } as never);
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, victim.id) });
    check("extra fields from the client are ignored", after!.passwordHash === victim.passwordHash && after!.avatar === null && after!.avatarVersion === 0);
    ok("HR creates an employee", await saveUser({ ...base, name: "Xia", email: "xia@team.local", password: "temp1234", joinedOn: "2026-10-26" }));
    check("new member must change password", (await U("xia@team.local")).mustChangePassword);
    fails("new member needs a password", await saveUser({ ...base, name: "Y", email: "y@team.local" }), /password/);
    fails("split schedule rejected for in-office", await saveUser({ ...base, name: "Z", email: "z@team.local", password: "temp1234", schedule: Array.from({ length: 7 }, () => [{ start: 540, end: 780 }, { start: 900, end: 1140 }]) }), /remote/);
    const dup = await safe("duplicate email returns a message", () => saveUser({ ...base, name: "Dup", email: "mei@team.local", password: "temp1234" }));
    if (dup) fails("duplicate email returns a message", dup, /email/i);

    const admin = await U("admin@team.local");
    fails("HR cannot demote an admin", await saveUser({ ...admin, role: "employee" }), /admin/);
    fails("HR cannot reset an admin's password", await saveUser({ ...admin, password: "hacked123" }), /admin/);
    const hr = await U("hr@team.local");
    fails("cannot change own role", await saveUser({ ...hr, role: "employee" }), /own role/);
    fails("cannot mark yourself as former", await saveUser({ ...hr, leftOn: "2026-11-01" }), /yourself/);
    const sara = await U("sara@team.local");
    fails("leaving before joining rejected", await saveUser({ ...sara, joinedOn: "2026-10-01", leftOn: "2026-09-01" }), /before joining/);

    ok("notice period: leaving date in the future", await saveUser({ ...sara, leftOn: "2026-12-31" }));
    const f = new FormData(); f.set("email", "sara@team.local"); f.set("password", "password");
    await login(null, f).then((r) => check("can still sign in during notice period", false, r?.error)).catch((e) => check("can still sign in during notice period", String(e).includes("redirect")));
    await as("hr"); // signing in as Sara switched the session
    const cov = await coverageFor(await U("tomasz@team.local"), ["2026-11-10"]);
    check("still counted as staff during notice period", cov[0]?.remaining === 2, `remaining ${cov[0]?.remaining}`);

    ok("mark as left in the past", await saveUser({ ...(await U("sara@team.local")), leftOn: "2026-10-20" }));
    check("not on calendar after leaving", (await dayState("sara", "2026-10-21")) === null);
    check("still on calendar before leaving", (await dayState("sara", "2026-10-19")) !== null);
    check("record kept on file", !!(await U("sara@team.local")));
    ok("reinstate by clearing the date", await saveUser({ ...(await U("sara@team.local")), leftOn: null }));
    check("reinstated member active again", (await U("sara@team.local")).active === true);

    await as("hana");
    const early = await leave("casual", ["2026-10-15"]);
    fails("no leave before joining date", early, /employment|join/i);
    ok("HR edits department minimum", await (async () => { await as("hr"); return saveDepartment({ id: engId, name: "Engineering", minStaff: 3 }); })());
    fails("negative minimum rejected", await saveDepartment({ id: engId, name: "Engineering", minStaff: -1 }), /negative/);
  });

  await G("16 Settings", async () => {
    await as("mei"); await throws("employee cannot change settings", () => saveSetting("casual_quota", 10));
    await as("hr");
    ok("HR changes casual quota", await saveSetting("casual_quota", 4));
    fails("unknown setting rejected", await saveSetting("evil", 1), /Unknown/);
    fails("negative quota rejected", await saveSetting("casual_quota", -1), /./);
    fails("deadline day 40 rejected", await saveSetting("deadline_day", 40), /./);
    ok("HR adds festive day", await addFestiveDay("2026-11-20", "Test fest"));
    fails("festive day needs a name", await addFestiveDay("2026-11-21", " "), /required/);
    await saveSetting("casual_quota", 2);
    await as("mei");
    ok("2 casual days with quota 2", await leave("casual", ["2026-12-01", "2026-12-02"]));
    fails("3rd day over new quota", await leave("casual", ["2026-12-03"]), /quota/);
    ok("festive leave on newly added day", await leave("festive", ["2026-11-20"]));
    await as("hr");
    ok("deadline day 28 accepted", await saveSetting("deadline_day", 28));
    ok("half-hour short-notice threshold accepted", await saveSetting("late_hours", 0.5));
  });

  await G("17 Profile and notifications", async () => {
    await as("mei"); await leave("casual", ["2026-11-10"]); await approve("hr", (await db.query.requests.findFirst({ orderBy: desc(schema.requests.id) }))!.id);
    await as("hr"); await leave("casual", ["2026-11-11"]); // gives Mei nothing; ensure Mei has 2+ notes:
    await as("mei"); const x = await leave("casual", ["2026-11-12"]); await as("hr"); await decide(id(x), false, "no");
    await as("mei");
    fails("invalid timezone rejected", await updateTimezone("Mars/Base"), /Unknown/);
    ok("timezone updated", await updateTimezone("Europe/London"));
    check("stored", (await U("mei@team.local")).timezone === "Europe/London");
    const [first, second] = await lastNotes("mei", 50);
    await markNotificationRead(first.id);
    const after = await lastNotes("mei", 50);
    check("one notification marked read", after.find((n) => n.id === first.id)?.read === true && after.find((n) => n.id === second.id)?.read === false);
    await as("priya"); await markNotificationRead(second.id);
    check("can't mark someone else's notification", (await lastNotes("mei", 50)).find((n) => n.id === second.id)?.read === false);
    await as("mei"); await markNotificationsRead();
    check("mark all as read", (await lastNotes("mei", 50)).every((n) => n.read));

    const meiId = (await U("mei@team.local")).id;
    const pic = (id: number) => avatarGET(new Request("http://x"), { params: Promise.resolve({ id: String(id) }) });
    check("no avatar = no url", avatarUrl(await U("mei@team.local")) === null);
    ok("avatar saved", await saveAvatar(`data:image/jpeg;base64,${Buffer.from("jpegbytes").toString("base64")}`));
    const url = avatarUrl(await U("mei@team.local"));
    check("avatar url is versioned", url?.startsWith(`/avatar/${meiId}?v=`) === true);
    check("page data carries no avatar bytes", (await getAllUsers()).every((u) => !("avatar" in u)));
    const res = await pic(meiId);
    check("avatar served with long cache", res.status === 200 && res.headers.get("cache-control")?.includes("immutable") === true && (await res.text()) === "jpegbytes");
    check("missing avatar is 404", (await pic((await U("priya@team.local")).id)).status === 404);
    await saveAvatar(null);
    check("removed avatar = no url", avatarUrl(await U("mei@team.local")) === null);
  });

  await G("18 Analytics totals", async () => {
    await as("mei");
    const l = await submitLeave({ leaveType: "casual", days: [{ date: "2026-11-10", half: null }, { date: "2026-11-11", half: "am" }] });
    const w = await submitWfh({ days: ["2026-11-12"] });
    const h = await submitHours({ date: "2026-11-13", slots: [{ start: 600, end: 1140 }] });
    for (const r of [l, w, h]) await approve("hr", id(r));
    await as("mei"); await leave("sick", ["2026-11-20"]); // pending
    const mei = await U("mei@team.local");
    const a = await analytics({ from: "2026-11-01", to: "2026-11-30", dept: null, users: [mei.id], status: "approved" });
    const p = a.people[0];
    check("casual 1.5 days", p.casual === 1.5, String(p.casual));
    check("1 WFH day", p.wfh === 1);
    check("1 hours change", p.hoursChanges === 1);
    check("pending sick excluded when approved-only", p.sick === 0);
    const all = await analytics({ from: "2026-11-01", to: "2026-11-30", dept: null, users: [mei.id], status: "all" });
    check("pending sick included when asked", all.people[0].sick === 1);
    check("single person gets day-by-day calendar", all.personDays?.length === 30);
    const two = await analytics({ from: "2026-11-01", to: "2026-11-30", dept: null, users: [mei.id, (await U("priya@team.local")).id], status: "all" });
    check("two people: no personal calendar", two.personDays === null);
    const dept = await analytics({ from: "2026-11-01", to: "2026-11-30", dept: mei.departmentId, users: [], status: "approved" });
    check("department filter limits people", dept.people.every((x) => x.department === "Engineering"));
    const former = await analytics({ from: "2026-01-01", to: "2026-12-31", dept: null, users: [], status: "approved" });
    check("former members included in reports", former.people.some((x) => x.name === "Ravi Menon"));
  });

  await G("19 Security", async () => {
    const jar = await cookies();
    const signIn = async (email: string, password: string) => {
      const f = new FormData(); f.set("email", email); f.set("password", password);
      return login(null, f).then((r) => r?.error ?? "no redirect", (e) => (String(e).includes("redirect") ? "ok" : String(e)));
    };

    // sessions
    await as("mei");
    const good = jar.get("session")!.value;
    const [uid, , sig] = good.split(".");
    check("session cookie carries an expiry", good.split(".").length === 3);
    jar.set("session", `${uid}.${Date.now() - 1000}.${sig}`);
    check("expired session rejected", (await currentUser()) === null);
    jar.set("session", `${uid}.${good.split(".")[1]}.${"0".repeat(sig.length)}`);
    check("tampered session rejected", (await currentUser()) === null);
    jar.set("session", good.replace(/^\d+/, String((await U("admin@team.local")).id)));
    check("session can't be moved to another user", (await currentUser()) === null);
    jar.set("session", good);
    check("valid session accepted", (await currentUser())?.email === "mei@team.local");

    await as("admin"); await saveUser({ ...(await U("mei@team.local")), password: "reset1234" });
    jar.set("session", good);
    check("admin password reset signs the person out", (await currentUser()) === null);
    await as("mei"); ok("own password change", await changePassword("", "brandnew99"));
    check("own password change keeps you signed in", (await currentUser())?.email === "mei@team.local");

    // login lockout
    check("unknown email: generic error", (await signIn("nobody@team.local", "x")) === "Wrong email or password");
    for (let i = 0; i < 4; i++) await signIn("mei@team.local", "wrong");
    check("5th wrong password locks the account", /Too many attempts/.test(await signIn("mei@team.local", "wrong")));
    check("locked account refuses the right password", /Too many attempts/.test(await signIn("mei@team.local", "brandnew99")));
    await as("admin"); await saveUser({ ...(await U("mei@team.local")), password: "unlock1234" });
    check("admin password reset unlocks", (await signIn("mei@team.local", "unlock1234")) === "ok");
    for (let i = 0; i < 3; i++) await signIn("hr@team.local", "wrong");
    await signIn("hr@team.local", "password");
    check("successful sign-in clears the failure count", (await U("hr@team.local")).failedLogins === 0);

    // request privacy
    await as("mei");
    const r = await leave("extended", ["2026-12-01"], { note: "family medical reason" });
    check("owner sees own request detail", (await getRequestDetail(id(r), await U("mei@team.local")))?.note === "family medical reason");
    check("another employee can't open it", (await getRequestDetail(id(r), await U("diego@team.local"))) === null);
    check("HR can open it", (await getRequestDetail(id(r), await U("hr@team.local"))) !== null);

    check("robots.txt blocks every crawler", JSON.stringify(robots()) === JSON.stringify({ rules: { userAgent: "*", disallow: "/" } }));
  });

  await G("20 Passkeys", async () => {
    // software authenticator: an ES256 key and just enough CBOR to build what a phone or laptop would send
    const cbor = (v: unknown): Buffer => {
      const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
      if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
      if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
      if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
      const m = v as Map<unknown, unknown>;
      return Buffer.concat([head(5, m.size), ...[...m].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
    };
    const b64 = (b: Buffer) => b.toString("base64url");
    const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const credId = randomBytes(16);
    const rpHash = sha("localhost");
    const client = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin: "http://localhost:3000", crossOrigin: false }));
    const register = async () => {
      const opts = (await passkeyRegisterOptions())!;
      const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose]);
      const attestationObject = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return passkeyRegister({ id: b64(credId), rawId: b64(credId), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(client("webauthn.create", opts.challenge)), attestationObject: b64(attestationObject), transports: ["internal"] } });
    };
    let count = 0;
    const assertion = (challenge: string, key = privateKey) => {
      const authenticatorData = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, ++count])]);
      const cd = client("webauthn.get", challenge);
      const signature = ecSign("sha256", Buffer.concat([authenticatorData, sha(cd)]), key);
      return { id: b64(credId), rawId: b64(credId), type: "public-key" as const, clientExtensionResults: {}, response: { clientDataJSON: b64(cd), authenticatorData: b64(authenticatorData), signature: b64(signature) } };
    };
    const signInPk = async (make = assertion) => {
      const opts = await passkeyLoginOptions();
      if (!opts) return "off";
      try { return (await passkeyLogin(make(opts.challenge))).error; } catch (e) { return String(e).includes("redirect") ? "ok" : String(e); }
    };

    await as("mei");
    check("off by default: no registration options", (await passkeyRegisterOptions()) === null);
    check("off by default: no sign-in options", (await passkeyLoginOptions()) === null);
    await as("mei");
    await throws("employee can't turn passkeys on", () => saveSetting("passkeys", 1));
    await as("admin");
    ok("admin turns passkeys on", await saveSetting("passkeys", 1));

    await as("mei");
    ok("register a passkey", await register());
    const pk = await db.query.passkeys.findFirst({ where: eq(schema.passkeys.credentialId, b64(credId)) });
    check("stored against the right person", pk?.userId === (await U("mei@team.local")).id);
    await cookies().then((c) => c.delete("session"));
    check("sign in with it", (await signInPk()) === "ok");
    check("session belongs to the passkey owner", (await currentUser())?.email === "mei@team.local");
    check("counter and last-used recorded", (await db.query.passkeys.findFirst({ where: eq(schema.passkeys.id, pk!.id) }))?.lastUsedAt != null);
    check("someone else's key is rejected", (await signInPk((c) => assertion(c, generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey))) === "Couldn't verify that passkey");
    check("a reused challenge is rejected", await (async () => {
      const opts = (await passkeyLoginOptions())!;
      await passkeyLogin(assertion(opts.challenge)).catch(() => {});
      return (await passkeyLogin(assertion(opts.challenge)).catch(() => ({ error: "redirected" }))).error === "That took too long. Try again.";
    })());

    const wrong = new FormData(); wrong.set("email", "mei@team.local"); wrong.set("password", "wrong");
    for (let i = 0; i < 5; i++) await login(null, wrong);
    check("password lockout doesn't block the passkey", (await signInPk()) === "ok");
    check("and the passkey clears the lockout", (await U("mei@team.local")).lockedUntil === null);

    await as("diego");
    await removePasskey(pk!.id);
    check("can't remove someone else's passkey", (await db.query.passkeys.findMany({ where: eq(schema.passkeys.id, pk!.id) })).length === 1);

    await as("admin");
    ok("admin turns passkeys off", await saveSetting("passkeys", 0));
    check("off: sign-in blocked", (await signInPk()) === "off");
    await as("mei");
    check("off: registration blocked", (await passkeyRegisterOptions()) === null);
    await as("admin");
    await saveSetting("passkeys", 1);
    check("on again: saved passkey still works", (await signInPk()) === "ok");

    await as("admin"); await saveUser({ ...(await U("mei@team.local")), password: "reset12345" });
    check("admin password reset removes the person's passkeys", (await db.query.passkeys.findMany({ where: eq(schema.passkeys.userId, (await U("mei@team.local")).id) })).length === 0);
    check("removed passkey can't sign in", (await signInPk()) === "This passkey isn't registered here");
  });

  // ---------- report ----------
  const fail = results.filter((r) => !r.ok);
  let g = "";
  for (const r of results) {
    if (r.group !== g) { g = r.group; console.log(`\n${g}`); }
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  →  ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - fail.length}/${results.length} passed, ${fail.length} failed`);
  void and;
}
main();

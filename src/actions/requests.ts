"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, noAvatar, schema, type Tx } from "@/db";
import type { DaySlots, LeaveType, Request, Shift, User } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { coverageFor, getDayRows, getFestiveDays, getSettings, getUsers, type Coverage } from "@/lib/data";
import { approverRole, canApprove, dayWeight, employedOn, isLate, planWindowOpen, sortSlots, validateDay, weeksWithoutLeave } from "@/lib/rules";
import { fmtDate, hhmm, monthOf, shiftInstants, todayIn } from "@/lib/time";

// Each action reads everything it needs up front (in parallel), then writes in one transaction:
// few round-trips to the database, and a failure never leaves a request without its events or notifications.

export type Result = { ok: true; id: number } | { ok: false; error: string; breaches?: Coverage[] };
const fail = (error: string): Result => ({ ok: false, error });
const done = (id: number): Result => {
  revalidatePath("/", "layout");
  return { ok: true, id };
};

async function notify(tx: Tx, userIds: number[], title: string, body: string, href: string) {
  const ids = [...new Set(userIds)];
  if (ids.length) await tx.insert(schema.notifications).values(ids.map((userId) => ({ userId, title, body, href })));
}

/** HR approves employees; if there is no current HR, admins do. Only an admin with no other admin self-approves. Bug #1 */
function approvers(requester: User, current: User[]) {
  const all = current.filter((u) => u.id !== requester.id);
  const primary = all.filter((u) => u.role === approverRole(requester.role));
  return primary.length ? primary : all.filter((u) => u.role === "admin");
}

/** current: everyone signed in-able right now (getUsers), read before the transaction */
async function finalize(tx: Tx, req: Request, me: User, current: User[], title: string, body: string) {
  const apps = approvers(me, current);
  if (apps.length === 0) {
    // only reachable for an admin with no other admin
    const decided = { status: "approved" as const, approverId: me.id, decidedAt: new Date().toISOString() };
    await tx.update(schema.requests).set(decided).where(eq(schema.requests.id, req.id));
    await tx.insert(schema.events).values({ requestId: req.id, actorId: me.id, action: "auto-approved", detail: "No other admin to approve" });
    await applyAndBroadcast(tx, { ...req, ...decided }, me, me, current);
  } else {
    await notify(tx, apps.map((a) => a.id), `${me.name}: ${title}`, body, `/requests?open=${req.id}`);
  }
}

/** on approval: write schedule changes, tell everyone. */
async function applyAndBroadcast(tx: Tx, r: Request, owner: User, actor: User, current: User[]) {
  const [days, replaced] = await Promise.all([
    tx.select().from(schema.requestDays).where(eq(schema.requestDays.requestId, r.id)),
    r.replacesId ? tx.select().from(schema.requestDays).where(eq(schema.requestDays.requestId, r.replacesId)) : null,
  ]);
  const slotsText = (sl: { start: number; end: number }[]) => sortSlots(sl).map((x) => `${hhmm(x.start)}–${hhmm(x.end)}`).join(" · ");
  const describe = (ds: { date: string; half?: "am" | "pm" | null; start?: number | null; end?: number | null }[]) =>
    r.kind === "hours" && ds[0] ? `${fmtDate(ds[0].date)}: ${slotsText(ds.map((d) => ({ start: d.start!, end: d.end! })))}` : ds.map((d) => fmtDate(d.date) + (d.half ? ` (${d.half})` : "")).join(", ");
  if (r.replacesId) {
    await tx.update(schema.requests).set({ status: "cancelled" }).where(and(eq(schema.requests.id, r.replacesId), inArray(schema.requests.status, ["approved", "pending"])));
    await tx.insert(schema.events).values({ requestId: r.replacesId, actorId: actor.id, action: "replaced", detail: `Replaced by request #${r.id}` });
  }
  let body = "";
  if (replaced) {
    body = `Was ${describe(replaced)} → now ${describe(days)}`;
  } else if (r.kind === "schedule" && r.payload) {
    await tx.update(schema.users).set({ schedule: r.payload }).where(eq(schema.users.id, r.userId));
    body = `New default hours: ${slotsText(r.payload[1])} (${owner.timezone})`;
  } else if (r.kind === "leave") {
    body = `${r.leaveType} leave · ${days.map((d) => fmtDate(d.date) + (d.half ? ` (${d.half})` : "")).join(", ")}`;
  } else if (r.kind === "hours") {
    body = `${describe(days)} (${owner.timezone})`;
  } else if (r.kind === "wfh") {
    body = days.map((d) => fmtDate(d.date)).join(", ");
  } else return;
  const everyone = current.filter((u) => u.id !== r.userId && u.id !== actor.id);
  await notify(tx, everyone.map((u) => u.id), `${owner.name} · ${replaced ? (r.kind === "leave" ? "leave changed" : "hours changed") : r.kind === "leave" ? "on leave" : r.kind === "wfh" ? "working from home" : "hours changed"}`, body, `/?date=${days[0]?.date ?? todayIn(owner.timezone)}&view=day`);
}

/** status + audit event only; callers handle notifications */
async function closeRequest(tx: Tx, requestId: number, me: User, reason?: string) {
  await tx.update(schema.requests).set({ status: "cancelled" }).where(eq(schema.requests.id, requestId));
  await tx.insert(schema.events).values({ requestId, actorId: me.id, action: "cancelled", detail: reason });
}

const findRequest = (id: number) => db.query.requests.findFirst({ where: eq(schema.requests.id, id) });
const findUser = (id: number) => db.query.users.findFirst({ columns: noAvatar, where: eq(schema.users.id, id) });

export async function submitLeave(input: {
  leaveType: LeaveType;
  days: { date: string; half: "am" | "pm" | null }[];
  note?: string;
  planMonth?: string | null;
  replaceId?: number | null;
  exceptionReason?: string | null;
}): Promise<Result> {
  const me = await requireUser();
  const today = todayIn(me.timezone);
  const days = [...new Map(input.days.map((d) => [d.date, d])).values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) return fail("Pick at least one day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(days[0].date)) return fail("Bad date");

  if (input.leaveType === "extended") {
    if (!input.note?.trim()) return fail("Tell HR why you need extended leave; they'll set up a conversation");
    if (input.planMonth) return fail("Extended leave is requested on its own, not in a monthly plan");
  }
  const from = days[0].date, to = days[days.length - 1].date;
  const [s, mine, festive, old, reopened, coverage, current] = await Promise.all([
    getSettings(),
    getDayRows(`${from.slice(0, 4)}-01-01`, `${to.slice(0, 4)}-12-31`, undefined, me.id),
    input.leaveType === "festive" ? getFestiveDays() : [],
    input.replaceId ? findRequest(input.replaceId) : undefined,
    input.planMonth
      ? db.query.requests.findFirst({
          where: and(eq(schema.requests.userId, me.id), eq(schema.requests.kind, "reopen"), eq(schema.requests.planMonth, input.planMonth), eq(schema.requests.status, "approved")),
        })
      : undefined,
    // department coverage (full days only; ponytail: half-days count as present)
    coverageFor(me, days.filter((d) => !d.half).map((d) => d.date), input.replaceId ? [input.replaceId] : []),
    getUsers(),
  ]);
  const myRows = mine.filter((r) => r.kind === "leave" && r.requestId !== input.replaceId);

  for (const d of days) if (!employedOn(me, d.date)) return fail(`${fmtDate(d.date)} is outside your employment dates`); // bug #10
  for (const d of days) if (myRows.some((r) => r.date === d.date)) return fail(`You already have leave on ${fmtDate(d.date)}`);
  // bug #7: a full-day leave can't sit on a work-from-home day
  const wfhRows = mine.filter((r) => r.kind === "wfh");
  for (const d of days) if (!d.half && wfhRows.some((r) => r.date === d.date)) return fail(`You're working from home on ${fmtDate(d.date)}. Cancel that request first`);

  if (input.leaveType === "casual") {
    const months = new Set(days.map((d) => monthOf(d.date)));
    for (const m of months) {
      const used = myRows.filter((r) => r.leaveType === "casual" && r.date.startsWith(m)).reduce((a, r) => a + dayWeight(r.half), 0);
      const add = days.filter((d) => d.date.startsWith(m)).reduce((a, d) => a + dayWeight(d.half), 0);
      if (used + add > s.casual_quota) return fail(`Casual quota for ${m} is ${s.casual_quota} days; you'd be at ${used + add}`);
    }
  }
  if (input.leaveType === "festive") {
    // a block of consecutive days around a festival: must include at least one listed festive day
    const fest = new Set(festive.map((f) => f.date));
    if (!days.some((d) => fest.has(d.date))) return fail("Festive leave must include at least one festive day from the list");
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(`${days[i - 1].date}T00:00:00Z`).getTime(), cur = new Date(`${days[i].date}T00:00:00Z`).getTime();
      if (cur - prev !== 86400_000) return fail("Festive leave days must be consecutive (one block around the festival)");
    }
    const y = from.slice(0, 4);
    const used = myRows.filter((r) => r.leaveType === "festive" && r.date.startsWith(y)).reduce((a, r) => a + dayWeight(r.half), 0);
    const add = days.reduce((a, d) => a + dayWeight(d.half), 0);
    if (used + add > s.festive_quota) return fail(`Festive quota for ${y} is ${s.festive_quota} days`);
  }

  const editingApproved = old?.status === "approved";
  if (input.planMonth) {
    const m = input.planMonth;
    if (days.some((d) => !d.date.startsWith(m))) return fail("Monthly plan days must be inside the month");
    // emergency change to an already-approved plan is allowed after the deadline; it still needs approval. Bug #4
    if (!editingApproved && !planWindowOpen(today, m, s.deadline_day) && !reopened) return fail(`The deadline for ${m} (day ${s.deadline_day}) has passed. Request a reopen first.`);
    const leaveDates = new Set([...myRows.filter((r) => r.date.startsWith(m)).map((r) => r.date), ...days.map((d) => d.date)]);
    const missing = weeksWithoutLeave(m, leaveDates);
    if (missing.length) return fail(`Every week needs at least one leave day. Missing in week(s) of ${missing.map((d) => fmtDate(d, "d MMM")).join(", ")}`);
  }

  // Breach = block unless submitted as an exception.
  const breaches = coverage.filter((c) => c.breach);
  const exception = input.exceptionReason?.trim() ?? "";
  if (breaches.length && !exception) {
    return { ok: false, error: `${breaches[0].dept} would drop to ${breaches[0].remaining} (minimum ${breaches[0].min}) on ${fmtDate(breaches[0].date)}`, breaches };
  }

  const firstStart = shiftInstants(from, sortSlots(me.schedule[new Date(`${from}T00:00:00Z`).getUTCDay()])[0], me.timezone).start;
  const late = isLate(new Date(), firstStart, s.late_hours);

  if (input.replaceId && (!old || old.userId !== me.id || old.kind !== "leave" || !["approved", "pending"].includes(old.status))) return fail("The leave you're editing is no longer open");
  const over = breaches.length > 0;
  const id = await db.transaction(async (tx) => {
    if (old?.status === "pending") await closeRequest(tx, old.id, me, "Edited before approval"); // ponytail: pending edits just restart; approved ones wait for approval
    const [req] = await tx.insert(schema.requests).values({
      userId: me.id, kind: "leave", leaveType: input.leaveType, note: input.note, planMonth: input.planMonth ?? null, isLate: late,
      replacesId: editingApproved ? input.replaceId! : null, overThreshold: over, exceptionReason: over ? exception : null, // bug #8
    }).returning();
    await tx.insert(schema.requestDays).values(days.map((d) => ({ requestId: req.id, date: d.date, half: d.half })));
    const detail = [late ? "Short notice" : null, input.planMonth ? `Monthly plan ${input.planMonth}` : null, input.replaceId ? `Edit of request #${input.replaceId}` : null, over ? `Exception requested: ${exception}` : null].filter(Boolean).join(" · ");
    await tx.insert(schema.events).values({ requestId: req.id, actorId: me.id, action: "submitted", detail: detail || null });
    const label = `${input.leaveType} leave · ${days.length} day${days.length > 1 ? "s" : ""}${over ? " · over threshold" : ""}${input.leaveType === "extended" ? " · needs a conversation" : ""}`;
    await finalize(tx, req, me, current, label, `${fmtDate(from)}${from !== to ? ` → ${fmtDate(to)}` : ""}${late ? " · short notice" : ""}`);
    return req.id;
  });
  return done(id);
}

export async function submitHours(input: { date: string; slots: Shift[]; note?: string; replaceId?: number | null }): Promise<Result> {
  const me = await requireUser();
  const err = validateDay(input.slots, me.remote);
  if (err) return fail(err);
  const slots = sortSlots(input.slots);
  if (!employedOn(me, input.date)) return fail(`${fmtDate(input.date)} is outside your employment dates`);
  const [dayRows, old, s, current] = await Promise.all([
    getDayRows(input.date, input.date, undefined, me.id),
    input.replaceId ? findRequest(input.replaceId) : undefined,
    getSettings(),
    getUsers(),
  ]);
  const rows = dayRows.filter((r) => r.requestId !== input.replaceId);
  if (rows.some((r) => r.kind === "hours")) return fail("You already have an hours change for that day");
  if (rows.some((r) => r.kind === "leave" && !r.half)) return fail("You're on leave that day");
  if (input.replaceId && (!old || old.userId !== me.id || old.kind !== "hours" || !["approved", "pending"].includes(old.status))) return fail("The change you're editing is no longer open");
  const late = isLate(new Date(), shiftInstants(input.date, slots[0], me.timezone).start, s.late_hours);
  const id = await db.transaction(async (tx) => {
    if (old?.status === "pending") await closeRequest(tx, old.id, me, "Edited before approval");
    // bug #8: only approved originals are "replaced"
    const [req] = await tx.insert(schema.requests).values({ userId: me.id, kind: "hours", note: input.note, isLate: late, replacesId: old?.status === "approved" ? old.id : null }).returning();
    await tx.insert(schema.requestDays).values(slots.map((sl) => ({ requestId: req.id, date: input.date, start: sl.start, end: sl.end })));
    await tx.insert(schema.events).values({ requestId: req.id, actorId: me.id, action: "submitted", detail: [late ? "Short notice" : null, input.replaceId ? `Edit of request #${input.replaceId}` : null].filter(Boolean).join(" · ") || null });
    await finalize(tx, req, me, current, `hours change ${fmtDate(input.date)}`, `${slots.map((x) => `${hhmm(x.start)}–${hhmm(x.end)}`).join(" · ")} ${me.timezone}${late ? " · short notice" : ""}`);
    return req.id;
  });
  return done(id);
}

export async function submitSchedule(input: { schedule: DaySlots[]; note?: string }): Promise<Result> {
  const me = await requireUser();
  if (input.schedule.length !== 7) return fail("Need 7 days");
  for (const day of input.schedule) {
    const err = validateDay(day, me.remote);
    if (err) return fail(err);
  }
  const schedule = input.schedule.map(sortSlots);
  const current = await getUsers();
  const id = await db.transaction(async (tx) => {
    const [req] = await tx.insert(schema.requests).values({ userId: me.id, kind: "schedule", payload: schedule, note: input.note }).returning();
    await tx.insert(schema.events).values({ requestId: req.id, actorId: me.id, action: "submitted" });
    await finalize(tx, req, me, current, "default hours change", `${schedule[1].map((x) => `${hhmm(x.start)}–${hhmm(x.end)}`).join(" · ")} ${me.timezone}`);
    return req.id;
  });
  return done(id);
}

/** work from home: still working the usual hours, just not in the office. No quota. In-office people only. */
export async function submitWfh(input: { days: string[]; note?: string }): Promise<Result> {
  const me = await requireUser();
  if (me.remote) return fail("You're a remote member already");
  const days = [...new Set(input.days)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!days.length) return fail("Pick at least one day");
  for (const d of days) if (!employedOn(me, d)) return fail(`${fmtDate(d)} is outside your employment dates`);
  const [rows, s, current] = await Promise.all([getDayRows(days[0], days[days.length - 1], undefined, me.id), getSettings(), getUsers()]);
  for (const d of days) {
    if (rows.some((r) => r.date === d && r.kind === "wfh")) return fail(`You already have a work-from-home request for ${fmtDate(d)}`);
    if (rows.some((r) => r.date === d && r.kind === "leave" && !r.half)) return fail(`You're on leave on ${fmtDate(d)}`);
  }
  const late = isLate(new Date(), shiftInstants(days[0], sortSlots(me.schedule[new Date(`${days[0]}T00:00:00Z`).getUTCDay()])[0], me.timezone).start, s.late_hours);
  const from = days[0], to = days[days.length - 1];
  const id = await db.transaction(async (tx) => {
    const [req] = await tx.insert(schema.requests).values({ userId: me.id, kind: "wfh", note: input.note, isLate: late }).returning();
    await tx.insert(schema.requestDays).values(days.map((date) => ({ requestId: req.id, date })));
    await tx.insert(schema.events).values({ requestId: req.id, actorId: me.id, action: "submitted", detail: late ? "Short notice" : null });
    await finalize(tx, req, me, current, `work from home · ${days.length} day${days.length > 1 ? "s" : ""}`, `${fmtDate(from)}${from !== to ? ` → ${fmtDate(to)}` : ""}${late ? " · short notice" : ""}`);
    return req.id;
  });
  return done(id);
}

/** extended leave: HR/admin records that the conversation is set up (or has happened) before deciding */
export async function logDiscussion(requestId: number, note: string): Promise<Result> {
  const me = await requireUser();
  const r = await findRequest(requestId);
  if (!r || r.status !== "pending" || r.leaveType !== "extended") return fail("Only pending extended leave has a discussion step");
  const owner = (await findUser(r.userId))!;
  if (r.userId === me.id || !canApprove(me.role, owner.role)) return fail("You can't handle this request");
  if (!note.trim()) return fail("Add the meeting details or a summary");
  await db.transaction(async (tx) => {
    await tx.update(schema.requests).set({ discussedAt: new Date().toISOString() }).where(eq(schema.requests.id, requestId));
    await tx.insert(schema.events).values({ requestId, actorId: me.id, action: "discussion", detail: note.trim() });
    await notify(tx, [r.userId], `${me.name} wants to talk about your extended leave`, note.trim(), `/requests?open=${requestId}`);
  });
  return done(requestId);
}

export async function submitReopen(month: string): Promise<Result> {
  const me = await requireUser();
  const [existing, current] = await Promise.all([
    db.query.requests.findFirst({
      where: and(eq(schema.requests.userId, me.id), eq(schema.requests.kind, "reopen"), eq(schema.requests.planMonth, month), inArray(schema.requests.status, ["pending", "approved"])),
    }),
    getUsers(),
  ]);
  if (existing) return fail(existing.status === "approved" ? "Already reopened; submit your plan" : "Reopen request already pending");
  const id = await db.transaction(async (tx) => {
    const [req] = await tx.insert(schema.requests).values({ userId: me.id, kind: "reopen", planMonth: month }).returning();
    await tx.insert(schema.events).values({ requestId: req.id, actorId: me.id, action: "submitted" });
    await finalize(tx, req, me, current, `reopen plan window ${month}`, "Missed the deadline");
    return req.id;
  });
  return done(id);
}

export async function decide(requestId: number, approve: boolean, note?: string): Promise<Result> {
  const me = await requireUser();
  const r = await findRequest(requestId);
  if (!r || r.status !== "pending") return fail("Request is no longer pending");
  const [owner, days, current] = await Promise.all([findUser(r.userId), db.select().from(schema.requestDays).where(eq(schema.requestDays.requestId, requestId)), getUsers()]);
  if (!owner || r.userId === me.id || !canApprove(me.role, owner.role)) return fail("You can't approve this request");
  if (!approve && !note?.trim()) return fail("Give a reason for rejecting");
  if (approve && r.leaveType === "extended" && !r.discussedAt) return fail("Log the conversation with the person before approving extended leave");
  let detail = note?.trim() || null;
  let over = false;
  if (approve && r.kind === "leave") {
    const breaches = (await coverageFor(owner, days.filter((d) => !d.half).map((d) => d.date), [requestId, ...(r.replacesId ? [r.replacesId] : [])])).filter((c) => c.breach);
    if (breaches.length) {
      over = true;
      const where = breaches.map((b) => `${b.dept} ${b.remaining}/${b.min} on ${fmtDate(b.date, "d MMM")}`).join(", ");
      detail = `Approved over threshold (${where})${detail ? ` · ${detail}` : ""}`;
    }
  }
  const decided = { status: approve ? ("approved" as const) : ("rejected" as const), approverId: me.id, decisionNote: note ?? null, decidedAt: new Date().toISOString(), ...(over ? { overThreshold: true } : {}) };
  const ok = await db.transaction(async (tx) => {
    // only one approver wins if two decide at once
    const won = await tx.update(schema.requests).set(decided).where(and(eq(schema.requests.id, requestId), eq(schema.requests.status, "pending"))).returning({ id: schema.requests.id });
    if (!won.length) return false;
    await tx.insert(schema.events).values({ requestId, actorId: me.id, action: approve ? "approved" : "rejected", detail });
    await notify(tx, [r.userId], `Request #${requestId} ${approve ? "approved" : "rejected"}`, note?.trim() || `by ${me.name}`, `/requests?open=${requestId}`);
    if (approve) await applyAndBroadcast(tx, { ...r, ...decided }, owner, me, current);
    return true;
  });
  return ok ? done(requestId) : fail("Request is no longer pending");
}

export async function cancelRequest(requestId: number, reason?: string): Promise<Result> {
  const me = await requireUser();
  const r = await findRequest(requestId);
  if (!r) return fail("Not found");
  if (r.userId !== me.id && me.role !== "admin") return fail("Not yours");
  if (r.status === "cancelled" || r.status === "rejected") return fail("Already closed");
  const wasApproved = r.status === "approved";
  const [others, days] = wasApproved
    ? await Promise.all([getUsers(), db.select().from(schema.requestDays).where(eq(schema.requestDays.requestId, requestId))])
    : [[], []];
  await db.transaction(async (tx) => {
    await closeRequest(tx, requestId, me, reason);
    if (wasApproved) await notify(tx, others.filter((u) => u.id !== me.id).map((u) => u.id), `${me.name} cancelled a ${r.kind}`, days.map((d) => fmtDate(d.date)).join(", "), `/requests?open=${requestId}`);
  });
  return done(requestId);
}

/** mark one of my notifications read (scoped to the signed-in user) */
export async function markNotificationRead(notificationId: number) {
  const me = await requireUser();
  await db.update(schema.notifications).set({ read: true }).where(and(eq(schema.notifications.id, notificationId), eq(schema.notifications.userId, me.id)));
  revalidatePath("/", "layout");
}

export async function markNotificationsRead() {
  const me = await requireUser();
  await db.update(schema.notifications).set({ read: true }).where(and(eq(schema.notifications.userId, me.id), eq(schema.notifications.read, false)));
  revalidatePath("/", "layout");
}

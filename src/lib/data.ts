import "server-only";
import { and, eq, gte, inArray, lte, ne, desc } from "drizzle-orm";
import { db, noAvatar, schema } from "@/db";
import type { LeaveType, RequestKind, RequestStatus, Shift, User } from "@/db/schema";
import { employedOn, isCurrent, sortSlots } from "./rules";

export async function getSettings() {
  const rows = await db.select().from(schema.settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, number>;
}

export const getUsers = async () => (await getAllUsers()).filter((u) => isCurrent(u));
/** everyone, former members included */
export const getAllUsers = () => db.query.users.findMany({ columns: noAvatar, orderBy: schema.users.name });

/** browser-cacheable avatar link; the version changes on every upload */
export const avatarUrl = (u: Pick<User, "id" | "avatarVersion">) => (u.avatarVersion ? `/avatar/${u.id}?v=${u.avatarVersion}` : null);

export const getDepartments = () => db.select().from(schema.departments).orderBy(schema.departments.name);

export type DayRow = {
  requestId: number;
  userId: number;
  kind: RequestKind;
  leaveType: LeaveType | null;
  status: RequestStatus;
  date: string;
  half: "am" | "pm" | null;
  start: number | null;
  end: number | null;
};

/** approved + pending day rows in a date range, optionally for one person */
export async function getDayRows(from: string, to: string, statuses: RequestStatus[] = ["approved", "pending"], userId?: number) {
  const rows = await db
    .select({
      requestId: schema.requests.id,
      userId: schema.requests.userId,
      kind: schema.requests.kind,
      leaveType: schema.requests.leaveType,
      status: schema.requests.status,
      date: schema.requestDays.date,
      half: schema.requestDays.half,
      start: schema.requestDays.start,
      end: schema.requestDays.end,
    })
    .from(schema.requestDays)
    .innerJoin(schema.requests, eq(schema.requestDays.requestId, schema.requests.id))
    .where(and(gte(schema.requestDays.date, from), lte(schema.requestDays.date, to), inArray(schema.requests.status, statuses), userId === undefined ? undefined : eq(schema.requests.userId, userId)));
  return rows as DayRow[];
}

export type Wfh = "no" | "pending" | "yes";
export type DayState =
  | { kind: "off"; leaveType: LeaveType; pending: boolean }
  | { kind: "half"; half: "am" | "pm"; leaveType: LeaveType; slots: Shift[]; pending: boolean; wfh: Wfh }
  | { kind: "work"; slots: Shift[]; overridden: boolean; pending: boolean; wfh: Wfh };

/** what a person is doing on a date, given their day rows for that date. approved rows win over pending. null = not employed that day. */
export function effectiveDay(user: User, date: string, rows: DayRow[]): DayState | null {
  if (!employedOn(user, date)) return null;
  const base = user.schedule[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const pick = (k: RequestKind) => {
    const approved = rows.filter((r) => r.kind === k && r.status === "approved");
    return approved.length ? approved : rows.filter((r) => r.kind === k && r.status === "pending");
  };
  const leave = pick("leave")[0];
  const hours = pick("hours");
  const w = pick("wfh")[0];
  const wfh: Wfh = !w ? "no" : w.status === "approved" ? "yes" : "pending";
  const slots = hours.length ? sortSlots(hours.map((h) => ({ start: h.start!, end: h.end! }))) : base;
  if (leave) {
    const pending = leave.status === "pending";
    if (leave.half) return { kind: "half", half: leave.half, leaveType: leave.leaveType!, slots, pending, wfh };
    return { kind: "off", leaveType: leave.leaveType!, pending };
  }
  return { kind: "work", slots, overridden: hours.length > 0, pending: hours[0]?.status === "pending", wfh };
}

export async function getRequestsFor(user: User) {
  const inboxFor = async () => {
    if (user.role === "employee") return [];
    const hrExists = (await db.query.users.findMany({ columns: noAvatar, where: eq(schema.users.role, "hr") })).some((u) => isCurrent(u));
    return db
      .select({ r: schema.requests })
      .from(schema.requests)
      .innerJoin(schema.users, eq(schema.requests.userId, schema.users.id))
      .where(
        and(
          eq(schema.requests.status, "pending"),
          ne(schema.requests.userId, user.id),
          // admins pick up employee requests when there is no current HR. Bug #1
          user.role === "hr" ? eq(schema.users.role, "employee") : hrExists ? ne(schema.users.role, "employee") : undefined,
        ),
      )
      .orderBy(desc(schema.requests.createdAt))
      .then((x) => x.map((y) => y.r));
  };
  const [mine, inbox] = await Promise.all([db.query.requests.findMany({ where: eq(schema.requests.userId, user.id), orderBy: desc(schema.requests.createdAt) }), inboxFor()]);
  const ids = [...mine, ...inbox].map((r) => r.id);
  const days = ids.length ? await db.select().from(schema.requestDays).where(inArray(schema.requestDays.requestId, ids)) : [];
  return { mine, inbox, days };
}

export type Coverage = { date: string; dept: string; remaining: number; min: number; breach: boolean };

/** department headcount left on each full-day date if this person is out, ignoring the given requests */
export async function coverageFor(user: { id: number; departmentId: number | null }, dates: string[], excludeRequestIds: number[] = []): Promise<Coverage[]> {
  if (!user.departmentId || !dates.length) return [];
  const sorted = [...dates].sort();
  const [dept, deptUsers, allRows] = await Promise.all([
    db.query.departments.findFirst({ where: eq(schema.departments.id, user.departmentId) }),
    db.query.users.findMany({ columns: noAvatar, where: and(eq(schema.users.departmentId, user.departmentId), eq(schema.users.active, true)) }),
    getDayRows(sorted[0], sorted[sorted.length - 1]),
  ]);
  if (!dept) return [];
  // everyone in the department who is employed on at least one of the dates; checked per date below
  const members = deptUsers.filter((m) => dates.some((d) => employedOn(m, d)));
  const memberIds = new Set(members.map((m) => m.id));
  const rows = allRows.filter(
    (r) => r.kind === "leave" && !r.half && memberIds.has(r.userId) && r.userId !== user.id && !excludeRequestIds.includes(r.requestId),
  );
  return sorted.map((date) => {
    const staff = members.filter((m) => m.id !== user.id && employedOn(m, date));
    const out = new Set(rows.filter((r) => r.date === date && staff.some((m) => m.id === r.userId)).map((r) => r.userId)).size;
    const remaining = staff.length - out;
    return { date, dept: dept.name, remaining, min: dept.minStaff, breach: remaining < dept.minStaff };
  });
}

/** notes, exception reasons and HR conversations are private: the owner, HR and admins only */
export async function getRequestDetail(id: number, viewer: Pick<User, "id" | "role">) {
  const r = await db.query.requests.findFirst({ where: eq(schema.requests.id, id) });
  if (!r || (r.userId !== viewer.id && viewer.role === "employee")) return null;
  const [days, evs, owner, replaces] = await Promise.all([
    db.select().from(schema.requestDays).where(eq(schema.requestDays.requestId, id)).orderBy(schema.requestDays.date),
    db
      .select({ e: schema.events, actor: schema.users.name })
      .from(schema.events)
      .innerJoin(schema.users, eq(schema.events.actorId, schema.users.id))
      .where(eq(schema.events.requestId, id))
      .orderBy(schema.events.createdAt),
    db.query.users.findFirst({ columns: noAvatar, where: eq(schema.users.id, r.userId) }),
    r.replacesId ? db.query.requests.findFirst({ where: eq(schema.requests.id, r.replacesId) }) : null,
  ]);
  const [coverage, replacesDays] = await Promise.all([
    r.kind === "leave" && r.status === "pending" && owner
      ? coverageFor(owner, days.filter((d) => !d.half).map((d) => d.date), [r.id, ...(r.replacesId ? [r.replacesId] : [])])
      : [],
    replaces ? db.select().from(schema.requestDays).where(eq(schema.requestDays.requestId, replaces.id)).orderBy(schema.requestDays.date) : [],
  ]);
  return { ...r, days, events: evs.map((x) => ({ ...x.e, actor: x.actor })), coverage, replaces: replaces ? { ...replaces, days: replacesDays } : null };
}

export const getNotifications = (userId: number) =>
  db.query.notifications.findMany({ where: eq(schema.notifications.userId, userId), orderBy: desc(schema.notifications.createdAt), limit: 30 });

/** for the profile dialog: no key material */
export const getPasskeys = (userId: number) =>
  db.query.passkeys.findMany({
    columns: { id: true, backedUp: true, createdAt: true, lastUsedAt: true },
    where: eq(schema.passkeys.userId, userId), orderBy: schema.passkeys.createdAt,
  });

export const getFestiveDays = () => db.select().from(schema.festiveDays).orderBy(schema.festiveDays.date);

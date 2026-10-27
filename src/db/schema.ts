import { pgTable, text, integer, doublePrecision, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Postgres (Supabase in production, PGlite locally). Dates stay ISO text so string comparisons in the app keep working.
// RLS is on with no policies: the app connects as the database owner, so Supabase's public Data API sees nothing.

const now = sql`to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const departments = pgTable("departments", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  minStaff: integer("min_staff").notNull().default(1),
}).enableRLS();

export type Role = "admin" | "hr" | "employee";

// weekly template: 7 entries (Sun..Sat). Each day is a list of slots {start,end} in minutes from local midnight;
// end may exceed 1440 (crosses midnight). More than one slot per day = split shift (remote people only).
export type Shift = { start: number; end: number };
export type DaySlots = Shift[];

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull().default("employee"),
  departmentId: integer("department_id").references(() => departments.id),
  timezone: text("timezone").notNull().default("UTC"),
  remote: boolean("remote").notNull().default(false),
  color: text("color").notNull().default("#6366f1"),
  avatar: text("avatar"), // ponytail: small JPEG data URL (~10KB), served by /avatar/[id] and never sent in page data; move to Supabase Storage when hosted
  avatarVersion: integer("avatar_version").notNull().default(0), // unix seconds of the last upload, 0 = none. Cache-busts /avatar/[id]
  schedule: jsonb("schedule").$type<DaySlots[]>().notNull(),
  active: boolean("active").notNull().default(true),
  joinedOn: text("joined_on"), // null = unknown (pre-dates the system)
  leftOn: text("left_on"), // set = former member; kept on file, cannot sign in
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  failedLogins: integer("failed_logins").notNull().default(0), // wrong passwords in a row; 5 locks the account
  lockedUntil: text("locked_until"), // ISO instant; sign-in refused until then
}, (t) => [index("users_department_idx").on(t.departmentId)]).enableRLS();

export type RequestKind = "leave" | "hours" | "schedule" | "reopen" | "wfh"; // wfh: working as usual, from home (in-office people only)
export type LeaveType = "casual" | "sick" | "festive" | "extended"; // extended: no quota, HR logs a conversation before approval
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export const requests = pgTable("requests", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  kind: text("kind").$type<RequestKind>().notNull(),
  leaveType: text("leave_type").$type<LeaveType>(),
  status: text("status").$type<RequestStatus>().notNull().default("pending"),
  note: text("note"),
  payload: jsonb("payload").$type<DaySlots[]>(), // kind=schedule: new weekly template
  discussedAt: text("discussed_at"), // extended leave: when HR logged the conversation
  planMonth: text("plan_month"), // YYYY-MM when this is a monthly plan or a reopen request
  isLate: boolean("is_late").notNull().default(false),
  replacesId: integer("replaces_id"), // edit of an approved request: original stays until this one is approved
  overThreshold: boolean("over_threshold").notNull().default(false),
  exceptionReason: text("exception_reason"),
  approverId: integer("approver_id").references(() => users.id),
  decisionNote: text("decision_note"),
  createdAt: text("created_at").notNull().default(now),
  decidedAt: text("decided_at"),
}, (t) => [index("requests_user_status_idx").on(t.userId, t.status)]).enableRLS();

// one row per affected date. leave: half in {am,pm,null}. hours: start/end override.
export const requestDays = pgTable("request_days", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  requestId: integer("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD in the user's timezone
  half: text("half").$type<"am" | "pm">(),
  start: integer("start"),
  end: integer("end"),
}, (t) => [index("request_days_date_idx").on(t.date), index("request_days_request_idx").on(t.requestId)]).enableRLS();

export const events = pgTable("events", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  requestId: integer("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").notNull().references(() => users.id),
  action: text("action").notNull(), // submitted | edited | approved | rejected | cancelled | auto-approved
  detail: text("detail"),
  createdAt: text("created_at").notNull().default(now),
}, (t) => [index("events_request_idx").on(t.requestId)]).enableRLS();

export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  read: boolean("read").notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
}, (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)]).enableRLS();

export const festiveDays = pgTable("festive_days", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  date: text("date").notNull().unique(),
  name: text("name").notNull(),
}).enableRLS();

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: doublePrecision("value").notNull(),
}).enableRLS();

/** avatar bytes stay out of user queries; pages link to /avatar/[id] instead */
export type User = Omit<typeof users.$inferSelect, "avatar">;
export type Department = typeof departments.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type RequestDay = typeof requestDays.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Notification = typeof notifications.$inferSelect;

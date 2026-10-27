"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DaySlots, Role } from "@/db/schema";
import { hashPassword, requireUser } from "@/lib/auth";
import { SETTING_RANGE, sortSlots, validateDay } from "@/lib/rules";

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

/** people management: admins and HR */
async function requirePeopleAdmin() {
  const me = await requireUser();
  if (me.role === "employee") throw new Error("HR or admins only");
  return me;
}

export async function saveUser(input: {
  id?: number; name: string; email: string; role: Role; departmentId: number | null; timezone: string; remote: boolean; color: string; schedule: DaySlots[]; password?: string;
  joinedOn?: string | null; leftOn?: string | null;
}): Promise<Result> {
  const me = await requirePeopleAdmin();
  if (!["admin", "hr", "employee"].includes(input.role)) return fail("Unknown role");
  if (me.role === "hr" && input.role === "admin") return fail("Only admins can grant the admin role");
  const existing = input.id ? await db.query.users.findFirst({ where: eq(schema.users.id, input.id) }) : null;
  if (input.id && !existing) return fail("Member not found");
  if (me.role === "hr" && existing?.role === "admin") return fail("Only admins can change an admin's account"); // bug #2
  if (input.id === me.id && input.role !== me.role) return fail("You can't change your own role");
  if (input.schedule.length !== 7) return fail("Need 7 days of hours");
  for (const day of input.schedule) {
    const err = validateDay(day, input.remote);
    if (err) return fail(err);
  }
  if (input.leftOn && input.joinedOn && input.leftOn < input.joinedOn) return fail("Leaving date is before joining date");
  if (input.id === me.id && input.leftOn) return fail("You can't mark yourself as a former member");
  // copy only the form's fields: the client can send anything (passwordHash, avatar, mustChangePassword...)
  const { id, password } = input;
  const rest = {
    name: input.name, email: input.email, role: input.role, departmentId: input.departmentId, timezone: input.timezone,
    remote: input.remote, color: input.color, schedule: input.schedule, joinedOn: input.joinedOn, leftOn: input.leftOn,
  };
  const email = rest.email.trim().toLowerCase();
  rest.schedule = rest.schedule.map(sortSlots);
  rest.joinedOn = rest.joinedOn || null;
  rest.leftOn = rest.leftOn || null;
  // bug #6: friendly message instead of a database error
  const clash = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (clash && clash.id !== id) return fail(`That email is already used by ${clash.name}`);
  const active = true; // former status comes from leftOn via isCurrent, so a notice period keeps access. Bug #3
  if (id) {
    await db.update(schema.users).set({ ...rest, email, active, ...(password ? { passwordHash: hashPassword(password), mustChangePassword: true } : {}) }).where(eq(schema.users.id, id));
  } else {
    if (!password) return fail("Temporary password required for a new member");
    await db.insert(schema.users).values({ ...rest, email, active, passwordHash: hashPassword(password), mustChangePassword: true });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveDepartment(input: { id?: number; name: string; minStaff: number }): Promise<Result> {
  await requirePeopleAdmin();
  if (input.minStaff < 0) return fail("Min staff can't be negative");
  if (input.id) await db.update(schema.departments).set({ name: input.name, minStaff: input.minStaff }).where(eq(schema.departments.id, input.id));
  else await db.insert(schema.departments).values({ name: input.name, minStaff: input.minStaff });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveSetting(key: string, value: number): Promise<Result> {
  await requirePeopleAdmin();
  const range = SETTING_RANGE[key];
  if (!range) return fail("Unknown setting");
  if (!Number.isFinite(value) || value < range[0] || value > range[1]) return fail(`Must be between ${range[0]} and ${range[1]}`); // bug #9
  await db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addFestiveDay(date: string, name: string): Promise<Result> {
  await requirePeopleAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name.trim()) return fail("Date and name required");
  await db.insert(schema.festiveDays).values({ date, name: name.trim() }).onConflictDoUpdate({ target: schema.festiveDays.date, set: { name: name.trim() } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeFestiveDay(id: number): Promise<Result> {
  await requirePeopleAdmin();
  await db.delete(schema.festiveDays).where(eq(schema.festiveDays.id, id));
  revalidatePath("/", "layout");
  return { ok: true };
}

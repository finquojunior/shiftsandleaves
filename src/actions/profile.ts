"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword, requireUser, setSession, verifyPassword } from "@/lib/auth";

type Result = { ok: true } | { ok: false; error: string };

export async function saveAvatar(dataUrl: string | null): Promise<Result> {
  const me = await requireUser();
  if (dataUrl !== null) {
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) return { ok: false, error: "Bad image" };
    if (dataUrl.length > 200_000) return { ok: false, error: "Image too large" };
  }
  await db.update(schema.users).set({ avatar: dataUrl, avatarVersion: dataUrl ? Math.floor(Date.now() / 1000) : 0 }).where(eq(schema.users.id, me.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateTimezone(timezone: string): Promise<Result> {
  const me = await requireUser();
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { return { ok: false, error: "Unknown timezone" }; }
  await db.update(schema.users).set({ timezone }).where(eq(schema.users.id, me.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePassword(current: string, next: string): Promise<Result> {
  const me = await requireUser();
  if (next.length < 8) return { ok: false, error: "New password needs at least 8 characters" };
  if (!me.mustChangePassword && !verifyPassword(current, me.passwordHash)) return { ok: false, error: "Current password is wrong" };
  const passwordHash = hashPassword(next);
  await db.update(schema.users).set({ passwordHash, mustChangePassword: false }).where(eq(schema.users.id, me.id));
  await setSession({ id: me.id, passwordHash }); // the new hash ends every other session; keep this one
  revalidatePath("/", "layout");
  return { ok: true };
}

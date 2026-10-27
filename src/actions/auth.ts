"use server";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { burnPasswordCheck, clearSession, setSession, verifyPassword } from "@/lib/auth";
import { isCurrent } from "@/lib/rules";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const WRONG = { error: "Wrong email or password" };

export async function login(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!u || !isCurrent(u)) {
    burnPasswordCheck(password);
    return WRONG;
  }
  // ponytail: per-account lock stops password guessing; add a Vercel Firewall rate limit if someone sprays many accounts
  if (u.lockedUntil && u.lockedUntil > new Date().toISOString()) return { error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` };
  if (!verifyPassword(password, u.passwordHash)) {
    const locks = u.failedLogins + 1 >= MAX_FAILS;
    await db
      .update(schema.users)
      .set(locks ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() } : { failedLogins: sql`${schema.users.failedLogins} + 1` })
      .where(eq(schema.users.id, u.id));
    return locks ? { error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` } : WRONG;
  }
  if (u.failedLogins || u.lockedUntil) await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  await setSession(u);
  redirect("/"); // shell opens the password dialog when mustChangePassword is set
}

export async function logout() {
  await clearSession();
  redirect("/login");
}

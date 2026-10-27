"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { clearSession, setSession, verifyPassword } from "@/lib/auth";
import { isCurrent } from "@/lib/rules";

export async function login(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!u || !isCurrent(u) || !verifyPassword(password, u.passwordHash)) return { error: "Wrong email or password" };
  await setSession(u.id);
  redirect("/"); // shell opens the password dialog when mustChangePassword is set
}

export async function logout() {
  await clearSession();
  redirect("/login");
}

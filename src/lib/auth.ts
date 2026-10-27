import { cache } from "react";
import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, noAvatar, schema } from "@/db";
import type { User } from "@/db/schema";
import { isCurrent } from "./rules";

// ponytail: signed cookie holding the user id. Swap for Supabase Auth when going hosted.
const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-me";
const COOKIE = "session";

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(scryptSync(pw, salt, 32), Buffer.from(hash, "hex"));
}

const sign = (id: number) => createHmac("sha256", SECRET).update(String(id)).digest("hex");

export async function setSession(userId: number) {
  (await cookies()).set(COOKIE, `${userId}.${sign(userId)}`, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

/** once per request: the layout and the page both ask */
export const currentUser = cache(async (): Promise<User | null> => {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || sig !== sign(Number(id))) return null;
  const u = await db.query.users.findFirst({ columns: noAvatar, where: eq(schema.users.id, Number(id)) });
  return u && isCurrent(u) ? u : null;
});

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new Error("Not signed in");
  return u;
}

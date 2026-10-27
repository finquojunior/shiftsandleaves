import { cache } from "react";
import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, noAvatar, schema } from "@/db";
import type { User } from "@/db/schema";
import { isCurrent } from "./rules";

// Signed cookie: "<user id>.<expiry ms>.<hmac>". The HMAC also covers the user's password hash, so changing or
// resetting a password signs that person out everywhere, and there is no session table to keep.
// empty counts as unset; production must set a real one or every session cookie would be forgeable
const SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev-secret-change-me");
const COOKIE = "session";
const MAX_AGE_DAYS = 30;

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(scryptSync(pw, salt, 32), Buffer.from(hash, "hex"));
}
let dummy: string | undefined;
/** same work as a real check, for unknown emails: response time doesn't reveal who has an account */
export const burnPasswordCheck = (pw: string) => verifyPassword(pw, (dummy ??= hashPassword("not-a-real-account")));

const sign = (id: number, exp: number, passwordHash: string) => {
  if (!SECRET) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", SECRET).update(`${id}.${exp}.${passwordHash}`).digest("hex");
};
const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function setSession(user: Pick<User, "id" | "passwordHash">) {
  const exp = Date.now() + MAX_AGE_DAYS * 86400_000;
  (await cookies()).set(COOKIE, `${user.id}.${exp}.${sign(user.id, exp, user.passwordHash)}`, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: MAX_AGE_DAYS * 86400,
  });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

/** once per request: the layout and the page both ask */
export const currentUser = cache(async (): Promise<User | null> => {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, exp, sig] = raw.split(".");
  if (!/^\d+$/.test(id ?? "") || !(Number(exp) > Date.now()) || !sig) return null;
  const u = await db.query.users.findFirst({ columns: noAvatar, where: eq(schema.users.id, Number(id)) });
  if (!u || !sameHex(sig, sign(u.id, Number(exp), u.passwordHash))) return null;
  return isCurrent(u) ? u : null;
});

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new Error("Not signed in");
  return u;
}

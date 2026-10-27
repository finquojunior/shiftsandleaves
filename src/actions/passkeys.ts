"use server";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db, schema } from "@/db";
import { mac, requireUser, sameHex, setSession } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { isCurrent } from "@/lib/rules";

type Result = { ok: true } | { ok: false; error: string };
const OFF = { ok: false, error: "Passkeys are turned off" } as const;
const CHALLENGE = "passkey_challenge";

const enabled = async () => (await getSettings()).passkeys === 1;

// ponytail: RP ID and origin come from the request's own host, so the same build works on localhost, the vercel.app URL
// and shifts.finquo.ai. A passkey is tied to the host it was made on; set a fixed RP ID here if the domain ever changes.
async function relyingParty() {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
}

/** the challenge rides in a signed 5-minute cookie, so there is no challenge table; it's single-use per browser */
async function putChallenge(challenge: string) {
  const exp = Date.now() + 5 * 60_000;
  (await cookies()).set(CHALLENGE, `${challenge}.${exp}.${mac(`passkey.${challenge}.${exp}`)}`, {
    httpOnly: true, sameSite: "strict", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 300,
  });
}
async function takeChallenge() {
  const jar = await cookies();
  const raw = jar.get(CHALLENGE)?.value ?? "";
  jar.delete(CHALLENGE);
  const [challenge, exp, sig] = raw.split(".");
  if (!challenge || !(Number(exp) > Date.now()) || !sig || !sameHex(sig, mac(`passkey.${challenge}.${exp}`))) return null;
  return challenge;
}

export async function passkeyRegisterOptions() {
  const me = await requireUser();
  if (!(await enabled())) return null;
  const existing = await db.query.passkeys.findMany({ where: eq(schema.passkeys.userId, me.id) });
  const { rpID } = await relyingParty();
  const options = await generateRegistrationOptions({
    rpName: "Shift & Leave", rpID, userName: me.email, userDisplayName: me.name,
    userID: new TextEncoder().encode(String(me.id)), // same id each time: re-adding on one device replaces, not duplicates
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports ?? undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await putChallenge(options.challenge);
  return options;
}

export async function passkeyRegister(response: RegistrationResponseJSON): Promise<Result> {
  const me = await requireUser();
  if (!(await enabled())) return OFF;
  const expectedChallenge = await takeChallenge();
  if (!expectedChallenge) return { ok: false, error: "That took too long. Try again." };
  const { rpID, origin } = await relyingParty();
  const v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID }).catch(() => null);
  if (!v?.verified) return { ok: false, error: "Couldn't verify that passkey" };
  const { credential, credentialBackedUp } = v.registrationInfo;
  await db.insert(schema.passkeys).values({
    userId: me.id, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter, transports: credential.transports ?? null, backedUp: credentialBackedUp,
  }).onConflictDoNothing();
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removePasskey(id: number): Promise<Result> {
  const me = await requireUser();
  await db.delete(schema.passkeys).where(and(eq(schema.passkeys.id, id), eq(schema.passkeys.userId, me.id)));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function passkeyLoginOptions() {
  if (!(await enabled())) return null;
  // no allowCredentials: the browser offers whichever passkeys it holds for this site, so no email is typed
  const options = await generateAuthenticationOptions({ rpID: (await relyingParty()).rpID, userVerification: "required" });
  await putChallenge(options.challenge);
  return options;
}

export async function passkeyLogin(response: AuthenticationResponseJSON): Promise<{ error: string }> {
  if (!(await enabled())) return { error: OFF.error };
  const expectedChallenge = await takeChallenge();
  if (!expectedChallenge) return { error: "That took too long. Try again." };
  const pk = await db.query.passkeys.findFirst({ where: eq(schema.passkeys.credentialId, response.id) });
  const u = pk && (await db.query.users.findFirst({ where: eq(schema.users.id, pk.userId) }));
  if (!pk || !u || !isCurrent(u)) return { error: "This passkey isn't registered here" };
  const { rpID, origin } = await relyingParty();
  const v = await verifyAuthenticationResponse({
    response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID,
    credential: { id: pk.credentialId, publicKey: Buffer.from(pk.publicKey, "base64url"), counter: pk.counter, transports: pk.transports ?? undefined },
  }).catch(() => null);
  if (!v?.verified) return { error: "Couldn't verify that passkey" };
  // a passkey proves the person, so it also clears a password lockout someone else may have caused
  await db.update(schema.passkeys).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() }).where(eq(schema.passkeys.id, pk.id));
  if (u.failedLogins || u.lockedUntil) await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  await setSession(u);
  redirect("/");
}

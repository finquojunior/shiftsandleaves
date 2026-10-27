"use client";
import { useActionState, useState, useTransition } from "react";
import { motion } from "motion/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { login } from "@/actions/auth";
import { passkeyLogin, passkeyLoginOptions } from "@/actions/passkeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarClock, Fingerprint } from "lucide-react";

export function LoginForm({ passkeys }: { passkeys: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  const [pkError, setPkError] = useState<string | null>(null);
  const [pkPending, startPk] = useTransition();
  const withPasskey = () => startPk(async () => {
    setPkError(null);
    const optionsJSON = await passkeyLoginOptions();
    if (!optionsJSON) return setPkError("Passkeys are turned off");
    let response;
    try { response = await startAuthentication({ optionsJSON }); } catch { return; } // cancelled
    const r = await passkeyLogin(response); // redirects on success
    setPkError(r.error);
  });
  const error = pkError ?? state?.error;
  return (
    <main className="flex-1 grid place-items-center p-6 grain">
      <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-[0_1px_2px_rgba(0,0,0,.04),0_12px_40px_-12px_rgba(0,0,0,.12)]">
        <div className="flex items-center gap-2 mb-6">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><CalendarClock className="size-5" /></span>
          <div>
            <h1 className="font-semibold leading-tight">Shift &amp; Leave</h1>
            <p className="text-xs text-muted-foreground">Sign in to your team</p>
          </div>
        </div>
        <form action={action} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-destructive">{error}</motion.p>}
          <Button type="submit" disabled={pending || pkPending} className="mt-1">{pending ? "Signing in…" : "Sign in"}</Button>
        </form>
        {passkeys && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            <Button variant="outline" className="w-full" disabled={pending || pkPending} onClick={withPasskey}><Fingerprint className="size-4" /> {pkPending ? "Waiting for passkey…" : "Sign in with a passkey"}</Button>
          </>
        )}
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
            Demo accounts: <code>admin@team.local</code>, <code>hr@team.local</code>, <code>mei@team.local</code> … password <code>password</code>
          </p>
        )}
      </motion.div>
    </main>
  );
}

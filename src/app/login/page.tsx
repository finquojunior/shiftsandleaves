"use client";
import { useActionState } from "react";
import { motion } from "motion/react";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarClock } from "lucide-react";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);
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
            <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@team.local" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {state?.error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-destructive">{state.error}</motion.p>}
          <Button type="submit" disabled={pending} className="mt-1">{pending ? "Signing in…" : "Sign in"}</Button>
        </form>
        <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
          Demo accounts: <code>admin@team.local</code>, <code>hr@team.local</code>, <code>mei@team.local</code> … password <code>password</code>
        </p>
      </motion.div>
    </main>
  );
}

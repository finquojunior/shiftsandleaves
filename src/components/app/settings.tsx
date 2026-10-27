"use client";
import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Fingerprint, PartyPopper, Trash2 } from "lucide-react";
import { addFestiveDay, removeFestiveDay, saveSetting } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fmtDate } from "@/lib/time";

const FIELDS = [
  { key: "deadline_day", label: "Monthly plan deadline", help: "Day of the month by which everyone submits that month's leaves." },
  { key: "casual_quota", label: "Casual leaves per month", help: "Includes weekly off-days. Half days count as 0.5." },
  { key: "festive_quota", label: "Festive leaves per year", help: "Only on the festive days listed." },
  { key: "late_hours", label: "Short-notice threshold (hours)", help: "Requests closer than this to the shift start are flagged." },
];

export function SettingsView({ settings, festive }: { settings: Record<string, number>; festive: { id: number; date: string; name: string }[] }) {
  const [vals, setVals] = useState(settings);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const save = (key: string) => start(async () => { const r = await saveSetting(key, vals[key]); if (r.ok) toast.success("Saved"); else toast.error(r.error); });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Rules</CardTitle><CardDescription>Applied when requests are submitted.</CardDescription></CardHeader>
        <CardContent className="grid gap-5">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid gap-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <div className="flex gap-2">
                <Input id={f.key} type="number" min={f.key === "deadline_day" ? 1 : 0} max={f.key === "deadline_day" ? 31 : undefined} value={vals[f.key] ?? 0} onChange={(e) => setVals({ ...vals, [f.key]: Number(e.target.value) })} className="w-28" />
                <Button variant="secondary" disabled={pending || vals[f.key] === settings[f.key]} onClick={() => save(f.key)}>Save</Button>
              </div>
              <p className="text-xs text-muted-foreground">{f.help}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Fingerprint className="size-4" /> Sign-in</CardTitle><CardDescription>Applies to everyone in the team.</CardDescription></CardHeader>
        <CardContent className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="passkeys">Passkeys</Label>
            <p className="text-xs text-muted-foreground">Let people add a passkey in their profile and sign in with Face ID, Touch ID, Windows Hello or their phone. Passwords keep working. Turning this off hides the option and blocks passkey sign-in; saved passkeys come back if you turn it on again.</p>
          </div>
          <Switch id="passkeys" checked={settings.passkeys === 1} disabled={pending} onCheckedChange={(on) => start(async () => { const r = await saveSetting("passkeys", on ? 1 : 0); if (r.ok) toast.success(on ? "Passkeys on" : "Passkeys off"); else toast.error(r.error); })} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><PartyPopper className="size-4" /> Festive days</CardTitle><CardDescription>Festive leave can only be taken on these dates.</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          <form className="flex flex-wrap gap-2 [&>input]:min-w-36 [&>input]:flex-1" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addFestiveDay(date, name); if (r.ok) { toast.success("Added"); setDate(""); setName(""); } else toast.error(r.error); }); }}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Button type="submit" disabled={pending}>Add</Button>
          </form>
          <ul className="grid gap-1">
            <AnimatePresence initial={false}>
              {festive.map((f) => (
                <motion.li key={f.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"><span className="w-28 tabular-nums text-muted-foreground">{fmtDate(f.date, "d MMM yyyy")}</span><span className="flex-1">{f.name}</span><Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => start(async () => { await removeFestiveDay(f.id); })}><Trash2 className="size-3.5" /></Button></div>
                </motion.li>
              ))}
            </AnimatePresence>
            {festive.length === 0 && <li className="text-sm text-muted-foreground">None yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

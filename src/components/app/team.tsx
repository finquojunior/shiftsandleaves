"use client";
import { useState, useTransition } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Archive, Globe, Building2, ChevronDown, Pencil, Plus, Sparkles, Users } from "lucide-react";
import type { DaySlots, Department, Role, User } from "@/db/schema";
import { saveDepartment, saveUser } from "@/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { hhmm } from "@/lib/time";
import { totalMinutes } from "@/lib/rules";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";
import { ScheduleEditor } from "./request-dialogs";

type U = Omit<User, "passwordHash"> & { passwordHash?: undefined; avatar: string | null };
const TZS = ["Asia/Kolkata", "Asia/Tokyo", "Asia/Singapore", "Asia/Dubai", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC"];
const COLORS = ["#7c3aed", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#64748b"];
const DOW = [1, 2, 3, 4, 5, 6, 0];
const slotsText = (sl: DaySlots) => sl.map((s) => `${hhmm(s.start)}–${hhmm(s.end)}`).join(" · ");
const sameAll = (sch: DaySlots[]) => sch.every((d) => JSON.stringify(d) === JSON.stringify(sch[0]));
const fmt = (d: string) => format(parseISO(d), "d MMM yyyy");

export function TeamView({ me, users, depts }: { me: { id: number; role: Role; timezone: string }; users: U[]; depts: Department[] }) {
  const [editUser, setEditUser] = useState<Partial<U> | null>(null);
  const [editDept, setEditDept] = useState<Partial<Department> | null>(null);
  const [showFormer, setShowFormer] = useState(false);
  const admin = me.role !== "employee"; // admins and HR manage people
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const isFormer = (u: U) => !!u.leftOn && u.leftOn < today;
  const current = users.filter((u) => !isFormer(u));
  const former = users.filter(isFormer);

  const Row = ({ u }: { u: U }) => {
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: u.timezone, hour: "2-digit", minute: "2-digit" }).format(now);
    const isNew = !u.leftOn && u.joinedOn && u.joinedOn >= format(new Date(now.getTime() - 30 * 86400_000), "yyyy-MM-dd");
    const future = !u.leftOn && u.joinedOn && u.joinedOn > today;
    return (
      <li className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[auto_1fr_auto_auto] sm:px-4", u.leftOn && "opacity-70")}>
        <UserAvatar user={u} className="size-9" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            {u.name}{u.id === me.id && <span className="text-xs text-muted-foreground">(you)</span>}
            <Badge variant="outline" className="capitalize">{u.role}</Badge>
            {u.remote && <Badge variant="secondary" className="gap-1"><Globe className="size-3" /> remote</Badge>}
            {u.schedule.some((d) => d.length > 1) && <Badge variant="secondary">split shift</Badge>}
            {future && <Badge className="gap-1 bg-sky-500/15 text-sky-700 dark:text-sky-300"><Sparkles className="size-3" /> joins {fmt(u.joinedOn!)}</Badge>}
            {isNew && !future && <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><Sparkles className="size-3" /> new</Badge>}
            {u.leftOn && <Badge variant="secondary" className="gap-1"><Archive className="size-3" /> {u.leftOn < today ? "left" : "leaving"} {fmt(u.leftOn)}</Badge>}
          </div>
          <div className="truncate text-xs text-muted-foreground">{u.email} · {u.timezone} · now {local}{u.joinedOn && ` · joined ${fmt(u.joinedOn)}`}</div>
        </div>
        <div className="col-span-3 text-sm tabular-nums sm:col-span-1 sm:text-right">
          {sameAll(u.schedule) ? <div>{slotsText(u.schedule[1])}</div> : <div className="flex flex-wrap gap-1 text-[10px] sm:justify-end">{DOW.map((i) => <span key={i} className="rounded bg-muted px-1 py-0.5">{slotsText(u.schedule[i])}</span>)}</div>}
          <div className="text-[11px] text-muted-foreground">{(totalMinutes(u.schedule[1]) / 60).toFixed(1)}h / day · local</div>
        </div>
        {admin && <Button size="icon-sm" variant="ghost" className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto" onClick={() => setEditUser(u)} aria-label="Edit member"><Pencil className="size-3.5" /></Button>}
      </li>
    );
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
        <span className="text-sm text-muted-foreground">{current.length} people · {depts.length} departments</span>
        {admin && <div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditDept({})}><Building2 className="size-4" /> <span className="hidden sm:inline">Department</span></Button><Button size="sm" onClick={() => setEditUser({})}><Plus className="size-4" /> <span className="hidden sm:inline">Member</span></Button></div>}
      </div>
      {depts.map((d, di) => {
        const members = current.filter((u) => u.departmentId === d.id);
        return (
          <motion.section key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: di * 0.06 }} className="rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <Building2 className="size-4 text-muted-foreground" />
              <h2 className="font-medium">{d.name}</h2>
              <Badge variant="secondary" className="gap-1"><Users className="size-3" /> {members.length}</Badge>
              <span className="text-xs text-muted-foreground">min {d.minStaff} on duty</span>
              {admin && <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={() => setEditDept(d)} aria-label="Edit department"><Pencil className="size-3.5" /></Button>}
            </div>
            <ul className="divide-y">
              {members.map((u) => <Row key={u.id} u={u} />)}
              {members.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No members yet.</li>}
            </ul>
          </motion.section>
        );
      })}
      {former.length > 0 && (
        <section className="rounded-2xl border border-dashed bg-card/60">
          <button type="button" onClick={() => setShowFormer((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
            <Archive className="size-4 text-muted-foreground" />
            <h2 className="font-medium">Former members</h2>
            <Badge variant="secondary">{former.length}</Badge>
            <span className="text-xs text-muted-foreground">kept on file · can&apos;t sign in</span>
            <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", showFormer && "rotate-180")} />
          </button>
          {showFormer && <ul className="divide-y border-t">{former.map((u) => <Row key={u.id} u={u} />)}</ul>}
        </section>
      )}
      {editUser && <MemberDialog initial={editUser} depts={depts} meId={me.id} onClose={() => setEditUser(null)} />}
      {editDept && <DeptDialog initial={editDept} onClose={() => setEditDept(null)} />}
    </div>
  );
}

function MemberDialog({ initial, depts, meId, onClose }: { initial: Partial<U>; depts: Department[]; meId: number; onClose: () => void }) {
  const [f, setF] = useState({
    name: initial.name ?? "", email: initial.email ?? "", role: (initial.role ?? "employee") as Role, departmentId: initial.departmentId ?? depts[0]?.id ?? null,
    timezone: initial.timezone ?? "Asia/Kolkata", remote: initial.remote ?? false, color: initial.color ?? COLORS[0],
    schedule: (initial.schedule ?? Array.from({ length: 7 }, () => [{ start: 540, end: 1080 }])) as DaySlots[], password: "",
    joinedOn: initial.joinedOn ?? (initial.id ? "" : format(new Date(), "yyyy-MM-dd")), leftOn: initial.leftOn ?? "",
  });
  const [pending, start] = useTransition();
  const submit = () => start(async () => {
    const r = await saveUser({ id: initial.id, ...f, password: f.password || undefined, joinedOn: f.joinedOn || null, leftOn: f.leftOn || null });
    if (r.ok) { toast.success(initial.id ? "Member updated" : "Member added"); onClose(); } else toast.error(r.error);
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{initial.id ? "Edit member" : "New member"}</DialogTitle><DialogDescription>Default hours are in the member&apos;s own timezone. A password set here is temporary: they must change it on next login.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Email</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Role</Label>
              <Select value={f.role} onValueChange={(v) => setF({ ...f, role: v as Role })} items={{ employee: "Employee", hr: "HR", admin: "Admin" }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="employee">Employee</SelectItem><SelectItem value="hr">HR</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>Department</Label>
              <Select value={String(f.departmentId)} onValueChange={(v) => setF({ ...f, departmentId: Number(v) })} items={Object.fromEntries(depts.map((d) => [String(d.id), d.name]))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{depts.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>Timezone</Label>
              <Select value={f.timezone} onValueChange={(v) => setF({ ...f, timezone: v ?? "UTC" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{TZS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>{initial.id ? "Reset password (blank = keep)" : "Temporary password"}</Label><Input type="text" autoComplete="off" placeholder={initial.id ? "Leave blank to keep" : "They change it on first login"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Joined on</Label><Input type="date" value={f.joinedOn} onChange={(e) => setF({ ...f, joinedOn: e.target.value })} /></div>
            {initial.id && initial.id !== meId && (
              <div className="grid gap-1.5"><Label>Leaving date <span className="font-normal text-muted-foreground">(former after this day)</span></Label><Input type="date" value={f.leftOn} onChange={(e) => setF({ ...f, leftOn: e.target.value })} /></div>
            )}
          </div>
          {f.leftOn && <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">They keep full access until {fmt(f.leftOn)}. After that they leave the calendar, can&apos;t sign in, and their history stays on file. Clear the date to reinstate.</p>}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2"><Switch checked={f.remote} onCheckedChange={(c) => setF({ ...f, remote: c, schedule: c ? f.schedule : f.schedule.map((d) => [{ start: d[0].start, end: Math.max(d[0].end, d[0].start + 480) }]) })} /><Label>Remote <span className="font-normal text-muted-foreground">(can split the day)</span></Label></div>
            <div className="ml-auto flex gap-1">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })} className="size-5 rounded-full ring-offset-2 ring-offset-background transition data-[on=true]:ring-2" data-on={f.color === c} style={{ background: c, ["--tw-ring-color" as string]: c }} />)}</div>
          </div>
          <ScheduleEditor value={f.schedule} onChange={(schedule) => setF({ ...f, schedule })} allowSplit={f.remote} />
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={submit}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeptDialog({ initial, onClose }: { initial: Partial<Department>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? "");
  const [min, setMin] = useState(initial.minStaff ?? 1);
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{initial.id ? "Edit department" : "New department"}</DialogTitle><DialogDescription>Leave requests that would leave fewer than the minimum on duty are blocked.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Minimum staff per day</Label><Input type="number" min={0} value={min} onChange={(e) => setMin(Number(e.target.value))} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={pending || !name} onClick={() => start(async () => { const r = await saveDepartment({ id: initial.id, name, minStaff: min }); if (r.ok) { toast.success("Saved"); onClose(); } else toast.error(r.error); })}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

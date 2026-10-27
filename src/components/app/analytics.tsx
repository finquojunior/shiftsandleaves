"use client";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { Download, Printer, Home, CalendarDays, Clock, RefreshCw, AlertTriangle, ShieldAlert, Archive, ChevronLeft, ChevronRight, Palmtree, Timer, Flag } from "lucide-react";
import type { Department } from "@/db/schema";
import type { Filters, PersonStats } from "@/lib/analytics";
import type { DayState } from "@/lib/data";
import { hhmm } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";

type DeptRow = { id: number; name: string; people: number; casual: number; festive: number; sick: number; extended: number; wfh: number; hoursChanges: number; scheduleChanges: number; shortNotice: number; overThreshold: number };
type Props = { filters: Filters; today: string; people: PersonStats[]; byDept: DeptRow[]; depts: Department[]; personDays: { date: string; state: DayState | null }[] | null; allUsers: { id: number; name: string; departmentId: number | null; leftOn: string | null }[] };

/** one colour per kind of event, used everywhere on this page */
export const TONE = {
  casual: { dot: "bg-amber-500", pill: "bg-amber-500/15 text-amber-800 dark:text-amber-200", soft: "bg-amber-500/10" },
  festive: { dot: "bg-pink-500", pill: "bg-pink-500/15 text-pink-800 dark:text-pink-200", soft: "bg-pink-500/10" },
  sick: { dot: "bg-teal-500", pill: "bg-teal-500/15 text-teal-800 dark:text-teal-200", soft: "bg-teal-500/10" },
  extended: { dot: "bg-purple-500", pill: "bg-purple-500/15 text-purple-800 dark:text-purple-200", soft: "bg-purple-500/10" },
  wfh: { dot: "bg-sky-500", pill: "bg-sky-500/15 text-sky-800 dark:text-sky-200", soft: "bg-sky-500/10" },
  hoursChanges: { dot: "bg-violet-500", pill: "bg-violet-500/15 text-violet-800 dark:text-violet-200", soft: "bg-violet-500/10" },
  scheduleChanges: { dot: "bg-indigo-500", pill: "bg-indigo-500/15 text-indigo-800 dark:text-indigo-200", soft: "bg-indigo-500/10" },
  shortNotice: { dot: "bg-orange-500", pill: "bg-orange-500/15 text-orange-800 dark:text-orange-200", soft: "bg-orange-500/10" },
  overThreshold: { dot: "bg-red-500", pill: "bg-red-500/15 text-red-800 dark:text-red-200", soft: "bg-red-500/10" },
  work: { dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-900 dark:text-emerald-100", soft: "bg-emerald-500/5" },
} as const;
type ToneKey = keyof typeof TONE;

const COLS: { key: keyof PersonStats & keyof DeptRow & ToneKey; label: string; short: string; help: string }[] = [
  { key: "casual", label: "Casual leave (days)", short: "Casual", help: "Casual leave days taken. Half days count as 0.5." },
  { key: "festive", label: "Festive leave (days)", short: "Festive", help: "Festive leave days taken around listed festivals." },
  { key: "sick", label: "Sick leave (days)", short: "Sick", help: "Sick leave days. No quota." },
  { key: "extended", label: "Extended leave (days)", short: "Extended", help: "Extended leave days, agreed after a conversation with HR. No quota." },
  { key: "wfh", label: "Work from home (days)", short: "WFH", help: "Days worked from home instead of the office." },
  { key: "hoursChanges", label: "Hours changed (requests)", short: "Hours changed", help: "Requests to work different hours on a specific day." },
  { key: "scheduleChanges", label: "Default hours changed (requests)", short: "Default hours changed", help: "Times the regular weekly hours were changed, applying from then on." },
  { key: "shortNotice", label: "Short notice (requests)", short: "Short notice", help: "Requests made closer to the shift than the short-notice threshold in Settings." },
  { key: "overThreshold", label: "Below minimum (approvals)", short: "Below minimum", help: "Leave approved even though the department dropped below its minimum staff." },
];

/** column header with its explanation on hover / focus */
function ColHead({ c }: { c: (typeof COLS)[number] }) {
  return (
    <TableHead className="text-right">
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} className="inline-flex cursor-help items-center gap-1.5 whitespace-nowrap underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />}>
          <span className={cn("size-1.5 rounded-full", TONE[c.key].dot)} />{c.short}
        </TooltipTrigger>
        <TooltipContent className="max-w-60 flex-col items-start gap-0.5 text-left">
          <div className="font-medium">{c.label}</div>
          <div className="opacity-80">{c.help}</div>
        </TooltipContent>
      </Tooltip>
    </TableHead>
  );
}
type StatKey = Exclude<ToneKey, "work">;
const MIX: StatKey[] = ["casual", "festive", "sick", "extended", "wfh"];

/** number cell: tinted pill when non-zero */
const Num = ({ v, k }: { v: number; k: ToneKey }) => (v === 0 ? <span className="text-muted-foreground/40">0</span> : <span className={cn("inline-block min-w-7 rounded-md px-1.5 py-0.5 text-center font-medium tabular-nums", TONE[k].pill)}>{fmtN(v)}</span>);

/** stacked bar of a person's leave + wfh days */
function MixBar({ p, max }: { p: PersonStats; max: number }) {
  const total = MIX.reduce((a, k) => a + (p[k] as number), 0);
  if (!total) return <div className="h-2 w-full rounded-full bg-muted" />;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" title={MIX.map((k) => `${k}: ${fmtN(p[k] as number)}`).join(" · ")}>
      {MIX.map((k) => (p[k] as number) > 0 && <span key={k} className={TONE[k].dot} style={{ width: `${((p[k] as number) / max) * 100}%` }} />)}
    </div>
  );
}
const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const kindIcon = { leave: CalendarDays, wfh: Home, hours: Clock, schedule: RefreshCw };

export function AnalyticsView({ filters, people, byDept, depts, allUsers, personDays, today }: Props) {
  const router = useRouter();
  const [f, setF] = useState(filters);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [printing, setPrinting] = useState(false);
  const apply = (next: Filters) => {
    setF(next);
    const q = new URLSearchParams({ from: next.from, to: next.to, status: next.status });
    if (next.dept != null) q.set("dept", String(next.dept));
    if (next.users.length) q.set("users", next.users.join(","));
    router.push(`/analytics?${q}`);
  };
  const totals = useMemo(() => Object.fromEntries(COLS.map((c) => [c.key, people.reduce((a, p) => a + (p[c.key] as number), 0)])) as Record<string, number>, [people]);
  const mixMax = Math.max(1, ...people.map((p) => MIX.reduce((a, k) => a + (p[k] as number), 0)));
  const pickable = allUsers.filter((u) => f.dept == null || u.departmentId === f.dept);
  const toggleUser = (id: number) => apply({ ...f, users: f.users.includes(id) ? f.users.filter((x) => x !== id) : [...f.users, id] });

  const print = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 150); };
  const csv = () => {
    const head = ["Name", "Department", "Role", ...COLS.map((c) => c.label)];
    const lines = people.map((p) => [p.name, p.department, p.role, ...COLS.map((c) => fmtN(p[c.key] as number))]);
    const hist = ["", "Name", "Date", "Type", "Detail", "Status"];
    const histLines = people.flatMap((p) => p.history.map((h) => ["", p.name, h.date, h.kind, h.label, h.status]));
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const body = [head, ...lines, [], hist, ...histLines].map((r) => r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = `team-report-${f.from}-to-${f.to}.csv`;
    a.click();
  };
  const title = `${format(parseISO(f.from), "d MMM yyyy")} – ${format(parseISO(f.to), "d MMM yyyy")}${f.dept != null ? ` · ${depts.find((d) => d.id === f.dept)?.name ?? "unknown department"}` : ""}${f.users.length ? ` · ${f.users.length} selected` : ""}${f.status === "all" ? " · incl. pending" : " · approved only"}`;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
        <div className="no-print ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={csv}><Download className="size-4" /> CSV</Button>
          <Button size="sm" onClick={print}><Printer className="size-4" /> Print report</Button>
        </div>
      </div>

      <div className="no-print grid gap-3 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5"><Label>From</Label><Input type="date" value={f.from} onChange={(e) => e.target.value && apply({ ...f, from: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>To</Label><Input type="date" value={f.to} onChange={(e) => e.target.value && apply({ ...f, to: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>Department</Label>
            <Select value={f.dept == null ? "all" : String(f.dept)} onValueChange={(v) => apply({ ...f, dept: v && v !== "all" ? Number(v) : null, users: [] })} items={{ all: "All departments", ...Object.fromEntries(depts.map((d) => [String(d.id), d.name])) }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All departments</SelectItem>{depts.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-1.5"><Switch checked={f.status === "all"} onCheckedChange={(c) => apply({ ...f, status: c ? "all" : "approved" })} /><Label>Include pending</Label></div>
        </div>
        <div className="grid gap-1.5">
          <Label>People <span className="font-normal text-muted-foreground">(none selected = everyone in the department)</span></Label>
          <div className="flex flex-wrap gap-1.5">
            {pickable.map((u) => (
              <button key={u.id} type="button" onClick={() => toggleUser(u.id)} className={cn("rounded-full border px-2.5 py-1 text-xs transition", f.users.includes(u.id) ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent", u.leftOn && "italic")}>{u.name}{u.leftOn && " (former)"}</button>
            ))}
            {f.users.length > 0 && <button type="button" onClick={() => apply({ ...f, users: [] })} className="px-2 text-xs text-muted-foreground underline-offset-2 hover:underline">clear</button>}
          </div>
        </div>
      </div>

      <StatCards totals={totals} people={people} />

      {personDays && people[0] && <PersonMonths person={people[0]} days={personDays} today={today} />}

      {byDept.length > 1 && (
        <section className="print-break overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-4 py-2.5 text-sm font-medium">By department</div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Department</TableHead><TableHead className="text-right">People</TableHead>{COLS.map((c) => <ColHead key={c.key} c={c} />)}</TableRow></TableHeader>
              <TableBody>
                {byDept.map((d) => <TableRow key={d.id}><TableCell className="font-medium">{d.name}</TableCell><TableCell className="text-right tabular-nums">{d.people}</TableCell>{COLS.map((c) => <TableCell key={c.key} className="text-right"><Num v={d[c.key] as number} k={c.key} /></TableCell>)}</TableRow>)}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-4 py-2.5 text-sm font-medium">By person <span className="text-xs font-normal text-muted-foreground">{people.length}</span>
          <button type="button" className="no-print ml-auto text-xs font-normal text-muted-foreground underline-offset-2 hover:underline" onClick={() => setOpen(open.size === people.length ? new Set() : new Set(people.map((p) => p.id)))}>{open.size === people.length ? "Collapse all" : "Expand all histories"}</button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Department</TableHead><TableHead className="w-28">Mix</TableHead>{COLS.map((c) => <ColHead key={c.key} c={c} />)}</TableRow></TableHeader>
            <TableBody>
              {people.map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>
                  <TableCell>
                    <div className="flex items-center gap-2"><UserAvatar user={p} className="size-7" textClass="text-[10px]" /><div><div className="font-medium">{p.name}{p.leftOn && <Archive className="ml-1 inline size-3 text-muted-foreground" />}</div><div className="text-[11px] text-muted-foreground capitalize">{p.role}{p.remote && " · remote"}</div></div></div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.department}</TableCell>
                  <TableCell><MixBar p={p} max={mixMax} /></TableCell>
                  {COLS.map((c) => <TableCell key={c.key} className="text-right"><Num v={p[c.key] as number} k={c.key} /></TableCell>)}
                </TableRow>
              ))}
              {people.length === 0 && <TableRow><TableCell colSpan={COLS.length + 3} className="py-8 text-center text-muted-foreground">Nobody matches these filters.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="grid gap-3">
        {people.filter((p) => printing || open.has(p.id)).map((p) => (
          <details key={p.id} open className={cn("print-break rounded-2xl border bg-card shadow-sm", printing && "print-open")}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium"><UserAvatar user={p} className="size-6" textClass="text-[9px]" />{p.name} <span className="text-xs font-normal text-muted-foreground">· {p.department} · {p.history.length} entries</span></summary>
            {p.history.length === 0 ? <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing in this period.</p> : (
              <ul className="divide-y border-t">
                {p.history.map((h, i) => { const Icon = kindIcon[h.kind]; return (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-sm">
                    <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{format(parseISO(h.date), "EEE d MMM yyyy")}</span>
                    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 capitalize", TONE[h.kind === "leave" ? (h.label.split(" ")[0] as ToneKey) : h.kind === "hours" ? "hoursChanges" : h.kind === "schedule" ? "scheduleChanges" : "wfh"]?.pill ?? "bg-muted")}><Icon className="size-3.5 shrink-0" />{h.label}</span>
                    {h.weight === 0.5 && <Badge variant="secondary">½ day</Badge>}
                    {h.late && <Badge variant="outline" className="gap-1 text-amber-600"><AlertTriangle className="size-3" /> short notice</Badge>}
                    {h.over && <Badge variant="outline" className="gap-1 text-red-600"><ShieldAlert className="size-3" /> over minimum</Badge>}
                    {h.status !== "approved" && <Badge variant="outline" className="capitalize">{h.status}</Badge>}
                  </li>
                ); })}
              </ul>
            )}
          </details>
        ))}
      </section>
    </div>
  );
}


/** one person's days, one month at a time, within the selected range */
function PersonMonths({ person, days, today }: { person: PersonStats; days: { date: string; state: DayState | null }[]; today: string }) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d.state])), [days]);
  const months = useMemo(() => [...new Set(days.map((d) => d.date.slice(0, 7)))], [days]);
  const [idx, setIdx] = useState(() => Math.max(0, months.indexOf(today.slice(0, 7))));
  const m = months[Math.min(idx, months.length - 1)];
  if (!m) return null;
  const first = parseISO(`${m}-01`);
  const cells = eachDayOfInterval({ start: startOfWeek(startOfMonth(first), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(first), { weekStartsOn: 1 }) });
  const inMonthDays = days.filter((d) => d.date.startsWith(m));
  const count = (pred: (s: DayState) => boolean) => inMonthDays.filter((d) => d.state && pred(d.state)).length;
  const summary = [
    { k: "casual" as ToneKey, v: count((s) => s.kind === "off" && s.leaveType === "casual") + count((s) => s.kind === "half" && s.leaveType === "casual") / 2 },
    { k: "festive" as ToneKey, v: count((s) => s.kind === "off" && s.leaveType === "festive") },
    { k: "sick" as ToneKey, v: count((s) => s.kind === "off" && s.leaveType === "sick") },
    { k: "extended" as ToneKey, v: count((s) => s.kind === "off" && s.leaveType === "extended") },
    { k: "wfh" as ToneKey, v: count((s) => s.kind !== "off" && s.wfh === "yes") },
    { k: "hoursChanges" as ToneKey, v: count((s) => s.kind === "work" && s.overridden) },
  ].filter((x) => x.v > 0);

  const cell = (s: DayState | null) => {
    if (!s) return { text: "—", cls: "text-muted-foreground/40" };
    if (s.kind === "off") return { text: `Off · ${s.leaveType}${s.pending ? " (pending)" : ""}`, cls: cn(TONE[s.leaveType].pill, s.pending && "border border-dashed opacity-70") };
    const hours = s.slots.map((x) => `${hhmm(x.start)}–${hhmm(x.end)}`).join(" · ");
    const tags = [s.kind === "half" ? `½ ${s.leaveType}` : null, s.wfh !== "no" ? `home${s.wfh === "pending" ? "?" : ""}` : null, s.kind === "work" && s.overridden ? "changed" : null].filter(Boolean).join(" · ");
    const tone = s.kind === "half" ? TONE[s.leaveType] : s.wfh !== "no" ? TONE.wfh : s.kind === "work" && s.overridden ? TONE.hoursChanges : TONE.work;
    return { text: hours + (tags ? ` · ${tags}` : ""), cls: cn(tone.pill, s.pending && "italic") };
  };

  return (
    <section className="print-break overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <UserAvatar user={person} className="size-6" textClass="text-[9px]" />
        <span className="text-sm font-medium">{person.name}&apos;s calendar</span>
        <span className="text-xs text-muted-foreground">in their own timezone</span>
        <div className="no-print ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon-sm" disabled={idx <= 0} onClick={() => setIdx((i) => i - 1)} aria-label="Previous month"><ChevronLeft className="size-4" /></Button>
          <span className="w-36 text-center text-sm font-medium">{format(first, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon-sm" disabled={idx >= months.length - 1} onClick={() => setIdx((i) => i + 1)} aria-label="Next month"><ChevronRight className="size-4" /></Button>
        </div>
        <span className="hidden text-sm font-medium print:inline">{format(first, "MMMM yyyy")}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b bg-muted/30 px-3 py-2 text-[11px]">
        {summary.length === 0 && <span className="text-muted-foreground">Nothing out of the ordinary this month.</span>}
        {summary.map((x) => <span key={x.k} className={cn("rounded-md px-1.5 py-0.5", TONE[x.k].pill)}>{fmtN(x.v)} {COLS.find((c) => c.key === x.k)?.short.toLowerCase()}</span>)}
      </div>
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[10px] text-muted-foreground">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="py-1">{w}</div>)}</div>
      <div className="grid grid-cols-7">
        {cells.map((c) => {
          const ds = format(c, "yyyy-MM-dd");
          const inMonth = isSameMonth(c, first);
          const l = inMonth && byDate.has(ds) ? cell(byDate.get(ds) ?? null) : null;
          return (
            <div key={ds} className={cn("min-h-16 border-b border-r p-1.5 text-[11px] leading-tight [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/30")}>
              <div className={cn("mb-1 inline-grid size-5 place-items-center rounded-full text-[11px] font-medium", ds === today && "bg-primary text-primary-foreground", !inMonth && "text-muted-foreground/60")}>{c.getDate()}</div>
              {l && <div className={cn("rounded-md px-1.5 py-1", l.cls)}>{l.text}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}


/* ---------- summary cards ---------- */

type Part = { k: ToneKey; label: string; v: number };
type Card = { title: string; icon: typeof Home; accent: string; ring: string; value: number; unit: string; context: string; parts: Part[]; empty: string };

function StatCards({ totals, people }: { totals: Record<string, number>; people: PersonStats[] }) {
  const wfhPeople = people.filter((p) => p.wfh > 0).length;
  const n = people.length;
  const cards: Card[] = [
    {
      title: "Leave", icon: Palmtree, accent: "bg-amber-500/12 text-amber-600 dark:text-amber-400", ring: "group-hover:ring-amber-500/30",
      value: totals.casual + totals.festive + totals.sick + totals.extended, unit: "days", context: `${people.filter((p) => p.casual + p.festive + p.sick + p.extended > 0).length} of ${n} people`,
      parts: [{ k: "casual", label: "Casual", v: totals.casual }, { k: "festive", label: "Festive", v: totals.festive }, { k: "sick", label: "Sick", v: totals.sick }, { k: "extended", label: "Extended", v: totals.extended }],
      empty: "No leave in this period",
    },
    {
      title: "Work from home", icon: Home, accent: "bg-sky-500/12 text-sky-600 dark:text-sky-400", ring: "group-hover:ring-sky-500/30",
      value: totals.wfh, unit: "days", context: `${wfhPeople} of ${n} people`,
      parts: people.filter((p) => p.wfh > 0).sort((a, b) => b.wfh - a.wfh).slice(0, 4).map((p) => ({ k: "wfh" as ToneKey, label: p.name.split(" ")[0], v: p.wfh })),
      empty: "Everyone was in the office",
    },
    {
      title: "Hours adjusted", icon: Timer, accent: "bg-violet-500/12 text-violet-600 dark:text-violet-400", ring: "group-hover:ring-violet-500/30",
      value: totals.hoursChanges + totals.scheduleChanges, unit: "changes", context: `${people.filter((p) => p.hoursChanges + p.scheduleChanges > 0).length} of ${n} people`,
      parts: [{ k: "hoursChanges", label: "One-day", v: totals.hoursChanges }, { k: "scheduleChanges", label: "Default hours", v: totals.scheduleChanges }],
      empty: "Everyone kept their hours",
    },
    {
      title: "Flags", icon: Flag, accent: "bg-rose-500/12 text-rose-600 dark:text-rose-400", ring: "group-hover:ring-rose-500/30",
      value: totals.shortNotice + totals.overThreshold, unit: "requests", context: "need a second look",
      parts: [{ k: "shortNotice", label: "Short notice", v: totals.shortNotice }, { k: "overThreshold", label: "Below minimum", v: totals.overThreshold }],
      empty: "Nothing flagged",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c, i) => {
        const sum = c.parts.reduce((a, p) => a + p.v, 0);
        // WFH parts are people, so shade them by rank instead of by kind
        const shade = (p: Part, j: number) => (c.title === "Work from home" ? ["bg-sky-500", "bg-sky-400", "bg-sky-300", "bg-sky-200"][j] : TONE[p.k].dot);
        return (
          <motion.div
            key={c.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 28 }}
            className={cn("group print-break flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm ring-1 ring-transparent transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md", c.ring)}
          >
            <div className="flex items-center gap-2.5">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", c.accent)}><c.icon className="size-[18px]" /></span>
              <div className="min-w-0">
                <div className="text-sm font-medium leading-tight">{c.title}</div>
                <div className="truncate text-xs text-muted-foreground">{c.context}</div>
              </div>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">{fmtN(c.value)}</span>
              <span className="text-sm text-muted-foreground">{c.value === 1 ? c.unit.replace(/s$/, "") : c.unit}</span>
            </div>

            <div className="mt-auto grid gap-2.5">
              <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
                {sum > 0 && c.parts.map((p, j) => p.v > 0 && (
                  <motion.span key={p.label} className={cn("h-full first:rounded-l-full last:rounded-r-full", shade(p, j))}
                    initial={{ width: 0 }} animate={{ width: `${(p.v / sum) * 100}%` }} transition={{ delay: 0.15 + i * 0.05, type: "spring", stiffness: 120, damping: 20 }} />
                ))}
              </div>
              {c.parts.length === 0 || sum === 0 ? (
                <p className="text-xs text-muted-foreground">{c.empty}</p>
              ) : (
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {c.parts.map((p, j) => (
                    <li key={p.label} className={cn("flex items-center gap-1.5 text-xs", p.v === 0 && "opacity-45")}>
                      <span className={cn("size-2 shrink-0 rounded-[3px]", shade(p, j))} />
                      <span className="truncate text-muted-foreground">{p.label}</span>
                      <span className="ml-auto font-medium tabular-nums">{fmtN(p.v)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

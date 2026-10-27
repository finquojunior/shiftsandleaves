"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Clock, Globe, Home, PartyPopper, Plus } from "lucide-react";
import type { DaySlots, Department } from "@/db/schema";
import type { Segment } from "@/app/(app)/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";
import { RequestMenu } from "./request-dialogs";

export type CalUser = { id: number; name: string; color: string; avatar: string | null; timezone: string; departmentId: number | null; remote: boolean; schedule: DaySlots[]; joinedOn: string | null; leftOn: string | null };
type View = "day" | "week" | "month";
type Props = {
  me: { id: number; timezone: string; departmentId: number | null; remote: boolean };
  users: CalUser[];
  depts: Department[];
  segments: Segment[];
  festive: { date: string; name: string }[];
  date: string;
  view: View;
};

const DAY = 86400_000;

/** client clock, null during SSR so markup matches */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 60_000);
    const raf = requestAnimationFrame(tick);
    return () => { clearInterval(t); cancelAnimationFrame(raf); };
  }, []);
  return now;
}
const first = (n: string) => n.split(" ")[0];

/** 9am, 11:30pm */
export function t12(iso: string, tz: string) {
  const d = new Date(iso);
  const h = Number(formatInTimeZone(d, tz, "H"));
  const m = formatInTimeZone(d, tz, "mm");
  return `${h % 12 || 12}${m === "00" ? "" : ":" + m}${h < 12 ? "am" : "pm"}`;
}

/** 11a–8p */
const t12c = (iso: string, tz: string) => t12(iso, tz).replace("am", "a").replace("pm", "p");

type Bar = { s: Segment; a: number; b: number; left: number; width: number };

/** project every segment onto one viewer-tz day: bars per user + hourly coverage */
function projectDay(ds: string, tz: string, users: CalUser[], segments: Segment[]) {
  const dayStart = fromZonedTime(`${ds}T00:00:00`, tz).getTime();
  const dayEnd = dayStart + DAY;
  const ids = new Set(users.map((u) => u.id));
  const bars = new Map<number, Bar[]>();
  for (const s of segments) {
    if (!s.start || !ids.has(s.userId)) continue;
    const a = Math.max(new Date(s.start).getTime(), dayStart), b = Math.min(new Date(s.end!).getTime(), dayEnd);
    if (b <= a) continue;
    const list = bars.get(s.userId) ?? [];
    list.push({ s, a, b, left: ((a - dayStart) / DAY) * 100, width: ((b - a) / DAY) * 100 });
    bars.set(s.userId, list);
  }
  const cover = Array.from({ length: 24 }, (_, h) => {
    const t0 = dayStart + h * 3600_000, t1 = t0 + 3600_000;
    let n = 0;
    for (const [, list] of bars) if (list.some((x) => x.a < t1 && x.b > t0 && !x.s.state.pending)) n++;
    return n;
  });
  const own = new Map<number, Segment[]>();
  for (const s of segments) if (s.date === ds && ids.has(s.userId)) own.set(s.userId, [...(own.get(s.userId) ?? []), s]);
  return { ds, dayStart, bars, cover, own, working: [...bars.keys()].length };
}
type DayData = ReturnType<typeof projectDay>;

export function CalendarView({ me, users, depts, segments, festive, date, view }: Props) {
  const router = useRouter();
  // keep the current view on screen, dimmed, until the next one arrives
  const [navigating, startNav] = useTransition();
  const nav = (href: string) => startNav(() => router.push(href));
  const [dept, setDept] = useState<string>("all");
  const [dir, setDir] = useState(1);
  const now = useNow();
  const tz = me.timezone;
  const d = parseISO(date);
  const today = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");

  const range =
    view === "month" ? { start: startOfWeek(startOfMonth(d), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(d), { weekStartsOn: 1 }) }
    : view === "week" ? { start: startOfWeek(d, { weekStartsOn: 1 }), end: endOfWeek(d, { weekStartsOn: 1 }) }
    : { start: d, end: d };
  const dayKey = `${format(range.start, "yyyy-MM-dd")}_${format(range.end, "yyyy-MM-dd")}`;
  // only people employed on at least one displayed day get a row
  const visible = useMemo(() => {
    const [a, b] = dayKey.split("_");
    const present = new Set(segments.filter((s) => s.date >= a && s.date <= b).map((s) => s.userId));
    return users.filter((u) => present.has(u.id) && (dept === "all" || String(u.departmentId) === dept));
  }, [users, dept, dayKey, segments]);
  const festiveMap = useMemo(() => new Map(festive.map((f) => [f.date, f.name])), [festive]);
  const projected = useMemo(() => {
    const [a, b] = dayKey.split("_");
    return eachDayOfInterval({ start: parseISO(a), end: parseISO(b) }).map((x) => projectDay(format(x, "yyyy-MM-dd"), tz, visible, segments));
  }, [dayKey, tz, visible, segments]);

  const step = (n: number) => (view === "month" ? addMonths(d, n) : addDays(d, view === "week" ? 7 * n : n));
  const go = (next: Date, dirn: number) => { setDir(dirn); nav(`/?date=${format(next, "yyyy-MM-dd")}&view=${view}`); };
  const openDay = (ds: string) => { setDir(1); nav(`/?date=${ds}&view=day`); };
  const title = view === "month" ? format(d, "MMMM yyyy") : view === "week" ? `${format(range.start, "d MMM")} – ${format(range.end, "d MMM yyyy")}` : format(d, "EEEE, d MMMM yyyy");
  const mySchedule = users.find((u) => u.id === me.id)?.schedule ?? [];

  return (
    <div aria-busy={navigating} className={cn("grid min-w-0 gap-4 transition-opacity *:min-w-0", navigating && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => go(step(-1), -1)} aria-label="Previous"><ChevronLeft className="size-4" /></Button>
          <Button variant="outline" size="icon" onClick={() => go(step(1), 1)} aria-label="Next"><ChevronRight className="size-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => go(new Date(), 0)}>Today</Button>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.h1 key={title} initial={{ opacity: 0, y: 6 * dir }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 * dir }} transition={{ duration: 0.18 }} className="min-w-0 truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</motion.h1>
        </AnimatePresence>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <Select value={dept} onValueChange={(v) => setDept(v ?? "all")} items={{ all: "All departments", ...Object.fromEntries(depts.map((x) => [String(x.id), x.name])) }}>
            <SelectTrigger className="w-36 sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {depts.map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Tabs value={view} onValueChange={(v) => nav(`/?date=${date}&view=${v}`)}>
            <TabsList><TabsTrigger value="day">Day</TabsTrigger><TabsTrigger value="week">Week</TabsTrigger><TabsTrigger value="month">Month</TabsTrigger></TabsList>
          </Tabs>
          <RequestMenu festive={festive} schedule={mySchedule} timezone={tz} remote={me.remote} defaultDate={view === "day" ? date : undefined} trigger={<Button className="ml-auto sm:ml-0"><Plus className="size-4" /> Request</Button>} />
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view + title + dept} className="min-w-0" initial={{ opacity: 0, x: 20 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 * dir }} transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.7 }}>
          {view === "week" && <WeekView days={projected} today={today} now={now} tz={tz} users={visible} festiveMap={festiveMap} onOpen={openDay} />}
          {view === "day" && <DayView day={projected[0]} today={today} now={now} tz={tz} users={visible} festiveName={festiveMap.get(date)} />}
          {view === "month" && <MonthGrid days={projected} month={d} today={today} tz={tz} users={visible} festiveMap={festiveMap} onOpen={openDay} />}
        </motion.div>
      </AnimatePresence>
      <p className="text-xs text-muted-foreground">Times shown in {tz}. Hatched bars are pending approval.</p>
    </div>
  );
}

/* ---------- shared pieces ---------- */

function CoverageStrip({ cover, max, labels }: { cover: number[]; max: number; labels?: boolean }) {
  return (
    <div>
      <div className="flex h-2.5 gap-px">
        {cover.map((n, h) => (
          <Tooltip key={h}>
            <TooltipTrigger render={<span className="flex-1 rounded-[2px]" style={{ background: n === 0 ? "color-mix(in oklch, var(--destructive) 55%, transparent)" : `oklch(0.62 0.16 160 / ${0.18 + 0.82 * (n / max)})` }} />} />
            <TooltipContent>{String(h).padStart(2, "0")}:00 · {n === 0 ? "nobody on" : `${n} on`}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {labels && <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>}
    </div>
  );
}

function Track({ bars, own, user, tz, nowPct, tall, compact }: { bars: Bar[]; own?: Segment; user: CalUser; tz: string; nowPct?: number | null; tall?: boolean; compact?: boolean }) {
  const off = own?.state.kind === "off";
  return (
    <div className={cn("relative w-full overflow-hidden rounded-md bg-muted/60", tall ? "h-9" : "h-7")} style={{ backgroundImage: "repeating-linear-gradient(to right, transparent 0 calc(25% - 1px), var(--border) calc(25% - 1px) 25%)" }}>
      {bars.map((x, i) => {
        const label = `${t12(x.s.start!, tz)}–${t12(x.s.end!, tz)}`;
        const short = compact ? `${t12c(x.s.start!, tz)}–${t12c(x.s.end!, tz)}` : label;
        return (
          <Tooltip key={i}>
            <TooltipTrigger
              render={<motion.div initial={{ scaleX: 0.6, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 28 }} className={cn("absolute inset-y-1 flex items-center overflow-hidden rounded px-1.5 text-[11px] font-medium text-white", x.s.state.pending && "border border-dashed border-white/70")} style={{ left: `${x.left}%`, width: `${x.width}%`, background: x.s.state.pending ? `${user.color}88` : user.color, backgroundImage: x.s.state.pending ? "repeating-linear-gradient(45deg,transparent 0 4px,rgba(255,255,255,.25) 4px 8px)" : undefined, transformOrigin: "left" }} />}
            >
              {!compact && x.width * 10 > short.length * 6 + 14 && <span className="truncate">{short}</span>}
            </TooltipTrigger>
            <TooltipContent>
              <div className="font-medium">{user.name}</div>
              <div>{label}</div>
              <div className="text-xs opacity-70">{x.s.state.kind === "half" ? `half day (${x.s.state.half} off)` : x.s.state.kind === "work" && x.s.state.overridden ? "changed hours" : "default hours"}{x.s.state.pending && " · pending"}{x.s.state.kind !== "off" && x.s.state.wfh !== "no" && ` · from home${x.s.state.wfh === "pending" ? " (pending)" : ""}`}</div>
            </TooltipContent>
          </Tooltip>
        );
      })}
      {off && bars.length === 0 && (
        <span className={cn("absolute inset-1 flex items-center justify-center rounded border text-[11px] capitalize text-muted-foreground", own?.state.pending ? "border-dashed" : "border-transparent bg-background/60")}>
          off · {own?.state.kind === "off" && own.state.leaveType}{own?.state.pending && " (pending)"}
        </span>
      )}
      {nowPct != null && <span className="pointer-events-none absolute inset-y-0 w-px bg-destructive" style={{ left: `${nowPct}%` }} />}
    </div>
  );
}

function Person({ u, sub }: { u: CalUser; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <UserAvatar user={u} className="size-7" textClass="text-[10px]" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium leading-tight">{u.name}</div>
        <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">{u.remote && <Globe className="size-2.5" />}{sub ?? u.timezone.split("/").pop()?.replace("_", " ")}</div>
      </div>
    </div>
  );
}

const nowPctOf = (now: number | null, dayStart: number) => (now != null && now >= dayStart && now < dayStart + DAY ? ((now - dayStart) / DAY) * 100 : null);

/* ---------- week ---------- */

/** the shift that starts on this date, written out under the track so nothing depends on bar width */
export const slotsLabel = (segs: Segment[], tz: string, compact = true) =>
  segs.filter((x) => x.start).map((x) => (compact ? `${t12c(x.start!, tz)}–${t12c(x.end!, tz)}` : `${t12(x.start!, tz)}–${t12(x.end!, tz)}`)).join(" · ");

function Caption({ segs, tz }: { segs?: Segment[]; tz: string }) {
  const s = segs?.[0];
  if (!s || !s.start) return <div className="h-3.5" />;
  return (
    <div className={cn("mt-0.5 flex items-center gap-1 truncate text-[10px] leading-3.5 tabular-nums text-muted-foreground", s.state.pending && "italic")}>
      <span className="truncate">{slotsLabel(segs!, tz)}</span>
      {s.state.kind === "half" && <span>½</span>}
      {s.state.kind === "work" && s.state.overridden && <Clock className="size-2.5 shrink-0" />}
      {s.state.kind !== "off" && s.state.wfh !== "no" && <Home className={cn("size-2.5 shrink-0", s.state.wfh === "pending" && "opacity-50")} aria-label="working from home" />}
    </div>
  );
}

/** "Kolkata · 11am–8pm": the first full working segment this week, in viewer tz */
function usual(u: CalUser, days: DayData[], tz: string) {
  for (const c of days) {
    const segs = c.own.get(u.id);
    const s = segs?.[0];
    if (s?.state.kind === "work" && !s.state.overridden) return `${u.timezone.split("/").pop()?.replace("_", " ")} · ${slotsLabel(segs!, tz, false)}`;
  }
  return u.leftOn ? `left ${format(parseISO(u.leftOn), "d MMM yyyy")}` : u.joinedOn && u.joinedOn > days[0].ds ? `joins ${format(parseISO(u.joinedOn), "d MMM")}` : undefined;
}

function WeekView({ days, today, now, tz, users, festiveMap, onOpen }: { days: DayData[]; today: string; now: number | null; tz: string; users: CalUser[]; festiveMap: Map<string, string>; onOpen: (d: string) => void }) {
  const max = Math.max(1, ...days.flatMap((c) => c.cover));
  const cols = { gridTemplateColumns: "var(--name-col) repeat(7, minmax(0, 1fr))" };
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm [--name-col:150px] sm:[--name-col:190px]">
      <div className="min-w-[900px] sm:min-w-[1080px]">
        <div className="grid border-b bg-muted/40" style={cols}>
          <div className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground backdrop-blur">Team · {users.length}</div>
          {days.map((c) => (
            <button key={c.ds} type="button" onClick={() => onOpen(c.ds)} className="flex items-center gap-1.5 px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent">
              {format(parseISO(c.ds), "EEE")}
              <span className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold text-foreground", c.ds === today && "bg-primary text-primary-foreground")}>{Number(c.ds.slice(8))}</span>
              {festiveMap.get(c.ds) && <Tooltip><TooltipTrigger render={<span className="text-amber-500" />}><PartyPopper className="size-3.5" /></TooltipTrigger><TooltipContent>{festiveMap.get(c.ds)}</TooltipContent></Tooltip>}
              <span className="ml-auto tabular-nums">{c.working} in</span>
            </button>
          ))}
        </div>
        <div className="grid border-b" style={cols}>
          <div className="sticky left-0 z-10 bg-card px-3 py-2 text-xs text-muted-foreground">On duty by hour</div>
          {days.map((c) => <div key={c.ds} className="px-2 py-2.5"><CoverageStrip cover={c.cover} max={max} /></div>)}
        </div>
        {users.map((u, i) => (
          <motion.div key={u.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="grid border-b last:border-b-0 hover:bg-accent/40" style={cols}>
            <div className="sticky left-0 z-10 bg-card px-3 py-1.5"><Person u={u} sub={usual(u, days, tz)} /></div>
            {days.map((c) => (
              <div key={c.ds} className={cn("px-1 py-1.5", c.ds === today && "bg-primary/[0.03]")}>
                <Track compact bars={c.bars.get(u.id) ?? []} own={c.own.get(u.id)?.[0]} user={u} tz={tz} nowPct={c.ds === today ? nowPctOf(now, c.dayStart) : null} />
                <Caption segs={c.own.get(u.id)} tz={tz} />
              </div>
            ))}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---------- day ---------- */

function DayView({ day, today, now, tz, users, festiveName }: { day: DayData; today: string; now: number | null; tz: string; users: CalUser[]; festiveName?: string }) {
  const nowPct = day.ds === today ? nowPctOf(now, day.dayStart) : null;
  const status = (bars: Bar[]) => {
    if (!bars.length) return { label: "Off", tone: "bg-muted text-muted-foreground", order: 3, at: Infinity };
    if (now == null || day.ds !== today) return { label: "", tone: "", order: 1, at: bars[0].a };
    if (bars.some((x) => x.a <= now && now < x.b)) return { label: "On now", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", order: 0, at: bars[0].a };
    const next = bars.find((x) => x.a > now);
    if (next) return { label: `Starts ${t12(new Date(next.a).toISOString(), tz)}`, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", order: 1, at: next.a };
    return { label: "Done", tone: "bg-muted text-muted-foreground", order: 2, at: bars[0].a };
  };
  const rows = users.map((u) => { const bars = (day.bars.get(u.id) ?? []).sort((a, b) => a.a - b.a); return { u, bars, st: status(bars) }; }).sort((a, b) => a.st.order - b.st.order || a.st.at - b.st.at);
  const off = rows.filter((r) => !r.bars.length).length;
  const gaps = day.cover.map((n, h) => (n === 0 ? h : -1)).filter((h) => h >= 0);
  const onNow = nowPct != null ? day.cover[Math.floor((nowPct / 100) * 24)] : null;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold">{rows.length - off} working</span>
          <span className="text-muted-foreground">· {off} off</span>
          {onNow != null && <Badge variant="secondary" className="gap-1"><Clock className="size-3" /> {onNow} on right now</Badge>}
          {festiveName && <Badge variant="secondary" className="gap-1"><PartyPopper className="size-3" /> {festiveName}</Badge>}
          {gaps.length > 0 && <span className="w-full text-xs text-destructive sm:ml-auto sm:w-auto">Nobody on: {gaps.map((h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`).join(", ")}</span>}
        </div>
        <CoverageStrip cover={day.cover} max={Math.max(1, ...day.cover)} labels />
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="grid border-b bg-muted/40 px-3 py-1.5 text-[10px] tabular-nums text-muted-foreground sm:grid-cols-[250px_1fr]">
          <span className="hidden sm:block" />
          <div className="flex justify-between"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
        </div>
        {rows.map(({ u, bars, st }, i) => (
          <motion.div key={u.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="grid items-center gap-x-3 gap-y-1.5 border-b px-3 py-2 last:border-b-0 hover:bg-accent/40 sm:grid-cols-[250px_1fr]">
            <div className="flex items-center justify-between gap-2">
              <Person u={u} sub={bars.length ? <>{t12(bars[0].s.start!, tz)}–{t12(bars[bars.length - 1].s.end!, tz)}{bars[0].s.state.kind !== "off" && bars[0].s.state.wfh !== "no" && <> · <Home className="inline size-2.5 align-[-1px]" /> home</>}</> : undefined} />
              {st.label && <Badge className={cn("shrink-0", st.tone)}>{st.label}</Badge>}
            </div>
            <Track bars={bars} own={day.own.get(u.id)?.[0]} user={u} tz={tz} nowPct={nowPct} tall />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---------- month ---------- */

/** hover card: on leave first, then working sorted by shift start */
function DaySummary({ c, users, tz }: { c: DayData; users: CalUser[]; tz: string }) {
  const off = users.filter((u) => c.own.get(u.id)?.[0]?.state.kind === "off").map((u) => ({ u, s: c.own.get(u.id)![0] }));
  const working = users
    .map((u) => ({ u, segs: c.own.get(u.id) ?? [] }))
    .filter((x) => x.segs.some((s) => s.start))
    .map((x) => ({ u: x.u, segs: x.segs, s: x.segs[0] }))
    .sort((a, b) => new Date(a.s.start!).getTime() - new Date(b.s.start!).getTime());
  const Row = ({ u, right, dim }: { u: CalUser; right: React.ReactNode; dim?: boolean }) => (
    <li className={cn("flex items-start gap-2 py-0.5", dim && "opacity-70")}>
      <UserAvatar user={u} className="mt-px size-5" textClass="text-[8px]" />
      <span className="min-w-20 flex-1 truncate">{u.name}</span>
      <span className="shrink-0 text-right tabular-nums text-muted-foreground">{right}</span>
    </li>
  );
  return (
    <div className="w-64 text-xs">
      <div className="mb-1 font-medium">{format(parseISO(c.ds), "EEEE d MMMM")}</div>
      {off.length > 0 && (
        <>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">On leave · {off.length}</div>
          <ul>{off.map(({ u, s }) => <Row key={u.id} u={u} dim right={<span className="capitalize">{s.state.kind === "off" && s.state.leaveType}{s.state.pending && " · pending"}</span>} />)}</ul>
        </>
      )}
      <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Working · {working.length}</div>
      <ul>{working.map(({ u, s, segs }) => (
        <Row key={u.id} u={u} right={
          <span className="grid justify-items-end">
            {/* one line per slot so a split day never squeezes the name */}
            {segs.filter((x) => x.start).map((x, i) => <span key={i}>{t12(x.start!, tz)}–{t12(x.end!, tz)}</span>)}
            <span>{s.state.kind === "half" && "½ "}{s.state.kind !== "off" && s.state.wfh !== "no" && <Home className="inline size-3 align-[-2px]" />}{s.state.pending && " pending"}</span>
          </span>
        } />
      ))}</ul>
      {working.length === 0 && <div className="text-muted-foreground">Nobody scheduled</div>}
    </div>
  );
}

function MonthGrid({ days, month, today, tz, users, festiveMap, onOpen }: { days: DayData[]; month: Date; today: string; tz: string; users: CalUser[]; festiveMap: Map<string, string>; onOpen: (d: string) => void }) {
  const byId = new Map(users.map((u) => [u.id, u]));
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="py-2">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((c, i) => {
          const inMonth = isSameMonth(parseISO(c.ds), month);
          const fest = festiveMap.get(c.ds);
          const offs = [...c.own.values()].map((l) => l[0]).filter((s) => s.state.kind === "off" || s.state.kind === "half");
          const employed = c.own.size;
          const inCount = employed - offs.filter((s) => s.state.kind === "off" && !s.state.pending).length;
          const thin = employed > 0 && inCount <= Math.ceil(employed / 2);
          return (
            <Tooltip key={c.ds}>
            <TooltipTrigger render={<motion.button type="button" onClick={() => onOpen(c.ds)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.008, 0.3) }}
              className={cn("flex min-h-20 flex-col gap-1 border-b border-r p-1 text-left transition-colors hover:bg-accent/60 sm:min-h-24 sm:gap-1.5 sm:p-2 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/30 text-muted-foreground")} />}>
              <div className="flex items-center gap-1.5">
                <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-semibold sm:size-6 sm:text-xs", c.ds === today && "bg-primary text-primary-foreground")}>{Number(c.ds.slice(8))}</span>
                {fest && <span className="text-amber-500" title={fest}><PartyPopper className="size-3.5" /></span>}
                <span className={cn("ml-auto text-[10px] tabular-nums sm:text-[11px]", thin ? "font-medium text-destructive" : "text-muted-foreground")}>{inCount}/{employed}<span className="hidden sm:inline"> in</span></span>
              </div>
              {offs.length > 0 && (
                <div className="flex flex-wrap gap-0.5 sm:gap-1">
                  {offs.map((s) => {
                    const u = byId.get(s.userId)!;
                    return <UserAvatar key={u.id} user={u} className={cn("size-5 ring-2 ring-background sm:size-6", s.state.pending && "opacity-50 outline-2 outline-dashed outline-offset-1", s.state.kind === "half" && "[clip-path:polygon(0_0,100%_0,100%_50%,0_50%)]")} textClass="text-[8px] sm:text-[9px]" />;
                  })}
                </div>
              )}
              {offs.length === 0 && inMonth && employed > 0 && <span className="hidden text-[11px] text-muted-foreground sm:inline">Everyone in</span>}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="border bg-popover text-popover-foreground shadow-md [&>div:last-child]:border [&>div:last-child]:bg-popover"><DaySummary c={c} users={users} tz={tz} /></TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export { first };

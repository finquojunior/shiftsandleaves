"use client";
import { useState, useTransition, type ReactElement } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, CalendarRange, Clock, Home, RefreshCw, ShieldAlert, Trash2, Unlock } from "lucide-react";
import type { DaySlots, LeaveType, Shift } from "@/db/schema";
import { submitHours, submitLeave, submitReopen, submitSchedule, submitWfh, type Result } from "@/actions/requests";
import type { Coverage } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { hhmm, parseHHMM, fmtDate } from "@/lib/time";
import { totalMinutes } from "@/lib/rules";

type Kind = "leave" | "plan" | "hours" | "schedule" | "reopen" | "wfh" | null;
type Props = { festive: { date: string; name: string }[]; schedule: DaySlots[]; timezone: string; remote: boolean; defaultDate?: string; trigger: ReactElement; replaceId?: number | null };

export function RequestMenu({ festive, schedule, timezone, remote, defaultDate, trigger }: Props) {
  const [kind, setKind] = useState<Kind>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setKind("leave")}><CalendarPlus className="size-4" /> Request leave</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setKind("hours")}><Clock className="size-4" /> Change hours for a day</DropdownMenuItem>
          {!remote && <DropdownMenuItem onClick={() => setKind("wfh")}><Home className="size-4" /> Work from home</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setKind("plan")}><CalendarRange className="size-4" /> Plan a month&apos;s leaves</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setKind("reopen")}><Unlock className="size-4" /> Reopen a month&apos;s window</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setKind("schedule")}><RefreshCw className="size-4" /> Change my default hours</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LeaveDialog key={`leave-${kind}`} open={kind === "leave" || kind === "plan"} plan={kind === "plan"} onClose={() => setKind(null)} festive={festive} defaultDate={defaultDate} />
      <HoursDialog key={`hours-${kind}`} open={kind === "hours"} onClose={() => setKind(null)} defaultDate={defaultDate} schedule={schedule} timezone={timezone} remote={remote} />
      <ScheduleDialog key={`sched-${kind}`} open={kind === "schedule"} onClose={() => setKind(null)} schedule={schedule} timezone={timezone} remote={remote} />
      <ReopenDialog open={kind === "reopen"} onClose={() => setKind(null)} />
      <WfhDialog key={`wfh-${kind}`} open={kind === "wfh"} onClose={() => setKind(null)} defaultDate={defaultDate} />
    </>
  );
}

function useSubmit(onDone: () => void, onFail?: (r: Extract<Result, { ok: false }>) => void) {
  const [pending, start] = useTransition();
  const run = (p: Promise<Result>, okMsg: string) =>
    start(async () => {
      const r = await p;
      if (r.ok) { toast.success(okMsg); onDone(); } else { toast.error(r.error); onFail?.(r); }
    });
  return { pending, run };
}

type Day = { date: string; half: "am" | "pm" | null };

export function LeaveDialog({ open, onClose, festive, defaultDate, plan, replaceId, initial }: {
  open: boolean; onClose: () => void; festive: { date: string; name: string }[]; defaultDate?: string; plan?: boolean; replaceId?: number | null;
  initial?: { leaveType: LeaveType; days: Day[]; note?: string | null; planMonth?: string | null };
}) {
  const [type, setType] = useState<LeaveType>(initial?.leaveType ?? "casual");
  const [days, setDays] = useState<Day[]>(initial?.days ?? (defaultDate ? [{ date: defaultDate, half: null }] : []));
  const [pick, setPick] = useState(defaultDate ?? "");
  const [month, setMonth] = useState(initial?.planMonth ?? (defaultDate ?? new Date().toISOString().slice(0, 10)).slice(0, 7));
  const [note, setNote] = useState(initial?.note ?? "");
  const [breaches, setBreaches] = useState<Coverage[]>([]);
  const [reason, setReason] = useState("");
  const { pending, run } = useSubmit(onClose, (r) => setBreaches(r.breaches ?? []));

  const add = (date: string) => {
    if (!date || days.some((d) => d.date === date)) return;
    setDays([...days, { date, half: null }].sort((a, b) => a.date.localeCompare(b.date)));
    setBreaches([]);
  };
  const total = days.reduce((a, d) => a + (d.half ? 0.5 : 1), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{replaceId ? "Edit leave" : plan ? "Plan the month" : "Request leave"}</DialogTitle>
          <DialogDescription>{plan ? "Pick every off day for the month. At least one per week." : "Goes to your approver, then the whole team is told."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {plan && (
            <div className="grid gap-1.5"><Label>Month</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          )}
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as LeaveType)} items={{ casual: "Casual", festive: "Festive", sick: "Sick", extended: "Extended" }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="casual">Casual (6 / month)</SelectItem>
                <SelectItem value="festive">Festive (6 / year, around a festival)</SelectItem>
                <SelectItem value="sick">Sick</SelectItem>
                <SelectItem value="extended">Extended</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Days</Label>
            <div className="flex gap-2">
              <Input type="date" value={pick} min={plan ? `${month}-01` : undefined} max={plan ? `${month}-31` : undefined} onChange={(e) => setPick(e.target.value)} />
              <Button type="button" variant="secondary" onClick={() => { add(pick); setPick(""); }}>Add</Button>
            </div>
            {type === "festive" && (
              <div className="grid gap-1.5 rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
                <span>Use any of your 6 festive days as one block of consecutive days that includes a festival. Tap one to start from it:</span>
                <div className="flex flex-wrap gap-1">
                  {festive.filter((f) => f.date >= new Date().toISOString().slice(0, 10)).slice(0, 8).map((f) => (
                    <button key={f.date} type="button" onClick={() => add(f.date)} className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-foreground transition hover:bg-accent">{fmtDate(f.date, "d MMM")} · {f.name}</button>
                  ))}
                </div>
              </div>
            )}
            <ul className="grid gap-1">
              <AnimatePresence initial={false}>
                {days.map((d) => (
                  <motion.li key={d.date} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm">
                      <span className="flex-1">{fmtDate(d.date, "EEE d MMM yyyy")}</span>
                      <Select items={{ full: "Full day", am: "Morning off", pm: "Afternoon off" }} value={d.half ?? "full"} onValueChange={(v) => setDays(days.map((x) => (x.date === d.date ? { ...x, half: v === "full" ? null : (v as "am" | "pm") } : x)))}>
                        <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="full">Full day</SelectItem><SelectItem value="am">Morning off</SelectItem><SelectItem value="pm">Afternoon off</SelectItem></SelectContent>
                      </Select>
                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => { setDays(days.filter((x) => x.date !== d.date)); setBreaches([]); }} aria-label="Remove"><Trash2 className="size-3.5" /></Button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            {days.length > 0 && <p className="text-xs text-muted-foreground">{total} day{total !== 1 && "s"} total</p>}
          </div>
          {type === "extended" && (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">Extended leave doesn&apos;t count against any quota. HR or an admin will get in touch to talk it through before deciding, so say what&apos;s going on and when you could meet.</p>
          )}
          <div className="grid gap-1.5"><Label>{type === "extended" ? "Why, and when can you talk?" : "Note (optional)"}</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={type === "extended" ? 3 : 2} /></div>
          <AnimatePresence>
            {breaches.length > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300"><ShieldAlert className="size-4" /> Below the department minimum</div>
                  <ul className="text-xs text-muted-foreground">
                    {breaches.map((b) => <li key={b.date}>{fmtDate(b.date, "EEE d MMM")}: {b.dept} would have {b.remaining} on duty, minimum is {b.min}</li>)}
                  </ul>
                  <p className="text-xs text-muted-foreground">You can still ask for an exception. HR or an admin decides with these numbers in front of them.</p>
                  <Textarea placeholder="Why this leave is needed anyway (required)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {breaches.length > 0 ? (
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={() => run(submitLeave({ leaveType: type, days, note, planMonth: plan ? month : initial?.planMonth ?? null, replaceId, exceptionReason: reason }), "Exception request submitted")}>{pending ? "Submitting…" : "Submit as exception"}</Button>
          ) : (
            <Button disabled={pending || days.length === 0} onClick={() => run(submitLeave({ leaveType: type, days, note, planMonth: plan ? month : initial?.planMonth ?? null, replaceId }), "Leave request submitted")}>{pending ? "Submitting…" : "Submit"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** one day's working slots: start/end per slot, "+ split" for remote people */
export function SlotsEditor({ value, onChange, allowSplit, label }: { value: Shift[]; onChange: (s: Shift[]) => void; allowSplit: boolean; label?: string }) {
  const set = (i: number, k: "start" | "end", v: string) => {
    let m = parseHHMM(v);
    const cur = { ...value[i], [k]: m } as Shift;
    if (k === "end" && m <= cur.start) m += 1440;
    onChange(value.map((s, j) => (j === i ? { ...s, [k]: m } : s)));
  };
  const total = totalMinutes(value) / 60;
  return (
    <div className="grid gap-1.5">
      {value.map((s, i) => (
        <div key={i} className="grid grid-cols-[2.5rem_1fr_1fr_1.75rem] items-center gap-2 text-sm">
          <span className="truncate text-muted-foreground">{i === 0 ? label ?? "" : ""}</span>
          <Input type="time" value={hhmm(s.start)} onChange={(e) => set(i, "start", e.target.value)} />
          <Input type="time" value={hhmm(s.end)} onChange={(e) => set(i, "end", e.target.value)} />
          {value.length > 1 ? <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove slot" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button> : <span />}
        </div>
      ))}
      <div className="flex items-center justify-between pl-[2.5rem+0.5rem] text-xs">
        <span className={total < 8 ? "text-destructive" : "text-muted-foreground"}>{total.toFixed(1)}h total{total < 8 && " · minimum 8"}</span>
        {allowSplit && value.length < 4 && <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => { const last = value[value.length - 1]; onChange([...value, { start: Math.min(last.end + 60, 1380), end: Math.min(last.end + 300, 1439 + 1440) }]); }}>+ add a slot</button>}
      </div>
    </div>
  );
}

export function HoursDialog({ open, onClose, defaultDate, schedule, timezone, remote, replaceId, initial }: {
  open: boolean; onClose: () => void; defaultDate?: string; schedule: DaySlots[]; timezone: string; remote: boolean; replaceId?: number | null;
  initial?: { date: string; slots: Shift[]; note?: string | null };
}) {
  const [date, setDate] = useState(initial?.date ?? defaultDate ?? "");
  const [slots, setSlots] = useState<Shift[]>(initial?.slots ?? schedule[date ? new Date(`${date}T00:00:00Z`).getUTCDay() : 1]);
  const [note, setNote] = useState(initial?.note ?? "");
  const { pending, run } = useSubmit(onClose);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{replaceId ? "Edit hours change" : "Change hours for a day"}</DialogTitle><DialogDescription>In your timezone ({timezone}). Slots ending before they start roll to the next day.{remote && " As a remote member you can split the day."}</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(ev) => { setDate(ev.target.value); if (!initial && ev.target.value) setSlots(schedule[new Date(`${ev.target.value}T00:00:00Z`).getUTCDay()]); }} /></div>
          <SlotsEditor value={slots} onChange={setSlots} allowSplit={remote} label="Hours" />
          <div className="grid gap-1.5"><Label>Reason (optional)</Label><Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || !date} onClick={() => run(submitHours({ date, slots, note, replaceId }), "Hours change submitted")}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const sameDay = (a: Shift[], b: Shift[]) => JSON.stringify(a) === JSON.stringify(b);

export function ScheduleEditor({ value, onChange, allowSplit }: { value: DaySlots[]; onChange: (s: DaySlots[]) => void; allowSplit: boolean }) {
  const [same, setSame] = useState(value.every((d) => sameDay(d, value[0])));
  const setDay = (i: number, slots: Shift[]) => onChange(same ? value.map(() => slots) : value.map((d, j) => (j === i ? slots : d)));
  const rows = same ? [1] : [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between"><Label>Same hours every day</Label><Switch checked={same} onCheckedChange={(c) => { setSame(c); if (c) onChange(value.map(() => value[1])); }} /></div>
      <div className="grid gap-3">
        {rows.map((i) => <SlotsEditor key={i} value={value[i]} onChange={(sl) => setDay(i, sl)} allowSplit={allowSplit} label={same ? "Daily" : DOW[i]} />)}
      </div>
    </div>
  );
}

function ScheduleDialog({ open, onClose, schedule, timezone, remote }: { open: boolean; onClose: () => void; schedule: DaySlots[]; timezone: string; remote: boolean }) {
  const [value, setValue] = useState<DaySlots[]>(schedule);
  const [note, setNote] = useState("");
  const { pending, run } = useSubmit(onClose);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Change my default hours</DialogTitle><DialogDescription>Applies once approved. Times in {timezone}. Minimum 8 hours a day{remote && ", split into slots if you like"}.</DialogDescription></DialogHeader>
        <ScheduleEditor value={value} onChange={setValue} allowSplit={remote} />
        <div className="grid gap-1.5"><Label>Reason (optional)</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending} onClick={() => run(submitSchedule({ schedule: value, note }), "Default hours change submitted")}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WfhDialog({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate?: string }) {
  const [days, setDays] = useState<string[]>(defaultDate ? [defaultDate] : []);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const { pending, run } = useSubmit(onClose);
  const add = (d: string) => { if (d && !days.includes(d)) setDays([...days, d].sort()); setPick(""); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Work from home</DialogTitle><DialogDescription>Your usual hours, just not in the office. No quota, goes to your approver, then the team is told.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Days</Label>
            <div className="flex gap-2"><Input type="date" value={pick} onChange={(e) => setPick(e.target.value)} /><Button type="button" variant="secondary" onClick={() => add(pick)}>Add</Button></div>
            <ul className="grid gap-1">
              <AnimatePresence initial={false}>
                {days.map((d) => (
                  <motion.li key={d} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm"><Home className="size-3.5 text-muted-foreground" /><span className="flex-1">{fmtDate(d, "EEE d MMM yyyy")}</span><Button type="button" size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => setDays(days.filter((x) => x !== d))}><Trash2 className="size-3.5" /></Button></div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
          <div className="grid gap-1.5"><Label>Note (optional)</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || !days.length} onClick={() => run(submitWfh({ days, note }), "Work-from-home request submitted")}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { pending, run } = useSubmit(onClose);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Reopen a month&apos;s plan window</DialogTitle><DialogDescription>Missed the deadline? Ask HR to let you submit your monthly plan.</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label>Month</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending} onClick={() => run(submitReopen(month), "Reopen request sent")}>Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

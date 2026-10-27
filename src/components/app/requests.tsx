"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, Ban, Pencil, AlertTriangle, CalendarDays, Clock, Home, MessagesSquare, RefreshCw, ShieldAlert, Unlock } from "lucide-react";
import type { DaySlots, Request, RequestDay, Role } from "@/db/schema";
import { cancelRequest, decide, logDiscussion } from "@/actions/requests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, hhmm } from "@/lib/time";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";
import { HoursDialog, LeaveDialog } from "./request-dialogs";
import type { Coverage } from "@/lib/data";

type U = { id: number; name: string; color: string; avatar: string | null; role: Role; timezone: string };
type Detail = Request & {
  days: RequestDay[];
  events: { id: number; action: string; detail: string | null; createdAt: string; actor: string }[];
  coverage: Coverage[];
  replaces: (Request & { days: RequestDay[] }) | null;
};

const statusTone: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};
const kindIcon = { leave: CalendarDays, hours: Clock, schedule: RefreshCw, reopen: Unlock, wfh: Home };

export function summary(r: Request, days: RequestDay[]) {
  const d = days.filter((x) => x.requestId === r.id).sort((a, b) => a.date.localeCompare(b.date));
  if (r.kind === "leave") {
    const n = d.reduce((a, x) => a + (x.half ? 0.5 : 1), 0);
    const span = d.length ? (d.length === 1 ? fmtDate(d[0].date) : `${fmtDate(d[0].date, "d MMM")} → ${fmtDate(d[d.length - 1].date, "d MMM")}`) : "";
    return { title: `${r.leaveType} leave · ${n} day${n !== 1 ? "s" : ""}`, sub: `${span}${r.planMonth ? ` · monthly plan ${r.planMonth}` : ""}` };
  }
  if (r.kind === "wfh") {
    const span = d.length ? (d.length === 1 ? fmtDate(d[0].date) : `${fmtDate(d[0].date, "d MMM")} → ${fmtDate(d[d.length - 1].date, "d MMM")}`) : "";
    return { title: `Work from home · ${d.length} day${d.length !== 1 ? "s" : ""}`, sub: span };
  }
  if (r.kind === "hours") return { title: `Hours change · ${d[0] ? fmtDate(d[0].date) : ""}`, sub: d.map((x) => `${hhmm(x.start!)}–${hhmm(x.end!)}`).join(" · ") };
  if (r.kind === "schedule") return { title: "Default hours change", sub: r.payload ? `${r.payload[1].map((x) => `${hhmm(x.start)}–${hhmm(x.end)}`).join(" · ")} daily` : "" };
  return { title: `Reopen plan window · ${r.planMonth}`, sub: "" };
}

export function RequestsView({ me, mine, inbox, days, users, detail, festive }: {
  me: { id: number; role: Role; timezone: string; schedule: DaySlots[]; remote: boolean }; mine: Request[]; inbox: Request[]; days: RequestDay[]; users: U[]; detail: Detail | null; festive: { date: string; name: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState(inbox.length ? "inbox" : "mine");
  const byId = new Map(users.map((u) => [u.id, u]));
  const [navigating, startNav] = useTransition();
  const open = (id: number) => startNav(() => router.push(`/requests?open=${id}`, { scroll: false }));
  const close = () => router.push("/requests", { scroll: false });

  const listProps = { byId, days, open };
  return (
    <div aria-busy={navigating} className={cn("grid gap-4 transition-opacity", navigating && "opacity-60")}>
      <h1 className="text-xl font-semibold tracking-tight">Requests</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="mine">Mine <span className="ml-1 text-muted-foreground">{mine.length}</span></TabsTrigger>
          {me.role !== "employee" && <TabsTrigger value="inbox">To approve {inbox.length > 0 && <span className="ml-1.5 grid size-5 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{inbox.length}</span>}</TabsTrigger>}
        </TabsList>
        <TabsContent value="mine" className="mt-3"><List {...listProps} items={mine} empty="You haven't made any requests." /></TabsContent>
        <TabsContent value="inbox" className="mt-3"><List {...listProps} items={inbox} empty="Nothing waiting for you." /></TabsContent>
      </Tabs>
      <DetailSheet detail={detail} onClose={close} me={me} user={detail ? byId.get(detail.userId) : undefined} festive={festive} />
    </div>
  );
}

function List({ items, empty, byId, days, open }: { items: Request[]; empty: string; byId: Map<number, U>; days: RequestDay[]; open: (id: number) => void }) {
  return (
    <ul className="grid gap-2">
      {items.length === 0 && <li className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</li>}
      <AnimatePresence initial={false}>
        {items.map((r, i) => {
          const u = byId.get(r.userId);
          const s = summary(r, days);
          const Icon = kindIcon[r.kind];
          return (
            <motion.li key={r.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.02 }}>
              <button type="button" onClick={() => open(r.id)} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition hover:bg-accent/60 hover:shadow">
                <UserAvatar user={u ?? { name: "?", color: "#999" }} className="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium"><Icon className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate capitalize">{s.title}</span>{r.isLate && <AlertTriangle className="size-3.5 shrink-0 text-amber-500" aria-label="Short notice" />}{r.overThreshold && <ShieldAlert className="size-3.5 shrink-0 text-red-500" aria-label="Over threshold" />}{r.leaveType === "extended" && r.status === "pending" && <MessagesSquare className={cn("size-3.5 shrink-0", r.discussedAt ? "text-emerald-600" : "text-amber-500")} aria-label={r.discussedAt ? "Conversation logged" : "Needs a conversation"} />}{r.replacesId && <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-label="Edit of an approved request" />}</div>
                  <div className="truncate text-xs text-muted-foreground">{u?.name} · {s.sub}{r.note ? ` · “${r.note}”` : ""}</div>
                </div>
                <Badge className={cn("shrink-0 capitalize", statusTone[r.status])}>{r.status}</Badge>
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function DetailSheet({ detail, onClose, me, user, festive }: { detail: Detail | null; onClose: () => void; me: { id: number; role: Role; timezone: string; schedule: DaySlots[]; remote: boolean }; user?: U; festive: { date: string; name: string }[] }) {
  const [note, setNote] = useState("");
  const [talk, setTalk] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const act = (p: Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { const r = await p; if (r.ok) { toast.success(msg); onClose(); } else toast.error(r.error); });
  if (!detail) return <Sheet open={false}><SheetContent /></Sheet>;
  const s = summary(detail, detail.days);
  const canDecide = detail.status === "pending" && detail.userId !== me.id && (me.role === "admin" || (me.role === "hr" && user?.role === "employee"));
  const canCancel = (detail.userId === me.id || me.role === "admin") && (detail.status === "pending" || detail.status === "approved");
  const canEdit = detail.userId === me.id && (detail.kind === "leave" || detail.kind === "hours") && (detail.status === "pending" || detail.status === "approved");
  const breaches = detail.coverage.filter((c) => c.breach);
  const needsTalk = detail.leaveType === "extended" && detail.status === "pending" && !detail.discussedAt;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-2"><Badge className={cn("capitalize", statusTone[detail.status])}>{detail.status}</Badge>{detail.isLate && <Badge variant="outline" className="gap-1 text-amber-600"><AlertTriangle className="size-3" /> Short notice</Badge>}{detail.overThreshold && <Badge variant="outline" className="gap-1 text-red-600"><ShieldAlert className="size-3" /> Over threshold</Badge>}{detail.replacesId && <Badge variant="outline" className="gap-1"><Pencil className="size-3" /> Edit of #{detail.replacesId}</Badge>}{detail.leaveType === "extended" && <Badge variant="outline" className={cn("gap-1", detail.discussedAt ? "text-emerald-700" : "text-amber-700")}><MessagesSquare className="size-3" /> {detail.discussedAt ? "Conversation logged" : "Needs a conversation"}</Badge>}</div>
          <SheetTitle className="capitalize">{s.title}</SheetTitle>
          <SheetDescription>#{detail.id} · {user?.name} · {s.sub}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-6">
          {detail.note && <p className="rounded-lg bg-muted p-3 text-sm">“{detail.note}”</p>}
          {detail.exceptionReason && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-red-700 dark:text-red-300"><ShieldAlert className="size-4" /> Exception requested</div>
              <p>“{detail.exceptionReason}”</p>
            </div>
          )}
          {detail.replaces && (
            <div className="rounded-lg border border-dashed p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Replaces #{detail.replaces.id} · stays in place until this is approved</div>
              <div className="flex flex-wrap gap-1.5">{detail.replaces.days.map((d) => <Badge key={d.id} variant="outline" className="line-through opacity-70">{fmtDate(d.date, "EEE d MMM")}{d.start != null && ` ${hhmm(d.start)}–${hhmm(d.end!)}`}{d.half && ` · ${d.half} off`}</Badge>)}</div>
            </div>
          )}
          {detail.coverage.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Department coverage if approved{breaches.length > 0 && <span className="ml-1 text-red-600">· {breaches.length} day{breaches.length > 1 && "s"} below minimum</span>}</div>
              <ul className="grid gap-1">
                {detail.coverage.map((c) => (
                  <li key={c.date} className={cn("flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm", c.breach && "border-red-500/40 bg-red-500/5")}>
                    <span>{fmtDate(c.date, "EEE d MMM")}</span>
                    <span className={cn("tabular-nums", c.breach ? "font-medium text-red-600" : "text-muted-foreground")}>{c.dept} · {c.remaining} on duty / min {c.min}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(detail.kind === "leave" || detail.kind === "wfh") && (
            <div className="flex flex-wrap gap-1.5">{detail.days.map((d) => <Badge key={d.id} variant="secondary">{fmtDate(d.date, "EEE d MMM")}{d.half && <span className="ml-1 opacity-70">· {d.half} off</span>}</Badge>)}</div>
          )}
          {detail.kind === "schedule" && detail.payload && (
            <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => { const sl = detail.payload![(i + 1) % 7]; return <div key={d} className="rounded-lg border p-1.5"><div className="text-muted-foreground">{d}</div>{sl.map((sh, j) => <div key={j} className="tabular-nums">{hhmm(sh.start)}–{hhmm(sh.end)}</div>)}</div>; })}
            </div>
          )}
          {detail.leaveType === "extended" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200"><MessagesSquare className="size-4" /> Extended leave</div>
              <p className="text-xs text-muted-foreground">Doesn&apos;t count against any quota. HR or an admin talks to the person first, logs it here, then decides.</p>
            </div>
          )}

          <div>
            <div className="mb-3 text-xs font-medium text-muted-foreground">Activity</div>
            <ol className="relative ml-2 border-l pl-5">
              {detail.events.map((e, i) => (
                <motion.li key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative mb-4 last:mb-0">
                  <span className={cn("absolute -left-[26px] top-1 grid size-3 place-items-center rounded-full ring-4 ring-background", e.action === "approved" || e.action === "auto-approved" ? "bg-emerald-500" : e.action === "rejected" ? "bg-red-500" : e.action === "cancelled" || e.action === "replaced" ? "bg-muted-foreground" : e.action === "discussion" ? "bg-amber-500" : "bg-primary")} />
                  <div className="text-sm"><span className="font-medium">{e.actor}</span> <span className="text-muted-foreground">{e.action}</span></div>
                  {e.detail && <div className="text-sm text-muted-foreground">{e.detail}</div>}
                  <div className="text-[11px] text-muted-foreground">{format(new Date(e.createdAt), "d MMM yyyy, HH:mm")}</div>
                </motion.li>
              ))}
            </ol>
          </div>

          {canDecide && detail.leaveType === "extended" && (
            <div className="grid gap-2 border-t pt-4">
              <div className="text-xs font-medium text-muted-foreground">{needsTalk ? "Set up the conversation" : "Add to the conversation log"}</div>
              <Textarea placeholder="Meeting time and link, or a summary of what was agreed" rows={2} value={talk} onChange={(e) => setTalk(e.target.value)} />
              <div><Button size="sm" variant="secondary" disabled={pending || !talk.trim()} onClick={() => start(async () => { const r = await logDiscussion(detail.id, talk); if (r.ok) { toast.success("Logged and the person was notified"); setTalk(""); } else toast.error(r.error); })}><MessagesSquare className="size-4" /> Log conversation</Button></div>
            </div>
          )}
          {(canDecide || canCancel || canEdit) && (
            <div className="grid gap-3 border-t pt-4">
              {canDecide && needsTalk && <p className="text-xs text-amber-700">Log the conversation before approving.</p>}
              {canDecide && breaches.length > 0 && <p className="text-xs text-red-600">Approving will log this as an over-threshold approval.</p>}
              {canDecide && <Textarea placeholder="Note (required to reject)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
              <div className="flex flex-wrap gap-2">
                {canDecide && <>
                  <Button disabled={pending || needsTalk} onClick={() => act(decide(detail.id, true, note), "Approved")}><Check className="size-4" /> Approve</Button>
                  <Button disabled={pending} variant="destructive" onClick={() => act(decide(detail.id, false, note), "Rejected")}><X className="size-4" /> Reject</Button>
                </>}
                {canEdit && <Button variant="outline" disabled={pending} onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
                {canCancel && <Button variant="ghost" disabled={pending} className="ml-auto" onClick={() => act(cancelRequest(detail.id), "Cancelled")}><Ban className="size-4" /> Cancel request</Button>}
              </div>
            </div>
          )}
        </div>
        {editing && detail.kind === "leave" && (
          <LeaveDialog open onClose={() => { setEditing(false); onClose(); }} festive={festive} replaceId={detail.id} plan={!!detail.planMonth}
            initial={{ leaveType: detail.leaveType!, days: detail.days.map((d) => ({ date: d.date, half: d.half })), note: detail.note, planMonth: detail.planMonth }} />
        )}
        {editing && detail.kind === "hours" && detail.days[0] && (
          <HoursDialog open onClose={() => { setEditing(false); onClose(); }} schedule={me.schedule} timezone={me.timezone} remote={me.remote} replaceId={detail.id}
            initial={{ date: detail.days[0].date, slots: detail.days.map((d) => ({ start: d.start!, end: d.end! })), note: detail.note }} />
        )}
      </SheetContent>
    </Sheet>
  );
}

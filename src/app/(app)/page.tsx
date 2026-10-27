import { addDays, format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { requireUser } from "@/lib/auth";
import { avatarUrl, effectiveDay, getAllUsers, getDayRows, getDepartments, getFestiveDays, type DayState } from "@/lib/data";
import { applyHalf } from "@/lib/rules";
import { shiftInstants, todayIn } from "@/lib/time";
import { CalendarView } from "@/components/app/calendar";

export type Segment = { userId: number; date: string; state: DayState; slot: number; start?: string; end?: string };

export default async function CalendarPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const me = await requireUser();
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIn(me.timezone);
  const view = sp.view === "month" ? "month" : sp.view === "day" ? "day" : "week";
  const from = format(addDays(startOfMonth(parseISO(date)), -7), "yyyy-MM-dd");
  const to = format(addDays(endOfMonth(parseISO(date)), 7), "yyyy-MM-dd");

  const [allUsers, depts, rows, festive] = await Promise.all([getAllUsers(), getDepartments(), getDayRows(from, to), getFestiveDays()]);

  // former and future members only appear on the days they're employed
  const segments: Segment[] = [];
  const seen = new Set<number>();
  const byUserDay = Map.groupBy(rows, (r) => `${r.userId}|${r.date}`);
  for (let d = parseISO(from); format(d, "yyyy-MM-dd") <= to; d = addDays(d, 1)) {
    const ds = format(d, "yyyy-MM-dd");
    for (const u of allUsers) {
      const state = effectiveDay(u, ds, byUserDay.get(`${u.id}|${ds}`) ?? []);
      if (!state) continue;
      seen.add(u.id);
      if (state.kind === "off") { segments.push({ userId: u.id, date: ds, state, slot: 0 }); continue; }
      const slots = state.kind === "half" ? applyHalf(state.slots, state.half) : state.slots;
      slots.forEach((slot, i) => {
        const { start, end } = shiftInstants(ds, slot, u.timezone);
        segments.push({ userId: u.id, date: ds, state, slot: i, start: start.toISOString(), end: end.toISOString() });
      });
    }
  }
  const users = allUsers.filter((u) => seen.has(u.id));

  return (
    <CalendarView
      me={{ id: me.id, timezone: me.timezone, departmentId: me.departmentId, remote: me.remote }}
      users={users.map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: avatarUrl(u), timezone: u.timezone, departmentId: u.departmentId, remote: u.remote, schedule: u.schedule, leftOn: u.leftOn, joinedOn: u.joinedOn }))}
      depts={depts}
      segments={segments}
      festive={festive}
      date={date}
      view={view}
    />
  );
}

import { parseISO, startOfWeek, addDays, format } from "date-fns";
import type { Role, Shift } from "@/db/schema";
import { MIN_SHIFT, monthDates } from "./time";

/** one day's slots: sorted, non-overlapping, 8h+ in total, inside a 24h window. Split days only for remote people. */
export function validateDay(slots: Shift[], allowSplit: boolean): string | null {
  if (!slots.length) return "Add at least one working slot";
  if (slots.length > 1 && !allowSplit) return "Split shifts are only for remote members";
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.start < 0 || s.start >= 1440) return "Start must be within the day";
    if (s.end <= s.start) return "End must be after start";
    if (i > 0 && s.start < sorted[i - 1].end) return "Slots overlap";
    total += s.end - s.start;
  }
  if (total < MIN_SHIFT) return "At least 8 hours a day in total";
  if (sorted[sorted.length - 1].end - sorted[0].start > 1440) return "A day's slots must fit within 24 hours";
  return null;
}

export const sortSlots = (slots: Shift[]) => [...slots].sort((a, b) => a.start - b.start);
export const totalMinutes = (slots: Shift[]) => slots.reduce((a, s) => a + (s.end - s.start), 0);

/** half day: 'pm' off keeps the first half of the day's hours, 'am' off keeps the second half. Works across split slots. */
export function applyHalf(slots: Shift[], half: "am" | "pm"): Shift[] {
  const sorted = sortSlots(slots);
  const cut = totalMinutes(sorted) / 2;
  const out: Shift[] = [];
  let acc = 0;
  for (const s of sorted) {
    const len = s.end - s.start;
    if (half === "pm") {
      if (acc >= cut) break;
      out.push({ start: s.start, end: Math.min(s.end, s.start + (cut - acc)) });
    } else {
      if (acc + len > cut) out.push({ start: Math.max(s.start, s.start + (cut - acc)), end: s.end });
    }
    acc += len;
  }
  return out;
}

/** today's date (UTC) as YYYY-MM-DD */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** still with the company today (a future leaving date = notice period, still current). Bugs #3, #1 */
export const isCurrent = (u: { active: boolean; leftOn: string | null }, today = todayUtc()) => u.active && (!u.leftOn || today <= u.leftOn);

/** settings bounds. Bug #9 */
export const SETTING_RANGE: Record<string, [number, number]> = { deadline_day: [1, 31], casual_quota: [0, 31], festive_quota: [0, 366], late_hours: [0, 720] };

/** employed on this date? */
export const employedOn = (u: { joinedOn: string | null; leftOn: string | null }, date: string) =>
  (!u.joinedOn || date >= u.joinedOn) && (!u.leftOn || date <= u.leftOn);

export const dayWeight = (half: "am" | "pm" | null | undefined) => (half ? 0.5 : 1);

/** Monday-start weeks that lie fully inside the month and have no leave day. */
export function weeksWithoutLeave(month: string, leaveDates: Set<string>) {
  const dates = monthDates(month);
  const missing: string[] = [];
  let ws = startOfWeek(parseISO(dates[0]), { weekStartsOn: 1 });
  const last = dates[dates.length - 1];
  while (format(ws, "yyyy-MM-dd") <= last) {
    const week = Array.from({ length: 7 }, (_, i) => format(addDays(ws, i), "yyyy-MM-dd"));
    const inside = week.every((d) => d.startsWith(month));
    if (inside && !week.some((d) => leaveDates.has(d))) missing.push(week[0]);
    ws = addDays(ws, 7);
  }
  return missing;
}

/** who approves whom. admins' requests go to another admin (auto-approve handled by caller if none). */
export const approverRole = (r: Role): Role => (r === "employee" ? "hr" : "admin");

export const canApprove = (approver: Role, requester: Role) =>
  approver === "admin" || (approver === "hr" && requester === "employee");

export const isLate = (now: Date, firstStart: Date, thresholdHours: number) =>
  firstStart.getTime() - now.getTime() < thresholdHours * 3600_000;

/** monthly plan submission is open if today <= deadline day of that month, or today is before the month. */
export function planWindowOpen(today: string, month: string, deadlineDay: number) {
  if (today < `${month}-01`) return true;
  if (!today.startsWith(month)) return false;
  return Number(today.slice(8)) <= deadlineDay;
}

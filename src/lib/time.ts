import { addMinutes, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Shift } from "@/db/schema";

export const MIN_SHIFT = 480;

/** 'YYYY-MM-DD' + shift in the person's tz -> UTC instants */
export function shiftInstants(date: string, shift: Shift, tz: string) {
  const midnight = fromZonedTime(`${date}T00:00:00`, tz);
  return { start: addMinutes(midnight, shift.start), end: addMinutes(midnight, shift.end) };
}

export const hhmm = (min: number) =>
  `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const parseHHMM = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

export const fmtIn = (d: Date, tz: string, f = "HH:mm") => formatInTimeZone(d, tz, f);

export const weekday = (date: string) => parseISO(date).getDay(); // 0=Sun

export const todayIn = (tz: string) => formatInTimeZone(new Date(), tz, "yyyy-MM-dd");

export const monthOf = (date: string) => date.slice(0, 7);

export const fmtDate = (date: string, f = "EEE d MMM") => format(parseISO(date), f);

/** all dates of a YYYY-MM month */
export function monthDates(month: string) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** every date from..to inclusive (YYYY-MM-DD); empty if to < from */
export function dateRange(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

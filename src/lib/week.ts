// Week-day helpers for the schedule grid.
//
// All operations are LOCAL-time-safe: we never round-trip through
// `Date.toISOString()` (UTC) for date-only values, since that introduces
// off-by-one errors in timezones away from UTC (e.g. Taipei UTC+8).

export type WeekDay = {
  iso: string;        // "2026-05-13"
  date: number;       // 13
  month: number;      // 5
  weekday: string;    // "三"
  isToday: boolean;
  isWeekend: boolean; // Sat / Sun
};

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

// Format Date → "YYYY-MM-DD" using LOCAL year/month/day (not UTC)
function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse "YYYY-MM-DD" as a local-midnight Date.
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Today's local date as ISO string.
export function todayLocalIso(): string {
  return localIso(new Date());
}

// ISO date shifted by N days, in local calendar.
export function shiftDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return localIso(d);
}

// Monday of the week containing `iso`. JS getDay(): 0=Sun..6=Sat
export function mondayOf(iso: string): string {
  const d = parseIso(iso);
  const jsDow = d.getDay();
  const offset = jsDow === 0 ? -6 : 1 - jsDow; // Sun→-6, Mon→0, Tue→-1, ...
  d.setDate(d.getDate() + offset);
  return localIso(d);
}

// Returns `count` consecutive days starting from `startIso` (inclusive).
export function weekDays(startIso: string, count = 6, todayIso?: string): WeekDay[] {
  const today = todayIso ?? todayLocalIso();
  return Array.from({ length: count }, (_, i) => {
    const iso = shiftDays(startIso, i);
    const d = parseIso(iso);
    return {
      iso,
      date: d.getDate(),
      month: d.getMonth() + 1,
      weekday: WEEKDAY_ZH[d.getDay()],
      isToday: iso === today,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  });
}

// Approximate ISO week number — good enough for label.
export function weekNumberOf(iso: string): number {
  const d = parseIso(iso);
  const start = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - start.getTime()) / 86400000);
  return Math.ceil((days + start.getDay() + 1) / 7);
}

// `date` falls within [start, end] inclusive (end nullable → single day)
export function dateInRange(date: string, start: string | null, end: string | null): boolean {
  if (!start) return false;
  if (!end) return date === start;
  return start <= date && date <= end;
}

// Week-day helpers for the schedule grid.

export type WeekDay = {
  iso: string;        // "2026-05-13"
  date: number;       // 13
  month: number;      // 5
  weekday: string;    // "三"
  isToday: boolean;
  isWeekend: boolean; // Sat / Sun
};

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

// ISO date for `date` shifted by N days
export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday of the week containing `iso`. JS getDay(): 0=Sun .. 6=Sat
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const jsDow = d.getDay(); // 0..6
  const offset = jsDow === 0 ? -6 : 1 - jsDow; // 0 (Sun) -> -6, 1 (Mon) -> 0, 2 (Tue) -> -1, ...
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// Returns `count` consecutive days starting from `startIso`.
export function weekDays(startIso: string, count = 6, todayIso?: string): WeekDay[] {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  return Array.from({ length: count }, (_, i) => {
    const iso = shiftDays(startIso, i);
    const d = new Date(`${iso}T00:00:00`);
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

// ISO week number (rough, not strict ISO 8601 — good enough for label)
export function weekNumberOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  const start = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - start.getTime()) / 86400000);
  return Math.ceil((days + start.getDay() + 1) / 7);
}

// `date` falls within [start, end] inclusive (end nullable -> single day)
export function dateInRange(date: string, start: string | null, end: string | null): boolean {
  if (!start) return false;
  if (!end) return date === start;
  return start <= date && date <= end;
}

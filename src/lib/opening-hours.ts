/**
 * Opening hours: validation of the weekly map stored in venues.opening_hours and the
 * "Aberto agora" status, always in São Paulo time (the app only covers São Paulo state).
 * Free of React/Next imports so it can be tested with `node --test`.
 */

import type { OpeningHours, OpeningInterval, Weekday } from "../types";

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Segunda",
  tue: "Terça",
  wed: "Quarta",
  thu: "Quinta",
  fri: "Sexta",
  sat: "Sábado",
  sun: "Domingo",
};

export const VENUE_TIME_ZONE = "America/Sao_Paulo";
export const MAX_INTERVALS_PER_DAY = 3;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export type OpeningHoursParse = { ok: true; value: OpeningHours | null } | { ok: false };

/**
 * Validates opening hours from a request body: null clears them; otherwise an object whose
 * keys are weekdays, each with up to MAX_INTERVALS_PER_DAY `{ open, close }` "HH:MM" intervals
 * (open != close). Days left out are closed. An object without any interval is rejected
 * (send null to say "unknown").
 */
export function parseOpeningHours(input: unknown): OpeningHoursParse {
  if (input === null) return { ok: true, value: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false };
  const value: OpeningHours = {};
  let intervals = 0;
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!WEEKDAYS.includes(key as Weekday)) return { ok: false };
    if (!Array.isArray(raw) || raw.length > MAX_INTERVALS_PER_DAY) return { ok: false };
    const day: OpeningInterval[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") return { ok: false };
      const { open, close } = item as Record<string, unknown>;
      if (typeof open !== "string" || typeof close !== "string") return { ok: false };
      if (!TIME_RE.test(open) || !TIME_RE.test(close) || open === close) return { ok: false };
      day.push({ open, close });
    }
    if (day.length > 0) value[key as Weekday] = day;
    intervals += day.length;
  }
  return intervals > 0 ? { ok: true, value } : { ok: false };
}

/** Weekday index (0 = Monday) and minutes since midnight of `now` in São Paulo. */
export function venueLocalTime(now: Date): { dayIndex: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VENUE_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { dayIndex, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export type OpenStatus = { open: true; closesAt: string } | { open: false };

/**
 * Whether the venue is open at `now` (São Paulo time), or null when the hours are unknown.
 * An interval whose close is not after its open runs past midnight into the next day.
 */
export function openStatus(hours: OpeningHours | undefined | null, now: Date): OpenStatus | null {
  if (!hours) return null;
  const { dayIndex, minutes } = venueLocalTime(now);
  if (dayIndex < 0) return null;
  const today = hours[WEEKDAYS[dayIndex]] ?? [];
  const yesterday = hours[WEEKDAYS[(dayIndex + 6) % 7]] ?? [];
  for (const { open, close } of today) {
    const o = toMinutes(open);
    const c = toMinutes(close);
    const overnight = c <= o;
    if (minutes >= o && (overnight || minutes < c)) return { open: true, closesAt: close };
  }
  for (const { open, close } of yesterday) {
    if (toMinutes(close) <= toMinutes(open) && minutes < toMinutes(close)) {
      return { open: true, closesAt: close };
    }
  }
  return { open: false };
}

/** "Aberto agora · fecha às 02:00" / "Fechado agora", or null when the hours are unknown. */
export function openStatusLabel(hours: OpeningHours | undefined | null, now: Date): string | null {
  const status = openStatus(hours, now);
  if (!status) return null;
  return status.open ? `Aberto agora · fecha às ${status.closesAt}` : "Fechado agora";
}

/** "18:00–02:00, 20:00–23:00" or "Fechado". */
export function formatDayHours(intervals: OpeningInterval[] | undefined): string {
  if (!intervals || intervals.length === 0) return "Fechado";
  return intervals.map((i) => `${i.open}–${i.close}`).join(", ");
}

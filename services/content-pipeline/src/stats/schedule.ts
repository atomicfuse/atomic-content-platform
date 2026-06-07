/**
 * Schedule snapshot helpers for the ops-console stats pipeline.
 *
 * All functions are pure (inject `now`, no Date.now()), zero new dependencies
 * (Intl only for timezone math).
 */

import type { PublishSchedule } from "../types.js";
import type { ScheduleSnapshot } from "./types.js";

// ---------------------------------------------------------------------------
// resolveArticlesPerDay
// Replicates the exact logic from services/content-pipeline/src/agents/scheduled-publisher/index.ts ~line 145.
// That function is exported (`export function resolveArticlesPerDay`) but we replicate here
// to keep the stats module self-contained and avoid a cross-directory import from agents/.
// If that export ever changes, keep this in sync.
// ---------------------------------------------------------------------------
function resolveArticlesPerDay(s: PublishSchedule): number {
  if (typeof s.articles_per_day === "number" && s.articles_per_day > 0) {
    return s.articles_per_day;
  }
  const perWeek = s.articles_per_week ?? 0;
  if (perWeek <= 0) return 0;
  const daysCount = s.preferred_days?.length || 7;
  return Math.max(1, Math.ceil(perWeek / daysCount));
}

// ---------------------------------------------------------------------------
// buildScheduleSnapshot
// ---------------------------------------------------------------------------

/**
 * Build a ScheduleSnapshot from a brief.schedule object.
 * Returns null if the schedule is undefined/null.
 */
export function buildScheduleSnapshot(s: PublishSchedule): ScheduleSnapshot;
export function buildScheduleSnapshot(s: PublishSchedule | undefined | null): ScheduleSnapshot | null;
export function buildScheduleSnapshot(
  s: PublishSchedule | undefined | null,
): ScheduleSnapshot | null {
  if (!s) return null;

  const days = s.preferred_days ?? [];
  const articlesPerDay = resolveArticlesPerDay(s);
  const weeklyTarget = articlesPerDay * days.length;

  return {
    articlesPerDay,
    preferredDays: days,
    weeklyTarget,
  };
}

// ---------------------------------------------------------------------------
// Timezone helpers (pure Intl — no new deps)
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;  // 0-23 (hourCycle h23)
  weekday: number; // 0=Sunday..6=Saturday
}

/**
 * Returns the wall-clock parts of `instant` in the given IANA timezone.
 */
function zonedParts(instant: Date, tz: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = fmt.formatToParts(instant);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const weekdayStr = get("weekday"); // "Sun", "Mon", ...
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = WEEKDAYS.indexOf(weekdayStr);

  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour"), 10),
    weekday: weekday === -1 ? 0 : weekday,
  };
}

/**
 * Find the UTC instant for "zoned date (year/month/day) at (hour):00:00 in tz".
 *
 * Strategy: start from a naive UTC guess (pretend the local time is UTC), then
 * correct using the offset seen at that guess. One or two iterations converge
 * (handles DST transitions robustly).
 */
function zonedToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  tz: string,
): Date {
  // Initial guess: treat the wall time as UTC
  let guess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));

  // Iterate twice to correct for DST
  for (let i = 0; i < 2; i++) {
    const zp = zonedParts(guess, tz);
    // Compute how many ms the guess's zoned time differs from the target
    const guessWallMs = Date.UTC(zp.year, zp.month - 1, zp.day, zp.hour, 0, 0, 0);
    const targetWallMs = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
    const offsetMs = guessWallMs - targetWallMs;
    guess = new Date(guess.getTime() - offsetMs);
  }

  return guess;
}

// ---------------------------------------------------------------------------
// Weekday name normalisation
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Maps "Monday", "Mon", "monday", "mon" → 0-6 (Sun=0). Returns -1 if unknown. */
function parseDayName(name: string): number {
  const norm = name.toLowerCase().slice(0, 3);
  return WEEKDAY_NAMES.findIndex((d) => d.startsWith(norm));
}

// ---------------------------------------------------------------------------
// SchedulerGate type
// ---------------------------------------------------------------------------

export interface SchedulerGate {
  enabled: boolean;
  run_at_hours: number[];
  timezone: string;
}

// ---------------------------------------------------------------------------
// computeNextRun
// ---------------------------------------------------------------------------

/**
 * Compute the next UTC instant at which the scheduler would fire for a site
 * with the given preferred weekdays.
 *
 * @param gate   - Global scheduler gate (enabled, run_at_hours, timezone).
 * @param preferredDays - Site's preferred days (e.g. ["Monday", "Wed"]).
 * @param now    - Injected current time (no Date.now()).
 * @returns The earliest Date strictly after `now` that satisfies all conditions,
 *          or null if the scheduler is disabled / no valid candidates.
 */
export function computeNextRun(
  gate: SchedulerGate,
  preferredDays: string[],
  now: Date,
): Date | null {
  if (!gate.enabled) return null;
  if (!preferredDays.length || !gate.run_at_hours.length) return null;

  // Resolve preferred weekday numbers (Sun=0..Sat=6)
  const preferredNums = new Set(
    preferredDays.map(parseDayName).filter((n) => n !== -1),
  );
  if (preferredNums.size === 0) return null;

  const sortedHours = [...gate.run_at_hours].sort((a, b) => a - b);

  // Get the zoned date for `now` so we can iterate from there
  const nowParts = zonedParts(now, gate.timezone);

  // Iterate over the next 14 days
  for (let addDays = 0; addDays <= 14; addDays++) {
    // Compute the calendar date in the timezone by adding addDays to now's zoned date
    const targetDate = new Date(
      Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day) +
        addDays * 86_400_000,
    );
    const targetParts = zonedParts(targetDate, gate.timezone);
    const { year, month, day, weekday } = targetParts;

    if (!preferredNums.has(weekday)) continue;

    for (const hour of sortedHours) {
      const candidate = zonedToUtc(year, month, day, hour, gate.timezone);
      if (candidate.getTime() > now.getTime()) {
        // Verify the round-trip: zoned hour must equal requested hour
        const verifyParts = zonedParts(candidate, gate.timezone);
        if (verifyParts.hour !== hour) continue; // skip ambiguous DST times
        return candidate;
      }
    }
  }

  return null;
}

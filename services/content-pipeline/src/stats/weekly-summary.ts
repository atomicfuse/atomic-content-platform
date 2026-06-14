import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";
import type { DayCell } from "./types.js";

/**
 * Map common timezone abbreviations to IANA names.
 * Same map as scheduled-publisher/index.ts — duplicated to keep
 * the stats module self-contained (no cross-directory agent import).
 */
const TIMEZONE_MAP: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
};

function resolveTimezone(tz: string): string {
  return TIMEZONE_MAP[tz.toUpperCase()] ?? tz;
}

/**
 * Compute the day-of-week index (0=Sun..6=Sat) and the week-of Sunday
 * date string (YYYY-MM-DD) for a given timezone and instant.
 *
 * @param timezone - Scheduler timezone abbreviation or IANA name
 * @param now - Current instant (injectable for testing)
 */
export function getDayIndexAndWeekOf(
  timezone: string,
  now: Date = new Date(),
): { dayIndex: number; weekOf: string } {
  const resolved = resolveTimezone(timezone);

  // Get current day-of-week in the scheduler's timezone (0=Sun..6=Sat)
  const dayName = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: resolved,
  }).format(now);
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayIndex = Math.max(0, DAY_NAMES.indexOf(dayName));

  // Get today's date in the scheduler's timezone (YYYY-MM-DD)
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Walk back to Sunday
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const sundayMs = todayMs - dayIndex * 86_400_000;
  const sunday = new Date(sundayMs);
  const weekOf = sunday.toISOString().slice(0, 10);

  return { dayIndex, weekOf };
}

// When automatic coaching happens, in each user's own time zone. Pure (standard Intl and
// ./stats.ts only), so `scripts/check-coach.mjs` checks it alongside the stats.

import { addDays } from './stats.ts';

export const SCHEDULE = {
  /** The day's nudge is written from this local hour on, so it's waiting when the app opens. */
  prepFromHour: 5,
  /** The nudge goes out as a push at this local hour… */
  pushHour: 15,
  /** …or, if that run failed, in the hours after it, up to and including this one. */
  pushUntilHour: 17,
  /** Users who haven't opened the app for longer than this get nothing automatic. */
  activeDays: 7,
} as const;

/** The local calendar day and hour somewhere, or null for an unknown time zone. */
export type LocalClock = { date: string; hour: number; weekday: number; dayOfMonth: number };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localClock(timeZone: string, now: Date): LocalClock | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(now);
  } catch {
    return null; // not a valid IANA time zone
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
    weekday: WEEKDAY_INDEX[part('weekday')] ?? 0,
    dayOfMonth: Number(part('day')),
  };
}

/**
 * Someone who opened the app (and so rolled their day over) within the last week. The date is
 * written by the device, so one more than a day ahead of their local date (a device's zone can
 * be a day ahead) didn't come from the app and doesn't count.
 */
export function isActive(lastRolloverDate: string | null, localDate: string): boolean {
  return (
    lastRolloverDate !== null &&
    lastRolloverDate >= addDays(localDate, -SCHEDULE.activeDays) &&
    lastRolloverDate <= addDays(localDate, 1)
  );
}

export type Duties = { nudge: boolean; weekly: boolean; monthly: boolean; push: boolean };

const NONE: Duties = { nudge: false, weekly: false, monthly: false, push: false };

/**
 * What the hourly run should make sure exists for one user right now. Each duty is "ensure":
 * the scheduler skips what's already there, so running every hour is harmless.
 */
export function dutiesFor(
  clock: LocalClock,
  settings: { aiCoach?: unknown; afternoonNudge?: unknown },
): Duties {
  // Both default to on, matching DEFAULT_SETTINGS in the app.
  if (settings.aiCoach === false || clock.hour < SCHEDULE.prepFromHour) return NONE;
  return {
    nudge: true,
    weekly: clock.weekday === 1,
    monthly: clock.dayOfMonth === 1,
    push:
      settings.afternoonNudge !== false &&
      clock.hour >= SCHEDULE.pushHour &&
      clock.hour <= SCHEDULE.pushUntilHour,
  };
}

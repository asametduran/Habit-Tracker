export type HabitType = 'daily' | 'quantity';

export type Reminder = {
  enabled: boolean;
  hour: number; // 0-23
  minute: number; // 0-59
  days: number[]; // 1 = Sunday … 7 = Saturday (expo-notifications weekday numbering)
};

export type Habit = {
  id: string;
  name: string;
  type: HabitType;
  target?: number; // quantity only
  count: number; // today's count; daily is 0 or 1
  streak: number;
  bestStreak: number;
  createdAt: string; // ISO date the habit started being tracked
  reminder?: Reminder;
};

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const DEFAULT_REMINDER: Reminder = { enabled: false, hour: 9, minute: 0, days: ALL_DAYS };

export type HistoryEntry = {
  date: string; // ISO date (local)
  habitId: string;
  count: number;
  completed: boolean; // snapshot, so later edits/removal of the habit don't rewrite the past
};

export type Challenge = {
  name?: string;
  habitIds: string[];
  durationDays: number;
  startDate: string;
  daysCompleted: number;
  status: 'active' | 'completed' | 'failed';
  celebrated?: boolean; // set once the completion reward has been shown
};

export type Settings = {
  dailyReminder: boolean; // master switch for per-habit reminders
  afternoonNudge: boolean;
  streakAlert: boolean;
  aiCoach: boolean; // daily nudges and reflections from Gemini (signed-in only)
};

export type HabitState = {
  habits: Habit[];
  history: HistoryEntry[];
  challenge: Challenge | null;
  lastRolloverDate: string;
  onboardingComplete: boolean;
  settings: Settings;
};

export const MILESTONES = [3, 7, 14, 30, 50, 100];

export const DEFAULT_SETTINGS: Settings = {
  dailyReminder: true,
  afternoonNudge: true,
  streakAlert: true,
  aiCoach: true,
};

// Dev-only: shifts "today" forward so day rollovers and challenges can be tested without waiting.
let dayOffset = 0;
export function setDayOffset(days: number) {
  dayOffset = days;
}
export function getDayOffset() {
  return dayOffset;
}
export function getToday(): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return toDateKey(date);
}

export function toDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / 86_400_000);
}

export function isCompleted(habit: Habit): boolean {
  return habit.type === 'daily' ? habit.count >= 1 : habit.count >= (habit.target ?? 1);
}

/** Returns the habit with a new count, with streak/bestStreak adjusted on completion transitions. */
export function applyCount(habit: Habit, count: number): Habit {
  const max = habit.type === 'daily' ? 1 : (habit.target ?? 1);
  const next = { ...habit, count: Math.max(0, Math.min(max, count)) };
  const was = isCompleted(habit);
  const now = isCompleted(next);
  if (!was && now) {
    next.streak = habit.streak + 1;
    next.bestStreak = Math.max(habit.bestStreak, next.streak);
  } else if (was && !now) {
    next.streak = Math.max(0, habit.streak - 1);
  }
  return next;
}

export function allCompleted(habits: Habit[]): boolean {
  return habits.length > 0 && habits.every(isCompleted);
}

/** The longest habit or challenge name the app keeps (the server rejects anything over 200). */
export const NAME_MAX = 100;

/** A name as the app stores it: trimmed and cut to NAME_MAX characters, never mid-emoji. */
export function cleanName(name: string): string {
  const chars = Array.from(name.trim());
  return chars.length > NAME_MAX ? chars.slice(0, NAME_MAX).join('').trimEnd() : chars.join('');
}

/** Migrates records stored by the pre-redesign model (`completedToday`, no type/count). */
export function migrateHabit(raw: Record<string, unknown>): Habit {
  if (typeof raw.type === 'string') {
    const habit = raw as unknown as Habit;
    return {
      ...habit,
      name: cleanName(String(habit.name)),
      bestStreak: habit.bestStreak ?? habit.streak,
      createdAt: habit.createdAt ?? getToday(),
    };
  }
  const streak = typeof raw.streak === 'number' ? raw.streak : 0;
  return {
    createdAt: getToday(),
    id: String(raw.id),
    name: cleanName(String(raw.name)),
    type: 'daily',
    count: raw.completedToday ? 1 : 0,
    streak,
    bestStreak: streak,
  };
}

/**
 * Closes out every day between `lastRolloverDate` and `today`: logs the counts, breaks streaks
 * for habits that weren't completed, advances/fails the challenge, and resets counts.
 * Returns the same object if nothing needs to change.
 */
export function rollover(state: HabitState, today: string): HabitState {
  if (state.lastRolloverDate === today) return state;
  const gap = daysBetween(state.lastRolloverDate, today);
  if (gap <= 0) return { ...state, lastRolloverDate: today };

  const closedDay = state.lastRolloverDate;
  const newHistory: HistoryEntry[] = state.habits.map((habit) => ({
    date: closedDay,
    habitId: habit.id,
    count: habit.count,
    completed: isCompleted(habit),
  }));

  // Any fully skipped day in between (app not opened) also breaks every streak.
  const missedFullDay = gap > 1;
  const habits = state.habits.map((habit) => ({
    ...habit,
    count: 0,
    streak: missedFullDay || !isCompleted(habit) ? 0 : habit.streak,
  }));

  let challenge = state.challenge;
  if (challenge && challenge.status === 'active' && closedDay >= challenge.startDate) {
    const active = challenge;
    const targets = state.habits.filter((habit) => active.habitIds.includes(habit.id));
    const dayWon = targets.length > 0 && targets.every(isCompleted) && !missedFullDay;
    if (!dayWon) {
      challenge = { ...active, status: 'failed' };
    } else {
      const daysCompleted = active.daysCompleted + 1;
      challenge = {
        ...active,
        daysCompleted,
        status: daysCompleted >= active.durationDays ? 'completed' : 'active',
      };
    }
  }

  return {
    ...state,
    habits,
    history: [...state.history, ...newHistory],
    challenge,
    lastRolloverDate: today,
  };
}

export type Consistency = { done: number; total: number; ratio: number };

/**
 * Completion over the last `days` days (today included, still in progress), counting only days
 * since the habit was created — so day one of a new habit is 1/1, not 1/30. Days with no log
 * entry (app never opened) count as missed.
 */
export function consistency(
  history: HistoryEntry[],
  habit: Habit,
  days: number,
  today: string,
): Consistency {
  const windowStart = addDays(today, -(days - 1));
  const start = habit.createdAt > windowStart ? habit.createdAt : windowStart;
  const total = Math.max(1, daysBetween(start, today) + 1);
  const pastDone = history.filter(
    (e) => e.habitId === habit.id && e.date >= start && e.date < today && e.completed,
  ).length;
  const done = pastDone + (isCompleted(habit) ? 1 : 0);
  return { done, total, ratio: done / total };
}

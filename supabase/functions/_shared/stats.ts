// Pure stats for the coaching functions: no imports, no Deno or Node APIs, so the same file
// runs in the edge functions and in `scripts/check-coach.mjs`. The model only phrases these
// numbers — every figure in a nudge or report comes from here.
//
// The rules match the app's History screen (`consistency()` in src/lib/habit-logic.ts): a day
// counts from the day the habit was created, and a day with no log entry counts as missed.

export type HabitRow = {
  id: string;
  name: string;
  type: 'daily' | 'quantity';
  target: number | null;
  count: number;
  streak: number;
  best_streak: number;
  count_date: string;
  created_at_day: string;
  deleted_at: string | null;
};

export type HistoryRow = {
  habit_id: string;
  date: string;
  count: number;
  completed: boolean;
};

export type ChallengeRow = {
  name: string | null;
  habit_ids: string[];
  duration_days: number;
  start_date: string;
  days_completed: number;
  status: 'active' | 'completed' | 'failed';
  deleted_at: string | null;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Date keys are calendar days with no time zone, so all arithmetic is done in UTC.
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekday(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function rowCompleted(row: Pick<HabitRow, 'type' | 'count' | 'target'>): boolean {
  return row.type === 'daily' ? row.count >= 1 : row.count >= (row.target ?? 1);
}

/** Rounded to whole percent, or null when there was nothing to measure. */
function percent(done: number, total: number): number | null {
  return total > 0 ? Math.round((done / total) * 100) : null;
}

export type WindowStats = {
  /** Days in the window since the habit was created. */
  tracked: number;
  done: number;
  rate: number | null;
  /** Completion in the first and second half of the window, when it's long enough to compare. */
  first_half_rate: number | null;
  second_half_rate: number | null;
  /** The weekday missed most often in the window (needs a few misses to mean anything). */
  most_missed_weekday: string | null;
  /** Quantity habits: average logged count per tracked day, against the target. */
  average_count: number | null;
};

/** One habit over [start, end], both inclusive. */
export function windowStats(
  habit: HabitRow,
  history: HistoryRow[],
  start: string,
  end: string,
): WindowStats {
  const from = habit.created_at_day > start ? habit.created_at_day : start;
  const tracked = from > end ? 0 : daysBetween(from, end) + 1;
  const byDate = new Map<string, HistoryRow>();
  for (const entry of history) {
    if (entry.habit_id === habit.id && entry.date >= from && entry.date <= end) {
      byDate.set(entry.date, entry);
    }
  }

  let done = 0;
  let countSum = 0;
  let firstDone = 0;
  let secondDone = 0;
  const half = Math.floor(tracked / 2);
  const misses = new Map<string, number>();
  for (let i = 0; i < tracked; i++) {
    const day = addDays(from, i);
    const entry = byDate.get(day);
    countSum += entry?.count ?? 0;
    if (entry?.completed) {
      done++;
      if (i < half) firstDone++;
      else if (i >= tracked - half) secondDone++;
    } else {
      misses.set(weekday(day), (misses.get(weekday(day)) ?? 0) + 1);
    }
  }

  let mostMissed: string | null = null;
  let mostMisses = 1; // a single miss isn't a pattern
  for (const [day, count] of misses) {
    if (count > mostMisses) {
      mostMissed = day;
      mostMisses = count;
    }
  }

  const comparable = tracked >= 6;
  return {
    tracked,
    done,
    rate: percent(done, tracked),
    first_half_rate: comparable ? percent(firstDone, half) : null,
    second_half_rate: comparable ? percent(secondDone, half) : null,
    most_missed_weekday: mostMissed,
    average_count:
      habit.type === 'quantity' && tracked > 0 ? Math.round((countSum / tracked) * 10) / 10 : null,
  };
}

/**
 * The longest habit or challenge name the model sees. Names are the user's own text, sent with
 * every call, so a longer one is cut (by character, so an emoji is never split) and ends in "…".
 */
const NAME_MAX = 80;

function clip(name: string): string {
  const chars = Array.from(name);
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX).join('')}…` : name;
}

function describeHabit(habit: HabitRow) {
  return {
    id: habit.id,
    name: clip(habit.name),
    type: habit.type,
    target: habit.type === 'quantity' ? (habit.target ?? 1) : null,
    current_streak: habit.streak,
    best_streak: habit.best_streak,
    tracked_since: habit.created_at_day,
  };
}

function describeChallenge(challenge: ChallengeRow | null, habits: HabitRow[]) {
  if (!challenge || challenge.deleted_at !== null) return null;
  return {
    name: challenge.name === null ? null : clip(challenge.name),
    status: challenge.status,
    days_completed: challenge.days_completed,
    duration_days: challenge.duration_days,
    habits: habits.filter((h) => challenge.habit_ids.includes(h.id)).map((h) => clip(h.name)),
  };
}

export type CoachInput = {
  habits: HabitRow[];
  history: HistoryRow[];
  challenge: ChallengeRow | null;
  /** The user's local "today" (their device decides the day, not the server). */
  today: string;
};

/** Per-habit numbers the app shows next to an insight, so the UI never depends on the model's text. */
export type HabitSummary = { id: string; name: string; rate: number | null; done: number; tracked: number };

/**
 * The app closes a day (logs it to history, resets the count, updates the streak) when it opens
 * on a later day. Until then, the last day a device saw lives only on the habit row: at 5 a.m.,
 * say, before the user has opened the app. This applies the same rule as the app's rollover, so
 * a scheduled run sees what the app will show: that day counts as logged, and a streak survives
 * only if its last day was yesterday and was completed.
 */
export function catchUp(input: CoachInput): CoachInput {
  const yesterday = addDays(input.today, -1);
  const logged = new Set(input.history.map((e) => `${e.habit_id}|${e.date}`));
  const opened: HistoryRow[] = [];
  let changed = false;
  const habits = input.habits.map((habit) => {
    if (habit.count_date >= input.today) return habit;
    changed = true;
    const done = rowCompleted(habit);
    if (!logged.has(`${habit.id}|${habit.count_date}`)) {
      opened.push({ habit_id: habit.id, date: habit.count_date, count: habit.count, completed: done });
    }
    const alive = habit.count_date === yesterday && done;
    return { ...habit, count: 0, count_date: input.today, streak: alive ? habit.streak : 0 };
  });
  return changed ? { ...input, habits, history: [...input.history, ...opened] } : input;
}

/** Data for a daily nudge: the last 14 finished days, plus how today is going so far. */
export function nudgeSnapshot(raw: CoachInput) {
  const { habits, history, challenge, today } = catchUp(raw);
  const active = habits.filter((h) => h.deleted_at === null);
  const yesterday = addDays(today, -1);
  const rows = active.map((habit) => {
    const last14 = windowStats(habit, history, addDays(today, -14), yesterday);
    const last7 = windowStats(habit, history, addDays(today, -7), yesterday);
    // A row the device hasn't brought forward to today yet has no progress for today.
    const count = habit.count_date === today ? habit.count : 0;
    return {
      ...describeHabit(habit),
      done_today: rowCompleted({ ...habit, count }),
      count_today: habit.type === 'quantity' ? count : null,
      last_7_days: { done: last7.done, tracked: last7.tracked, rate: last7.rate },
      last_14_days: last14,
    };
  });
  const summary: HabitSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    rate: row.last_14_days.rate,
    done: row.last_14_days.done,
    tracked: row.last_14_days.tracked,
  }));
  return {
    snapshot: {
      today,
      weekday: weekday(today),
      habits: rows,
      challenge: describeChallenge(challenge, active),
    },
    summary,
    hasData: active.length > 0,
  };
}

/** Data for a reflection over the `days` finished days before today, compared with the period before. */
export function reportSnapshot(raw: CoachInput, days: number) {
  const { habits, history, challenge, today } = catchUp(raw);
  const active = habits.filter((h) => h.deleted_at === null);
  const end = addDays(today, -1);
  const start = addDays(today, -days);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(start, -days);

  const rows = active.map((habit) => ({
    ...describeHabit(habit),
    period: windowStats(habit, history, start, end),
    previous_period: windowStats(habit, history, prevStart, prevEnd),
  }));

  const total = (key: 'period' | 'previous_period') => {
    const done = rows.reduce((sum, row) => sum + row[key].done, 0);
    const tracked = rows.reduce((sum, row) => sum + row[key].tracked, 0);
    return { done, tracked, rate: percent(done, tracked) };
  };

  // Days on which every habit that existed that day was completed.
  let perfectDays = 0;
  let measuredDays = 0;
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const due = active.filter((h) => h.created_at_day <= day);
    if (due.length === 0) continue;
    measuredDays++;
    const done = due.every((h) =>
      history.some((e) => e.habit_id === h.id && e.date === day && e.completed),
    );
    if (done) perfectDays++;
  }

  const summary: HabitSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    rate: row.period.rate,
    done: row.period.done,
    tracked: row.period.tracked,
  }));
  return {
    snapshot: {
      period: { start, end, days },
      overall: total('period'),
      previous_overall: total('previous_period'),
      perfect_days: { count: perfectDays, out_of: measuredDays },
      habits: rows,
      challenge: describeChallenge(challenge, active),
    },
    summary,
    period: { start, end },
    hasData: rows.some((row) => row.period.tracked > 0),
  };
}

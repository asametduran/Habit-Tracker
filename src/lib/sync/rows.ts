import { daysBetween, type HabitType, type Reminder, type Settings } from '@/lib/habit-logic';

// Database rows, as stored in Supabase and in the local replica, plus the rules for merging a
// local row with the server's. Pure: no React, no I/O — `scripts/check-sync.mjs` runs it in Node.

export const ZERO_TIME = '1970-01-01T00:00:00.000Z';

export type HabitRow = {
  id: string;
  name: string;
  type: HabitType;
  target: number | null;
  count: number;
  streak: number;
  best_streak: number;
  count_date: string; // the day `count` and `streak` are valid for
  created_at_day: string;
  reminder: Reminder | null;
  deleted_at: string | null;
  updated_at: string;
};

export type HistoryRow = {
  habit_id: string;
  date: string;
  count: number;
  completed: boolean;
  updated_at: string;
};

export type ChallengeRow = {
  name: string | null;
  habit_ids: string[];
  duration_days: number;
  start_date: string;
  days_completed: number;
  status: 'active' | 'completed' | 'failed';
  celebrated: boolean;
  deleted_at: string | null;
  updated_at: string;
};

export type UserStateRow = {
  settings: Partial<Settings>;
  onboarding_complete: boolean;
  last_rollover_date: string | null;
  updated_at: string;
};

/** A local row plus the last version of it the server confirmed (`null`: never synced). */
export type Tracked<T> = { row: T; base: T | null };

type Timed = { updated_at: string };

/** JSON with sorted keys, so two rows with the same content always serialize the same. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function timeOf(iso: string | null | undefined): number {
  const time = iso ? Date.parse(iso) : 0;
  return Number.isNaN(time) ? 0 : time;
}

export function laterOf(a: string, b: string): string {
  return timeOf(a) >= timeOf(b) ? a : b;
}

/** Same row apart from `updated_at`. */
export function sameContent<T extends Timed>(a: T, b: T): boolean {
  if (a === b) return true;
  return stableJson({ ...a, updated_at: '' }) === stableJson({ ...b, updated_at: '' });
}

/** Has local changes the server hasn't confirmed. */
export function isDirty<T extends Timed>(tracked: Tracked<T>): boolean {
  return tracked.base === null || !sameContent(tracked.row, tracked.base);
}

/** The local copy already is exactly this server row. */
function isCurrent<T extends Timed>(local: Tracked<T>, remote: T): boolean {
  return (
    !isDirty(local) && sameContent(local.row, remote) && local.row.updated_at === remote.updated_at
  );
}

function synced<T>(row: T): Tracked<T> {
  return { row, base: row };
}

export function rowCompleted(row: Pick<HabitRow, 'type' | 'count' | 'target'>): boolean {
  return row.type === 'daily' ? row.count >= 1 : row.count >= (row.target ?? 1);
}

/**
 * Brings a habit row forward to `date`: its count is logged as the closed day's history entry
 * and reset, and the streak survives only if that day was completed and was yesterday.
 */
export function normalizeHabitRow(
  row: HabitRow,
  date: string,
): { row: HabitRow; closed: HistoryRow | null } {
  if (row.deleted_at !== null || row.count_date >= date) return { row, closed: null };
  const completed = rowCompleted(row);
  return {
    row: {
      ...row,
      count: 0,
      streak: completed && daysBetween(row.count_date, date) === 1 ? row.streak : 0,
      count_date: date,
    },
    closed: {
      habit_id: row.id,
      date: row.count_date,
      count: row.count,
      completed,
      updated_at: row.updated_at,
    },
  };
}

// A habit row carries two independent things: what the habit is, and today's progress on it.
// Renaming a habit on one device must not undo a check-off made on another, so they merge apart.
function definitionKey(row: HabitRow): string {
  return stableJson([
    row.name,
    row.type,
    row.target,
    row.reminder,
    row.created_at_day,
    row.deleted_at !== null,
  ]);
}

function progressKey(row: HabitRow): string {
  return `${row.count}|${row.streak}|${row.best_streak}|${row.count_date}`;
}

/**
 * Three-way merge of a habit against the server's row. A side that didn't change since `base`
 * never wins. Conflicting definitions: newest wins. Conflicting progress: both sides are brought
 * to the same day and the higher count/streak is kept, so a device that closed a day without
 * seeing a check-off can't break the streak. `closed` holds the history entries that produced.
 */
export function mergeHabit(
  local: Tracked<HabitRow> | undefined,
  remote: HabitRow,
): { tracked: Tracked<HabitRow> | null; closed: HistoryRow[] } {
  if (!local) return { tracked: remote.deleted_at === null ? synced(remote) : null, closed: [] };
  if (isCurrent(local, remote)) return { tracked: local, closed: [] };
  const { row, base } = local;

  const localDef = base === null || definitionKey(row) !== definitionKey(base);
  const remoteDef = base === null || definitionKey(remote) !== definitionKey(base);
  const remoteNewer = timeOf(remote.updated_at) >= timeOf(row.updated_at);
  const def = !localDef ? remote : !remoteDef ? row : remoteNewer ? remote : row;

  if (def.deleted_at !== null) {
    // Deleted on the server (or on both sides): nothing left to keep locally.
    if (remote.deleted_at !== null) return { tracked: null, closed: [] };
    return { tracked: { row, base: remote }, closed: [] };
  }

  const localProg = base === null || progressKey(row) !== progressKey(base);
  const remoteProg = base === null || progressKey(remote) !== progressKey(base);
  const closed: HistoryRow[] = [];
  let prog: Pick<HabitRow, 'count' | 'streak' | 'best_streak' | 'count_date'>;
  if (!localProg) prog = remote;
  else if (!remoteProg) prog = row;
  else {
    const day = row.count_date >= remote.count_date ? row.count_date : remote.count_date;
    const mine = normalizeHabitRow({ ...row, deleted_at: null }, day);
    const theirs = normalizeHabitRow({ ...remote, deleted_at: null }, day);
    if (mine.closed) closed.push(mine.closed);
    if (theirs.closed) closed.push(theirs.closed);
    prog = {
      count: Math.max(mine.row.count, theirs.row.count),
      streak: Math.max(mine.row.streak, theirs.row.streak),
      best_streak: Math.max(mine.row.best_streak, theirs.row.best_streak),
      count_date: day,
    };
  }

  const merged: HabitRow = {
    ...def,
    count: prog.count,
    streak: prog.streak,
    best_streak: Math.max(prog.best_streak, prog.streak),
    count_date: prog.count_date,
    updated_at: laterOf(row.updated_at, remote.updated_at),
  };
  if (sameContent(merged, remote)) return { tracked: synced(remote), closed };
  return { tracked: { row: merged, base: remote }, closed };
}

/** A logged day only ever goes up: highest count wins, and completed stays completed. */
export function mergeHistory(
  local: Tracked<HistoryRow> | undefined,
  remote: HistoryRow,
): Tracked<HistoryRow> {
  if (!local) return synced(remote);
  if (isCurrent(local, remote)) return local;
  const count = Math.max(local.row.count, remote.count);
  const completed = local.row.completed || remote.completed;
  if (count === remote.count && completed === remote.completed) return synced(remote);
  return {
    row: { ...local.row, count, completed, updated_at: laterOf(local.row.updated_at, remote.updated_at) },
    base: remote,
  };
}

/**
 * The single challenge row. A never-synced local challenge yields to the account's. When both
 * sides advanced the same challenge, the one further along wins; otherwise the newest wins.
 */
export function mergeChallenge(
  local: Tracked<ChallengeRow> | null,
  remote: ChallengeRow | null,
): Tracked<ChallengeRow> | null {
  if (!remote) {
    if (!local || local.base === null) return local;
    return { row: local.row, base: null };
  }
  if (!local || local.base === null) return synced(remote);
  if (isCurrent(local, remote)) return local;
  if (!isDirty(local)) return synced(remote);
  if (sameContent(remote, local.base)) {
    return remote.updated_at === local.base.updated_at ? local : { row: local.row, base: remote };
  }

  const { row } = local;
  const remoteNewer = timeOf(remote.updated_at) >= timeOf(row.updated_at);
  const sameChallenge =
    row.deleted_at === null &&
    remote.deleted_at === null &&
    row.start_date === remote.start_date &&
    stableJson(row.habit_ids) === stableJson(remote.habit_ids);
  if (!sameChallenge) return remoteNewer ? synced(remote) : { row, base: remote };

  const useRemote =
    remote.days_completed !== row.days_completed
      ? remote.days_completed > row.days_completed
      : remoteNewer;
  const winner = useRemote ? remote : row;
  const merged: ChallengeRow = {
    ...winner,
    celebrated: row.celebrated || remote.celebrated,
    updated_at: laterOf(row.updated_at, remote.updated_at),
  };
  return sameContent(merged, remote) ? synced(remote) : { row: merged, base: remote };
}

/**
 * The single settings/progress row. Settings: three-way, newest wins a real conflict, and a
 * never-synced device takes the account's. Onboarding stays done once done anywhere.
 */
export function mergeUserState(
  local: Tracked<UserStateRow>,
  remote: UserStateRow | null,
): Tracked<UserStateRow> {
  if (!remote) return local.base === null ? local : { row: local.row, base: null };
  if (isCurrent(local, remote)) return local;
  const { row, base } = local;
  const remoteNewer = timeOf(remote.updated_at) >= timeOf(row.updated_at);

  let settings = remote.settings;
  let day = remote.last_rollover_date;
  if (base !== null) {
    const localSet = stableJson(row.settings) !== stableJson(base.settings);
    const remoteSet = stableJson(remote.settings) !== stableJson(base.settings);
    if (localSet && (!remoteSet || !remoteNewer)) settings = row.settings;
  }
  const localDay = base === null || row.last_rollover_date !== base.last_rollover_date;
  const remoteDay = base === null || remote.last_rollover_date !== base.last_rollover_date;
  if (localDay && !remoteDay) day = row.last_rollover_date;
  else if (localDay && remoteDay) {
    day = (row.last_rollover_date ?? '') > (remote.last_rollover_date ?? '') ? row.last_rollover_date : day;
  }

  const merged: UserStateRow = {
    settings,
    onboarding_complete: row.onboarding_complete || remote.onboarding_complete,
    last_rollover_date: day,
    updated_at: laterOf(row.updated_at, remote.updated_at),
  };
  return sameContent(merged, remote) ? synced(remote) : { row: merged, base: remote };
}

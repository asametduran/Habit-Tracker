import {
  DEFAULT_SETTINGS,
  addDays,
  cleanName,
  type Challenge,
  type Habit,
  type HabitState,
  type HistoryEntry,
} from '@/lib/habit-logic';
import type { Cursors, PushResult, RemoteSnapshot, RowBatch } from '@/lib/sync/remote-store';
import {
  ZERO_TIME,
  isDirty,
  mergeChallenge,
  mergeHabit,
  mergeHistory,
  mergeUserState,
  normalizeHabitRow,
  sameContent,
  stableJson,
  type ChallengeRow,
  type HabitRow,
  type HistoryRow,
  type Tracked,
  type UserStateRow,
} from '@/lib/sync/rows';

/**
 * The local copy of the user's database rows: what gets saved on the device and synced.
 * `HabitState` (what screens read) is derived from it, and every state change is written back
 * into it with `applyState`. Replicas are immutable — every function returns a new one, reusing
 * the parts that didn't change, so "what changed" is a reference comparison.
 */
export type Replica = {
  /** The account these rows belong to; `null` until someone signs in on this device. */
  owner: string | null;
  epoch: string | null;
  cursors: Cursors;
  lastSyncedAt: string | null;
  habits: Record<string, Tracked<HabitRow>>;
  history: Record<string, Tracked<HistoryRow>>;
  challenge: Tracked<ChallengeRow> | null;
  userState: Tracked<UserStateRow>;
};

export function historyKey(habitId: string, date: string): string {
  return `${habitId}|${date}`;
}

export function emptyReplica(owner: string | null = null): Replica {
  return {
    owner,
    epoch: null,
    cursors: { habits: null, history: null },
    lastSyncedAt: null,
    habits: {},
    history: {},
    challenge: null,
    userState: {
      row: { settings: {}, onboarding_complete: false, last_rollover_date: null, updated_at: ZERO_TIME },
      base: null,
    },
  };
}

// --- state → replica --------------------------------------------------------------------

function sameSettings(a: UserStateRow['settings'], b: UserStateRow['settings']): boolean {
  return (
    stableJson({ ...DEFAULT_SETTINGS, ...a }) === stableJson({ ...DEFAULT_SETTINGS, ...b })
  );
}

/** Raises logged days (never lowers them) as local changes. Copies `history` only if needed. */
function logDays(
  history: Record<string, Tracked<HistoryRow>>,
  entries: Omit<HistoryRow, 'updated_at'>[],
  now: string,
): Record<string, Tracked<HistoryRow>> {
  let out = history;
  for (const entry of entries) {
    const key = historyKey(entry.habit_id, entry.date);
    const existing = out[key];
    const count = Math.max(existing?.row.count ?? 0, entry.count);
    const completed = (existing?.row.completed ?? false) || entry.completed;
    if (existing && existing.row.count === count && existing.row.completed === completed) continue;
    if (out === history) out = { ...history };
    out[key] = {
      row: { habit_id: entry.habit_id, date: entry.date, count, completed, updated_at: now },
      base: existing?.base ?? null,
    };
  }
  return out;
}

/** Writes a new UI state into the replica. `prev` is the state the replica currently reflects. */
export function applyState(
  replica: Replica,
  prev: HabitState | null,
  next: HabitState,
  now: string,
): Replica {
  let { habits, history, challenge, userState } = replica;
  const dayChanged = prev === null || prev.lastRolloverDate !== next.lastRolloverDate;

  if (prev === null || prev.habits !== next.habits || dayChanged) {
    const out: Record<string, Tracked<HabitRow>> = {};
    let changed = false;
    for (const habit of next.habits) {
      const existing = habits[habit.id];
      const row: HabitRow = {
        id: habit.id,
        name: habit.name,
        type: habit.type,
        target: habit.target ?? null,
        count: habit.count,
        streak: habit.streak,
        best_streak: habit.bestStreak,
        count_date: next.lastRolloverDate,
        created_at_day: habit.createdAt,
        reminder: habit.reminder ?? null,
        deleted_at: null,
        updated_at: now,
      };
      if (existing && sameContent(existing.row, row)) out[habit.id] = existing;
      else {
        out[habit.id] = { row, base: existing?.base ?? null };
        changed = true;
      }
    }
    for (const [id, tracked] of Object.entries(habits)) {
      if (out[id]) continue;
      if (tracked.row.deleted_at !== null) out[id] = tracked;
      else {
        changed = true;
        // The server has it, so it needs to be told; a habit it never saw can just go.
        if (tracked.base !== null) {
          out[id] = { row: { ...tracked.row, deleted_at: now, updated_at: now }, base: tracked.base };
        }
      }
    }
    if (changed) habits = out;
  }

  if (prev === null || prev.history !== next.history) {
    history = logDays(
      history,
      next.history.map((entry) => ({
        habit_id: entry.habitId,
        date: entry.date,
        count: entry.count,
        completed: entry.completed,
      })),
      now,
    );
  }

  if (prev === null || prev.challenge !== next.challenge) {
    const current = next.challenge;
    if (current === null) {
      if (challenge && challenge.row.deleted_at === null) {
        challenge =
          challenge.base === null
            ? null
            : { row: { ...challenge.row, deleted_at: now, updated_at: now }, base: challenge.base };
      }
    } else {
      const row: ChallengeRow = {
        name: current.name ?? null,
        habit_ids: current.habitIds,
        duration_days: current.durationDays,
        start_date: current.startDate,
        days_completed: current.daysCompleted,
        status: current.status,
        celebrated: current.celebrated ?? false,
        deleted_at: null,
        updated_at: now,
      };
      if (!challenge || !sameContent(challenge.row, row)) {
        challenge = { row, base: challenge?.base ?? null };
      }
    }
  }

  const stored = userState.row;
  if (
    stored.onboarding_complete !== next.onboardingComplete ||
    stored.last_rollover_date !== next.lastRolloverDate ||
    !sameSettings(stored.settings, next.settings)
  ) {
    userState = {
      row: {
        settings: sameSettings(stored.settings, next.settings) ? stored.settings : next.settings,
        onboarding_complete: next.onboardingComplete,
        last_rollover_date: next.lastRolloverDate,
        updated_at: now,
      },
      base: userState.base,
    };
  }

  if (
    habits === replica.habits &&
    history === replica.history &&
    challenge === replica.challenge &&
    userState === replica.userState
  ) {
    return replica;
  }
  return { ...replica, habits, history, challenge, userState };
}

// --- replica → state --------------------------------------------------------------------

function toHabit(row: HabitRow): Habit {
  const habit: Habit = {
    id: row.id,
    // Rows written by an older app version can be longer; the next write sends it back cut.
    name: cleanName(row.name),
    type: row.type,
    count: row.count,
    streak: row.streak,
    bestStreak: row.best_streak,
    createdAt: row.created_at_day,
  };
  if (row.target !== null) habit.target = row.target;
  if (row.reminder !== null) habit.reminder = row.reminder;
  return habit;
}

function toChallenge(tracked: Tracked<ChallengeRow> | null): Challenge | null {
  if (!tracked || tracked.row.deleted_at !== null) return null;
  const { row } = tracked;
  const challenge: Challenge = {
    habitIds: row.habit_ids,
    durationDays: row.duration_days,
    startDate: row.start_date,
    daysCompleted: row.days_completed,
    status: row.status,
    celebrated: row.celebrated,
  };
  const name = row.name === null ? '' : cleanName(row.name);
  if (name) challenge.name = name;
  return challenge;
}

/**
 * The UI state a replica describes. Pass the previous replica/state pair to keep the pieces
 * that didn't change (same object), so screens don't re-render for nothing.
 */
export function replicaToState(
  replica: Replica,
  today: string,
  prev?: { replica: Replica; state: HabitState },
): HabitState {
  const row = replica.userState.row;
  const same = prev && prev.replica.userState === replica.userState;

  const habits: Habit[] =
    prev && prev.replica.habits === replica.habits
      ? prev.state.habits
      : Object.values(replica.habits)
          .filter((tracked) => tracked.row.deleted_at === null)
          .map((tracked) => toHabit(tracked.row))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const history: HistoryEntry[] =
    prev && prev.replica.history === replica.history
      ? prev.state.history
      : Object.values(replica.history)
          .map(({ row: entry }) => ({
            date: entry.date,
            habitId: entry.habit_id,
            count: entry.count,
            completed: entry.completed,
          }))
          .sort((a, b) =>
            a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.habitId < b.habitId ? -1 : 1,
          );

  const challenge =
    prev && prev.replica.challenge === replica.challenge
      ? prev.state.challenge
      : toChallenge(replica.challenge);

  const state: HabitState = {
    habits,
    history,
    challenge,
    lastRolloverDate: same ? prev.state.lastRolloverDate : (row.last_rollover_date ?? today),
    onboardingComplete: row.onboarding_complete,
    settings: same ? prev.state.settings : { ...DEFAULT_SETTINGS, ...row.settings },
  };
  if (
    prev &&
    same &&
    habits === prev.state.habits &&
    history === prev.state.history &&
    challenge === prev.state.challenge
  ) {
    return prev.state;
  }
  return state;
}

// --- sync -------------------------------------------------------------------------------

/**
 * A device that closed a day without seeing another device's check-offs marks the challenge
 * failed. Once the merged history shows those days were won, count them again. Only ever
 * moves a challenge forward — a real failure is never undone by missing data.
 */
function repairChallenge(
  row: ChallengeRow,
  history: Record<string, Tracked<HistoryRow>>,
  asOf: string | null,
): ChallengeRow {
  if (row.deleted_at !== null || row.status === 'completed' || !asOf) return row;
  if (row.habit_ids.length === 0) return row;
  let days = 0;
  let status: ChallengeRow['status'] = 'active';
  for (let day = row.start_date; day < asOf && status === 'active'; day = addDays(day, 1)) {
    const won = row.habit_ids.every((id) => history[historyKey(id, day)]?.row.completed);
    if (!won) status = 'failed';
    else if (++days >= row.duration_days) status = 'completed';
  }
  if (status === 'failed' || days <= row.days_completed) return row;
  return { ...row, days_completed: days, status };
}

/** Merges rows pulled from the server. Returns the same replica if nothing changed. */
export function mergePulled(replica: Replica, snap: RemoteSnapshot, now: string): Replica {
  let habits = replica.habits;
  let history = replica.history;
  const closed: HistoryRow[] = [];

  for (const remote of snap.habits) {
    const local = habits[remote.id];
    const merged = mergeHabit(local, remote);
    closed.push(...merged.closed);
    if (merged.tracked === local || (!merged.tracked && !local)) continue;
    if (habits === replica.habits) habits = { ...habits };
    if (merged.tracked) habits[remote.id] = merged.tracked;
    else delete habits[remote.id];
  }

  for (const remote of snap.history) {
    const key = historyKey(remote.habit_id, remote.date);
    const merged = mergeHistory(history[key], remote);
    if (merged === history[key]) continue;
    if (history === replica.history) history = { ...history };
    history[key] = merged;
  }

  let challenge = mergeChallenge(replica.challenge, snap.challenge);
  let userState = mergeUserState(replica.userState, snap.userState);

  // Everything has to describe the same day: the latest one any device has reached.
  let asOf = userState.row.last_rollover_date;
  for (const { row } of Object.values(habits)) {
    if (row.deleted_at === null && (asOf === null || row.count_date > asOf)) asOf = row.count_date;
  }
  if (asOf !== null) {
    for (const [id, tracked] of Object.entries(habits)) {
      const normalized = normalizeHabitRow(tracked.row, asOf);
      if (normalized.row === tracked.row) continue;
      if (normalized.closed) closed.push(normalized.closed);
      if (habits === replica.habits) habits = { ...habits };
      habits[id] = { row: { ...normalized.row, updated_at: now }, base: tracked.base };
    }
    if (userState.row.last_rollover_date !== asOf) {
      userState = {
        row: { ...userState.row, last_rollover_date: asOf, updated_at: now },
        base: userState.base,
      };
    }
  }
  history = logDays(history, closed, now);

  if (challenge) {
    const repaired = repairChallenge(challenge.row, history, asOf);
    if (repaired !== challenge.row) {
      challenge = { row: { ...repaired, updated_at: now }, base: challenge.base };
    }
  }

  const epoch = snap.epoch ?? replica.epoch;
  if (
    habits === replica.habits &&
    history === replica.history &&
    challenge === replica.challenge &&
    userState === replica.userState &&
    epoch === replica.epoch &&
    snap.cursors.habits === replica.cursors.habits &&
    snap.cursors.history === replica.cursors.history
  ) {
    return replica;
  }
  return { ...replica, habits, history, challenge, userState, epoch, cursors: snap.cursors };
}

/** Everything the server hasn't confirmed yet. */
export function collectDirty(replica: Replica): RowBatch {
  const dirty = <T extends { updated_at: string }>(tracked: Tracked<T>[]) =>
    tracked.filter(isDirty).map((t) => t.row);
  return {
    habits: dirty(Object.values(replica.habits)),
    history: dirty(Object.values(replica.history)),
    challenge: replica.challenge && isDirty(replica.challenge) ? replica.challenge.row : null,
    userState: isDirty(replica.userState) ? replica.userState.row : null,
  };
}

export function pendingCount(replica: Replica): number {
  const batch = collectDirty(replica);
  return (
    batch.habits.length +
    batch.history.length +
    (batch.challenge ? 1 : 0) +
    (batch.userState ? 1 : 0)
  );
}

/**
 * Records what the server stored for a push. A row edited while the push was in flight keeps
 * its local value and stays dirty — only its base moves to what the server now has.
 */
export function ackPushed(replica: Replica, sent: RowBatch, result: PushResult, now: string): Replica {
  const ack = <T extends { updated_at: string }>(
    current: Tracked<T>,
    sentRow: T,
    stored: T,
  ): Tracked<T> =>
    sameContent(current.row, sentRow) ? { row: stored, base: stored } : { row: current.row, base: stored };

  const habits = { ...replica.habits };
  const storedHabits = new Map(result.habits.map((row) => [row.id, row]));
  for (const sentRow of sent.habits) {
    const stored = storedHabits.get(sentRow.id);
    if (!stored) continue;
    const current = habits[sentRow.id];
    if (!current) {
      // Removed locally while its first push was in flight: the server has it now, so undo that.
      if (stored.deleted_at === null) {
        habits[sentRow.id] = { row: { ...stored, deleted_at: now, updated_at: now }, base: stored };
      }
    } else if (stored.deleted_at !== null && sameContent(current.row, sentRow)) {
      delete habits[sentRow.id]; // the server knows it's gone; nothing left to remember
    } else {
      habits[sentRow.id] = ack(current, sentRow, stored);
    }
  }

  const history = { ...replica.history };
  const storedHistory = new Map(
    result.history.map((row) => [historyKey(row.habit_id, row.date), row]),
  );
  for (const sentRow of sent.history) {
    const key = historyKey(sentRow.habit_id, sentRow.date);
    const stored = storedHistory.get(key);
    if (stored && history[key]) history[key] = ack(history[key], sentRow, stored);
  }

  let { challenge, userState } = replica;
  if (sent.challenge && result.challenge && challenge) {
    challenge = ack(challenge, sent.challenge, result.challenge);
  }
  if (sent.userState && result.userState) {
    userState = ack(userState, sent.userState, result.userState);
  }
  return { ...replica, habits, history, challenge, userState, epoch: result.epoch ?? replica.epoch };
}

/** First sign-in on this device: its rows now belong to `userId` and none are synced yet. */
export function adoptReplica(replica: Replica, userId: string): Replica {
  const unsynced = <T>(records: Record<string, Tracked<T>>) =>
    Object.fromEntries(
      Object.entries(records).map(([key, tracked]) => [key, { row: tracked.row, base: null }]),
    );
  return {
    owner: userId,
    epoch: null,
    cursors: { habits: null, history: null },
    lastSyncedAt: null,
    habits: unsynced(replica.habits),
    history: unsynced(replica.history),
    challenge: replica.challenge && { row: replica.challenge.row, base: null },
    userState: { row: replica.userState.row, base: null },
  };
}

// --- storage ----------------------------------------------------------------------------
// One entry per row: `m` (meta), `h:<id>`, `y:<habit_id>|<date>`, `c`, `u`. A row equal to
// its base is stored once (`s: 1`), which also makes it cheap to recognize as clean on load.

type Stored<T> = { r: T; s: 1 } | { r: T; b: T | null };

function encode<T extends { updated_at: string }>(tracked: Tracked<T>): string {
  const clean =
    tracked.base !== null &&
    sameContent(tracked.row, tracked.base) &&
    tracked.row.updated_at === tracked.base.updated_at;
  const stored: Stored<T> = clean ? { r: tracked.row, s: 1 } : { r: tracked.row, b: tracked.base };
  return JSON.stringify(stored);
}

function decode<T>(raw: string | undefined): Tracked<T> | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Stored<T>;
    if (!stored || typeof stored !== 'object' || !stored.r) return null;
    return 's' in stored ? { row: stored.r, base: stored.r } : { row: stored.r, base: stored.b ?? null };
  } catch {
    return null;
  }
}

function encodeMeta(replica: Replica): string {
  const { owner, epoch, cursors, lastSyncedAt } = replica;
  return JSON.stringify({ owner, epoch, cursors, lastSyncedAt });
}

export function serializeReplica(replica: Replica): Record<string, string> {
  const out: Record<string, string> = { m: encodeMeta(replica), u: encode(replica.userState) };
  for (const [id, tracked] of Object.entries(replica.habits)) out[`h:${id}`] = encode(tracked);
  for (const [key, tracked] of Object.entries(replica.history)) out[`y:${key}`] = encode(tracked);
  if (replica.challenge) out.c = encode(replica.challenge);
  return out;
}

/** `null` when the entries don't hold a replica (nothing saved yet). Unreadable rows are skipped. */
export function deserializeReplica(entries: Record<string, string>): Replica | null {
  if (!entries.m) return null;
  let meta: Partial<Pick<Replica, 'owner' | 'epoch' | 'cursors' | 'lastSyncedAt'>>;
  try {
    meta = JSON.parse(entries.m) ?? {};
  } catch {
    return null;
  }
  const replica = emptyReplica(meta.owner ?? null);
  replica.epoch = meta.epoch ?? null;
  replica.cursors = { habits: meta.cursors?.habits ?? null, history: meta.cursors?.history ?? null };
  replica.lastSyncedAt = meta.lastSyncedAt ?? null;
  replica.challenge = decode<ChallengeRow>(entries.c);
  replica.userState = decode<UserStateRow>(entries.u) ?? replica.userState;
  for (const [key, raw] of Object.entries(entries)) {
    if (key.startsWith('h:')) {
      const tracked = decode<HabitRow>(raw);
      if (tracked) replica.habits[key.slice(2)] = tracked;
    } else if (key.startsWith('y:')) {
      const tracked = decode<HistoryRow>(raw);
      if (tracked) replica.history[key.slice(2)] = tracked;
    }
  }
  return replica;
}

export type ReplicaDelta = { put: Record<string, string>; del: string[] };

/** The entries to write to turn the saved `prev` into `next`. `prev === null`: write it all. */
export function diffReplica(prev: Replica | null, next: Replica): ReplicaDelta {
  if (prev === null) return { put: serializeReplica(next), del: [] };
  const put: Record<string, string> = {};
  const del: string[] = [];
  const meta = encodeMeta(next);
  if (meta !== encodeMeta(prev)) put.m = meta;
  if (next.userState !== prev.userState) put.u = encode(next.userState);
  if (next.challenge !== prev.challenge) {
    if (next.challenge) put.c = encode(next.challenge);
    else del.push('c');
  }
  const rows = <T extends { updated_at: string }>(
    prefix: string,
    before: Record<string, Tracked<T>>,
    after: Record<string, Tracked<T>>,
  ) => {
    if (before === after) return;
    for (const [key, tracked] of Object.entries(after)) {
      if (before[key] !== tracked) put[prefix + key] = encode(tracked);
    }
    for (const key of Object.keys(before)) {
      if (!(key in after)) del.push(prefix + key);
    }
  };
  rows('h:', prev.habits, next.habits);
  rows('y:', prev.history, next.history);
  return { put, del };
}

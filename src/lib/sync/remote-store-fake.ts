import { historyKey } from '@/lib/sync/replica';
import type { Cursors, RemoteStore } from '@/lib/sync/remote-store';
import {
  sameContent,
  timeOf,
  type ChallengeRow,
  type HabitRow,
  type HistoryRow,
  type UserStateRow,
} from '@/lib/sync/rows';

// In-memory stand-in for Supabase, used by `scripts/check-sync.mjs`. It mirrors what the
// migration makes the real server do: the server sets `updated_at`, an unchanged write keeps
// its timestamp, a logged day never goes down, and reset rotates the data epoch.

type Account = {
  habits: Map<string, HabitRow>;
  history: Map<string, HistoryRow>;
  challenge: ChallengeRow | null;
  userState: UserStateRow | null;
  epoch: string | null;
};

const OVERLAP_MS = 5000;

export function createFakeServer(now: () => string) {
  const accounts = new Map<string, Account>();
  const failures = { pull: 0, push: 0 };
  const hooks: { beforePush: (() => void) | null } = { beforePush: null };
  let epochs = 0;

  function account(userId: string): Account {
    let found = accounts.get(userId);
    if (!found) {
      found = { habits: new Map(), history: new Map(), challenge: null, userState: null, epoch: null };
      accounts.set(userId, found);
    }
    return found;
  }

  function touch<T extends { updated_at: string }>(old: T | null | undefined, incoming: T): T {
    return old && sameContent(old, incoming) ? old : { ...incoming, updated_at: now() };
  }

  function since<T extends { updated_at: string }>(rows: Iterable<T>, cursor: string | null) {
    const from = cursor === null ? -Infinity : timeOf(cursor) - OVERLAP_MS;
    const found = [...rows].filter((row) => timeOf(row.updated_at) > from);
    const newest = found.reduce<string | null>(
      (max, row) => (max === null || timeOf(row.updated_at) > timeOf(max) ? row.updated_at : max),
      cursor,
    );
    return { rows: found, cursor: newest };
  }

  function remoteFor(userId: string): RemoteStore {
    return {
      async pull(cursors: Cursors) {
        if (failures.pull > 0) {
          failures.pull--;
          throw new Error('network down');
        }
        const data = account(userId);
        const habits = since(data.habits.values(), cursors.habits);
        const history = since(data.history.values(), cursors.history);
        return structuredClone({
          habits: habits.rows,
          history: history.rows,
          challenge: data.challenge,
          userState: data.userState,
          epoch: data.epoch,
          cursors: { habits: habits.cursor, history: history.cursor },
        });
      },
      async push(batch) {
        const hook = hooks.beforePush;
        hooks.beforePush = null;
        hook?.();
        if (failures.push > 0) {
          failures.push--;
          throw new Error('network down');
        }
        const data = account(userId);
        const sent = structuredClone(batch);
        const habits = sent.habits.map((row) => {
          const stored = touch(data.habits.get(row.id), row);
          data.habits.set(row.id, stored);
          return stored;
        });
        const history = sent.history.map((row) => {
          const key = historyKey(row.habit_id, row.date);
          const old = data.history.get(key);
          const stored = touch(old, {
            ...row,
            count: Math.max(old?.count ?? 0, row.count),
            completed: (old?.completed ?? false) || row.completed,
          });
          data.history.set(key, stored);
          return stored;
        });
        if (sent.challenge) data.challenge = touch(data.challenge, sent.challenge);
        if (sent.userState) {
          data.userState = touch(data.userState, sent.userState);
          data.epoch ??= `epoch-${++epochs}`;
        }
        return structuredClone({
          habits,
          history,
          challenge: sent.challenge ? data.challenge : null,
          userState: sent.userState ? data.userState : null,
          epoch: sent.userState ? data.epoch : null,
        });
      },
      async reset() {
        const epoch = `epoch-${++epochs}`;
        accounts.set(userId, {
          habits: new Map(),
          history: new Map(),
          challenge: null,
          userState: {
            settings: {},
            onboarding_complete: false,
            last_rollover_date: null,
            updated_at: now(),
          },
          epoch,
        });
        return epoch;
      },
    };
  }

  return {
    remoteFor,
    /** What the server holds for a user, for assertions. */
    account,
    /** Makes the next pull or push throw, like a dropped connection. */
    failNext(operation: 'pull' | 'push') {
      failures[operation]++;
    },
    /** `beforePush` runs once, just before the next push is applied. */
    hooks,
  };
}

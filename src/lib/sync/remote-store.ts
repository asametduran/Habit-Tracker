import type { ChallengeRow, HabitRow, HistoryRow, UserStateRow } from '@/lib/sync/rows';

/** Newest server `updated_at` already pulled, per table. `null`: pull everything. */
export type Cursors = { habits: string | null; history: string | null };

export type RemoteSnapshot = {
  habits: HabitRow[];
  history: HistoryRow[];
  /** The single-row tables are always read in full; `null` means the server has no row. */
  challenge: ChallengeRow | null;
  userState: UserStateRow | null;
  epoch: string | null;
  cursors: Cursors;
};

export type RowBatch = {
  habits: HabitRow[];
  history: HistoryRow[];
  challenge: ChallengeRow | null;
  userState: UserStateRow | null;
};

/** The rows as the server stored them (it sets `updated_at` and may keep a higher history count). */
export type PushResult = RowBatch & { epoch: string | null };

/**
 * The signed-in user's data on the server. `remote-store-supabase.ts` is the real one;
 * `remote-store-fake.ts` is an in-memory stand-in for `scripts/check-sync.mjs`.
 */
export type RemoteStore = {
  pull(cursors: Cursors): Promise<RemoteSnapshot>;
  push(batch: RowBatch): Promise<PushResult>;
  /** Deletes everything the user has and returns the new data epoch. */
  reset(): Promise<string>;
};

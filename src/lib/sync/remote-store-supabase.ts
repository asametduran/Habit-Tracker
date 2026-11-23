import type { SupabaseClient } from '@supabase/supabase-js';

import type { Cursors, RemoteStore } from '@/lib/sync/remote-store';
import {
  timeOf,
  type ChallengeRow,
  type HabitRow,
  type HistoryRow,
  type UserStateRow,
} from '@/lib/sync/rows';

// The signed-in user's rows in Supabase (tables: supabase/migrations). Row Level Security
// already limits every query to the caller's rows; the user_id filters keep the indexes in use.

const PAGE = 1000;
const CHUNK = 500;
// Re-read a little before the cursor: a row committed by another device just after a pull can
// carry a slightly earlier timestamp. Rows seen twice merge to themselves.
const OVERLAP_MS = 5000;

const HABIT_COLUMNS =
  'id,name,type,target,count,streak,best_streak,count_date,created_at_day,reminder,deleted_at,updated_at';
const HISTORY_COLUMNS = 'habit_id,date,count,completed,updated_at';
const CHALLENGE_COLUMNS =
  'name,habit_ids,duration_days,start_date,days_completed,status,celebrated,deleted_at,updated_at';
const USER_STATE_COLUMNS = 'settings,onboarding_complete,last_rollover_date,updated_at';

type StoredUserState = UserStateRow & { data_epoch: string };

function splitEpoch(stored: StoredUserState | null) {
  if (!stored) return { userState: null, epoch: null };
  const { data_epoch: epoch, ...userState } = stored;
  return { userState, epoch };
}

export function createSupabaseRemote(client: SupabaseClient, userId: string): RemoteStore {
  async function pullSince<T extends { updated_at: string }>(
    table: string,
    columns: string,
    keys: string[],
    cursor: string | null,
  ): Promise<{ rows: T[]; cursor: string | null }> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = client.from(table).select(columns).eq('user_id', userId);
      if (cursor !== null) {
        query = query.gt('updated_at', new Date(timeOf(cursor) - OVERLAP_MS).toISOString());
      }
      query = query.order('updated_at', { ascending: true });
      for (const key of keys) query = query.order(key, { ascending: true });
      const { data, error } = await query.range(from, from + PAGE - 1);
      if (error) throw error;
      const page = (data ?? []) as unknown as T[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    const newest = rows.reduce<string | null>(
      (max, row) => (max === null || timeOf(row.updated_at) > timeOf(max) ? row.updated_at : max),
      cursor,
    );
    return { rows, cursor: newest };
  }

  async function pullOne<T>(table: string, columns: string): Promise<T | null> {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as T | null;
  }

  /** Writes rows and returns them as stored. `updated_at` is left for the server to set. */
  async function upsert<T extends { updated_at: string }>(
    table: string,
    columns: string,
    onConflict: string,
    rows: T[],
  ): Promise<T[]> {
    const stored: T[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const payload = rows
        .slice(i, i + CHUNK)
        .map(({ updated_at, ...row }) => ({ ...row, user_id: userId }));
      const { data, error } = await client.from(table).upsert(payload, { onConflict }).select(columns);
      if (error) throw error;
      stored.push(...((data ?? []) as unknown as T[]));
    }
    return stored;
  }

  return {
    async pull(cursors: Cursors) {
      const [habits, history, challenge, stored] = await Promise.all([
        pullSince<HabitRow>('habits', HABIT_COLUMNS, ['id'], cursors.habits),
        pullSince<HistoryRow>('history', HISTORY_COLUMNS, ['habit_id', 'date'], cursors.history),
        pullOne<ChallengeRow>('challenges', CHALLENGE_COLUMNS),
        pullOne<StoredUserState>('user_state', `${USER_STATE_COLUMNS},data_epoch`),
      ]);
      return {
        habits: habits.rows,
        history: history.rows,
        challenge,
        ...splitEpoch(stored),
        cursors: { habits: habits.cursor, history: history.cursor },
      };
    },

    async push(batch) {
      const habits = await upsert('habits', HABIT_COLUMNS, 'user_id,id', batch.habits);
      const history = await upsert(
        'history',
        HISTORY_COLUMNS,
        'user_id,habit_id,date',
        batch.history,
      );
      const [challenge = null] = batch.challenge
        ? await upsert('challenges', CHALLENGE_COLUMNS, 'user_id', [batch.challenge])
        : [];
      const [stored = null] = batch.userState
        ? await upsert<StoredUserState>('user_state', `${USER_STATE_COLUMNS},data_epoch`, 'user_id', [
            // data_epoch is the server's: never sent, only read back.
            batch.userState as StoredUserState,
          ])
        : [];
      return { habits, history, challenge, ...splitEpoch(stored) };
    },

    async reset() {
      const { data, error } = await client.rpc('reset_my_data');
      if (error) throw error;
      return String(data);
    },
  };
}

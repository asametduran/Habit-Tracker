import * as SQLite from 'expo-sqlite';

import type { LocalStore } from '@/lib/sync/persister';
import { deserializeReplica } from '@/lib/sync/replica';

// Native: one SQLite row per replica entry, so a tap rewrites a single small row.
// The web variant is local-store.web.ts.

const BATCH = 100;

export function createLocalStore(): LocalStore {
  let opening: Promise<SQLite.SQLiteDatabase> | null = null;

  function open(): Promise<SQLite.SQLiteDatabase> {
    opening ??= (async () => {
      const db = await SQLite.openDatabaseAsync('habitracker.db');
      await db.execAsync(
        'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS replica (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
      );
      return db;
    })().catch((error: unknown) => {
      opening = null; // let the next call try again
      throw error;
    });
    return opening;
  }

  return {
    async load() {
      const db = await open();
      const rows = await db.getAllAsync<{ key: string; value: string }>(
        'SELECT key, value FROM replica',
      );
      const entries: Record<string, string> = {};
      for (const row of rows) entries[row.key] = row.value;
      return deserializeReplica(entries);
    },

    async apply(delta, full, replace) {
      const puts = Object.entries(delta.put);
      if (!replace && puts.length === 0 && delta.del.length === 0) return;
      const db = await open();
      await db.withExclusiveTransactionAsync(async (txn) => {
        if (replace) await txn.runAsync('DELETE FROM replica');
        for (let i = 0; i < delta.del.length; i += BATCH) {
          const keys = delta.del.slice(i, i + BATCH);
          await txn.runAsync(
            `DELETE FROM replica WHERE key IN (${keys.map(() => '?').join(', ')})`,
            keys,
          );
        }
        for (let i = 0; i < puts.length; i += BATCH) {
          const batch = puts.slice(i, i + BATCH);
          await txn.runAsync(
            `INSERT OR REPLACE INTO replica (key, value) VALUES ${batch.map(() => '(?, ?)').join(', ')}`,
            batch.flat(),
          );
        }
      });
    },
  };
}

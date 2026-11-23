import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LocalStore } from '@/lib/sync/persister';
import { deserializeReplica, serializeReplica } from '@/lib/sync/replica';

// Web: the whole replica under one AsyncStorage (localStorage) key. Fine for the amount of
// data a habit tracker holds; native uses SQLite (local-store.ts).

const KEY = 'habit-tracker/replica';

export function createLocalStore(): LocalStore {
  return {
    async load() {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return null;
      try {
        return deserializeReplica(JSON.parse(raw) ?? {});
      } catch {
        return null;
      }
    },
    async apply(_delta, full) {
      await AsyncStorage.setItem(KEY, JSON.stringify(serializeReplica(full)));
    },
  };
}

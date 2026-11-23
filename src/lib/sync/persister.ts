import { diffReplica, type Replica, type ReplicaDelta } from '@/lib/sync/replica';

/** Where the replica is kept on the device: SQLite on native, AsyncStorage on web. */
export type LocalStore = {
  /** `null` when nothing has been saved yet. Rejects if the storage can't be read. */
  load(): Promise<Replica | null>;
  /**
   * Saves a change. Stores that keep one entry per row apply `delta`; the rest rewrite `full`.
   * `replace` means the saved copy is unknown or absent, so anything already there must go.
   */
  apply(delta: ReplicaDelta, full: Replica, replace: boolean): Promise<void>;
};

/**
 * Writes the replica to the device in the background. One write runs at a time; changes made
 * meanwhile are folded into the next one, which only contains the rows that differ.
 */
export function createPersister(local: LocalStore, getReplica: () => Replica) {
  let started = false;
  let busy = false;
  let persisted: Replica | null = null;
  let current: Promise<boolean> = Promise.resolve(true);

  async function run(): Promise<boolean> {
    try {
      for (;;) {
        const next = getReplica();
        if (next === persisted) return true;
        await local.apply(diffReplica(persisted, next), next, persisted === null);
        persisted = next;
      }
    } catch (error) {
      // The data is still in memory and the next change retries the write.
      console.warn('Saving habits to this device failed', error);
      return false;
    } finally {
      busy = false;
    }
  }

  function schedule() {
    if (!started || busy) return;
    busy = true;
    current = run();
  }

  return {
    /**
     * Begins saving. `loaded` is what `load()` returned. Never call this after a failed load:
     * the device may hold data that just couldn't be read, and saving would overwrite it.
     */
    start(loaded: Replica | null) {
      persisted = loaded;
      started = true;
      schedule();
    },
    schedule,
    /** Resolves `true` once everything up to now is on the device. */
    flush(): Promise<boolean> {
      if (!started) return Promise.resolve(false);
      schedule();
      return current;
    },
  };
}

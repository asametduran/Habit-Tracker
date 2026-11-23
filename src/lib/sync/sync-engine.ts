import type { Clock, HabitStore } from '@/lib/sync/habit-store';
import type { RemoteStore } from '@/lib/sync/remote-store';
import { ackPushed, collectDirty, emptyReplica, mergePulled } from '@/lib/sync/replica';

export type SyncStatus = { syncing: boolean; error: string | null };

export type SyncOutcome = { ok: true; pulled: number; pushed: number } | { ok: false; error: string };

type Timer = ReturnType<typeof setTimeout>;

type Options = {
  store: HabitStore;
  remote: RemoteStore;
  clock: Clock;
  onStatus?: (status: SyncStatus) => void;
  /** Injectable so the checks can run without real timers. */
  schedule?: (run: () => void, ms: number) => Timer;
  cancel?: (timer: Timer) => void;
  debounceMs?: number;
};

const RETRY_MS = [5_000, 15_000, 60_000, 300_000];

// The data was replaced (sign-out, reset) or the engine stopped while a request was in
// flight: its result belongs to data that no longer exists, so it is dropped silently.
const STALE: SyncOutcome = { ok: false, error: 'Sync was interrupted.' };

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Sync failed.';
}

/**
 * Keeps the store's replica and the server in step: pull, merge, then push what's still
 * unconfirmed. Runs in the background — nothing the user does waits for it.
 */
export function createSyncEngine({
  store,
  remote,
  clock,
  onStatus,
  schedule = setTimeout,
  cancel = clearTimeout,
  debounceMs = 2000,
}: Options) {
  let disposed = false;
  let running: Promise<SyncOutcome> | null = null;
  let again = false;
  let timer: Timer | null = null;
  let failures = 0;

  async function runOnce(): Promise<SyncOutcome> {
    const generation = store.generation();
    const stale = () => disposed || store.generation() !== generation;

    const before = store.getSnapshot().replica;
    let snap = await remote.pull(before.cursors);
    if (stale()) return STALE;
    if (before.epoch && snap.epoch && before.epoch !== snap.epoch) {
      // The account was reset from another device. Whatever this one still holds — synced or
      // not — belongs to the data that was erased, so start over from the server.
      snap = await remote.pull({ habits: null, history: null });
      if (stale()) return STALE;
      const full = snap;
      store.mergeReplica((replica) =>
        mergePulled(
          { ...emptyReplica(replica.owner), lastSyncedAt: replica.lastSyncedAt },
          full,
          clock.now(),
        ),
      );
    } else {
      const pulled = snap;
      store.mergeReplica((replica) => mergePulled(replica, pulled, clock.now()));
    }

    const sent = collectDirty(store.getSnapshot().replica);
    const pushed =
      sent.habits.length + sent.history.length + (sent.challenge ? 1 : 0) + (sent.userState ? 1 : 0);
    if (pushed > 0) {
      const result = await remote.push(sent);
      if (stale()) return STALE;
      store.mergeReplica((replica) => ackPushed(replica, sent, result, clock.now()), false);
    }
    store.mergeReplica((replica) => ({ ...replica, lastSyncedAt: clock.now() }), false);
    return { ok: true, pulled: snap.habits.length + snap.history.length, pushed };
  }

  function clearTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  /** Syncs now. Never rejects. A call made during a sync joins it and queues a follow-up. */
  function syncNow(): Promise<SyncOutcome> {
    if (disposed) return Promise.resolve(STALE);
    if (running) {
      again = true;
      return running;
    }
    clearTimer();
    onStatus?.({ syncing: true, error: null });
    running = runOnce()
      .catch((error: unknown): SyncOutcome => ({ ok: false, error: messageOf(error) }))
      .then((outcome) => {
        running = null;
        const followUp = again;
        again = false;
        if (disposed) return outcome;
        if (outcome === STALE) {
          // The data was replaced under this run; sync what's there now.
          onStatus?.({ syncing: false, error: null });
          request();
        } else if (outcome.ok) {
          failures = 0;
          onStatus?.({ syncing: false, error: null });
          if (followUp) request();
        } else {
          onStatus?.({ syncing: false, error: outcome.error });
          const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
          failures++;
          clearTimer();
          timer = schedule(() => {
            timer = null;
            void syncNow();
          }, wait);
        }
        return outcome;
      });
    return running;
  }

  /** Asks for a sync soon; calls in quick succession collapse into one. */
  function request() {
    if (disposed) return;
    clearTimer();
    timer = schedule(() => {
      timer = null;
      void syncNow();
    }, debounceMs);
  }

  return {
    syncNow,
    request,
    dispose() {
      disposed = true;
      clearTimer();
      onStatus?.({ syncing: false, error: null });
    },
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

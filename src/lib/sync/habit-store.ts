import { rollover, type HabitState } from '@/lib/habit-logic';
import { applyState, emptyReplica, replicaToState, type Replica } from '@/lib/sync/replica';

export type Clock = {
  /** Today's day key (honors the dev day offset). */
  today: () => string;
  /** The current time as an ISO timestamp. */
  now: () => string;
};

export type Snapshot = { state: HabitState; replica: Replica };

/** Closes days up to `today`, unless another device already moved this data past it. */
export function rollForward(state: HabitState, today: string): HabitState {
  return state.lastRolloverDate > today ? state : rollover(state, today);
}

/**
 * Holds the UI state and the replica it's derived from, always in step. Updates are
 * synchronous: a tap changes the state before anything touches the disk or the network.
 */
export function createHabitStore(clock: Clock) {
  let generation = 0;
  let snapshot: Snapshot = fromReplica(emptyReplica());
  const listeners = new Set<() => void>();
  const localListeners = new Set<() => void>();

  function fromReplica(replica: Replica): Snapshot {
    return { state: replicaToState(replica, clock.today()), replica };
  }

  function set(next: Snapshot, local: boolean) {
    if (next.state === snapshot.state && next.replica === snapshot.replica) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
    if (local) localListeners.forEach((listener) => listener());
  }

  function update(change: (state: HabitState) => HabitState) {
    const state = change(snapshot.state);
    if (state === snapshot.state) return;
    set({ state, replica: applyState(snapshot.replica, snapshot.state, state, clock.now()) }, true);
  }

  return {
    getSnapshot: () => snapshot,
    /** Any change to the state or the replica. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Changes made on this device (not ones merged in from the server) — these need a sync. */
    onLocalChange(listener: () => void) {
      localListeners.add(listener);
      return () => {
        localListeners.delete(listener);
      };
    },
    /** Bumped whenever the data is replaced wholesale; in-flight syncs check it and drop out. */
    generation: () => generation,
    update,
    rollToday() {
      update((state) => rollForward(state, clock.today()));
    },
    /**
     * Applies a sync result. With `derive`, the state is rebuilt from the merged rows and
     * rolled to today; pass `false` for bookkeeping that can't change what screens show.
     */
    mergeReplica(merge: (replica: Replica) => Replica, derive = true) {
      const prev = snapshot;
      let replica = merge(prev.replica);
      if (replica === prev.replica) return;
      let state = prev.state;
      if (derive) {
        state = replicaToState(replica, clock.today(), prev);
        const rolled = rollForward(state, clock.today());
        if (rolled !== state) {
          replica = applyState(replica, state, rolled, clock.now());
          state = rolled;
        }
      }
      set({ state, replica }, false);
    },
    /** Replaces everything (load from disk, sign-out, reset, another account). */
    reset(replica: Replica) {
      generation++;
      set(fromReplica(replica), false);
    },
  };
}

export type HabitStore = ReturnType<typeof createHabitStore>;

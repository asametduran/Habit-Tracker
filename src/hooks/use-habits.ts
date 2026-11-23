import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/hooks/use-auth';
import {
  DEFAULT_SETTINGS,
  addDays,
  applyCount,
  cleanName,
  getDayOffset,
  getToday,
  isCompleted,
  migrateHabit,
  rollover,
  setDayOffset,
  type Challenge,
  type Habit,
  type HabitState,
  type HabitType,
  type Settings,
} from '@/lib/habit-logic';
import { unregisterCoachPush } from '@/lib/push';
import { getSupabase } from '@/lib/supabase';
import { createHabitStore, type Clock } from '@/lib/sync/habit-store';
import { createLocalStore } from '@/lib/sync/local-store';
import { createPersister } from '@/lib/sync/persister';
import type { RemoteStore } from '@/lib/sync/remote-store';
import { createSupabaseRemote } from '@/lib/sync/remote-store-supabase';
import {
  adoptReplica,
  applyState,
  emptyReplica,
  pendingCount,
  type Replica,
} from '@/lib/sync/replica';
import { createSyncEngine, type SyncEngine, type SyncStatus } from '@/lib/sync/sync-engine';

export type {
  Challenge,
  Habit,
  HabitType,
  HistoryEntry,
  Reminder,
  Settings,
} from '@/lib/habit-logic';

const KEYS = {
  devDayOffset: 'habit-tracker/dev-day-offset',
  habits: 'habit-tracker/habits',
  history: 'habit-tracker/history',
  challenge: 'habit-tracker/challenge',
  lastRollover: 'habit-tracker/last-rollover-date',
  onboardingComplete: 'habit-tracker/onboarding-complete',
  settings: 'habit-tracker/settings',
} as const;

// Where the data lived before the app had a database. Read once, to move it into the replica.
const LEGACY_KEYS = [
  KEYS.habits,
  KEYS.history,
  KEYS.challenge,
  KEYS.lastRollover,
  KEYS.onboardingComplete,
  KEYS.settings,
];

// How long a device that slept through midnight waits to hear from the server before it
// closes the day on its own.
const DAY_SYNC_WAIT_MS = 2500;

const MERGE_NOTICE = 'Your habits on this device were merged with your account.';

// Shown for the moment between someone signing in and another account's data being cleared.
const BLANK: HabitState = {
  habits: [],
  history: [],
  challenge: null,
  lastRolloverDate: '',
  onboardingComplete: false,
  settings: DEFAULT_SETTINGS,
};

type NewHabit = { name: string; type?: HabitType; target?: number };

type ChallengeOptions = { name?: string; durationDays?: number };

type HabitsContextValue = HabitState & {
  isLoaded: boolean;
  /** Today's date key — shifted forward when the dev day-offset is in use. */
  today: string;
  addHabit: (input: NewHabit) => Habit | null;
  updateHabit: (
    id: string,
    patch: Partial<Pick<Habit, 'name' | 'type' | 'target' | 'reminder'>>,
  ) => void;
  removeHabit: (id: string) => void;
  setCount: (id: string, count: number) => void;
  startChallenge: (habitIds: string[], options?: ChallengeOptions) => void;
  markChallengeCelebrated: () => void;
  completeOnboarding: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  /** Signed in, this erases the account's data first — and rejects if that can't be done. */
  resetAll: () => Promise<void>;
  // Developer tools
  devDayOffset: number;
  devAdvanceDay: () => void;
  devResetDays: () => void;
  devCompleteAllToday: () => void;
  devForceChallengeComplete: () => void;
};

type SyncContextValue = SyncStatus & {
  /** Changes made on this device that the server hasn't confirmed yet. */
  pending: number;
  lastSyncedAt: string | null;
  /** Signed in, but this device hasn't heard back from the account yet. */
  restoring: boolean;
  /** The data on this device already belongs to an account. */
  hasAccount: boolean;
  /** Syncs now and resolves with the number of changes still waiting. */
  syncNow: () => Promise<number>;
  notice: string | null;
  dismissNotice: () => void;
  /** Signs out and clears this device. Anything still `pending` is lost — sync first. */
  signOut: () => Promise<void>;
};

type Session = { remote: RemoteStore; engine: SyncEngine };

const HabitsContext = createContext<HabitsContextValue | null>(null);
const SyncContext = createContext<SyncContextValue | null>(null);

const clock: Clock = { today: getToday, now: () => new Date().toISOString() };

// One store for the whole app. Taps change it synchronously; saving to the device and syncing
// with the server both follow in the background.
const store = createHabitStore(clock);
const localStore = createLocalStore();
const persister = createPersister(localStore, () => store.getSnapshot().replica);
store.subscribe(persister.schedule);

// What the signed-in account needs outside of rendering. Like the store, there is one per app.
const account: {
  session: Session | null;
  /** Habits that were on this device before it was signed in for the first time. */
  adopted: Set<string> | null;
} = { session: null, adopted: null };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** What the app saved before it had a database, or `null` if there is nothing. */
async function loadLegacyState(): Promise<HabitState | null> {
  const entries = await AsyncStorage.multiGet(LEGACY_KEYS);
  if (entries.every(([, value]) => value === null)) return null;
  const raw = Object.fromEntries(entries) as Record<string, string | null>;
  const history = parse<HabitState['history']>(raw[KEYS.history], []);
  const storedHabits = parse<Record<string, unknown>[] | null>(raw[KEYS.habits], null);
  const habits = (storedHabits ?? []).map((stored) => {
    const habit = migrateHabit(stored);
    if (typeof stored.createdAt === 'string') return habit;
    // Habits saved before `createdAt` existed: date them from their earliest log entry.
    const earliest = history
      .filter((e) => e.habitId === habit.id)
      .reduce<string | null>((min, e) => (min === null || e.date < min ? e.date : min), null);
    return earliest ? { ...habit, createdAt: earliest } : habit;
  });
  // Not rolled over here: the day is closed after loading, the same as on any other launch.
  return {
    habits,
    history,
    challenge: parse<Challenge | null>(raw[KEYS.challenge], null),
    lastRolloverDate: raw[KEYS.lastRollover] ?? getToday(),
    // Users who had habits before onboarding existed skip it.
    onboardingComplete: raw[KEYS.onboardingComplete] === 'true' || habits.length > 0,
    settings: { ...DEFAULT_SETTINGS, ...parse(raw[KEYS.settings], {}) },
  };
}

let hydration: Promise<void> | null = null;

/** Loads what's saved on the device into the store. Runs once, however often it's called. */
function hydrate(): Promise<void> {
  hydration ??= (async () => {
    // The simulated-day offset is a developer tool (Settings, dev builds only). A release build
    // always runs on the real date, even if a dev build left an offset on this device.
    const offset = __DEV__ ? await AsyncStorage.getItem(KEYS.devDayOffset).catch(() => null) : null;
    setDayOffset(Number(offset) || 0);

    let loaded: Replica | null = null;
    let readable = true;
    try {
      loaded = await localStore.load();
    } catch (error) {
      // Whatever is saved can't be read. Carry on in memory and leave it untouched, rather
      // than write a fresh copy over it.
      console.warn('Loading saved habits failed', error);
      readable = false;
    }
    if (loaded) {
      store.reset(loaded);
      persister.start(loaded);
      return;
    }

    const legacy = await loadLegacyState().catch(() => null);
    store.reset(legacy ? applyState(emptyReplica(), null, legacy, clock.now()) : emptyReplica());
    if (!readable) return;
    persister.start(null);
    if (legacy) {
      // The old copy goes only once the new one is safely on the device.
      void persister.flush().then((saved) => {
        if (saved) AsyncStorage.multiRemove(LEGACY_KEYS).catch(() => {});
      });
    }
  })();
  return hydration;
}

export function HabitsProvider({ children }: { children: ReactNode }) {
  const { status, user, signOut: authSignOut } = useAuth();
  const userId = status === 'signedIn' ? (user?.id ?? null) : null;

  const { state, replica } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [hydrated, setHydrated] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [devDayOffset, setDevDayOffset] = useState(0);
  // Real state (not a getToday() call inside the memo) so the React Compiler can't cache it.
  const [today, setToday] = useState(getToday);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ syncing: false, error: null });
  // The account whose first sync on this launch has finished, whether or not it worked.
  const [attemptedFor, setAttemptedFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    hydrate().then(() => {
      if (!active) return;
      setDevDayOffset(getDayOffset());
      setToday(getToday());
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Everything that depends on who is signed in: whose data this is, and keeping it in sync.
  useEffect(() => {
    if (!hydrated || status === 'loading') return;
    let active = true;

    const client = userId ? getSupabase() : null;
    let engine: SyncEngine | null = null;
    if (userId && client) {
      const { replica: current } = store.getSnapshot();
      if (current.owner === null) {
        // First sign-in on this device: what's already here goes into the account.
        const ids = Object.keys(current.habits);
        account.adopted = ids.length > 0 ? new Set(ids) : null;
        store.reset(adoptReplica(current, userId));
      } else if (current.owner !== userId) {
        account.adopted = null;
        store.reset(emptyReplica(userId));
      }
      const remote = createSupabaseRemote(client, userId);
      engine = createSyncEngine({ store, remote, clock, onStatus: setSyncStatus });
      account.session = { remote, engine };
    }
    const live = engine;

    const settleDay = async (syncing: Promise<unknown> | undefined) => {
      // Another device may have checked things off yesterday: hear about it before closing
      // the day here, or a streak looks broken until the next sync puts it back.
      if (syncing && store.getSnapshot().state.lastRolloverDate < getToday()) {
        await Promise.race([syncing, wait(DAY_SYNC_WAIT_MS)]);
      }
      if (!active) return;
      store.rollToday();
      setToday(getToday());
    };

    const first = live?.syncNow();
    first?.then(() => {
      if (active) setAttemptedFor(userId);
    });
    settleDay(first).then(() => {
      if (active) setIsLoaded(true);
    });

    const appState = AppState.addEventListener('change', (next) => {
      // Catch up on day changes when the app returns to the foreground.
      if (next === 'active') void settleDay(live?.syncNow());
      // Leaving: send what's waiting now rather than after the usual pause.
      else if (next === 'background') void live?.syncNow();
    });
    const network = live
      ? Network.addNetworkStateListener((next) => {
          if (next.isConnected && next.isInternetReachable !== false) live.request();
        })
      : null;
    const stopRequests = store.onLocalChange(() => live?.request());
    const stopNotice = store.subscribe(() => {
      const local = account.adopted;
      const snapshot = store.getSnapshot();
      if (!local || snapshot.replica.lastSyncedAt === null) return;
      account.adopted = null;
      if (snapshot.state.habits.some((habit) => !local.has(habit.id))) setNotice(MERGE_NOTICE);
    });

    return () => {
      active = false;
      appState.remove();
      network?.remove();
      stopRequests();
      stopNotice();
      live?.dispose();
      account.session = null;
    };
  }, [hydrated, status, userId]);

  const addHabit = useCallback((input: NewHabit) => {
    const name = cleanName(input.name);
    if (!name) return null;
    const type = input.type ?? 'daily';
    const habit: Habit = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      type,
      target: type === 'quantity' ? Math.max(1, input.target ?? 1) : undefined,
      count: 0,
      streak: 0,
      bestStreak: 0,
      createdAt: getToday(),
    };
    store.update((current) => ({ ...current, habits: [...current.habits, habit] }));
    return habit;
  }, []);

  const updateHabit = useCallback<HabitsContextValue['updateHabit']>((id, patch) => {
    store.update((current) => ({
      ...current,
      habits: current.habits.map((habit) => {
        if (habit.id !== id) return habit;
        const type = patch.type ?? habit.type;
        const target =
          type === 'quantity' ? Math.max(1, patch.target ?? habit.target ?? 1) : undefined;
        const name = cleanName(patch.name ?? '') || habit.name;
        const reminder = patch.reminder ?? habit.reminder;
        // Re-clamp today's count against the new type/target.
        return applyCount({ ...habit, name, type, target, reminder }, habit.count);
      }),
    }));
  }, []);

  const removeHabit = useCallback((id: string) => {
    store.update((current) => ({
      ...current,
      habits: current.habits.filter((h) => h.id !== id),
    }));
  }, []);

  const setCount = useCallback((id: string, count: number) => {
    store.update((current) => ({
      ...current,
      habits: current.habits.map((habit) => (habit.id === id ? applyCount(habit, count) : habit)),
    }));
  }, []);

  const startChallenge = useCallback((habitIds: string[], options: ChallengeOptions = {}) => {
    store.update((current) => ({
      ...current,
      challenge: {
        name: cleanName(options.name ?? '') || undefined,
        habitIds,
        durationDays: Math.max(1, Math.round(options.durationDays ?? 3)),
        startDate: getToday(),
        daysCompleted: 0,
        status: 'active',
      },
    }));
  }, []);

  const markChallengeCelebrated = useCallback(() => {
    store.update((current) =>
      current.challenge
        ? { ...current, challenge: { ...current.challenge, celebrated: true } }
        : current,
    );
  }, []);

  const completeOnboarding = useCallback(() => {
    store.update((current) => ({ ...current, onboardingComplete: true }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    store.update((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
  }, []);

  const resetAll = useCallback(async () => {
    const live = account.session;
    const { owner } = store.getSnapshot().replica;
    // The account goes first: if it can't be reached, nothing is erased and this rejects.
    // Its new epoch tells the other devices to drop their copies too.
    const epoch = live ? await live.remote.reset() : null;
    await AsyncStorage.multiRemove(Object.values(KEYS)).catch(() => {});
    setDayOffset(0);
    setDevDayOffset(0);
    setToday(getToday());
    store.reset(
      live ? { ...emptyReplica(owner), epoch, lastSyncedAt: clock.now() } : emptyReplica(owner),
    );
    live?.engine.request();
  }, []);

  // --- Sync --------------------------------------------------------------------------------
  const syncNow = useCallback(async () => {
    const engine = account.session?.engine;
    if (engine) {
      const outcome = await engine.syncNow();
      // A sync that was already running may have started before the latest changes.
      if (outcome.ok && pendingCount(store.getSnapshot().replica) > 0) await engine.syncNow();
    }
    return pendingCount(store.getSnapshot().replica);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const signOut = useCallback(async () => {
    // While still signed in (RLS needs the session): this phone stops getting the account's
    // coach pushes. Offline, the token stays until Expo reports it stale.
    await unregisterCoachPush().catch(() => undefined);
    await authSignOut();
    account.adopted = null;
    setAttemptedFor(null);
    setNotice(null);
    store.reset(emptyReplica());
  }, [authSignOut]);

  // --- Developer tools -------------------------------------------------------------------
  const shiftDays = useCallback((delta: number) => {
    if (!__DEV__) return;
    const next = Math.max(0, getDayOffset() + delta);
    setDayOffset(next);
    setDevDayOffset(next);
    setToday(getToday());
    AsyncStorage.setItem(KEYS.devDayOffset, String(next));
    store.update((current) => rollover(current, getToday()));
  }, []);

  const devAdvanceDay = useCallback(() => shiftDays(1), [shiftDays]);
  const devResetDays = useCallback(() => shiftDays(-getDayOffset()), [shiftDays]);

  const devCompleteAllToday = useCallback(() => {
    store.update((current) => ({
      ...current,
      habits: current.habits.map((habit) =>
        isCompleted(habit)
          ? habit
          : applyCount(habit, habit.type === 'daily' ? 1 : (habit.target ?? 1)),
      ),
    }));
  }, []);

  const devForceChallengeComplete = useCallback(() => {
    store.update((current) =>
      current.challenge
        ? {
            ...current,
            challenge: {
              ...current.challenge,
              daysCompleted: current.challenge.durationDays,
              status: 'completed',
              celebrated: false,
              startDate: addDays(getToday(), -current.challenge.durationDays),
            },
          }
        : current,
    );
  }, []);

  // Another account's data is still on this device (it was signed out without being cleared).
  // The effect above replaces it; until it has, show nothing rather than someone else's habits.
  const foreign = userId !== null && replica.owner !== null && replica.owner !== userId;
  const shown = foreign ? BLANK : state;

  const value = useMemo<HabitsContextValue>(
    () => ({
      ...shown,
      isLoaded,
      today,
      devDayOffset,
      devAdvanceDay,
      devResetDays,
      devCompleteAllToday,
      devForceChallengeComplete,
      addHabit,
      updateHabit,
      removeHabit,
      setCount,
      startChallenge,
      markChallengeCelebrated,
      completeOnboarding,
      updateSettings,
      resetAll,
    }),
    [
      shown,
      isLoaded,
      today,
      devDayOffset,
      devAdvanceDay,
      devResetDays,
      devCompleteAllToday,
      devForceChallengeComplete,
      addHabit,
      updateHabit,
      removeHabit,
      setCount,
      startChallenge,
      markChallengeCelebrated,
      completeOnboarding,
      updateSettings,
      resetAll,
    ],
  );

  const sync = useMemo<SyncContextValue>(
    () => ({
      ...syncStatus,
      pending: pendingCount(replica),
      lastSyncedAt: replica.lastSyncedAt,
      restoring:
        userId !== null && (foreign || (replica.lastSyncedAt === null && attemptedFor !== userId)),
      hasAccount: replica.owner !== null,
      syncNow,
      notice,
      dismissNotice,
      signOut,
    }),
    [syncStatus, replica, userId, foreign, attemptedFor, syncNow, notice, dismissNotice, signOut],
  );

  return createElement(
    HabitsContext.Provider,
    { value },
    createElement(SyncContext.Provider, { value: sync }, children),
  );
}

export function useHabits(): HabitsContextValue {
  const context = useContext(HabitsContext);
  if (!context) throw new Error('useHabits must be used inside <HabitsProvider>');
  return context;
}

/** Where this device stands with the account's copy of the data. */
export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used inside <HabitsProvider>');
  return context;
}

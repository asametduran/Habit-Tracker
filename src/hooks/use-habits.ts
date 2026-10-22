import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import {
  DEFAULT_SETTINGS,
  addDays,
  applyCount,
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

const EMPTY_STATE: HabitState = {
  habits: [],
  history: [],
  challenge: null,
  lastRolloverDate: getToday(),
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
  resetAll: () => Promise<void>;
  // Developer tools
  devDayOffset: number;
  devAdvanceDay: () => void;
  devResetDays: () => void;
  devCompleteAllToday: () => void;
  devForceChallengeComplete: () => void;
};

const HabitsContext = createContext<HabitsContextValue | null>(null);

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function loadState(): Promise<HabitState> {
  const entries = await AsyncStorage.multiGet(Object.values(KEYS));
  const raw = Object.fromEntries(entries) as Record<string, string | null>;
  setDayOffset(Number(raw[KEYS.devDayOffset]) || 0);
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
  const today = getToday();
  const loaded: HabitState = {
    habits,
    history,
    challenge: parse<Challenge | null>(raw[KEYS.challenge], null),
    lastRolloverDate: raw[KEYS.lastRollover] ?? today,
    // Users who had habits before onboarding existed skip it.
    onboardingComplete: raw[KEYS.onboardingComplete] === 'true' || habits.length > 0,
    settings: { ...DEFAULT_SETTINGS, ...parse(raw[KEYS.settings], {}) },
  };
  return rollover(loaded, today);
}

export function HabitsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HabitState>(EMPTY_STATE);
  const [isLoaded, setIsLoaded] = useState(false);
  const [devDayOffset, setDevDayOffset] = useState(0);
  // Real state (not a getToday() call inside the memo) so the React Compiler can't cache it.
  const [today, setToday] = useState(getToday);

  useEffect(() => {
    loadState().then((loaded) => {
      setDevDayOffset(getDayOffset());
      setToday(getToday());
      setState(loaded);
      setIsLoaded(true);
    });
  }, []);

  // Catch up on day changes when the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      setToday(getToday());
      setState((current) => rollover(current, getToday()));
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.multiSet([
      [KEYS.habits, JSON.stringify(state.habits)],
      [KEYS.history, JSON.stringify(state.history)],
      [KEYS.challenge, JSON.stringify(state.challenge)],
      [KEYS.lastRollover, state.lastRolloverDate],
      [KEYS.onboardingComplete, String(state.onboardingComplete)],
      [KEYS.settings, JSON.stringify(state.settings)],
    ]);
  }, [state, isLoaded]);

  const addHabit = useCallback((input: NewHabit) => {
    const name = input.name.trim();
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
    setState((current) => ({ ...current, habits: [...current.habits, habit] }));
    return habit;
  }, []);

  const updateHabit = useCallback<HabitsContextValue['updateHabit']>((id, patch) => {
    setState((current) => ({
      ...current,
      habits: current.habits.map((habit) => {
        if (habit.id !== id) return habit;
        const type = patch.type ?? habit.type;
        const target =
          type === 'quantity' ? Math.max(1, patch.target ?? habit.target ?? 1) : undefined;
        const name = patch.name?.trim() || habit.name;
        const reminder = patch.reminder ?? habit.reminder;
        // Re-clamp today's count against the new type/target.
        return applyCount({ ...habit, name, type, target, reminder }, habit.count);
      }),
    }));
  }, []);

  const removeHabit = useCallback((id: string) => {
    setState((current) => ({ ...current, habits: current.habits.filter((h) => h.id !== id) }));
  }, []);

  const setCount = useCallback((id: string, count: number) => {
    setState((current) => ({
      ...current,
      habits: current.habits.map((habit) => (habit.id === id ? applyCount(habit, count) : habit)),
    }));
  }, []);

  const startChallenge = useCallback((habitIds: string[], options: ChallengeOptions = {}) => {
    setState((current) => ({
      ...current,
      challenge: {
        name: options.name?.trim() || undefined,
        habitIds,
        durationDays: Math.max(1, Math.round(options.durationDays ?? 3)),
        startDate: getToday(),
        daysCompleted: 0,
        status: 'active',
      },
    }));
  }, []);

  const markChallengeCelebrated = useCallback(() => {
    setState((current) =>
      current.challenge
        ? { ...current, challenge: { ...current.challenge, celebrated: true } }
        : current,
    );
  }, []);

  const completeOnboarding = useCallback(() => {
    setState((current) => ({ ...current, onboardingComplete: true }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
  }, []);

  const resetAll = useCallback(async () => {
    await AsyncStorage.multiRemove(Object.values(KEYS));
    setDayOffset(0);
    setDevDayOffset(0);
    setToday(getToday());
    setState({ ...EMPTY_STATE, lastRolloverDate: getToday() });
  }, []);

  // --- Developer tools -------------------------------------------------------------------
  const shiftDays = useCallback((delta: number) => {
    const next = Math.max(0, getDayOffset() + delta);
    setDayOffset(next);
    setDevDayOffset(next);
    setToday(getToday());
    AsyncStorage.setItem(KEYS.devDayOffset, String(next));
    setState((current) => rollover(current, getToday()));
  }, []);

  const devAdvanceDay = useCallback(() => shiftDays(1), [shiftDays]);
  const devResetDays = useCallback(() => shiftDays(-getDayOffset()), [shiftDays]);

  const devCompleteAllToday = useCallback(() => {
    setState((current) => ({
      ...current,
      habits: current.habits.map((habit) =>
        isCompleted(habit)
          ? habit
          : applyCount(habit, habit.type === 'daily' ? 1 : (habit.target ?? 1)),
      ),
    }));
  }, []);

  const devForceChallengeComplete = useCallback(() => {
    setState((current) =>
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

  const value = useMemo<HabitsContextValue>(
    () => ({
      ...state,
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
      state,
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

  return createElement(HabitsContext.Provider, { value }, children);
}

export function useHabits(): HabitsContextValue {
  const context = useContext(HabitsContext);
  if (!context) throw new Error('useHabits must be used inside <HabitsProvider>');
  return context;
}

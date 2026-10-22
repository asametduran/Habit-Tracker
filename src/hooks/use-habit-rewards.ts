import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useHabits } from '@/hooks/use-habits';
import { MILESTONES, allCompleted, applyCount, isCompleted } from '@/lib/habit-logic';

export type RewardEvent =
  | { key: number; type: 'milestone'; habitId: string; streak: number }
  | {
      key: number;
      type: 'allDone';
      /** Set when the completion that finished the day also hit a streak milestone. */
      milestone?: { habitId: string; streak: number };
    };

// Omit<> doesn't distribute over unions, so spell the key-less variant out per member.
type NewRewardEvent = RewardEvent extends infer E ? (E extends unknown ? Omit<E, 'key'> : never) : never;

const EVENT_LIFETIME_MS = 2500;

/**
 * Wraps the habit mutators with the core-loop reward layer (haptics, sound, milestone/all-done
 * events). This is the only module that touches expo-haptics / expo-audio.
 */
export function useHabitRewards() {
  const { habits, setCount } = useHabits();
  const chime = useAudioPlayer(require('@/assets/sounds/chime.wav'));
  const celebration = useAudioPlayer(require('@/assets/sounds/celebration.wav'));
  const [lastEvent, setLastEvent] = useState<RewardEvent | null>(null);
  const eventKey = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  const emit = useCallback((event: NewRewardEvent) => {
    eventKey.current += 1;
    setLastEvent({ ...event, key: eventKey.current } as RewardEvent);
    clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setLastEvent(null), EVENT_LIFETIME_MS);
  }, []);

  const play = useCallback((player: ReturnType<typeof useAudioPlayer>) => {
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // Audio is a nicety; never let it break a check-off.
    }
  }, []);

  const haptic = useCallback((run: () => Promise<void>) => {
    if (Platform.OS === 'web') return;
    run().catch(() => {});
  }, []);

  const celebrateChallenge = useCallback(() => {
    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    play(celebration);
  }, [celebration, haptic, play]);

  const changeCount = useCallback(
    (id: string, delta: number) => {
      const habit = habits.find((h) => h.id === id);
      if (!habit) return;
      const next = applyCount(habit, habit.count + delta);
      if (next.count === habit.count) return;
      setCount(id, next.count);

      const was = isCompleted(habit);
      const now = isCompleted(next);
      if (was === now) return; // progress within a quantity habit — no reward yet
      if (was && !now) return; // un-completing is silent

      haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
      const milestone = MILESTONES.includes(next.streak)
        ? { habitId: id, streak: next.streak }
        : undefined;
      if (milestone) haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));

      const after = habits.map((h) => (h.id === id ? next : h));
      if (!allCompleted(habits) && allCompleted(after)) {
        play(celebration);
        emit({ type: 'allDone', milestone });
      } else {
        play(chime);
        if (milestone) emit({ type: 'milestone', ...milestone });
      }
    },
    [habits, setCount, haptic, play, chime, celebration, emit],
  );

  const toggleDaily = useCallback(
    (id: string) => {
      const habit = habits.find((h) => h.id === id);
      if (habit) changeCount(id, isCompleted(habit) ? -1 : 1);
    },
    [habits, changeCount],
  );
  const incrementQuantity = useCallback((id: string) => changeCount(id, 1), [changeCount]);
  const decrementQuantity = useCallback((id: string) => changeCount(id, -1), [changeCount]);

  return { toggleDaily, incrementQuantity, decrementQuantity, lastEvent, celebrateChallenge };
}

import { createAudioPlayer, type AudioPlayer, type AudioSource } from 'expo-audio';
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

const CHIME: AudioSource = require('@/assets/sounds/chime.wav');
const CELEBRATION: AudioSource = require('@/assets/sounds/celebration.wav');

/**
 * Plays a short sound. The player is made after mount, not during render: expo-audio's
 * useAudioPlayer builds an <audio> element while rendering on web, which crashes the static
 * export (pages render in Node, where there is no `Audio`). Effects only run on the device.
 */
function useSoundEffect(source: AudioSource) {
  const player = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    const created = createAudioPlayer(source);
    player.current = created;
    return () => {
      player.current = null;
      created.release();
    };
  }, [source]);

  return useCallback(() => {
    try {
      player.current?.seekTo(0);
      player.current?.play();
    } catch {
      // Audio is a nicety; never let it break a check-off.
    }
  }, []);
}

/**
 * Wraps the habit mutators with the core-loop reward layer (haptics, sound, milestone/all-done
 * events). This is the only module that touches expo-haptics / expo-audio.
 */
export function useHabitRewards() {
  const { habits, setCount } = useHabits();
  const playChime = useSoundEffect(CHIME);
  const playCelebration = useSoundEffect(CELEBRATION);
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

  const haptic = useCallback((run: () => Promise<void>) => {
    if (Platform.OS === 'web') return;
    run().catch(() => {});
  }, []);

  const celebrateChallenge = useCallback(() => {
    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    playCelebration();
  }, [haptic, playCelebration]);

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
        playCelebration();
        emit({ type: 'allDone', milestone });
      } else {
        playChime();
        if (milestone) emit({ type: 'milestone', ...milestone });
      }
    },
    [habits, setCount, haptic, playChime, playCelebration, emit],
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

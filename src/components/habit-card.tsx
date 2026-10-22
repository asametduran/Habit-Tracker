import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { StreakFlame } from '@/components/streak-flame';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, OnAccent, Spacing } from '@/constants/theme';
import { Habit } from '@/hooks/use-habits';
import { isCompleted } from '@/lib/habit-logic';

type HabitCardProps = {
  habit: Habit;
  onToggle: (id: string) => void;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  /** Bump when this habit hits a streak milestone to pulse its flame. */
  pulseKey?: number;
};

const REPEAT_INTERVAL_MS = 150;

export function HabitCard({ habit, onToggle, onIncrement, onDecrement, pulseKey }: HabitCardProps) {
  const done = isCompleted(habit);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {habit.type === 'daily' ? (
        <Pressable
          onPress={() => onToggle(habit.id)}
          style={styles.checkbox}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={habit.name}>
          <ThemedView
            type="background"
            style={[styles.checkboxInner, done && styles.checkboxChecked]}>
            {done && <ThemedText type="smallBold" style={styles.checkmark}>✓</ThemedText>}
          </ThemedView>
        </Pressable>
      ) : null}

      <ThemedView style={styles.info}>
        <ThemedText type="default" style={done && styles.strikethrough}>
          {habit.name}
        </ThemedText>
        <ThemedView style={styles.streakRow}>
          <StreakFlame pulseKey={pulseKey} />
          <ThemedText type="small" themeColor="textSecondary">
            {habit.streak} day streak
          </ThemedText>
        </ThemedView>
      </ThemedView>

      {habit.type === 'quantity' ? (
        <ThemedView style={styles.stepper}>
          <RepeatButton label="−" a11y={`Decrease ${habit.name}`} onStep={() => onDecrement(habit.id)} />
          <ThemedText type="smallBold" style={styles.count}>
            {habit.count}/{habit.target}
          </ThemedText>
          <RepeatButton label="+" a11y={`Increase ${habit.name}`} onStep={() => onIncrement(habit.id)} />
        </ThemedView>
      ) : null}
    </ThemedView>
  );
}

/** Tap = one step; press-and-hold keeps stepping. */
function RepeatButton({ label, a11y, onStep }: { label: string; a11y: string; onStep: () => void }) {
  const stepRef = useRef(onStep);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    stepRef.current = onStep;
  });
  useEffect(() => () => clearInterval(timer.current), []);

  const stop = () => clearInterval(timer.current);

  return (
    <Pressable
      onPress={() => stepRef.current()}
      onLongPress={() => {
        stop();
        timer.current = setInterval(() => stepRef.current(), REPEAT_INTERVAL_MS);
      }}
      onPressOut={stop}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={styles.stepButton}>
      <ThemedText type="subtitle" style={styles.stepLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  checkbox: {
    padding: Spacing.half,
  },
  checkboxInner: {
    width: 28,
    height: 28,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#60646C',
  },
  checkboxChecked: {
    borderColor: Accent,
    backgroundColor: Accent,
  },
  checkmark: {
    color: OnAccent,
  },
  info: {
    flex: 1,
    gap: Spacing.half,
    backgroundColor: 'transparent',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: 'transparent',
  },
  strikethrough: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: 'transparent',
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3c87f733',
  },
  stepLabel: {
    fontSize: 24,
    lineHeight: 28,
  },
  count: {
    minWidth: 48,
    textAlign: 'center',
  },
});

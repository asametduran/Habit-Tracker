import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { HabitForm } from '@/components/habit-form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useHabits, type Habit } from '@/hooks/use-habits';

const MAX_STARTER_HABITS = 3;

const HOW_IT_WORKS = [
  {
    icon: '✏️',
    title: 'Create habits',
    body: 'Add the things you want to do — a simple daily check-off, or something with a count like “8 glasses of water”.',
  },
  {
    icon: '✅',
    title: 'Track them every day',
    body: 'Check habits off on the Today screen. Each one you finish earns a sound, a buzz, and a growing streak.',
  },
  {
    icon: '🏆',
    title: 'Hit milestones and challenges',
    body: 'Streaks celebrate at 3, 7, 14 days and beyond. Start with a 3-day kickstart challenge, then create your own.',
  },
  {
    icon: '📈',
    title: 'Watch your progress',
    body: 'The History tab shows a heat map and your consistency over the last 7 and 30 days.',
  },
  {
    icon: '🔔',
    title: 'Get reminders when you want them',
    body: 'On the mobile app, set a notification for each habit at the time (and days) that suits you.',
  },
] as const;

/** One-time gate shown instead of the tabs until onboarding is complete. */
export function OnboardingScreen() {
  const [step, setStep] = useState<'intro' | 'habits'>('intro');

  return step === 'intro' ? (
    <IntroStep onNext={() => setStep('habits')} />
  ) : (
    <HabitsStep onBack={() => setStep('intro')} />
  );
}

function IntroStep({ onNext }: { onNext: () => void }) {
  const { status, requestAuth } = useAuth();

  return (
    <Screen title="How it works">
      <ThemedText themeColor="textSecondary">
        Build habits that stick, in five simple ideas.
      </ThemedText>

      {HOW_IT_WORKS.map((item) => (
        <ThemedView key={item.title} type="backgroundElement" style={styles.explainer}>
          <ThemedText style={styles.icon}>{item.icon}</ThemedText>
          <ThemedView style={styles.explainerText}>
            <ThemedText type="smallBold">{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.body}
            </ThemedText>
          </ThemedView>
        </ThemedView>
      ))}

      <Button label="Get started" onPress={onNext} />
      {status === 'signedOut' ? (
        <Button label="I already have an account" variant="secondary" onPress={requestAuth} />
      ) : null}
    </Screen>
  );
}

function HabitsStep({ onBack }: { onBack: () => void }) {
  const { addHabit, removeHabit, startChallenge, completeOnboarding } = useHabits();
  const [added, setAdded] = useState<Habit[]>([]);

  const full = added.length >= MAX_STARTER_HABITS;

  const handleStart = () => {
    startChallenge(
      added.map((habit) => habit.id),
      { name: '3-day kickstart', durationDays: 3 },
    );
    completeOnboarding();
  };

  return (
    <Screen title="Your first habits">
      <ThemedText themeColor="textSecondary">
        Pick up to {MAX_STARTER_HABITS} habits to start. We&apos;ll kick off a 3-day challenge —
        check off every one for 3 days in a row to win.
      </ThemedText>

      {added.map((habit) => (
        <ThemedView key={habit.id} type="backgroundElement" style={styles.addedRow}>
          <ThemedView style={styles.addedInfo}>
            <ThemedText>{habit.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {habit.type === 'quantity' ? `${habit.target} per day` : 'Daily check-off'}
            </ThemedText>
          </ThemedView>
          <Pressable
            onPress={() => {
              removeHabit(habit.id);
              setAdded((current) => current.filter((h) => h.id !== habit.id));
            }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${habit.name}`}
            hitSlop={8}>
            <ThemedText type="small" themeColor="textSecondary">
              ✕
            </ThemedText>
          </Pressable>
        </ThemedView>
      ))}

      {full ? null : (
        <HabitForm
          submitLabel="Add habit"
          onSubmit={(value) => {
            const habit = addHabit(value);
            if (habit) setAdded((current) => [...current, habit]);
          }}
        />
      )}

      <Button label="Start 3-day challenge" disabled={added.length === 0} onPress={handleStart} />
      <Button label="Back" variant="secondary" onPress={onBack} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  explainer: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  icon: {
    fontSize: 28,
    lineHeight: 44,
  },
  explainerText: {
    flex: 1,
    gap: Spacing.half,
    backgroundColor: 'transparent',
  },
  addedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  addedInfo: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

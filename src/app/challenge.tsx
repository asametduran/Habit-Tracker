import { useEffect, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ConfettiBurst } from '@/components/confetti-burst';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { useHabitRewards } from '@/hooks/use-habit-rewards';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { NAME_MAX, isCompleted } from '@/lib/habit-logic';

const PRESET_DAYS = [3, 7, 14, 30];

const STATUS_COPY = {
  active: 'In progress — keep every habit checked off each day.',
  completed: 'Challenge complete! 🎉',
  failed: 'A day was missed. Start a new one whenever you’re ready.',
} as const;

export default function ChallengeScreen() {
  const { habits, challenge, startChallenge, markChallengeCelebrated } = useHabits();
  const { celebrateChallenge } = useHabitRewards();
  const [creating, setCreating] = useState(false);

  // Latch the burst so it keeps playing after `celebrated` flips to true.
  const shouldCelebrate = challenge?.status === 'completed' && !challenge.celebrated;
  const [burstKey, setBurstKey] = useState(0);
  if (shouldCelebrate && burstKey === 0) setBurstKey(1);

  useEffect(() => {
    if (!shouldCelebrate) return;
    celebrateChallenge();
    markChallengeCelebrated();
  }, [shouldCelebrate, celebrateChallenge, markChallengeCelebrated]);

  const targets = challenge ? habits.filter((h) => challenge.habitIds.includes(h.id)) : [];
  const todayDone = targets.length > 0 && targets.every(isCompleted);
  const showForm = creating || !challenge;

  return (
    <Screen title="Challenge" overlay={<ConfettiBurst triggerKey={burstKey} />}>
      {showForm ? (
        <ChallengeForm
          onCancel={challenge ? () => setCreating(false) : undefined}
          onStart={(ids, options) => {
            setBurstKey(0);
            startChallenge(ids, options);
            setCreating(false);
          }}
        />
      ) : challenge ? (
        <>
          <ThemedView type="backgroundElement" style={styles.card}>
            {challenge.name ? <ThemedText type="smallBold">{challenge.name}</ThemedText> : null}
            <ThemedText type="subtitle">
              {challenge.daysCompleted}/{challenge.durationDays} days
            </ThemedText>
            <ThemedView style={styles.pips}>
              {Array.from({ length: challenge.durationDays }, (_, i) => (
                <ThemedView
                  key={i}
                  type="backgroundSelected"
                  style={[styles.pip, i < challenge.daysCompleted && styles.pipDone]}
                />
              ))}
            </ThemedView>
            <ThemedText themeColor="textSecondary">{STATUS_COPY[challenge.status]}</ThemedText>
            {challenge.status === 'active' ? (
              <ThemedText type="small" themeColor="textSecondary">
                Today:{' '}
                {todayDone ? 'all done ✅ — it counts when the day closes' : 'still in progress'}
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              Started {challenge.startDate}
            </ThemedText>
          </ThemedView>

          <ThemedText type="subtitle">Target habits</ThemedText>
          {targets.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              The habits in this challenge were removed.
            </ThemedText>
          ) : null}
          {targets.map((habit) => (
            <ThemedView key={habit.id} type="backgroundElement" style={styles.habitRow}>
              <ThemedText>{habit.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {isCompleted(habit)
                  ? '✅ done today'
                  : `${habit.count}${habit.type === 'quantity' ? `/${habit.target}` : ''} today`}
              </ThemedText>
            </ThemedView>
          ))}

          <Button
            label={challenge.status === 'active' ? 'Create a different challenge' : 'Create a new challenge'}
            variant={challenge.status === 'active' ? 'secondary' : 'primary'}
            onPress={() => setCreating(true)}
          />
        </>
      ) : null}
    </Screen>
  );
}

type ChallengeFormProps = {
  onStart: (habitIds: string[], options: { name: string; durationDays: number }) => void;
  onCancel?: () => void;
};

function ChallengeForm({ onStart, onCancel }: ChallengeFormProps) {
  const { habits } = useHabits();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [days, setDays] = useState('7');
  const [selected, setSelected] = useState<string[]>(() => habits.map((h) => h.id));

  const durationDays = parseInt(days, 10) || 0;
  const valid = selected.length > 0 && durationDays >= 1;
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  return (
    <>
      <ThemedText themeColor="textSecondary">
        Pick the habits and how many days in a row you need to complete all of them.
      </ThemedText>

      <ThemedText type="smallBold" themeColor="textSecondary">
        Name (optional)
      </ThemedText>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Summer reset"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
        maxLength={NAME_MAX}
        accessibilityLabel="Challenge name"
      />

      <ThemedText type="smallBold" themeColor="textSecondary">
        Length
      </ThemedText>
      <ThemedView style={styles.row}>
        {PRESET_DAYS.map((preset) => (
          <Chip
            key={preset}
            label={`${preset} days`}
            selected={durationDays === preset}
            onPress={() => setDays(`${preset}`)}
          />
        ))}
        <TextInput
          value={days}
          onChangeText={(text) => setDays(text.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder="Days"
          placeholderTextColor={theme.textSecondary}
          style={[inputStyle, styles.daysInput]}
          accessibilityLabel="Custom number of days"
        />
      </ThemedView>

      <ThemedText type="smallBold" themeColor="textSecondary">
        Habits
      </ThemedText>
      {habits.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Add a habit in the Manage tab first.
        </ThemedText>
      ) : (
        <ThemedView style={styles.row}>
          {habits.map((habit) => (
            <Chip
              key={habit.id}
              role="checkbox"
              label={habit.name}
              selected={selected.includes(habit.id)}
              onPress={() => toggle(habit.id)}
            />
          ))}
        </ThemedView>
      )}

      <Button
        label={durationDays ? `Start ${durationDays}-day challenge` : 'Start challenge'}
        disabled={!valid}
        onPress={() => onStart(selected, { name, durationDays })}
      />
      {onCancel ? <Button label="Cancel" variant="secondary" onPress={onCancel} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  pips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    backgroundColor: 'transparent',
  },
  pip: {
    flexGrow: 1,
    flexBasis: 12,
    maxWidth: 48,
    height: 12,
    borderRadius: 6,
  },
  pipDone: {
    backgroundColor: Accent,
  },
  habitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  input: {
    borderWidth: 1,
    borderColor: '#60646C',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  daysInput: {
    width: 90,
  },
});

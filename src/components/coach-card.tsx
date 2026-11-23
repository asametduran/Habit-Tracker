import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCoach } from '@/hooks/use-coach';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import type { CoachRequest, NudgeContent } from '@/lib/coach';

const NUDGE: CoachRequest = { fn: 'coach-nudge' };

// The day the user last hid the card; it comes back the next day with a fresh nudge.
const HIDDEN_KEY = 'habit-tracker/coach-hidden-on';

/** Today's AI coaching nudge, written by Gemini from the user's streaks and consistency. */
export function CoachCard() {
  const theme = useTheme();
  const { habits, today, updateHabit } = useHabits();
  // undefined until storage has been read, so a hidden card doesn't flash (or cost a request).
  const [hiddenOn, setHiddenOn] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(HIDDEN_KEY).then(setHiddenOn, () => setHiddenOn(null));
  }, []);

  const hidden = hiddenOn === undefined || hiddenOn === today;
  const coach = useCoach<NudgeContent>(NUDGE, { auto: true, active: !hidden && habits.length > 0 });
  if (!coach) return null;
  const { state, refresh, generate } = coach;
  if (state.status === 'empty' || state.status === 'none') return null;

  const hide = () => {
    setHiddenOn(today);
    AsyncStorage.setItem(HIDDEN_KEY, today).catch(() => undefined);
  };

  const header = (
    <View style={styles.header}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        ✨ Your coach
      </ThemedText>
      <Pressable onPress={hide} accessibilityRole="button" hitSlop={8}>
        <ThemedText type="small" themeColor="textSecondary">
          Hide for today
        </ThemedText>
      </Pressable>
    </View>
  );

  if (state.status === 'loading') {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        {header}
        <View style={styles.loading}>
          <ActivityIndicator color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">
            Looking at your last two weeks…
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (state.status === 'error') {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        {header}
        <ThemedText type="small" themeColor="textSecondary">
          {state.message}
        </ThemedText>
        <Pressable onPress={generate} accessibilityRole="button" hitSlop={8}>
          <ThemedText type="smallBold">Try again</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const nudge = state.insight.content;
  const adjustment = nudge.goal_adjustment;
  const target = adjustment && habits.find((habit) => habit.id === adjustment.habit_id);
  // Gone once applied: the habit's target then matches the suggestion.
  const showAdjustment =
    adjustment && target && target.type === 'quantity' && target.target !== adjustment.suggested_target;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {header}
      <ThemedText type="subtitle" style={styles.headline}>
        {nudge.headline}
      </ThemedText>
      <ThemedText>{nudge.message}</ThemedText>
      {nudge.tip ? <ThemedText type="small">💡 {nudge.tip}</ThemedText> : null}
      {showAdjustment ? (
        <ThemedView type="backgroundSelected" style={styles.suggestion}>
          <ThemedText type="small">{adjustment.reason}</ThemedText>
          <Button
            label={`Set ${target.name} to ${adjustment.suggested_target} a day`}
            variant="secondary"
            onPress={() => updateHabit(target.id, { target: adjustment.suggested_target })}
          />
        </ThemedView>
      ) : null}
      <Pressable onPress={refresh} accessibilityRole="button" hitSlop={8}>
        <ThemedText type="small" themeColor="textSecondary">
          Give me another tip
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headline: {
    fontSize: 20,
    lineHeight: 26,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  suggestion: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
});

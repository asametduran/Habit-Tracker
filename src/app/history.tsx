import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ReflectionCard } from '@/components/reflection-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';
import {
  addDays,
  consistency,
  isCompleted,
  parseDateKey,
  type Habit,
  type HistoryEntry,
} from '@/lib/habit-logic';

const WEEKS = 12;
const CELL = 18;
const GAP = 3;

/** Completion ratio (0–1) per date, or undefined where nothing was logged. */
function buildRatios(
  history: HistoryEntry[],
  habits: Habit[],
  today: string,
  habitId: string | 'all',
): Map<string, number> {
  const totals = new Map<string, { done: number; total: number }>();
  const add = (date: string, completed: boolean) => {
    const cell = totals.get(date) ?? { done: 0, total: 0 };
    cell.total += 1;
    if (completed) cell.done += 1;
    totals.set(date, cell);
  };
  for (const entry of history) {
    if (habitId === 'all' || entry.habitId === habitId) add(entry.date, entry.completed);
  }
  for (const habit of habits) {
    if (habitId === 'all' || habit.id === habitId) add(today, isCompleted(habit));
  }
  return new Map([...totals].map(([date, { done, total }]) => [date, done / total]));
}

export default function HistoryScreen() {
  const { habits, history, today } = useHabits();
  const [selected, setSelected] = useState<string>('all');

  const ratios = useMemo(
    () => buildRatios(history, habits, today, selected),
    [history, habits, today, selected],
  );

  // Columns are weeks (Mon→Sun); the last column holds today.
  const mondayOffset = (parseDateKey(today).getDay() + 6) % 7;
  const firstMonday = addDays(today, -(mondayOffset + (WEEKS - 1) * 7));
  const weeks = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(firstMonday, w * 7 + d)),
  );

  return (
    <Screen title="History">
      <ThemedView style={styles.chips}>
        {[{ id: 'all', name: 'All habits' }, ...habits].map((option) => (
          <Chip
            key={option.id}
            label={option.name}
            selected={selected === option.id}
            onPress={() => setSelected(option.id)}
          />
        ))}
      </ThemedView>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Last {WEEKS} weeks
        </ThemedText>
        <View style={styles.grid} accessibilityLabel="Completion heat map">
          {weeks.map((week) => (
            <View key={week[0]} style={styles.column}>
              {week.map((date) => {
                const ratio = ratios.get(date);
                const future = date > today;
                return (
                  <View
                    key={date}
                    accessibilityLabel={`${date}: ${ratio === undefined ? 'no data' : `${Math.round(ratio * 100)}%`}`}
                    style={[
                      styles.cell,
                      future && styles.cellFuture,
                      !future && ratio === undefined && styles.cellEmpty,
                      ratio !== undefined && {
                        backgroundColor: Accent,
                        opacity: 0.2 + ratio * 0.8,
                      },
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>
        {history.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Your history fills in as days roll over.
          </ThemedText>
        ) : null}
      </ThemedView>

      <ReflectionCard />

      <ThemedText type="subtitle">Consistency</ThemedText>
      {habits.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No habits yet.
        </ThemedText>
      ) : null}
      {habits.map((habit) => {
        const week = consistency(history, habit, 7, today);
        const month = consistency(history, habit, 30, today);
        return (
          <ThemedView key={habit.id} type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">{habit.name}</ThemedText>
            <ThemedView style={styles.statsRow}>
              <Stat
                icon="📅"
                label={`Last 7 days · ${week.done}/${week.total}`}
                value={`${Math.round(week.ratio * 100)}%`}
              />
              <Stat
                icon="🗓️"
                label={`Last 30 days · ${month.done}/${month.total}`}
                value={`${Math.round(month.ratio * 100)}%`}
              />
              <Stat icon="🔥" label="Current streak" value={`${habit.streak}`} />
              <Stat icon="🏆" label="Best streak" value={`${habit.bestStreak}`} />
            </ThemedView>
          </ThemedView>
        );
      })}
    </Screen>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    // A tile inside a card: the "selected" shade, like other nested boxes (an untyped ThemedView
    // would paint the page background, a black block in dark mode).
    <ThemedView type="backgroundSelected" style={styles.stat}>
      <ThemedText style={styles.statIcon}>{icon}</ThemedText>
      <ThemedText type="smallBold" style={styles.statValue}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel}>
        {label}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    gap: GAP,
  },
  column: {
    gap: GAP,
  },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 4,
  },
  cellEmpty: {
    backgroundColor: '#60646C33',
  },
  cellFuture: {
    backgroundColor: 'transparent',
  },
  // Equal-width cells that wrap as a tidy grid, with content centered in each.
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  stat: {
    flexGrow: 1,
    flexBasis: 140,
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.three,
  },
  statIcon: {
    fontSize: 24,
    lineHeight: 40,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 24,
    lineHeight: 32,
    textAlign: 'center',
  },
  statLabel: {
    textAlign: 'center',
  },
});

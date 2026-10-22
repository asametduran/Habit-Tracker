import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { HabitForm } from '@/components/habit-form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';

export default function ManageScreen() {
  const { habits, addHabit, updateHabit, removeHabit } = useHabits();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Screen title="Manage">
      <ThemedText type="smallBold" themeColor="textSecondary">
        Add a habit
      </ThemedText>
      <HabitForm submitLabel="Add" onSubmit={(value) => addHabit(value)} />

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
        Your habits
      </ThemedText>
      {habits.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing here yet.
        </ThemedText>
      ) : null}

      {habits.map((habit) =>
        editingId === habit.id ? (
          <ThemedView key={habit.id} type="backgroundElement" style={styles.card}>
            <HabitForm
              initial={{ name: habit.name, type: habit.type, target: habit.target }}
              submitLabel="Save"
              onSubmit={(value) => {
                updateHabit(habit.id, value);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          </ThemedView>
        ) : (
          <ThemedView key={habit.id} type="backgroundElement" style={[styles.card, styles.row]}>
            <ThemedView style={styles.info}>
              <ThemedText>{habit.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {habit.type === 'quantity' ? `Quantity · ${habit.target} per day` : 'Daily check-off'}
              </ThemedText>
            </ThemedView>
            <Pressable
              onPress={() => setEditingId(habit.id)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${habit.name}`}>
              <ThemedText type="smallBold" style={styles.edit}>
                Edit
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => removeHabit(habit.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${habit.name}`}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Remove
              </ThemedText>
            </Pressable>
          </ThemedView>
        ),
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    marginTop: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  info: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  edit: {
    color: '#3c87f7',
  },
});

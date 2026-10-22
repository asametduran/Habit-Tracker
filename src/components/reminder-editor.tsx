import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import type { Habit, Reminder } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { ALL_DAYS, DEFAULT_REMINDER } from '@/lib/habit-logic';

// Index 0 = Sunday, matching expo-notifications' weekday numbering (1 = Sunday).
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type ReminderEditorProps = {
  habit: Habit;
  /** Persists the reminder. Only called when the user confirms (or turns it off). */
  onChange: (reminder: Reminder) => void;
  /** Called when the user turns a reminder on, so the screen can ask for permission first. */
  onEnable?: () => Promise<boolean>;
};

const pad = (n: number) => `${n}`.padStart(2, '0');

function summarize(reminder: Reminder): string {
  const days =
    reminder.days.length === 7
      ? 'Every day'
      : reminder.days.map((d) => DAY_LABELS[d - 1]).join(', ');
  return `${days} at ${pad(reminder.hour)}:${pad(reminder.minute)}`;
}

export function ReminderEditor({ habit, onChange, onEnable }: ReminderEditorProps) {
  const saved = habit.reminder;
  const isSet = !!saved?.enabled;
  const [editing, setEditing] = useState(false);

  const startEditing = () => setEditing(true);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.header}>
        <ThemedView style={styles.titles}>
          <ThemedText>{habit.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isSet && saved ? `✓ ${summarize(saved)}` : 'No reminder'}
          </ThemedText>
        </ThemedView>
        {isSet && !editing ? (
          <Pressable
            onPress={startEditing}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${habit.name} reminder`}>
            <ThemedText type="smallBold" style={styles.editLink}>
              Edit
            </ThemedText>
          </Pressable>
        ) : null}
        <Switch
          value={isSet || editing}
          trackColor={{ true: Accent }}
          accessibilityLabel={`Remind me about ${habit.name}`}
          onValueChange={async (on) => {
            if (!on) {
              setEditing(false);
              onChange({ ...(saved ?? DEFAULT_REMINDER), enabled: false });
              return;
            }
            if (onEnable && !(await onEnable())) return;
            startEditing();
          }}
        />
      </ThemedView>

      {editing ? (
        <ReminderForm
          // Re-seed the draft each time the form opens.
          initial={{ ...(saved ?? DEFAULT_REMINDER), enabled: true }}
          habitName={habit.name}
          onSave={(reminder) => {
            onChange(reminder);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </ThemedView>
  );
}

type ReminderFormProps = {
  initial: Reminder;
  habitName: string;
  onSave: (reminder: Reminder) => void;
  onCancel: () => void;
};

function ReminderForm({ initial, habitName, onSave, onCancel }: ReminderFormProps) {
  const theme = useTheme();
  const [hourText, setHourText] = useState(pad(initial.hour));
  const [minuteText, setMinuteText] = useState(pad(initial.minute));
  const [days, setDays] = useState<number[]>(initial.days);

  const hour = Math.min(23, parseInt(hourText, 10) || 0);
  const minute = Math.min(59, parseInt(minuteText, 10) || 0);
  const validTime = hourText !== '' && minuteText !== '' && +hourText <= 23 && +minuteText <= 59;

  const toggleDay = (weekday: number) =>
    setDays((current) =>
      (current.includes(weekday)
        ? current.filter((d) => d !== weekday)
        : [...current, weekday]
      ).sort((a, b) => a - b),
    );

  const inputStyle = [styles.timeInput, { color: theme.text, backgroundColor: theme.background }];

  return (
    <ThemedView style={styles.form}>
      <ThemedView style={styles.timeRow}>
        <ThemedText type="small" themeColor="textSecondary">
          Time (24h)
        </ThemedText>
        <TextInput
          value={hourText}
          onChangeText={(text) => setHourText(text.replace(/[^0-9]/g, '').slice(0, 2))}
          keyboardType="number-pad"
          maxLength={2}
          style={inputStyle}
          accessibilityLabel={`${habitName} reminder hour`}
        />
        <ThemedText type="smallBold">:</ThemedText>
        <TextInput
          value={minuteText}
          onChangeText={(text) => setMinuteText(text.replace(/[^0-9]/g, '').slice(0, 2))}
          keyboardType="number-pad"
          maxLength={2}
          style={inputStyle}
          accessibilityLabel={`${habitName} reminder minute`}
        />
      </ThemedView>

      <ThemedView style={styles.days}>
        {DAY_LABELS.map((label, index) => (
          <Chip
            key={label}
            role="checkbox"
            label={label}
            selected={days.includes(index + 1)}
            onPress={() => toggleDay(index + 1)}
          />
        ))}
      </ThemedView>

      {!validTime ? (
        <ThemedText type="small" themeColor="textSecondary">
          Enter a time between 00:00 and 23:59.
        </ThemedText>
      ) : days.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Pick at least one day.
        </ThemedText>
      ) : null}

      <ThemedView style={styles.actions}>
        <ThemedView style={styles.actionFill}>
          <Button
            label="Save reminder"
            disabled={!validTime || days.length === 0}
            onPress={() => onSave({ enabled: true, hour, minute, days: days.length ? days : ALL_DAYS })}
          />
        </ThemedView>
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  titles: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  editLink: {
    color: Accent,
  },
  form: {
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  timeInput: {
    width: 56,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#60646C',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  days: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    backgroundColor: 'transparent',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  actionFill: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

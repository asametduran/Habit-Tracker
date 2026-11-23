import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { HabitType } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { NAME_MAX } from '@/lib/habit-logic';

export type HabitFormValue = { name: string; type: HabitType; target?: number };

type HabitFormProps = {
  initial?: HabitFormValue;
  submitLabel: string;
  onSubmit: (value: HabitFormValue) => void;
  onCancel?: () => void;
};

export function HabitForm({ initial, submitLabel, onSubmit, onCancel }: HabitFormProps) {
  const theme = useTheme();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<HabitType>(initial?.type ?? 'daily');
  const [target, setTarget] = useState(`${initial?.target ?? 8}`);

  const submit = () => {
    if (!name.trim()) return;
    const parsed = Math.max(1, parseInt(target, 10) || 1);
    onSubmit({ name, type, target: type === 'quantity' ? parsed : undefined });
    if (!initial) {
      setName('');
      setType('daily');
    }
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  return (
    <ThemedView style={styles.form}>
      <TextInput
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        placeholder="Habit name"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
        returnKeyType="done"
        maxLength={NAME_MAX}
        accessibilityLabel="Habit name"
      />

      <ThemedView style={styles.row}>
        <Chip label="Daily check-off" selected={type === 'daily'} onPress={() => setType('daily')} />
        <Chip label="Quantity" selected={type === 'quantity'} onPress={() => setType('quantity')} />
        {type === 'quantity' ? (
          <TextInput
            value={target}
            onChangeText={(text) => setTarget(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="Target"
            placeholderTextColor={theme.textSecondary}
            style={[inputStyle, styles.targetInput]}
            accessibilityLabel="Daily target"
          />
        ) : null}
      </ThemedView>

      <ThemedView style={styles.row}>
        <Button label={submitLabel} onPress={submit} />
        {onCancel ? <Button label="Cancel" variant="secondary" onPress={onCancel} /> : null}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.two,
    backgroundColor: 'transparent',
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
  targetInput: {
    width: 90,
  },
});

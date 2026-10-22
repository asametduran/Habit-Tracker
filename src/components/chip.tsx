import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, OnAccent, Spacing } from '@/constants/theme';

type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Accessibility role: radio for single-select groups, checkbox for multi-select. */
  role?: 'radio' | 'checkbox';
};

/** Selectable pill. Selected = white text on the accent fill; unselected = themed text on an outline. */
export function Chip({ label, selected, onPress, role = 'radio' }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { selected } : { checked: selected }}
      style={[styles.chip, selected && styles.selected]}>
      <ThemedText type="smallBold" style={selected ? styles.selectedText : undefined}>
        {role === 'checkbox' && selected ? `✓ ${label}` : label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: Accent,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  selected: {
    backgroundColor: Accent,
  },
  selectedText: {
    color: OnAccent,
  },
});

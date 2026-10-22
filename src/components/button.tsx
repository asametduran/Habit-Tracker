import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, OnAccent, Spacing } from '@/constants/theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Outline style for secondary actions. */
  variant?: 'primary' | 'secondary';
};

/** Primary = white text on the accent fill; secondary = themed text on an outline. */
export function Button({ label, onPress, disabled, variant = 'primary' }: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.button, primary ? styles.primary : styles.secondary, disabled && styles.disabled]}>
      <ThemedText type="smallBold" style={primary ? styles.primaryText : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: Accent,
  },
  secondary: {
    borderWidth: 1,
    borderColor: Accent,
  },
  primaryText: {
    color: OnAccent,
  },
  disabled: {
    opacity: 0.4,
  },
});

import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

type ScreenProps = {
  title: string;
  children: ReactNode;
  /** Absolutely positioned content drawn above the screen (e.g. confetti). */
  overlay?: ReactNode;
};

export function Screen({ title, children, overlay }: ScreenProps) {
  const insets = useSafeAreaInsets();
  // Clear the status bar / notch / Dynamic Island on top of the normal page padding.
  const paddingTop = Platform.OS === 'web' ? styles.safeArea.paddingTop : insets.top + Spacing.three;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.safeArea, { paddingTop }]}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <ThemedText type="title" style={styles.title}>
            {title}
          </ThemedText>
          {children}
        </ScrollView>
      </View>
      {overlay}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    paddingHorizontal: Spacing.four,
    paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.three : Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  scrollContent: {
    gap: Spacing.three,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
  },
});

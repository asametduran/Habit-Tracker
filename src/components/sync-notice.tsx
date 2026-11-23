import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSync } from '@/hooks/use-habits';

/** A one-off message from sync, floating above the tab bar until it's dismissed. */
export function SyncNotice() {
  const { notice, dismissNotice } = useSync();
  if (!notice) return null;

  return (
    <View style={styles.wrap}>
      <ThemedView type="backgroundSelected" style={styles.notice}>
        <ThemedText type="small" style={styles.text}>
          {notice}
        </ThemedText>
        <Pressable
          onPress={dismissNotice}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}>
          <ThemedText type="smallBold">OK</ThemedText>
        </Pressable>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BottomTabInset + Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    zIndex: 5,
    // Only the notice itself takes taps; the screen around it stays usable.
    pointerEvents: 'box-none',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.four * 2,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  text: {
    flex: 1,
  },
});

import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type DailyProgressBarProps = {
  completed: number;
  total: number;
};

export function DailyProgressBar({ completed, total }: DailyProgressBarProps) {
  const ratio = useSharedValue(0);

  useEffect(() => {
    ratio.value = withTiming(total === 0 ? 0 : completed / total, { duration: 350 });
  }, [completed, total, ratio]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${ratio.value * 100}%` }));

  return (
    <ThemedView style={styles.wrapper}>
      <ThemedView
        type="backgroundElement"
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: completed }}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </ThemedView>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {completed}/{total} done
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  track: {
    flex: 1,
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#3c87f7',
  },
});

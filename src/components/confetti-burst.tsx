import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const DOT_COUNT = 12;
const COLORS = ['#3c87f7', '#f7b23c', '#f75c5c', '#4cd68a', '#b06cf7'];

type ConfettiBurstProps = {
  /** Bump (or set to a new truthy value) to fire a burst. 0/undefined renders nothing. */
  triggerKey?: number;
};

export function ConfettiBurst({ triggerKey }: ConfettiBurstProps) {
  if (!triggerKey) return null;
  return (
    <View pointerEvents="none" style={styles.overlay}>
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <Dot key={`${triggerKey}-${i}`} />
      ))}
    </View>
  );
}

function Dot() {
  const [spec] = useState(() => ({
    angle: Math.random() * Math.PI * 2,
    distance: 90 + Math.random() * 140,
    size: 8 + Math.random() * 8,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateX: Math.cos(spec.angle) * spec.distance * progress.value },
      { translateY: Math.sin(spec.angle) * spec.distance * progress.value },
      { scale: 1 - progress.value * 0.6 },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        { width: spec.size, height: spec.size, borderRadius: spec.size / 2, backgroundColor: spec.color },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
  },
});

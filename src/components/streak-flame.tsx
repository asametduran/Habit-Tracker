import { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type StreakFlameProps = {
  /** Bump to play the milestone pulse. 0/undefined leaves the flame at rest. */
  pulseKey?: number;
};

export function StreakFlame({ pulseKey }: StreakFlameProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!pulseKey) return;
    scale.value = withSequence(withTiming(2, { duration: 200 }), withSpring(1));
  }, [pulseKey, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.Text style={style}>🔥</Animated.Text>;
}

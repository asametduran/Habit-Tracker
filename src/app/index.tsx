import { FlatList, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoachCard } from '@/components/coach-card';
import { ConfettiBurst } from '@/components/confetti-burst';
import { DailyProgressBar } from '@/components/daily-progress-bar';
import { HabitCard } from '@/components/habit-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useHabitRewards } from '@/hooks/use-habit-rewards';
import { useHabits } from '@/hooks/use-habits';
import { isCompleted } from '@/lib/habit-logic';

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const { habits } = useHabits();
  const { toggleDaily, incrementQuantity, decrementQuantity, lastEvent } = useHabitRewards();

  const completedCount = habits.filter(isCompleted).length;
  const confettiKey = lastEvent?.type === 'allDone' ? lastEvent.key : 0;
  const milestone =
    lastEvent?.type === 'milestone'
      ? { habitId: lastEvent.habitId, key: lastEvent.key }
      : lastEvent?.type === 'allDone' && lastEvent.milestone
        ? { habitId: lastEvent.milestone.habitId, key: lastEvent.key }
        : null;

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.safeArea,
          // Clear the status bar / notch / Dynamic Island on top of the normal page padding.
          Platform.OS !== 'web' && { paddingTop: insets.top + Spacing.three },
        ]}>
        <ThemedText type="title" style={styles.title}>
          Today
        </ThemedText>

        <DailyProgressBar completed={completedCount} total={habits.length} />

        <FlatList
          data={habits}
          keyExtractor={(habit) => habit.id}
          contentContainerStyle={styles.listContent}
          style={styles.list}
          ListHeaderComponent={<CoachCard />}
          renderItem={({ item }) => (
            <HabitCard
              habit={item}
              onToggle={toggleDaily}
              onIncrement={incrementQuantity}
              onDecrement={decrementQuantity}
              pulseKey={milestone?.habitId === item.id ? milestone.key : 0}
            />
          )}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No habits yet — add one in the Manage tab.
            </ThemedText>
          }
        />

        {Platform.OS === 'web' && <WebBadge />}
      </View>
      <ConfettiBurst triggerKey={confettiKey} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.three : Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    // The row container centers this block vertically. Without a cap it grows past the screen
    // and overflows both ways, pushing the title up under the status bar / top tab bar.
    maxHeight: '100%',
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: Spacing.two,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: Spacing.four,
  },
});

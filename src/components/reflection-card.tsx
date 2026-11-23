import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { useCoach } from '@/hooks/use-coach';
import { useTheme } from '@/hooks/use-theme';
import type { CoachRequest, ReportContent } from '@/lib/coach';
import { parseDateKey } from '@/lib/habit-logic';

const RANGES = [
  { id: 'week', label: 'Past 7 days', request: { fn: 'reflection-report', range: 'week' } },
  { id: 'month', label: 'Past 30 days', request: { fn: 'reflection-report', range: 'month' } },
] as const satisfies readonly { id: string; label: string; request: CoachRequest }[];

function shortDate(key: string) {
  return parseDateKey(key).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Weekly / monthly AI reflection, written by Gemini on request and kept for the period. */
export function ReflectionCard() {
  const theme = useTheme();
  const [rangeId, setRangeId] = useState<'week' | 'month'>('week');
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  const coach = useCoach<ReportContent>(range.request, { auto: false });
  if (!coach) return null;
  const { state, generate, refresh } = coach;

  let body: ReactNode;
  if (state.status === 'loading') {
    body = (
      <View style={styles.row}>
        <ActivityIndicator color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          Reading your {range.label.toLowerCase()}…
        </ThemedText>
      </View>
    );
  } else if (state.status === 'none') {
    body = (
      <>
        <ThemedText type="small" themeColor="textSecondary">
          A short write-up of how your {range.label.toLowerCase()} went: what worked, what slipped,
          and one thing to focus on next. A new one arrives automatically{' '}
          {rangeId === 'week' ? 'every Monday morning' : 'on the 1st of each month'}.
        </ThemedText>
        <Button label="Write one now" onPress={generate} />
      </>
    );
  } else if (state.status === 'empty' || state.status === 'error') {
    body = (
      <>
        <ThemedText type="small" themeColor="textSecondary">
          {state.message}
        </ThemedText>
        {state.status === 'error' ? (
          <Button label="Try again" variant="secondary" onPress={generate} />
        ) : null}
      </>
    );
  } else {
    const { insight } = state;
    const report = insight.content;
    const { overall, previous_overall: previous, perfect_days: perfect } = report.stats;
    body = (
      <>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {shortDate(insight.period_start)} – {shortDate(insight.period_end)}
          {overall.rate !== null ? ` · ${overall.rate}% done` : ''}
          {previous.rate !== null ? ` (was ${previous.rate}%)` : ''}
          {perfect.out_of > 0 ? ` · ${perfect.count} perfect day${perfect.count === 1 ? '' : 's'}` : ''}
        </ThemedText>
        <ThemedText type="subtitle" style={styles.title}>
          {report.title}
        </ThemedText>
        <ThemedText>{report.summary}</ThemedText>

        {report.highlights.length > 0 ? (
          <View style={styles.list}>
            {report.highlights.map((line) => (
              <ThemedText key={line} type="small">
                ✅ {line}
              </ThemedText>
            ))}
          </View>
        ) : null}
        {report.watch_outs.length > 0 ? (
          <View style={styles.list}>
            {report.watch_outs.map((line) => (
              <ThemedText key={line} type="small">
                👀 {line}
              </ThemedText>
            ))}
          </View>
        ) : null}
        <ThemedText type="small">🎯 {report.focus_next}</ThemedText>

        <View style={styles.list}>
          {report.stats.habits.map((habit) => (
            <View key={habit.id} style={styles.bar}>
              <ThemedText type="small" style={styles.barLabel} numberOfLines={1}>
                {habit.name}
              </ThemedText>
              <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
                <View style={[styles.fill, { width: `${habit.rate ?? 0}%` }]} />
              </View>
              <ThemedText type="smallBold" style={styles.barValue}>
                {habit.rate === null ? '–' : `${habit.rate}%`}
              </ThemedText>
            </View>
          ))}
        </View>

        <View style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
            Written by Gemini from your habit stats.
          </ThemedText>
          <Pressable onPress={refresh} accessibilityRole="button" hitSlop={8}>
            <ThemedText type="small" themeColor="textSecondary">
              Rewrite
            </ThemedText>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <ThemedText type="subtitle">Reflection</ThemedText>
      <ThemedView style={styles.chips}>
        {RANGES.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={rangeId === option.id}
            onPress={() => setRangeId(option.id)}
          />
        ))}
      </ThemedView>
      <ThemedView type="backgroundElement" style={styles.card}>
        {body}
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  list: {
    gap: Spacing.one,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  barLabel: {
    width: 110,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: Accent,
  },
  barValue: {
    width: 44,
    textAlign: 'right',
  },
});

import { useState } from 'react';
import { Pressable, StyleSheet, Switch } from 'react-native';

import { Button } from '@/components/button';
import { ReminderEditor } from '@/components/reminder-editor';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Danger, OnAccent, Spacing } from '@/constants/theme';
import { useHabits, type Settings } from '@/hooks/use-habits';
import { NOTIFICATIONS_SUPPORTED, ensurePermission } from '@/lib/notifications';

const TOGGLES: { key: keyof Settings; label: string; detail: string }[] = [
  {
    key: 'dailyReminder',
    label: 'Habit reminders',
    detail: 'Master switch for the per-habit reminders below',
  },
  { key: 'afternoonNudge', label: 'Afternoon nudge', detail: '3:00 pm, only if habits are left' },
  { key: 'streakAlert', label: 'Streak-at-risk alert', detail: '8:00 pm, for streaks of 3+ days' },
];

export default function SettingsScreen() {
  const {
    habits,
    settings,
    updateSettings,
    updateHabit,
    resetAll,
    challenge,
    today,
    devDayOffset,
    devAdvanceDay,
    devResetDays,
    devCompleteAllToday,
    devForceChallengeComplete,
  } = useHabits();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Web has no notifications, so there's nothing to ask permission for — settings still save.
  const askPermission = async () => {
    const granted = !NOTIFICATIONS_SUPPORTED || (await ensurePermission());
    setPermissionDenied(!granted);
    return granted;
  };

  const toggle = async (key: keyof Settings, value: boolean) => {
    if (value && !(await askPermission())) return;
    updateSettings({ [key]: value });
  };

  const reset = async () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setConfirmingReset(false);
    await resetAll();
  };

  return (
    <Screen title="Settings">
      <ThemedText type="subtitle">Notifications</ThemedText>
      {NOTIFICATIONS_SUPPORTED ? null : (
        <ThemedText type="small" themeColor="textSecondary">
          Notifications only fire in the mobile app. You can set everything up here — your choices
          are saved and will apply on your phone.
        </ThemedText>
      )}

      {TOGGLES.map(({ key, label, detail }) => (
        <ThemedView key={key} type="backgroundElement" style={styles.row}>
          <ThemedView style={styles.info}>
            <ThemedText>{label}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {detail}
            </ThemedText>
          </ThemedView>
          <Switch
            value={settings[key]}
            trackColor={{ true: Accent }}
            onValueChange={(value) => toggle(key, value)}
            accessibilityLabel={label}
          />
        </ThemedView>
      ))}
      {permissionDenied ? (
        <ThemedText type="small" themeColor="textSecondary">
          Notifications are blocked — enable them for this app in system settings.
        </ThemedText>
      ) : null}

      <ThemedText type="subtitle" style={styles.sectionGap}>
        Reminder per habit
      </ThemedText>
      {habits.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Add a habit in the Manage tab to set a reminder for it.
        </ThemedText>
      ) : null}
      {habits.map((habit) => (
        <ReminderEditor
          key={habit.id}
          habit={habit}
          onEnable={askPermission}
          onChange={(reminder) => updateHabit(habit.id, { reminder })}
        />
      ))}

      {__DEV__ ? (
        <>
          <ThemedText type="subtitle" style={styles.sectionGap}>
            Developer tools
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.devCard}>
            <ThemedText type="smallBold">
              App date: {today}
              {devDayOffset > 0 ? `  (+${devDayOffset} simulated day${devDayOffset === 1 ? '' : 's'})` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {challenge
                ? `Challenge: ${challenge.daysCompleted}/${challenge.durationDays} days · ${challenge.status}`
                : 'No challenge running.'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Advancing a day runs the real end-of-day logic: history is logged, streaks break for
              missed habits, and the challenge advances or fails.
            </ThemedText>
          </ThemedView>
          <Button
            label="Complete all habits, then advance a day"
            onPress={() => {
              devCompleteAllToday();
              devAdvanceDay();
            }}
          />
          <Button label="Advance a day (as is)" variant="secondary" onPress={devAdvanceDay} />
          <Button label="Complete all of today’s habits" variant="secondary" onPress={devCompleteAllToday} />
          <Button
            label="Trigger challenge-complete celebration"
            variant="secondary"
            disabled={!challenge}
            onPress={devForceChallengeComplete}
          />
          <Button
            label="Reset to real date"
            variant="secondary"
            disabled={devDayOffset === 0}
            onPress={devResetDays}
          />
          <ThemedText type="small" themeColor="textSecondary">
            After triggering the celebration, open the Challenge tab to see the confetti and hear
            the sound.
          </ThemedText>
        </>
      ) : null}

      <ThemedText type="subtitle" style={styles.sectionGap}>
        Data
      </ThemedText>
      <Pressable
        onPress={reset}
        accessibilityRole="button"
        style={[styles.reset, confirmingReset && styles.resetConfirm]}>
        <ThemedText type="smallBold" style={confirmingReset ? styles.resetTextOn : styles.resetText}>
          {confirmingReset ? 'Tap again to erase everything' : 'Reset all data'}
        </ThemedText>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">
        Clears habits, history and the challenge, and shows onboarding again.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  info: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  devCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  sectionGap: {
    marginTop: Spacing.three,
  },
  reset: {
    borderWidth: 1,
    borderColor: Danger,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  resetConfirm: {
    backgroundColor: Danger,
  },
  resetText: {
    color: Danger,
  },
  resetTextOn: {
    color: OnAccent,
  },
});

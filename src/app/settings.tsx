import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { ReminderEditor } from '@/components/reminder-editor';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Danger, OnAccent, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { showPushPreview } from '@/components/push-preview';
import { useCoach } from '@/hooks/use-coach';
import { useCoachPush } from '@/hooks/use-coach-push';
import { previewCoachPush } from '@/hooks/use-simulated-coach-push';
import type { CoachRequest, NudgeContent } from '@/lib/coach';
import { useHabits, useSync, type Settings } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { NOTIFICATIONS_SUPPORTED, ensurePermission } from '@/lib/notifications';
import type { PushRegistration } from '@/lib/push';

const TOGGLES: { key: keyof Settings; label: string; detail: string }[] = [
  {
    key: 'dailyReminder',
    label: 'Habit reminders',
    detail: 'Master switch for the per-habit reminders below',
  },
  { key: 'afternoonNudge', label: 'Afternoon nudge', detail: '3:00 pm, only if habits are left' },
  { key: 'streakAlert', label: 'Streak-at-risk alert', detail: '8:00 pm, for streaks of 3+ days' },
];

const NUDGE: CoachRequest = { fn: 'coach-nudge' };

// How long "Sign out" waits for a last sync before asking whether to go ahead without it.
const SIGN_OUT_SYNC_WAIT_MS = 4000;

function changes(count: number) {
  return `${count} change${count === 1 ? '' : 's'}`;
}

// Offline is the usual reason a sync fails, and fetch reports it in developer terms
// ("Failed to fetch" on web, "Network request failed" on native). Anything else is shown as is.
function syncErrorText(error: string) {
  return /failed to fetch|network request failed|networkerror/i.test(error)
    ? 'Can’t reach the server — changes will sync when you’re back online.'
    : `Last sync failed: ${error}`;
}

// Why this phone isn't getting the coach's 3 pm push, in plain words.
function coachPushText(registration: PushRegistration): string | null {
  if (registration.ok) return 'Your coach sends today’s tip to this phone at 3:00 pm.';
  switch (registration.reason) {
    case 'no-project':
      return 'Coach notifications start once this app’s push setup is in a build (EAS project ID).';
    case 'simulator':
      return 'Emulators can’t receive coach notifications; try it on a real phone.';
    case 'denied':
      return 'Notifications are blocked — enable them for this app in system settings to get your coach’s tips.';
    case 'failed':
      return 'Couldn’t set up coach notifications; it’s tried again next time you open the app.';
    default:
      return null;
  }
}

function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

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
  const { status, user, setFirstName } = useAuth();
  const { syncing, error, pending, lastSyncedAt, syncNow, signOut } = useSync();
  const coachPush = useCoachPush();
  // Shares today's nudge with the Today screen, so a fresh one written here shows there too.
  const nudge = useCoach<NudgeContent>(NUDGE, { auto: false });
  const theme = useTheme();
  // null until edited, so the field shows the saved name once the account has loaded.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameNote, setNameNote] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const signedIn = status === 'signedIn';
  const syncStatus = syncing
    ? 'Syncing…'
    : pending > 0
      ? `${changes(pending)} waiting to sync`
      : lastSyncedAt
        ? `All changes synced · ${timeOfDay(lastSyncedAt)}`
        : 'Not synced yet';

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
    setResetFailed(false);
    try {
      await resetAll();
    } catch {
      // Signed in, the account is erased first — and it couldn't be reached.
      setResetFailed(true);
    }
  };

  const saveName = async () => {
    if (nameDraft === null || nameDraft.trim() === (user?.firstName ?? '')) return;
    const result = await setFirstName(nameDraft);
    setNameNote(result.ok ? 'Saved.' : result.message);
    if (result.ok) setNameDraft(null);
  };

  const leave = async () => {
    if (!confirmingSignOut && pending > 0) {
      // Signing out clears this device, so get everything onto the account first — and ask
      // before going ahead if that isn't possible right now.
      setSigningOut(true);
      const left = await Promise.race([
        syncNow(),
        new Promise<number>((resolve) => setTimeout(() => resolve(pending), SIGN_OUT_SYNC_WAIT_MS)),
      ]);
      setSigningOut(false);
      if (left > 0) {
        setConfirmingSignOut(true);
        return;
      }
    }
    setConfirmingSignOut(false);
    await signOut();
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
              {key === 'afternoonNudge' && signedIn && settings.aiCoach
                ? '3:00 pm, a personal tip from your AI coach'
                : detail}
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
          {nudge ? (
            <>
              <Button
                label="Preview today’s 3 pm coach push"
                variant="secondary"
                onPress={async () => {
                  const shown = await previewCoachPush(today);
                  if (!shown) {
                    showPushPreview({
                      title: 'Your coach',
                      body: 'There’s no nudge for today yet (or the coach couldn’t be reached).',
                    });
                  }
                }}
              />
              <Button
                label={nudge.state.status === 'loading' ? 'Writing a fresh nudge…' : 'Write a fresh nudge'}
                variant="secondary"
                disabled={nudge.state.status === 'loading'}
                onPress={nudge.refresh}
              />
              <ThemedText type="small" themeColor="textSecondary">
                Each fresh nudge is one Gemini call ({'≤'}10 per account per day). The push preview
                shows the same banner the web app shows at 3 pm.
              </ThemedText>
            </>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            After triggering the celebration, open the Challenge tab to see the confetti and hear
            the sound.
          </ThemedText>
        </>
      ) : null}

      <ThemedText type="subtitle" style={styles.sectionGap}>
        Account
      </ThemedText>
      {signedIn ? (
        <>
          <ThemedView type="backgroundElement" style={styles.devCard}>
            <ThemedText>{user?.email ?? 'Signed in'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {syncStatus}
            </ThemedText>
            {error && !syncing ? (
              <ThemedText type="small" themeColor="textSecondary">
                {syncErrorText(error)}
              </ThemedText>
            ) : null}
          </ThemedView>
          <Button label="Sync now" variant="secondary" disabled={syncing} onPress={syncNow} />
          {/* Once a background sync catches up there's nothing left to warn about. */}
          {confirmingSignOut && pending > 0 ? (
            <Pressable
              onPress={leave}
              accessibilityRole="button"
              style={[styles.reset, styles.resetConfirm]}>
              <ThemedText type="smallBold" style={styles.resetTextOn}>
                Tap again to sign out — {changes(pending)} not synced yet will be lost
              </ThemedText>
            </Pressable>
          ) : (
            <Button
              label={signingOut ? 'Syncing before signing out…' : 'Sign out'}
              variant="secondary"
              disabled={signingOut}
              onPress={leave}
            />
          )}
          <ThemedText type="small" themeColor="textSecondary">
            Signing out removes your habits from this device. They stay in your account.
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.row}>
            <ThemedView style={styles.info}>
              <ThemedText>AI coach</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                A daily nudge on Today and reflections in History, written by Google Gemini from
                your habit names and stats.
              </ThemedText>
            </ThemedView>
            <Switch
              value={settings.aiCoach}
              trackColor={{ true: Accent }}
              onValueChange={(value) => updateSettings({ aiCoach: value })}
              accessibilityLabel="AI coach"
            />
          </ThemedView>
          {settings.aiCoach ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                A fresh nudge is ready each morning, and new reflections arrive on Mondays and the
                1st of the month.
              </ThemedText>
              {coachPush && coachPushText(coachPush) ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {coachPushText(coachPush)}
                </ThemedText>
              ) : null}
              <ThemedView type="backgroundElement" style={styles.devCard}>
                <ThemedText>First name</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  So your coach can say hi. Leave it empty to stay anonymous.
                </ThemedText>
                <TextInput
                  value={nameDraft ?? user?.firstName ?? ''}
                  onChangeText={(value) => {
                    setNameDraft(value);
                    setNameNote(null);
                  }}
                  onSubmitEditing={saveName}
                  onBlur={saveName}
                  placeholder="First name"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                  autoCapitalize="words"
                  autoComplete="given-name"
                  textContentType="givenName"
                  maxLength={40}
                  returnKeyType="done"
                  accessibilityLabel="First name"
                />
                {nameNote ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {nameNote}
                  </ThemedText>
                ) : null}
              </ThemedView>
            </>
          ) : null}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {status === 'disabled'
            ? 'Sync isn’t set up in this build — your habits are saved on this device only.'
            : 'Not signed in.'}
        </ThemedText>
      )}

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
      {resetFailed ? (
        <ThemedText type="small" style={styles.resetText}>
          Couldn’t reach your account, so nothing was erased. Try again when you’re online.
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {signedIn
          ? 'Clears habits, history and the challenge — in your account and on every device signed in to it — and shows onboarding again.'
          : 'Clears habits, history and the challenge, and shows onboarding again.'}
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
  input: {
    borderWidth: 1,
    borderColor: '#60646C',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.one,
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

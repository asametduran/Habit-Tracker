import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { isCompleted, type Habit, type Settings } from '@/lib/habit-logic';

export const NOTIFICATIONS_SUPPORTED = true;

const IDS = {
  nudge: 'afternoon-nudge',
  streak: 'streak-at-risk',
} as const;

const NUDGE_HOUR = 15;
const STREAK_HOUR = 20;
const STREAK_ALERT_MIN = 3;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Habit reminders',
      importance: AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

function todayAt(hour: number): Date {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date;
}

async function scheduleToday(id: string, hour: number, title: string, body: string) {
  const date = todayAt(hour);
  if (date.getTime() <= Date.now()) return; // that time has already passed today
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
}

/**
 * Re-derives all three local notifications from the current settings and habit state.
 * Cheap and idempotent — called when settings change and whenever the app backgrounds.
 * With `coachPush`, the AI coach sends the afternoon nudge as a push from the server instead.
 */
export async function syncNotifications(
  settings: Settings,
  habits: Habit[],
  { coachPush = false }: { coachPush?: boolean } = {},
): Promise<void> {
  const anyEnabled = settings.dailyReminder || settings.afternoonNudge || settings.streakAlert;
  if (!anyEnabled) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return;
  }
  if (!(await ensurePermission())) return;

  // Everything scheduled here is app-owned, so rebuild from scratch each time.
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (settings.dailyReminder) {
    for (const habit of habits) {
      const reminder = habit.reminder;
      if (!reminder?.enabled || reminder.days.length === 0) continue;
      const content = { title: habit.name, body: `Time for “${habit.name}”.` };
      const { hour, minute } = reminder;
      if (reminder.days.length === 7) {
        await Notifications.scheduleNotificationAsync({
          identifier: `habit-${habit.id}`,
          content,
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
        });
      } else {
        for (const weekday of reminder.days) {
          await Notifications.scheduleNotificationAsync({
            identifier: `habit-${habit.id}-${weekday}`,
            content,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday,
              hour,
              minute,
            },
          });
        }
      }
    }
  }

  const incomplete = habits.filter((habit) => !isCompleted(habit));

  if (settings.afternoonNudge && !coachPush && incomplete.length > 0) {
    await scheduleToday(
      IDS.nudge,
      NUDGE_HOUR,
      'Still time today',
      `${incomplete.length} habit${incomplete.length === 1 ? '' : 's'} left to go.`,
    );
  }

  const atRisk = incomplete.find((habit) => habit.streak >= STREAK_ALERT_MIN);
  if (settings.streakAlert && atRisk) {
    await scheduleToday(
      IDS.streak,
      STREAK_HOUR,
      'Your streak is at risk 🔥',
      `Finish "${atRisk.name}" to keep your ${atRisk.streak}-day streak.`,
    );
  }
}

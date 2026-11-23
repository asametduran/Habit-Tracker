import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useHabits } from '@/hooks/use-habits';
import { NOTIFICATIONS_SUPPORTED, syncNotifications } from '@/lib/notifications';

/**
 * Keeps scheduled local notifications in step with settings, and recomputes the
 * afternoon-nudge / streak-at-risk alerts each time the app goes to the background.
 * `coachPush`: this phone gets the AI coach's afternoon push, so no local afternoon nudge.
 */
export function useNotificationSync(coachPush: boolean) {
  const { habits, settings, isLoaded } = useHabits();
  const latest = useRef({ habits, settings, coachPush });

  useEffect(() => {
    latest.current = { habits, settings, coachPush };
  });

  // Reschedule when any habit's name or reminder changes (not on every check-off).
  const reminderKey = JSON.stringify(habits.map((h) => [h.id, h.name, h.reminder]));

  useEffect(() => {
    if (!NOTIFICATIONS_SUPPORTED || !isLoaded) return;
    syncNotifications(settings, latest.current.habits, { coachPush }).catch(() => {});
  }, [settings, isLoaded, reminderKey, coachPush]);

  useEffect(() => {
    if (!NOTIFICATIONS_SUPPORTED) return;
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'background' || status === 'inactive') {
        const { settings: s, habits: h, coachPush: push } = latest.current;
        syncNotifications(s, h, { coachPush: push }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);
}

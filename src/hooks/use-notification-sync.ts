import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useHabits } from '@/hooks/use-habits';
import { NOTIFICATIONS_SUPPORTED, syncNotifications } from '@/lib/notifications';

/**
 * Keeps scheduled local notifications in step with settings, and recomputes the
 * afternoon-nudge / streak-at-risk alerts each time the app goes to the background.
 */
export function useNotificationSync() {
  const { habits, settings, isLoaded } = useHabits();
  const latest = useRef({ habits, settings });

  useEffect(() => {
    latest.current = { habits, settings };
  });

  // Reschedule when any habit's name or reminder changes (not on every check-off).
  const reminderKey = JSON.stringify(habits.map((h) => [h.id, h.name, h.reminder]));

  useEffect(() => {
    if (!NOTIFICATIONS_SUPPORTED || !isLoaded) return;
    syncNotifications(settings, latest.current.habits).catch(() => {});
  }, [settings, isLoaded, reminderKey]);

  useEffect(() => {
    if (!NOTIFICATIONS_SUPPORTED) return;
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'background' || status === 'inactive') {
        syncNotifications(latest.current.settings, latest.current.habits).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);
}

import { useEffect, useSyncExternalStore } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useHabits } from '@/hooks/use-habits';
import { PUSH_SUPPORTED, registerForCoachPush, type PushRegistration } from '@/lib/push';

// One registration per signed-in account per app launch, shared by everyone who asks (the root
// layout registers; Settings shows the outcome; local notifications check whether it worked).
let result: { key: string; registration: PushRegistration | null } | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Registers this phone for the coach's 15:00 push while it's wanted: signed in, AI coach and
 * afternoon nudge both on. Returns the outcome (null while pending or not wanted); `{ ok: true }`
 * means the server sends the afternoon nudge, so the app doesn't schedule its local one.
 */
export function useCoachPush(): PushRegistration | null {
  const { status, user } = useAuth();
  const { settings, isLoaded } = useHabits();
  const wanted =
    PUSH_SUPPORTED &&
    isLoaded &&
    status === 'signedIn' &&
    !!user &&
    settings.aiCoach &&
    settings.afternoonNudge;
  const key = wanted ? user.id : null;

  const current = useSyncExternalStore(
    subscribe,
    () => result,
    () => null,
  );

  useEffect(() => {
    if (!key || result?.key === key) return;
    result = { key, registration: null };
    listeners.forEach((listener) => listener());
    registerForCoachPush().then((registration) => {
      if (result?.key !== key) return; // signed out or switched account meanwhile
      result = { key, registration };
      listeners.forEach((listener) => listener());
    });
  }, [key]);

  return key && current?.key === key ? current.registration : null;
}

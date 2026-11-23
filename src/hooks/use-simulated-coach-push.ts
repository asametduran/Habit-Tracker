import { useEffect } from 'react';
import { Platform } from 'react-native';

import { showPushPreview } from '@/components/push-preview';
import { useAuth } from '@/hooks/use-auth';
import { useHabits } from '@/hooks/use-habits';
import { fetchInsight, type NudgeContent } from '@/lib/coach';

// The browser can't get the coach's real 15:00 push, so on web the app shows a look-alike banner
// (components/push-preview.tsx) at that time instead: once a day, while the app is open between
// 15:00 and 18:00 (the same window the server sends pushes in), with the same text.

const PUSH_HOUR = 15;
const UNTIL_HOUR = 18;
const SHOWN_KEY = 'habit-tracker/push-preview-shown-on';

function shownOn(): string | null {
  try {
    return globalThis.localStorage?.getItem(SHOWN_KEY) ?? null;
  } catch {
    return null;
  }
}

function markShown(day: string) {
  try {
    globalThis.localStorage?.setItem(SHOWN_KEY, day);
  } catch {
    // private window: it may show again on reload, which is harmless
  }
}

/** Shows today's coach push as an in-app banner: fetches today's nudge and shows its push text. */
export async function previewCoachPush(today: string): Promise<boolean> {
  try {
    const result = await fetchInsight<NudgeContent>({ fn: 'coach-nudge' }, today);
    if (result.status !== 'ok') return false;
    const nudge = result.insight.content;
    showPushPreview({ title: nudge.headline, body: nudge.push || nudge.message });
    return true;
  } catch {
    return false;
  }
}

export function useSimulatedCoachPush() {
  const { status } = useAuth();
  const { settings, today, isLoaded } = useHabits();
  const enabled =
    Platform.OS === 'web' &&
    isLoaded &&
    status === 'signedIn' &&
    settings.aiCoach &&
    settings.afternoonNudge;

  useEffect(() => {
    if (!enabled) return;
    const fire = () => {
      if (shownOn() === today) return;
      previewCoachPush(today).then((shown) => shown && markShown(today));
    };
    const now = new Date();
    const at = new Date(now);
    at.setHours(PUSH_HOUR, 0, 0, 0);
    if (now.getHours() >= PUSH_HOUR && now.getHours() < UNTIL_HOUR) {
      fire();
      return;
    }
    if (now >= at) return; // after the window: tomorrow
    const timer = setTimeout(fire, at.getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [enabled, today]);
}

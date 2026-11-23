// Web build: local notifications aren't supported, so every entry point is a no-op.
import type { Habit, Settings } from '@/lib/habit-logic';

export const NOTIFICATIONS_SUPPORTED = false;

export async function ensurePermission(): Promise<boolean> {
  return false;
}

export async function syncNotifications(
  _settings: Settings,
  _habits: Habit[],
  _options?: { coachPush?: boolean },
): Promise<void> {}

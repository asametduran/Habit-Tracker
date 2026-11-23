import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ensurePermission } from '@/lib/notifications';
import { getSupabase } from '@/lib/supabase';

// Remote push for the AI coach: the device's Expo push token is stored in `push_tokens`, and the
// coach-scheduler edge function sends the daily nudge to it at 15:00 (supabase/functions/).

export const PUSH_SUPPORTED = true;

export type PushRegistration =
  | { ok: true }
  /**
   * `no-project`: the build has no EAS project ID, so Expo can't issue a push token (run
   * `npx eas-cli@latest init`). `simulator`: emulators can't receive pushes.
   */
  | { ok: false; reason: 'no-project' | 'simulator' | 'denied' | 'failed' | 'unsupported' };

let registered: string | null = null;

export async function registerForCoachPush(): Promise<PushRegistration> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'unsupported' };
  if (!Device.isDevice) return { ok: false, reason: 'simulator' };
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return { ok: false, reason: 'no-project' };
  if (!(await ensurePermission())) return { ok: false, reason: 'denied' };
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('register_push_token', {
      push_token: token,
      device_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (error) throw error;
    registered = token;
    return { ok: true };
  } catch (error) {
    console.warn('Registering for coach notifications failed', error);
    return { ok: false, reason: 'failed' };
  }
}

/** Stops this device getting the signed-in account's pushes. Call before signing out. */
export async function unregisterCoachPush(): Promise<void> {
  const token = registered;
  registered = null;
  if (!token) return;
  await getSupabase()?.from('push_tokens').delete().eq('token', token);
}

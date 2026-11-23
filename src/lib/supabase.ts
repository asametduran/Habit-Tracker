import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { authStorage } from '@/lib/session-storage';

// Both values are public by design: they identify the project, and Row Level Security is what
// protects the data. The secret (service_role) key must never be put in the app. See .env.example.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Without these the app runs local-only: no account, no sync. */
export const isSupabaseConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

/**
 * The Supabase client, created on first use. `null` when sync isn't configured, and while the
 * web build is being statically rendered in Node — so call it from effects and handlers only.
 */
export function getSupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  if (Platform.OS === 'web' && typeof window === 'undefined') return null;
  if (client) return client;

  const created = createClient(url, key, {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  if (Platform.OS !== 'web') {
    // Native has no "tab is visible" signal, so token refresh follows the app's foreground state.
    AppState.addEventListener('change', (state) => {
      if (state === 'active') created.auth.startAutoRefresh();
      else created.auth.stopAutoRefresh();
    });
  }
  client = created;
  return client;
}

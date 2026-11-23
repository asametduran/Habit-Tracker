import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type User } from '@supabase/supabase-js';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

// Who was signed in last time. Not a credential (the session lives in session-storage) — it
// only lets the app open straight to the user's habits without waiting on the network.
const USER_KEY = 'habit-tracker/auth-user';

const SESSION_WAIT_MS = 3000;

const OFFLINE_MESSAGE = "Can't reach the server. Check your connection and try again.";
const DISABLED_MESSAGE = "Accounts aren't set up in this build.";

/**
 * `firstName` and `timeZone` live in the account's metadata: the AI coach uses the name ("Hey
 * Sam, …") and the scheduler uses the time zone to write nudges in the morning and push them at
 * 15:00 local time (supabase/functions/coach-scheduler).
 */
export type AuthUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  timeZone: string | null;
};

/** `disabled`: no Supabase project is configured, so the app is local-only. */
export type AuthStatus = 'loading' | 'signedIn' | 'signedOut' | 'disabled';

export type AuthResult = { ok: true; needsConfirmation?: boolean } | { ok: false; message: string };

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  /** `captchaToken`: from the Turnstile widget, when the build has a site key (lib/captcha). */
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<AuthResult>;
  signUp: (
    email: string,
    password: string,
    firstName?: string,
    captchaToken?: string | null,
  ) => Promise<AuthResult>;
  /** Saves the first name the coach greets the user with (empty clears it). */
  setFirstName: (firstName: string) => Promise<AuthResult>;
  /** Forgets the session on this device. Works offline. */
  signOut: () => Promise<void>;
  /**
   * Forgotten password, step 1: emails a reset code. Succeeds for unknown addresses too, so it
   * can't be used to find out who has an account.
   */
  sendPasswordReset: (email: string, captchaToken?: string | null) => Promise<AuthResult>;
  /** Step 2: checks the emailed code. The app stays on the sign-in screen until step 3. */
  verifyPasswordReset: (email: string, code: string) => Promise<AuthResult>;
  /** Step 3: saves the new password and lets the user in. */
  setNewPassword: (password: string) => Promise<AuthResult>;
  /** Abandons a reset after step 2, dropping the session the code opened. */
  cancelPasswordReset: () => Promise<void>;
  /** The sign-in screen was asked for before onboarding finished ("I already have an account"). */
  authRequested: boolean;
  requestAuth: () => void;
  cancelAuthRequest: () => void;
};

type AuthState = { status: AuthStatus; user: AuthUser | null };

const AuthContext = createContext<AuthContextValue | null>(null);

// Set while a password reset is between "code accepted" and "new password saved": the code
// already signs the user in, but the app shouldn't open until the old password is replaced.
// Auth changes in that window are parked here and applied once the reset finishes. Module-level
// like the session itself: there is one AuthProvider per app.
const resetHold: { current: { user: AuthUser | null } | null } = { current: null };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toUser(user: User): AuthUser {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? null,
    firstName: text(meta.first_name),
    timeZone: text(meta.time_zone),
  };
}

/** The device's IANA time zone ("Europe/Istanbul"), when the JS engine can tell. */
function deviceTimeZone(): string | null {
  try {
    return text(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

function remember(user: AuthUser | null) {
  const saved = user
    ? AsyncStorage.setItem(USER_KEY, JSON.stringify(user))
    : AsyncStorage.removeItem(USER_KEY);
  saved.catch(() => {});
}

async function recall(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    const user = raw ? (JSON.parse(raw) as Partial<AuthUser> | null) : null;
    if (!user || typeof user.id !== 'string') return null;
    // Saved before these fields existed: fill them in until the session refreshes the user.
    return {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      timeZone: user.timeZone ?? null,
    };
  } catch {
    return null;
  }
}

// Supabase's wording for these is technical; the rest of its messages read fine as they are.
const FRIENDLY: Record<string, string> = {
  otp_expired: 'That code is wrong or has expired. Check the email, or send a new code.',
  same_password: 'Choose a password different from your old one.',
  over_email_send_rate_limit: 'Too many emails were sent. Wait a few minutes and try again.',
  captcha_failed: 'The security check didn’t go through. Let it finish, then try again.',
};

function describe(error: unknown): string {
  if (isAuthRetryableFetchError(error)) return OFFLINE_MESSAGE;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (FRIENDLY[code]) return FRIENDLY[code];
  if (error && typeof error === 'object' && 'message' in error && error.message) {
    return String(error.message);
  }
  return 'Something went wrong. Please try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    status: isSupabaseConfigured ? 'loading' : 'disabled',
    user: null,
  });
  const [authRequested, setAuthRequested] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;

    const settle = (user: AuthUser | null) => {
      if (!active) return;
      if (resetHold.current) {
        resetHold.current.user = user;
        return;
      }
      setAuth(user ? { status: 'signedIn', user } : { status: 'signedOut', user: null });
      remember(user);
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') settle(null);
      else if (
        session &&
        (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')
      ) {
        settle(toUser(session.user));
      }
    });

    (async () => {
      const remembered = await recall();
      if (!active) return;
      // Offline with an expired token, getSession() can take a long time and then fail.
      // Someone who was signed in last time gets their habits right away regardless.
      if (remembered) {
        setAuth((current) =>
          current.status === 'loading' ? { status: 'signedIn', user: remembered } : current,
        );
      }
      // With no one remembered there's nothing to show meanwhile, so don't wait long either:
      // the sign-in screen appears, and gives way if a session turns up after all.
      const fallback = remembered
        ? null
        : setTimeout(() => {
            if (!active) return;
            setAuth((current) =>
              current.status === 'loading' ? { status: 'signedOut', user: null } : current,
            );
          }, SESSION_WAIT_MS);
      const result = await supabase.auth
        .getSession()
        .catch((error: unknown) => ({ data: { session: null }, error }));
      if (fallback) clearTimeout(fallback);
      if (!active) return;
      const session = result.data.session;
      if (session) settle(toUser(session.user));
      // An error means "couldn't check", not "signed out": keep a remembered user signed in.
      else if (!result.error || !remembered) settle(null);
    })();

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, captchaToken?: string | null): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, message: DISABLED_MESSAGE };
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        options: captchaToken ? { captchaToken } : undefined,
      });
      return error ? { ok: false, message: describe(error) } : { ok: true };
    } catch (error) {
      return { ok: false, message: describe(error) };
    }
  },
    [],
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      firstName?: string,
      captchaToken?: string | null,
    ): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, message: DISABLED_MESSAGE };
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { first_name: text(firstName), time_zone: deviceTimeZone() },
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (error) return { ok: false, message: describe(error) };
      // No session means the project requires the email address to be confirmed first.
      return data.session ? { ok: true } : { ok: true, needsConfirmation: true };
    } catch (error) {
      return { ok: false, message: describe(error) };
    }
  },
    [],
  );

  const setFirstName = useCallback(async (firstName: string): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, message: DISABLED_MESSAGE };
    try {
      const { error } = await supabase.auth.updateUser({ data: { first_name: text(firstName) } });
      return error ? { ok: false, message: describe(error) } : { ok: true };
    } catch (error) {
      return { ok: false, message: describe(error) };
    }
  }, []);

  // Keep the account's time zone current (people travel; older accounts never had one), so
  // scheduled coaching follows the user's local day.
  const signedInUser = auth.status === 'signedIn' ? auth.user : null;
  useEffect(() => {
    const zone = deviceTimeZone();
    if (!signedInUser || !zone || signedInUser.timeZone === zone) return;
    getSupabase()
      ?.auth.updateUser({ data: { time_zone: zone } })
      .catch(() => {}); // offline: tried again next launch
  }, [signedInUser]);

  const signOut = useCallback(async () => {
    // Someone signing out of a finished setup lands on the sign-in screen, not onboarding.
    setAuthRequested(true);
    try {
      await getSupabase()?.auth.signOut({ scope: 'local' });
    } catch {
      // The local session is dropped either way.
    }
    remember(null);
    setAuth((current) =>
      current.status === 'disabled' ? current : { status: 'signedOut', user: null },
    );
  }, []);

  const sendPasswordReset = useCallback(
    async (email: string, captchaToken?: string | null): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, message: DISABLED_MESSAGE };
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        captchaToken ? { captchaToken } : undefined,
      );
      return error ? { ok: false, message: describe(error) } : { ok: true };
    } catch (error) {
      return { ok: false, message: describe(error) };
    }
  },
    [],
  );

  const verifyPasswordReset = useCallback(
    async (email: string, code: string): Promise<AuthResult> => {
      const supabase = getSupabase();
      if (!supabase) return { ok: false, message: DISABLED_MESSAGE };
      resetHold.current = { user: null };
      try {
        const { data, error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.replace(/\s/g, ''),
          type: 'recovery',
        });
        if (error || !data.session) {
          resetHold.current = null;
          return { ok: false, message: describe(error) };
        }
        resetHold.current.user = toUser(data.session.user);
        return { ok: true };
      } catch (error) {
        resetHold.current = null;
        return { ok: false, message: describe(error) };
      }
    },
    [],
  );

  const setNewPassword = useCallback(async (password: string): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, message: DISABLED_MESSAGE };
    try {
      // On failure the verified session stays parked, so the user can try another password
      // without asking for a new code.
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) return { ok: false, message: describe(error) };
      const user = toUser(data.user);
      resetHold.current = null;
      setAuth({ status: 'signedIn', user });
      remember(user);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: describe(error) };
    }
  }, []);

  const cancelPasswordReset = useCallback(async () => {
    if (!resetHold.current) return;
    try {
      await getSupabase()?.auth.signOut({ scope: 'local' });
    } catch {
      // The local session is dropped either way.
    }
    resetHold.current = null;
  }, []);

  const requestAuth = useCallback(() => setAuthRequested(true), []);
  const cancelAuthRequest = useCallback(() => setAuthRequested(false), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...auth,
      signIn,
      signUp,
      setFirstName,
      signOut,
      sendPasswordReset,
      verifyPasswordReset,
      setNewPassword,
      cancelPasswordReset,
      authRequested,
      requestAuth,
      cancelAuthRequest,
    }),
    [
      auth,
      signIn,
      signUp,
      setFirstName,
      signOut,
      sendPasswordReset,
      verifyPasswordReset,
      setNewPassword,
      cancelPasswordReset,
      authRequested,
      requestAuth,
      cancelAuthRequest,
    ],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

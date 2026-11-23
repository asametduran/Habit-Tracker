import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useHabits, useSync } from '@/hooks/use-habits';
import { fetchInsight, type CoachRequest, type Insight } from '@/lib/coach';

export type CoachState<Content> =
  | { status: 'loading' }
  | { status: 'ready'; insight: Insight<Content> }
  /** Nothing has been written for this period yet (only when not loading automatically). */
  | { status: 'none' }
  /** Not enough tracked days for the model to say anything useful. */
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string };

// Results live in memory for the session, shared by every screen, one entry per user, insight
// and day. They're never written to the device: the server keeps the copy that matters.
const entries = new Map<string, CoachState<unknown>>();
const listeners = new Set<() => void>();

function put(key: string, state: CoachState<unknown>) {
  entries.set(key, state);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function load(
  key: string,
  request: CoachRequest,
  today: string,
  syncNow: () => Promise<number>,
  options: { refresh?: boolean; cachedOnly?: boolean },
) {
  if (entries.get(key)?.status === 'loading') return;
  put(key, { status: 'loading' });
  try {
    // The coach reads the account's data on the server, so send this device's changes first.
    await syncNow().catch(() => undefined);
    const result = await fetchInsight(request, today, options);
    put(
      key,
      result.status === 'ok'
        ? { status: 'ready', insight: result.insight }
        : result.status === 'none'
          ? { status: 'none' }
          : { status: 'empty', message: result.message },
    );
  } catch (error) {
    put(key, { status: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * A coaching insight for today, or null while the coach is unavailable (signed out, local-only
 * build, switched off in Settings, or `active` is false). With `auto`, a missing insight is
 * written on first use; otherwise only an existing one is fetched and `generate` writes one.
 */
export function useCoach<Content>(
  request: CoachRequest,
  { auto, active = true }: { auto: boolean; active?: boolean },
) {
  const { status, user } = useAuth();
  const { today, settings } = useHabits();
  const { syncNow } = useSync();

  const { fn } = request;
  const range = request.fn === 'reflection-report' ? request.range : null;
  const enabled = active && status === 'signedIn' && !!user && settings.aiCoach;
  const key = enabled ? [user.id, fn, range ?? '', today].join('|') : null;

  const stored = useSyncExternalStore(
    subscribe,
    () => (key ? entries.get(key) : undefined),
    () => undefined,
  ) as CoachState<Content> | undefined;

  const run = useCallback(
    (options: { refresh?: boolean; cachedOnly?: boolean }) => {
      if (!key) return;
      const req: CoachRequest = range ? { fn: 'reflection-report', range } : { fn: 'coach-nudge' };
      void load(key, req, today, syncNow, options);
    },
    [key, range, today, syncNow],
  );

  useEffect(() => {
    if (key && !entries.has(key)) run(auto ? {} : { cachedOnly: true });
  }, [key, auto, run]);

  if (!key) return null;
  return {
    // Until the first request starts (right after this render), it's as good as loading.
    state: stored ?? ({ status: 'loading' } as CoachState<Content>),
    generate: () => run({}),
    refresh: () => run({ refresh: true }),
  };
}

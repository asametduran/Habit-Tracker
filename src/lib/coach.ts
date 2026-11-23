import { FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabase } from '@/lib/supabase';

// Talks to the AI coaching edge functions in supabase/functions/. They read the signed-in
// user's synced data on the server and ask Gemini to write the words; the shapes below mirror
// the schemas in coach-nudge/index.ts and reflection-report/index.ts.

/** The exact numbers an insight was written from, so the UI never has to trust the prose. */
export type HabitRate = {
  id: string;
  name: string;
  rate: number | null; // whole percent
  done: number;
  tracked: number;
};

export type NudgeContent = {
  headline: string;
  message: string;
  tip: string | null;
  /** The phone-notification version; missing on nudges written before pushes existed. */
  push?: string;
  focus_habit_id: string | null;
  goal_adjustment: { habit_id: string; suggested_target: number; reason: string } | null;
  stats: { habits: HabitRate[] };
};

type Overall = { done: number; tracked: number; rate: number | null };

export type ReportContent = {
  title: string;
  summary: string;
  highlights: string[];
  watch_outs: string[];
  focus_next: string;
  stats: {
    habits: HabitRate[];
    overall: Overall;
    previous_overall: Overall;
    perfect_days: { count: number; out_of: number };
  };
};

export type Insight<Content> = {
  kind: 'nudge' | 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  content: Content;
  model: string;
  created_at: string;
};

export type CoachResult<Content> =
  | { status: 'ok'; insight: Insight<Content> }
  /** `cachedOnly` was set and nothing has been written for this period yet. */
  | { status: 'none' }
  | { status: 'insufficient_data'; message: string };

export type CoachRequest =
  | { fn: 'coach-nudge' }
  | { fn: 'reflection-report'; range: 'week' | 'month' };

/**
 * Asks a coaching function for an insight. Each period is written once and cached on the
 * server; `refresh` asks for a new one, `cachedOnly` never triggers a new one.
 */
export async function fetchInsight<Content>(
  request: CoachRequest,
  today: string,
  options: { refresh?: boolean; cachedOnly?: boolean } = {},
): Promise<CoachResult<Content>> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Sign in to use the coach.');
  const { fn, ...rest } = request;
  const { data, error } = await supabase.functions.invoke(fn, {
    body: { ...rest, today, ...options },
  });
  if (error) {
    // The functions answer errors with a readable `{ error }` message; use it when there is one.
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      if (body && typeof body.error === 'string') throw new Error(body.error);
    }
    throw new Error('Couldn’t reach your coach. Check your connection and try again.');
  }
  return data as CoachResult<Content>;
}

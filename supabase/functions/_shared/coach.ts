// Shared code for the coaching edge functions. `coach-nudge` / `reflection-report` answer the
// app (serveCoach); `coach-scheduler` writes the same insights on a schedule (writeInsight).
//
// Flow: read the user's habits, history and streaks from Postgres → exact numbers from
// ./stats.ts → Google Gemini writes the words → stored in `coach_insights`, one per period.
// Every model call is logged in `coach_usage`, which caps calls per user per day.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import * as z from 'npm:zod@4.6.7/v4';

import { addDays, isDateKey, type CoachInput, type HabitSummary } from './stats.ts';

/**
 * A current stable Flash model. gemini-2.5-flash / -pro are deprecated (rerouted by Google from
 * 2026-12-01), so they aren't the default; set the GEMINI_MODEL secret to use another model.
 */
const DEFAULT_MODEL = 'gemini-3.8-flash';

/**
 * Tried in turn when the model before is overloaded, out of quota or too slow: a different
 * model has its own capacity, so this beats retrying the same one. GEMINI_FALLBACK_MODEL
 * replaces the first; Flash-Lite is the light last resort.
 */
const FALLBACK_MODEL = 'gemini-3.6-flash';
const LAST_RESORT_MODEL = 'gemini-3.5-flash-lite';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

// Under heavy load Gemini can hold a request open until the edge function is killed (Supabase
// answers 546). Three attempts of at most 40 s each stay inside the function's time limit.
const ATTEMPT_TIMEOUT_MS = 40_000;

/** Model calls per user in any 24 hours, cached answers excluded. */
const DAILY_LIMIT = 10;

/**
 * Model calls for the whole project in any 24 hours: a ceiling on the Gemini bill however many
 * accounts there are. The COACH_GLOBAL_DAILY_LIMIT secret overrides it.
 */
const GLOBAL_DAILY_LIMIT = 2000;

/** The most habits the coach reads per user: far above real use, and a bound on prompt size. */
const MAX_HABITS = 50;

/**
 * The longest answer one call may produce. A nudge or a reflection needs a few hundred tokens;
 * this bounds what a call can cost however the model is steered (thinking may count toward it).
 */
const MAX_OUTPUT_TOKENS = 4096;

/** History needed for the longest window: a 30-day report plus the 30 days it's compared with. */
const HISTORY_DAYS = 61;

const PAGE = 1000; // PostgREST's default max rows per request

export const INSIGHT_COLUMNS = 'kind, period_start, period_end, content, model, created_at';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type InsightKind = 'nudge' | 'weekly' | 'monthly';

/** What the model may know about the person, beyond their numbers. */
export type Profile = { firstName: string | null };

export type Built = {
  snapshot: unknown;
  summary: HabitSummary[];
  /** Extra numbers stored with the insight for the app to show (overall rates and so on). */
  extraStats?: Record<string, unknown>;
  period: { start: string; end: string };
  hasData: boolean;
};

export type CoachSpec<T> = {
  /** Which insight this request is for, from the request body. Null means a bad request. */
  kindFor(body: Record<string, unknown>): InsightKind | null;
  build(input: CoachInput, kind: InsightKind): Built;
  system: string;
  prompt(input: CoachInput, kind: InsightKind, snapshot: unknown, profile: Profile): string;
  schema: z.ZodType<T>;
  /** Drops anything in the model's answer that doesn't match the data (e.g. an unknown habit id). */
  check(output: T, input: CoachInput): T;
  emptyMessage: string;
  /**
   * When the app only asks for what exists (`cachedOnly`), an insight of this kind written in
   * the last N days counts, not just one for the exact current period (the scheduler writes
   * weekly reflections on Mondays, which should still show on Thursday).
   */
  showLatestWithinDays?: Partial<Record<InsightKind, number>>;
};

export function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function env(name: string): string | undefined {
  return Deno.env.get(name) || undefined;
}

function globalDailyLimit(): number {
  const configured = Number(env('COACH_GLOBAL_DAILY_LIMIT'));
  return Number.isInteger(configured) && configured > 0 ? configured : GLOBAL_DAILY_LIMIT;
}

// Projects on Supabase's newer API keys expose them as JSON maps (`{"default": "sb_..."}`)
// instead of the single legacy variables; accept either.
function projectKey(legacy: string, keyMap: string): string | undefined {
  const direct = env(legacy);
  if (direct) return direct;
  const raw = env(keyMap);
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

const noSession = { persistSession: false, autoRefreshToken: false };

/** The service-role client (bypasses RLS: always filter by user), or null if unconfigured. */
export function serviceClient(): SupabaseClient | null {
  const url = env('SUPABASE_URL');
  const serviceKey = projectKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
  if (!url || !serviceKey) {
    console.error('coach: missing Supabase configuration', { url: !!url, serviceKey: !!serviceKey });
    return null;
  }
  return createClient(url, serviceKey, { auth: noSession });
}

/** A client acting as the caller, so Row Level Security applies to everything it reads. */
function userClient(authorization: string): SupabaseClient | null {
  const url = env('SUPABASE_URL');
  const publicKey = projectKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
  if (!url || !publicKey) {
    console.error('coach: missing Supabase configuration', { url: !!url, publicKey: !!publicKey });
    return null;
  }
  return createClient(url, publicKey, { global: { headers: { Authorization: authorization } }, auth: noSession });
}

/** The first name the user gave the app (stored in their auth metadata), if any. */
export function profileOf(user: { user_metadata?: Record<string, unknown> | null }): Profile {
  const name = user.user_metadata?.first_name;
  return { firstName: typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : null };
}

async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * One user's habits (at most MAX_HABITS), their recent history and the challenge. Filtered by
 * user explicitly, so it's also safe with the service-role client; with the caller's client RLS
 * applies on top. Bounded, so no account can make a run slow or a prompt huge.
 */
export async function loadInput(db: SupabaseClient, userId: string, today: string): Promise<CoachInput> {
  const since = addDays(today, -HISTORY_DAYS);
  const [habits, challenge] = await Promise.all([
    db
      .from('habits')
      .select('id, name, type, target, count, streak, best_streak, count_date, created_at_day, deleted_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('id')
      .limit(MAX_HABITS),
    db
      .from('challenges')
      .select('name, habit_ids, duration_days, start_date, days_completed, status, deleted_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (habits.error) throw habits.error;
  if (challenge.error) throw challenge.error;
  const ids = (habits.data ?? []).map((habit) => habit.id as string);
  // Only the loaded habits' history: at most MAX_HABITS × (HISTORY_DAYS + 1) rows.
  const history = ids.length
    ? await fetchAll((from, to) =>
        db
          .from('history')
          .select('habit_id, date, count, completed')
          .eq('user_id', userId)
          .in('habit_id', ids)
          .gte('date', since)
          .lte('date', today)
          .order('date')
          .order('habit_id')
          .range(from, to),
      )
    : [];
  return { habits: habits.data ?? [], history, challenge: challenge.data, today } as CoachInput;
}

/**
 * Zod's JSON Schema in the subset Gemini's `responseJsonSchema` documents: nullable fields as
 * `type: [T, "null"]` instead of `anyOf`, and no `$schema` marker.
 */
function geminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (!node || typeof node !== 'object') return node;
  const { $schema: _drop, ...rest } = node as Record<string, unknown>;
  const branches = rest.anyOf;
  if (Array.isArray(branches) && branches.length === 2) {
    const nonNull = branches.find((b) => (b as { type?: unknown }).type !== 'null') as
      | Record<string, unknown>
      | undefined;
    const hasNull = branches.some((b) => (b as { type?: unknown }).type === 'null');
    if (nonNull && hasNull && typeof nonNull.type === 'string') {
      const { anyOf: _anyOf, ...outer } = rest;
      return geminiSchema({ ...nonNull, ...outer, type: [nonNull.type, 'null'] });
    }
  }
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, geminiSchema(value)]));
}

export class ModelError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(detail);
  }
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
};

/** One generateContent call with JSON output constrained to `schema`. */
async function generate(apiKey: string, model: string, system: string, prompt: string, schema: z.ZodType) {
  // A short coaching note needs little reasoning; low thinking is faster and cheaper. Only
  // Gemini 3 and later accept `thinkingLevel` (older models reject it), so it's left off there.
  const thinking = /^gemini-([3-9]|\d\d)/.test(model) ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {};
  let res: Response;
  try {
    res = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      // The key goes in a header rather than the URL, so it never shows up in request logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: geminiSchema(z.toJSONSchema(schema)),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...thinking,
        },
      }),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ModelError(504, `${model} timed out after ${ATTEMPT_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }
  if (!res.ok) throw new ModelError(res.status, (await res.text()).slice(0, 500));
  const body = (await res.json()) as GeminiResponse;
  const candidate = body.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('');
  const usage = body.usageMetadata ?? {};
  return {
    model: body.modelVersion ?? model,
    inputTokens: usage.promptTokenCount ?? 0,
    // Thinking tokens are billed as output.
    outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    blocked: body.promptFeedback?.blockReason ?? null,
    finishReason: candidate?.finishReason ?? null,
    text,
  };
}

const transient = (status: number) => status === 429 || status === 500 || status === 503 || status === 504;

/** Each model in turn, moving on when one is overloaded ("high demand"), out of quota or too slow. */
export async function generateResilient(apiKey: string, system: string, prompt: string, schema: z.ZodType) {
  const models = [
    env('GEMINI_MODEL') ?? DEFAULT_MODEL,
    env('GEMINI_FALLBACK_MODEL') ?? FALLBACK_MODEL,
    LAST_RESORT_MODEL,
  ];
  const attempts = models.filter((model, i) => models.indexOf(model) === i);
  for (let i = 0; ; i++) {
    try {
      return await generate(apiKey, attempts[i], system, prompt, schema);
    } catch (error) {
      const last = i === attempts.length - 1;
      if (!(error instanceof ModelError) || !transient(error.status) || last) throw error;
      console.warn(`coach: ${attempts[i]} failed (${error.status}), trying ${attempts[i + 1]}`);
    }
  }
}

/**
 * The prompts ask for no em/en dashes (they read as machine-written); this catches any that slip
 * through: a dash between numbers becomes a hyphen ("5–6"), any other becomes a comma.
 */
export function withoutDashes<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/,\s*([.,!?])/g, '$1') as T;
  }
  if (Array.isArray(value)) return value.map(withoutDashes) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, withoutDashes(inner)]),
    ) as T;
  }
  return value;
}

export type Written =
  | { status: 'ok'; insight: Record<string, unknown> }
  | { status: 'insufficient_data'; message: string }
  | { status: 'capped' }
  | { status: 'not_configured' }
  | { status: 'unusable' };

/**
 * Asks the model for a fresh insight and stores it, replacing any for the same period.
 * Throws ModelError when every model failed.
 */
export async function writeInsight<T>(
  spec: CoachSpec<T>,
  kind: InsightKind,
  input: CoachInput,
  ctx: { service: SupabaseClient; userId: string; profile: Profile },
): Promise<Written> {
  const built = spec.build(input, kind);
  if (!built.hasData) return { status: 'insufficient_data', message: spec.emptyMessage };

  const apiKey = env('GEMINI_API_KEY');
  if (!apiKey) {
    console.error('coach: the GEMINI_API_KEY secret is not set');
    return { status: 'not_configured' };
  }

  // Checks the user's and the project's caps and logs the call in one locked step, so requests
  // that arrive together can't all pass the check before any of them is counted.
  const claim = await ctx.service.rpc('claim_coach_call', {
    p_user: ctx.userId,
    p_kind: kind,
    p_user_limit: DAILY_LIMIT,
    p_global_limit: globalDailyLimit(),
  });
  if (claim.error) throw claim.error;
  if (claim.data === null) return { status: 'capped' };

  // A call that fails keeps its claim: one we gave up on after the timeout may still be billed.
  const result = await generateResilient(
    apiKey,
    spec.system,
    spec.prompt(input, kind, built.snapshot, ctx.profile),
    spec.schema,
  );

  // The call is billed (or counted against the free quota) whatever came back.
  const logged = await ctx.service
    .from('coach_usage')
    .update({ model: result.model, input_tokens: result.inputTokens, output_tokens: result.outputTokens })
    .eq('id', claim.data);
  if (logged.error) console.error('coach: usage log failed', logged.error);

  let parsed: T | null = null;
  try {
    const checked = spec.schema.safeParse(JSON.parse(result.text));
    if (checked.success) parsed = checked.data;
  } catch {
    // not JSON: handled below
  }
  if (!parsed) {
    // Not the text itself: it can quote the user's name and habits.
    console.error('coach: no usable output', {
      blocked: result.blocked,
      finishReason: result.finishReason,
      length: result.text.length,
    });
    return { status: 'unusable' };
  }

  const content = {
    ...withoutDashes(spec.check(parsed, input)),
    stats: { habits: built.summary, ...built.extraStats },
  };
  const saved = await ctx.service
    .from('coach_insights')
    .upsert(
      {
        user_id: ctx.userId,
        kind,
        period_start: built.period.start,
        period_end: built.period.end,
        content,
        model: result.model,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,kind,period_end' },
    )
    .select(INSIGHT_COLUMNS)
    .single();
  if (saved.error) throw saved.error;
  return { status: 'ok', insight: saved.data };
}

/** The HTTP endpoint the app calls for one kind of insight. */
export function serveCoach<T>(spec: CoachSpec<T>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

    const authorization = req.headers.get('Authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return reply(401, { error: 'Sign in to use the coach.' });

    const asUser = userClient(authorization);
    const service = serviceClient();
    if (!asUser || !service) return reply(500, { error: 'The coach isn’t set up on the server yet.' });

    const { data: userData } = await asUser.auth.getUser(token);
    const user = userData.user;
    if (!user) return reply(401, { error: 'Your session has expired. Sign in again.' });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return reply(400, { error: 'Expected a JSON body.' });
    }
    // The device decides what "today" is: it knows the user's time zone, the server doesn't.
    const today = body.today;
    const kind = spec.kindFor(body);
    if (!isDateKey(today) || !kind) return reply(400, { error: 'Bad request.' });

    try {
      const input = await loadInput(asUser, user.id, today);
      const built = spec.build(input, kind);

      if (body.refresh !== true) {
        const cached = await asUser
          .from('coach_insights')
          .select(INSIGHT_COLUMNS)
          .eq('kind', kind)
          .eq('period_end', built.period.end)
          .maybeSingle();
        if (cached.error) throw cached.error;
        if (cached.data) return reply(200, { status: 'ok', cached: true, insight: cached.data });
      }
      if (body.cachedOnly === true) {
        const within = spec.showLatestWithinDays?.[kind];
        if (within) {
          const recent = await asUser
            .from('coach_insights')
            .select(INSIGHT_COLUMNS)
            .eq('kind', kind)
            .gte('period_end', addDays(today, -within))
            .order('period_end', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (recent.error) throw recent.error;
          if (recent.data) return reply(200, { status: 'ok', cached: true, insight: recent.data });
        }
        return reply(200, { status: 'none' });
      }

      const written = await writeInsight(spec, kind, input, {
        service,
        userId: user.id,
        profile: profileOf(user),
      });
      switch (written.status) {
        case 'ok':
          return reply(200, { status: 'ok', cached: false, insight: written.insight });
        case 'insufficient_data':
          return reply(200, { status: 'insufficient_data', message: written.message });
        case 'capped':
          return reply(429, { error: 'Your coach has written plenty today. Check back tomorrow.' });
        case 'not_configured':
          return reply(503, { error: 'The coach isn’t switched on yet.' });
        case 'unusable':
          return reply(502, { error: 'Your coach couldn’t write this one. Try again later.' });
      }
    } catch (error) {
      if (error instanceof ModelError) {
        console.error('coach: Gemini API error', error.status, error.message);
        if (transient(error.status)) {
          return reply(503, { error: 'Your coach is busy right now. Try again in a minute.' });
        }
        return reply(502, { error: 'Your coach couldn’t be reached. Try again later.' });
      }
      console.error('coach: failed', error);
      return reply(500, { error: 'Something went wrong. Try again later.' });
    }
  });
}

// Automatic coaching, run hourly by pg_cron (supabase/migrations/20261121000000_coach_schedule.sql).
// For every active user, in their own time zone (see ../_shared/schedule.ts):
//   from 05:00   write today's nudge, so the app opens straight to it
//   Mondays      write the weekly reflection; on the 1st, the monthly one
//   15:00-17:00  send the nudge to their phones as a push (once a day)
// Everything is "make sure it exists", so a run that fails is simply caught up by the next one.
//
// Callable only with the shared secret (COACH_CRON_SECRET), never by the app.
// POST {}                     → 202, runs in the background (what the cron job sends)
// POST { wait: true, ... }    → runs and answers with a summary; for testing, `now` (ISO time)
//                               pretends it's another time and `userId` limits the run to one user.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';

import {
  env,
  INSIGHT_COLUMNS,
  loadInput,
  ModelError,
  profileOf,
  reply,
  serviceClient,
  writeInsight,
  type CoachSpec,
  type InsightKind,
} from '../_shared/coach.ts';
import { nudgeSpec, type Nudge } from '../_shared/nudge.ts';
import { sendPushes } from '../_shared/push.ts';
import { reportSpec } from '../_shared/report.ts';
import { dutiesFor, isActive, localClock, SCHEDULE } from '../_shared/schedule.ts';
import { addDays, type CoachInput } from '../_shared/stats.ts';

const CONCURRENCY = 3;
/** Stop starting new users after this long; whoever's left is picked up next hour. */
const TIME_BUDGET_MS = 100_000;

type Summary = {
  considered: number;
  due: number;
  written: Record<InsightKind, number>;
  pushes: number;
  skipped: string[];
  errors: string[];
};

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function existing(service: SupabaseClient, userId: string, kind: InsightKind, periodEnd: string) {
  const { data, error } = await service
    .from('coach_insights')
    .select(`${INSIGHT_COLUMNS}, pushed_at`)
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('period_end', periodEnd)
    .maybeSingle();
  if (error) throw error;
  return data as ({ content: Record<string, unknown>; pushed_at: string | null } & Record<string, unknown>) | null;
}

/** Makes sure the insight for this period exists; returns it (or null if there was nothing to write). */
async function ensure<T>(
  ctx: { service: SupabaseClient; userId: string; summary: Summary; label: string },
  spec: CoachSpec<T>,
  kind: InsightKind,
  input: () => Promise<CoachInput>,
  profile: { firstName: string | null },
) {
  const loaded = await input();
  const periodEnd = spec.build(loaded, kind).period.end;
  const found = await existing(ctx.service, ctx.userId, kind, periodEnd);
  if (found) return found;
  const written = await writeInsight(spec, kind, loaded, { service: ctx.service, userId: ctx.userId, profile });
  if (written.status !== 'ok') {
    ctx.summary.skipped.push(`${ctx.label} ${kind}: ${written.status}`);
    return null;
  }
  ctx.summary.written[kind]++;
  return existing(ctx.service, ctx.userId, kind, periodEnd);
}

async function runForUser(
  service: SupabaseClient,
  row: { user_id: string; settings: Record<string, unknown> | null; last_rollover_date: string | null },
  now: Date,
  summary: Summary,
) {
  const userId = row.user_id;
  const label = userId.slice(0, 8);
  const { data: auth, error } = await service.auth.admin.getUserById(userId);
  if (error || !auth.user) {
    summary.skipped.push(`${label}: no auth user`);
    return;
  }
  const timeZone = auth.user.user_metadata?.time_zone;
  const clock = typeof timeZone === 'string' ? localClock(timeZone, now) : null;
  if (!clock) {
    summary.skipped.push(`${label}: no time zone yet`);
    return;
  }
  if (!isActive(row.last_rollover_date, clock.date)) return;
  const duties = dutiesFor(clock, row.settings ?? {});
  if (!duties.nudge) return;
  summary.due++;

  const profile = profileOf(auth.user);
  let cached: Promise<CoachInput> | null = null;
  const input = () => (cached ??= loadInput(service, userId, clock.date));
  const ctx = { service, userId, summary, label };

  const nudge = await ensure<Nudge>(ctx, nudgeSpec, 'nudge', input, profile);
  if (duties.weekly) await ensure(ctx, reportSpec, 'weekly', input, profile);
  if (duties.monthly) await ensure(ctx, reportSpec, 'monthly', input, profile);

  if (!duties.push || !nudge || nudge.pushed_at) return;
  const { data: tokens, error: tokenError } = await service
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId);
  if (tokenError) throw tokenError;
  if (!tokens?.length) return;

  const content = nudge.content as Partial<Nudge>;
  const body = content.push || content.message || '';
  const sent = await sendPushes(
    tokens.map(({ token }) => ({
      to: token as string,
      title: content.headline || 'Your coach',
      body,
      data: { url: '/', kind: 'coach-nudge' },
    })),
  );
  if (sent.stale.length) await service.from('push_tokens').delete().in('token', sent.stale);
  summary.errors.push(...sent.errors.map((e) => `${label} push: ${e}`));
  if (sent.delivered.length) {
    summary.pushes += sent.delivered.length;
    await service
      .from('coach_insights')
      .update({ pushed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('kind', 'nudge')
      .eq('period_end', clock.date);
  }
}

async function run(options: { now: Date; userId?: string }): Promise<Summary> {
  const summary: Summary = {
    considered: 0,
    due: 0,
    written: { nudge: 0, weekly: 0, monthly: 0 },
    pushes: 0,
    skipped: [],
    errors: [],
  };
  const service = serviceClient();
  if (!service) {
    summary.errors.push('missing Supabase configuration');
    return summary;
  }

  // Anyone whose day rolled over recently; the per-user check uses their own calendar. A date
  // further ahead than any time zone can be didn't come from the app (see isActive).
  const utcToday = options.now.toISOString().slice(0, 10);
  const since = addDays(utcToday, -(SCHEDULE.activeDays + 1));
  let query = service
    .from('user_state')
    .select('user_id, settings, last_rollover_date')
    .eq('onboarding_complete', true)
    .gte('last_rollover_date', since)
    .lte('last_rollover_date', addDays(utcToday, 2));
  if (options.userId) query = query.eq('user_id', options.userId);
  const { data: rows, error } = await query;
  if (error) {
    summary.errors.push(`user_state: ${error.message}`);
    return summary;
  }
  summary.considered = rows.length;

  const started = Date.now();
  let next = 0;
  const worker = async () => {
    while (next < rows.length && Date.now() - started < TIME_BUDGET_MS) {
      const row = rows[next++];
      try {
        await runForUser(service, row, options.now, summary);
      } catch (error) {
        const detail = error instanceof ModelError ? `model ${error.status}` : String((error as Error)?.message ?? error);
        summary.errors.push(`${String(row.user_id).slice(0, 8)}: ${detail}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (next < rows.length) summary.skipped.push(`${rows.length - next} users left for the next run`);
  return summary;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const secret = env('COACH_CRON_SECRET');
  const given = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  if (!secret || !given || !sameSecret(given, secret)) return reply(401, { error: 'Not allowed.' });

  const body = (await req.json().catch(() => ({}))) as { wait?: boolean; now?: string; userId?: string };
  const now = body.now ? new Date(body.now) : new Date();
  if (Number.isNaN(now.getTime())) return reply(400, { error: 'Bad "now".' });

  const work = run({ now, userId: typeof body.userId === 'string' ? body.userId : undefined }).then(
    (summary) => {
      console.log('coach-scheduler:', JSON.stringify(summary));
      return summary;
    },
  );
  if (body.wait || typeof EdgeRuntime === 'undefined') return reply(200, await work);
  EdgeRuntime.waitUntil(work);
  return reply(202, { status: 'started' });
});

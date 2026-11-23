-- HabiTracker: AI coaching. The `coach-nudge` and `reflection-report` edge functions read a
-- user's habits and history (as that user, under RLS), ask Claude for a nudge or a reflection,
-- and store the result here so it is generated at most once per period.

create table public.coach_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('nudge', 'weekly', 'monthly')),
  -- The days the insight covers (a nudge covers just the day it was written for).
  period_start date not null,
  period_end date not null,
  -- Claude's structured output plus the stats it was written from.
  content jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, period_end)
);

-- One row per Claude call, so a daily cap can't be dodged by deleting insights. Never visible
-- to users: RLS is on and there are no policies, so only the service role reads or writes it.
create table public.coach_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index coach_usage_user_created_idx on public.coach_usage (user_id, created_at);

alter table public.coach_insights enable row level security;
alter table public.coach_usage enable row level security;

-- Users read and delete their own insights; only the edge functions (service role) write them.
create policy "coach_insights_select_own" on public.coach_insights for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "coach_insights_delete_own" on public.coach_insights for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.coach_insights, public.coach_usage from anon, authenticated;
grant select, delete on public.coach_insights to authenticated;

-- "Reset all data" now clears coaching too. Usage rows stay, so a reset doesn't refill the cap.
create or replace function public.reset_my_data()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  epoch uuid := gen_random_uuid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  delete from public.habits where user_id = uid;
  delete from public.history where user_id = uid;
  delete from public.challenges where user_id = uid;
  delete from public.coach_insights where user_id = uid;
  insert into public.user_state (user_id, settings, onboarding_complete, last_rollover_date, data_epoch)
  values (uid, '{}'::jsonb, false, null, epoch)
  on conflict (user_id) do update
    set settings = excluded.settings,
        onboarding_complete = excluded.onboarding_complete,
        last_rollover_date = excluded.last_rollover_date,
        data_epoch = excluded.data_epoch;
  return epoch;
end;
$$;

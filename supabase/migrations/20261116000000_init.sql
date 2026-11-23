-- HabiTracker: per-user habit data.
-- Every row belongs to one user and Row Level Security limits each user to their own rows.

create table public.habits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  type text not null check (type in ('daily', 'quantity')),
  target integer check (target is null or target >= 1),
  count integer not null default 0,
  streak integer not null default 0,
  best_streak integer not null default 0,
  -- The day `count` and `streak` are valid for; a device on a later day closes it out first.
  count_date date not null,
  created_at_day date not null,
  reminder jsonb,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- No foreign key to habits: a day's log outlives the habit it was logged for.
create table public.history (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id text not null,
  date date not null,
  count integer not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, habit_id, date)
);

create table public.challenges (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text,
  habit_ids text[] not null default '{}',
  duration_days integer not null check (duration_days >= 1),
  start_date date not null,
  days_completed integer not null default 0,
  status text not null check (status in ('active', 'completed', 'failed')),
  celebrated boolean not null default false,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id)
);

create table public.user_state (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  onboarding_complete boolean not null default false,
  last_rollover_date date,
  -- Rotated by reset_my_data(); a device holding another value drops its local cache.
  data_epoch uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key (user_id)
);

create index habits_user_updated_idx on public.habits (user_id, updated_at);
create index history_user_updated_idx on public.history (user_id, updated_at);

-- The server owns updated_at, so devices with wrong clocks can't skew sync cursors.
-- A write that changes nothing keeps the old timestamp.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- A logged day never goes down: a stale device can't erase a check-off it never saw.
create function public.history_keep_highest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.count := greatest(old.count, new.count);
  new.completed := old.completed or new.completed;
  return new;
end;
$$;

-- Triggers on one table fire in name order: a_keep_highest must run before touch_updated_at.
create trigger a_keep_highest before update on public.history
  for each row execute function public.history_keep_highest();

create trigger touch_updated_at before insert or update on public.habits
  for each row execute function public.touch_updated_at();
create trigger touch_updated_at before insert or update on public.history
  for each row execute function public.touch_updated_at();
create trigger touch_updated_at before insert or update on public.challenges
  for each row execute function public.touch_updated_at();
create trigger touch_updated_at before insert or update on public.user_state
  for each row execute function public.touch_updated_at();

alter table public.habits enable row level security;
alter table public.history enable row level security;
alter table public.challenges enable row level security;
alter table public.user_state enable row level security;

create policy "habits_select_own" on public.habits for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "habits_insert_own" on public.habits for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "habits_update_own" on public.habits for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "habits_delete_own" on public.habits for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "history_select_own" on public.history for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "history_insert_own" on public.history for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "history_update_own" on public.history for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "history_delete_own" on public.history for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "challenges_select_own" on public.challenges for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "challenges_insert_own" on public.challenges for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "challenges_update_own" on public.challenges for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "challenges_delete_own" on public.challenges for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_state_select_own" on public.user_state for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "user_state_insert_own" on public.user_state for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "user_state_update_own" on public.user_state for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_state_delete_own" on public.user_state for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Signed-out clients get nothing; signed-in clients get row access, filtered by the policies.
revoke all on public.habits, public.history, public.challenges, public.user_state from anon;
grant select, insert, update, delete
  on public.habits, public.history, public.challenges, public.user_state to authenticated;

-- "Reset all data": wipes the caller's rows and rotates the epoch so their other devices
-- drop their caches instead of syncing the old data back. Runs as the caller, under RLS.
create function public.reset_my_data()
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

revoke execute on function public.reset_my_data() from public, anon;
grant execute on function public.reset_my_data() to authenticated;

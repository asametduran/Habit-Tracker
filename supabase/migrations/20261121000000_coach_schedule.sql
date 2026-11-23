-- HabiTracker: automatic coaching. An hourly cron job calls the `coach-scheduler` edge
-- function, which pre-writes each active user's daily nudge in their morning, sends it as a
-- push at 15:00 their time, and writes the weekly / monthly reflections.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- When the nudge was sent as a push, so it goes out once and a failed send can be retried.
alter table public.coach_insights add column pushed_at timestamptz;

-- One row per device that can receive pushes (Expo push tokens). A token belongs to whoever is
-- signed in on that device, so registering goes through register_push_token(), which moves a
-- token over from a previous account.
create table public.push_tokens (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "push_tokens_select_own" on public.push_tokens for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "push_tokens_delete_own" on public.push_tokens for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;

create function public.register_push_token(push_token text, device_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if push_token is null or length(push_token) > 512 or device_platform not in ('ios', 'android') then
    raise exception 'invalid push token';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (push_token, uid, device_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- The scheduler's URL and shared secret live in Vault (set once per project, never in the
-- repo): `coach_scheduler_url` and `coach_cron_secret`. pg_net fires the request and returns;
-- the function does the work on its own time.
select cron.schedule(
  'coach-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'coach_scheduler_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'coach_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'coach_scheduler_url');
  $$
);

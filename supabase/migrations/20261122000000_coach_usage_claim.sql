-- HabiTracker: the AI coach's limits, checked and recorded in one step.
-- The edge functions used to count a user's calls, ask Gemini (several seconds), and only then
-- log the call, so requests sent together all passed the check before any of them was logged.
-- A call now claims its slot first, here, under a lock; the function records the model and
-- token counts on the claimed row once the call has been made.

-- For counting the whole project's calls in the last 24 hours.
create index coach_usage_created_idx on public.coach_usage (created_at);

create function public.claim_coach_call(
  p_user uuid,
  p_kind text,
  p_user_limit integer,
  p_global_limit integer
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  claimed bigint;
begin
  -- Claims queue on this lock until their transaction ends (a few milliseconds each), so no
  -- two of them can read the counts below at the same time.
  perform pg_advisory_xact_lock(hashtextextended('habitracker.claim_coach_call', 0));
  if (select count(*) from public.coach_usage
        where user_id = p_user and created_at > now() - interval '24 hours') >= p_user_limit
     or (select count(*) from public.coach_usage
        where created_at > now() - interval '24 hours') >= p_global_limit then
    return null;
  end if;
  insert into public.coach_usage (user_id, kind, model)
  values (p_user, p_kind, 'pending')
  returning id into claimed;
  return claimed;
end;
$$;

-- Only the edge functions (service role) claim: anyone else could use up a user's allowance,
-- or everyone's.
revoke execute on function public.claim_coach_call(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_coach_call(uuid, text, integer, integer) to service_role;

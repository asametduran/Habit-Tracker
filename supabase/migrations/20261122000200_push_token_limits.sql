-- HabiTracker: register_push_token() accepts only Expo push tokens, and keeps at most the 10
-- most recently registered devices per account, so an account can't fill push_tokens with
-- strings the scheduler would then try to deliver to. A token still moves to whoever signs in
-- on that device.
create or replace function public.register_push_token(push_token text, device_platform text)
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
  if push_token is null
     or push_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'
     or device_platform is null
     or device_platform not in ('ios', 'android') then
    raise exception 'invalid push token';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (push_token, uid, device_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  delete from public.push_tokens
  where user_id = uid
    and token not in (
      select token from public.push_tokens
      where user_id = uid
      order by updated_at desc
      limit 10
    );
end;
$$;

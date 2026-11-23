-- HabiTracker: the RLS event trigger (20261122000300) must never block a CREATE TABLE. On hosted
-- Supabase its function runs as `postgres`, which isn't a superuser, so it can't alter a table
-- another role owns, and that error would abort the other role's CREATE TABLE. As in Supabase's
-- own example, such a table is now left as it is with a warning in the database log; the
-- dashboard's Security Advisor lists any public table without RLS.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
      and schema_name = 'public'
  loop
    begin
      execute format('alter table if exists %s enable row level security', cmd.object_identity);
    exception when others then
      raise warning 'rls_auto_enable: could not enable RLS on %: %', cmd.object_identity, sqlerrm;
    end;
  end loop;
end;
$$;

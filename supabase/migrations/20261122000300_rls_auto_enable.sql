-- HabiTracker: any table created in the public schema from now on starts with Row Level
-- Security on. A future migration that forgets `enable row level security` then exposes
-- nothing: with RLS on and no policy, the API roles see no rows. This follows Supabase's
-- documented event-trigger example (Database > Postgres > Event triggers); the `postgres` role
-- can create event triggers on hosted projects. Tables that already exist are unaffected (each
-- of them enables RLS in its own migration).
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
    execute format('alter table if exists %s enable row level security', cmd.object_identity);
  end loop;
end;
$$;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

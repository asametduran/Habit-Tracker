-- HabiTracker: size limits for everything the app writes.
-- The app writes these tables directly (through RLS), so these checks are the server-side
-- validation. Without them one account could store huge names, JSON or negative counts, and the
-- coach functions paste habit names into Gemini prompts.
-- NOT VALID: every insert and update from now on is checked, but rows already stored are not
-- re-checked, so this applies even if an old row is too long. The app shortens names to the
-- limit when it next writes them. Run VALIDATE CONSTRAINT later to check the old rows too.
alter table public.habits
  add constraint habits_id_len check (char_length(id) <= 64) not valid,
  add constraint habits_name_len check (char_length(name) <= 200) not valid,
  add constraint habits_counts check (count >= 0 and streak >= 0 and best_streak >= 0) not valid,
  add constraint habits_reminder_size
    check (reminder is null or octet_length(reminder::text) <= 2048) not valid;

alter table public.history
  add constraint history_habit_id_len check (char_length(habit_id) <= 64) not valid,
  add constraint history_count check (count >= 0) not valid;

alter table public.challenges
  add constraint challenges_name_len check (name is null or char_length(name) <= 200) not valid,
  add constraint challenges_habit_ids
    check (cardinality(habit_ids) <= 100 and octet_length(habit_ids::text) <= 8192) not valid;

alter table public.user_state
  add constraint user_state_settings_size check (octet_length(settings::text) <= 8192) not valid;

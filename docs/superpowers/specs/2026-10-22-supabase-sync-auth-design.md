# Supabase backend, accounts, and local-first sync — design

## Intent

Today all habit data lives in AsyncStorage on one phone. A new phone or a reinstall loses everything, and
there is no way to use the app on two devices. We want:

1. **Accounts** so the backend knows whose data is whose.
2. **A Supabase Postgres database** as the durable, shared copy.
3. **A local cache that is the thing the UI actually talks to**, so every tap is instant and the app works
   offline. The network is never in the path of a user action.
4. **Multiple devices** per account, converging on the same data.

## Goals / non-goals / anti-goals

**Goals**
- Email + password sign-up, sign-in, sign-out (decided by the user).
- Habits, history, challenge and synced settings follow the account across devices.
- UI reads and writes only local storage; sync is background work.
- Existing on-device data is uploaded, not lost, the first time someone signs in.
- Each user can only ever read/write their own rows, enforced in the database (Row Level Security).

**Non-goals (this round)**
- Social login, magic links, password-reset UI polish, account deletion UI.
- Realtime push (Supabase Realtime). Sync happens on launch, foreground, reconnect, and after local edits.
- Web as a first-class offline target (see "My calls"; web must keep working, not be optimal).
- Sharing habits between users.

**Anti-goals (failure even if it "works")**
- A spinner or a network wait between a tap and the UI updating.
- Losing a check-off because two devices synced in the wrong order.
- Streaks silently resetting because a stale device rolled the day over.
- Any secret (`service_role` key) in the app or the repo.

## Decided by the user
- Supabase is the backend. Email + password auth.
- Local cache for instant feel; multi-device wanted.
- Account required once onboarding finishes (agreed to the proposal; "something like that").

## My calls (flagged for review)
- **Local store: `expo-sqlite`** behind a small `LocalStore` interface. `expo-sqlite` web support is
  experimental, so web gets an AsyncStorage-backed implementation of the same interface. Check current
  SDK 57 docs before coding.
- **Conflict rule:** last-write-wins per row by `updated_at`, except history rows, where the higher `count`
  wins (a completed check-off is never undone by a stale device).
- **Sign-out clears the local cache** (the next person on the device must not see the previous account's
  data); unsynced changes must be flushed or the user warned first.
- **Email confirmation** follows the Supabase project setting; the app handles both "confirm required"
  and "signed in immediately".
- `devDayOffset` (dev tool) stays local-only and is never synced.
- Sessions stored in `expo-secure-store`; the Supabase client uses `autoRefreshToken`.

## Architecture

```
Screens ──► useHabits()  (same public API as today)
               │
               ▼
        LocalStore (SQLite / AsyncStorage on web)   ◄── source of truth for the UI
               │  every write also appends to `outbox`
               ▼
        SyncEngine ──► RemoteStore (Supabase) ──► Postgres + RLS
               ▲
     triggers: launch, app foreground, connectivity regained, after a local write (debounced)
```

- `useHabits()` keeps its current signature, so no screen changes. Its internals swap from
  "AsyncStorage blob" to "LocalStore + SyncEngine". `src/lib/habit-logic.ts` stays the pure rules module.
- `RemoteStore` is an interface. The Supabase implementation is one file; an in-memory fake lets the sync
  logic be exercised before any Supabase project exists.
- New auth layer: `AuthProvider` + `useAuth()` (session, signIn, signUp, signOut). Root layout gating becomes:
  loading → onboarding (if not complete) → auth screen (if no session) → tabs. The existing web-overlay vs
  native-replace behavior of onboarding is preserved for the auth screen.

## Data model (Postgres)

All tables have `user_id uuid not null references auth.users on delete cascade default auth.uid()`,
`updated_at timestamptz not null default now()`, and RLS enabled with policies allowing select/insert/
update/delete only where `user_id = auth.uid()`.

| Table | Key | Columns |
|---|---|---|
| `habits` | `(user_id, id)` | `name`, `type`, `target`, `count`, `streak`, `best_streak`, `created_at_day`, `reminder jsonb`, `deleted_at` |
| `history` | `(user_id, habit_id, date)` | `count`, `completed` |
| `challenges` | `user_id` (one row) | `name`, `habit_ids`, `duration_days`, `start_date`, `days_completed`, `status`, `celebrated` |
| `user_state` | `user_id` | `settings jsonb`, `onboarding_complete`, `last_rollover_date` |

- Habit `id` stays the client-generated string (used by notifications and challenges today).
- Deletes are **soft** (`deleted_at`) so deletion syncs to other devices; local rows are purged after sync.
- Local tables mirror these plus a `dirty` flag / `outbox` table (entity, key, op, payload, queued_at).
- History being keyed by `(habit_id, date)` makes it naturally idempotent if two devices roll over the same day.

## Sync behavior

- **Push:** drain the outbox in order; upsert rows; mark clean. Failures stay queued and retry with backoff.
- **Pull:** fetch rows with `updated_at > last_pulled_at` per table; merge with the conflict rule above;
  never overwrite a row that has an un-pushed local change without applying the rule.
- **Rollover and stale devices:** `last_rollover_date` is part of synced `user_state`. On foreground,
  *pull first, then roll over*, so a device that was offline for days rolls over from current data, not a stale
  copy. If a device is offline, it may roll over locally; history upserts and the max-count rule reconcile it
  later. This is the hardest part of the feature and needs careful manual testing with the dev day offset.
- **First sign-in migration:** if local data exists from before accounts, upload it as the account's data
  (if the account is empty). If the account already has data, merge using the same rules and tell the user.

## Auth UX
- Sign-up / sign-in screen (email, password, toggle between modes, inline errors, loading state).
- Settings gets an account section: signed-in email, sign out, sync status (last synced / pending changes).
- Offline with an existing session: the app opens normally; sign-in itself requires network.

## Work that can be done before the Supabase project exists
Everything except live verification: `supabase/migrations/*.sql` (schema + RLS), `.env.example`, Supabase
client wiring reading `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `LocalStore`, outbox,
`SyncEngine` against the in-memory fake, `AuthProvider` and auth screens, root-layout gating, migration of
existing AsyncStorage data. Applying the SQL and testing against real Supabase waits for the credentials.

## Left to the builder
File/module naming within `src/lib` and `src/hooks`; exact SQLite schema; debounce/backoff constants;
auth screen visuals (follow existing themed components); how to structure the web `LocalStore`.

## Verification
No test runner exists. Required: `npx tsc --noEmit` and `npm run lint` (one known pre-existing lint error in
`use-color-scheme.web.ts`). Sync logic should be isolated as pure functions so merge rules can be checked
with a small script run through the in-memory fake. Manual two-device (or two-session) test once Supabase exists.

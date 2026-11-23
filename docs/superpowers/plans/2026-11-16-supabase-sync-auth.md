# Supabase Sync and Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habits, history, the challenge and settings sync to a per-user Supabase database behind email + password sign-in, while every tap still updates the UI from a local cache with no network wait.

**Architecture:** Screens keep calling `useHabits()` (public API unchanged). Behind it, a synchronous in-memory store holds the UI state plus a *replica* — one tracked row per database row, each remembering the last server version it saw. The replica is persisted locally (SQLite on native, AsyncStorage on web) and a sync engine pulls, three-way merges, then pushes dirty rows to Supabase through a `RemoteStore` interface that also has an in-memory fake.

**Tech Stack:** Expo SDK 57, `@supabase/supabase-js` 2.x, `expo-sqlite`, `expo-secure-store`, `expo-network`, Postgres + Row Level Security, Node 24 `node:test` for the sync checks.

**Spec:** `docs/superpowers/specs/2026-10-22-supabase-sync-auth-design.md`

## Global Constraints

- Tapping never waits on the network: every mutation is applied to the store synchronously; sync is background only.
- Only the Project URL and the publishable key are in the app (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, read from git-ignored `.env.local`). No `service_role` key anywhere.
- Every table: `user_id uuid not null default auth.uid() references auth.users on delete cascade`, `updated_at timestamptz not null default now()`, RLS for select/insert/update/delete limited to `user_id = auth.uid()`.
- Conflict rule: last-write-wins per row by `updated_at`, except history where the higher `count` wins.
- `useHabits()` keeps its exact public API. `devDayOffset` stays local-only. The `habit-tracker/*` storage prefix is not renamed; existing data is migrated into the replica.
- Sessions live in `expo-secure-store`; the client auto-refreshes tokens. Offline with an existing session opens normally.
- `npx tsc --noEmit` and `npm run lint` pass (one known pre-existing lint error in `use-color-scheme.web.ts`).
- Pure sync modules use erasable TypeScript only, so `node scripts/check-sync.mjs` can load them with Node's type stripping.

## Decisions made while planning (builder's calls — not in the spec)

1. Env var is `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the spec said `…_ANON_KEY`; Supabase now issues publishable keys).
2. Extra columns: `habits.count_date` (the day `count`/`streak` are valid for), `challenges.deleted_at` ("no challenge"), `user_state.data_epoch` (rotated by "Reset all data" so other devices wipe their cache).
3. Merge is three-way against the last server version: a side that did not change never wins. Only real conflicts use the conflict rule. Habit progress conflicts take the higher count/streak after bringing both sides to the same day; challenge conflicts on the same challenge take the higher `days_completed`.
4. The server sets `updated_at` (trigger) and keeps history monotonic (`greatest(count)`, `completed or`), so a stale device cannot lower a logged day.
5. Removing a habit is a soft delete (`deleted_at`) until pushed. Its history rows stay, as today.
6. "Reset all data" while signed in needs to be online: it calls `reset_my_data()` and rotates the epoch.
7. Sign-out is `scope: 'local'` (never needs the network) and warns first if changes are unsynced.
8. Session storage splits the session into chunks, because one SecureStore value is limited in size.
9. Onboarding gets an "I already have an account" button so a returning user is not forced through setup.
10. On first sign-in the account wins for the single-row tables (challenge, settings); habits are combined.
11. When a new day starts and the user is signed in, the app tries a sync for up to 2.5 s before closing the day, then closes it locally either way.

## Review Focus

1. **Stale device closes a day it never saw the check-off for** — streak and the logged day must survive. Test in Task 2 (`stale rollover keeps the streak`).
2. **Edit made while a push is in flight** — must stay queued, not be marked synced. Test in Task 3 (`edit during push stays dirty`).
3. **Push fails (offline / server error)** — nothing is lost, retry sends it. Test in Task 3 (`failed push is retried`).
4. **Reset on one device while another has unsynced edits** — the other device ends up empty, not half-restored. Test in Task 3 (`reset wipes the other device`).
5. **Signing in on a device that already has local habits, into an account that has data** — both sets of habits are kept, the account's challenge wins. Test in Task 3 (`first sign-in merges`).

Known and accepted: two devices whose calendar days differ (time zones, dev day offset) — the device that is behind adopts the later day early instead of breaking streaks.

---

### Task 1: Database schema

**Files:** Create `supabase/migrations/20261116000000_init.sql`

- [ ] Tables `habits (user_id, id)`, `history (user_id, habit_id, date)`, `challenges (user_id)`, `user_state (user_id)` with the columns in `src/lib/sync/rows.ts`.
- [ ] RLS enabled on all four; four policies each, `to authenticated`, `(select auth.uid()) = user_id`.
- [ ] `revoke all … from anon`; `grant select, insert, update, delete … to authenticated`.
- [ ] Triggers: `touch_updated_at` (keeps `updated_at` when nothing changed), `history_keep_highest`.
- [ ] `reset_my_data() returns uuid` (`security invoker`, `search_path = ''`).
- [ ] Apply with `npx supabase db push` once the project is linked.

### Task 2: Rows and replica (pure)

**Files:** Create `src/lib/sync/rows.ts`, `src/lib/sync/replica.ts`; Test `scripts/check-sync.mjs`

**Produces:**
- `rows.ts`: `HabitRow`, `HistoryRow`, `ChallengeRow`, `UserStateRow`, `Tracked<T>`, `ZERO_TIME`, `normalizeHabitRow(row, date)`, `mergeHabit`, `mergeHistory`, `mergeChallenge`, `mergeUserState`, `isDirty*`.
- `replica.ts`: `Replica`, `emptyReplica()`, `applyState(replica, prev, next, now)`, `replicaToState(replica, today)`, `mergePulled(replica, snapshot)`, `collectDirty(replica)`, `ackPushed(replica, sent, result)`, `pendingCount(replica)`, `adoptReplica(replica, userId)`, `serializeReplica`, `deserializeReplica`, `diffReplica`.

- [ ] Tests: state → replica → state round trip; `stale rollover keeps the streak`; concurrent counts take the max; delete propagates; serialize/diff round trip.

### Task 3: Remote store, store and sync engine

**Files:** Create `src/lib/sync/remote-store.ts` (interface), `remote-store-fake.ts`, `remote-store-supabase.ts`, `habit-store.ts`, `sync-engine.ts`

**Produces:**
- `RemoteStore { pull(cursors): Promise<RemoteSnapshot>; push(batch): Promise<PushResult>; reset(): Promise<string> }`
- `createHabitStore(clock)` → `{ getSnapshot, subscribe, hydrate, update, mergeReplica, reset, generation }`
- `createSyncEngine(deps)` → `{ syncNow(): Promise<SyncOutcome>; request(): void; dispose(): void }` — pull → merge → push → ack; debounce 2 s; retry 5 s, 15 s, 60 s, 5 min.

- [ ] Tests through the fake: two devices converge; `edit during push stays dirty`; `failed push is retried`; `reset wipes the other device`; `first sign-in merges`; challenge conflict takes the higher `days_completed`.

### Task 4: Local persistence

**Files:** Create `src/lib/sync/local-store.ts` (SQLite), `local-store.web.ts` (AsyncStorage), `persister.ts`

- [ ] `LocalStore { load(): Promise<Replica | null>; apply(delta, full): Promise<void> }`; native writes only changed rows in one transaction.
- [ ] `createPersister` serialises writes and coalesces changes made during a write.

### Task 5: Auth

**Files:** Create `src/lib/supabase.ts`, `src/lib/session-storage.ts`, `session-storage.web.ts`, `src/hooks/use-auth.ts`, `src/components/auth-screen.tsx`

- [ ] `useAuth()` → `{ status: 'loading' | 'signedIn' | 'signedOut' | 'disabled', user, signIn, signUp, signOut, authRequested, requestAuth, cancelAuthRequest }`.
- [ ] Status comes from a locally remembered user first, so an offline launch never waits on a token refresh.
- [ ] Sign-up handles both "session returned" and "confirm your email".

### Task 6: Wire into the app

**Files:** Modify `src/hooks/use-habits.ts`, `src/app/_layout.tsx`, `src/app/settings.tsx`, `src/components/onboarding-screen.tsx`; Create `src/components/sync-notice.tsx`; Modify `CLAUDE.md`, `README.md`

- [ ] `HabitsProvider` runs on the store; adds `useSync()` (`pending`, `lastSyncedAt`, `syncing`, `error`, `syncNow`, `notice`, `signOut`).
- [ ] Sync triggers: launch, foreground, connectivity regained, 2 s after a local write.
- [ ] Gate: loading → onboarding → auth screen → tabs, web overlay / native replace preserved.
- [ ] Settings: account section (email, sync status, sync now, sign out with unsynced warning); reset reports failure when offline.
- [ ] `npx tsc --noEmit`, `npm run lint`, `node scripts/check-sync.mjs`, web smoke test.

### Task 7: Live verification (needs the linked project)

- [ ] `npx supabase db push`, sign up, check a row appears; second session sees it; a second account sees nothing.

# Habit Tracker Redesign — Design Spec

Date: 2026-10-10

## Framework

Core function: create and track habits.
Core loop: completing a habit is rewarded visually, haptically, and with sound.
Challenge: a 3-day starter challenge right after onboarding, with its own completion reward.
Accessory: a history/accountability screen (log + consistency chart).
Surface area: 6 screens total (within the 5–7 target).
Retention hook: daily push-notification check-ins.

## Screens (6)

1. **Onboarding** — first launch only. Pick/create habits, then auto-starts the 3-day challenge.
2. **Today** (exists as `index.tsx`) — daily checklist, the core loop.
3. **History** — calendar heat map + consistency chart.
4. **Manage** (currently folded into Today's add row) — add/edit/remove habits, set type.
5. **Challenge** — active challenge progress, completion reward screen.
6. **Settings** — notification preferences.

Navigation: `app-tabs.tsx` / `app-tabs.web.tsx` become a 5-tab bar (Today, History, Manage, Challenge, Settings). Onboarding is not a tab — it's a one-time gate rendered instead of the tabs when `onboarding-complete` isn't set in `AsyncStorage`. Both tab-bar files are updated together, per existing project convention.

## Phase 1 — Habit types + core loop reward

### Data model

`src/hooks/use-habits.ts` — `Habit` becomes:

```ts
type Habit = {
  id: string;
  name: string;
  type: 'daily' | 'quantity';
  target?: number;   // quantity only
  count: number;      // today's count; daily is 0 or 1
  streak: number;
  bestStreak: number;
};
```

`completedToday` is removed in favor of a derived `isCompleted(habit)`: `daily` → `count >= 1`; `quantity` → `count >= target`.

Old stored records (no `type`/`count`) are migrated on load: `type: 'daily'`, `count: completedToday ? 1 : 0`, `bestStreak: streak`.

### Day rollover (foundational — fixes a gap in the current model)

The current implementation has no concept of "day" at all: streak only moves when the user manually toggles, with no date boundary. This is bundled into Phase 1 because History (Phase 2) and Challenges (Phase 3) both depend on a real daily boundary existing.

A new stored field `lastRolloverDate: string` (ISO date) sits alongside the habits array. On app load, if `lastRolloverDate !== today`:
- For each habit, append `{ date: lastRolloverDate, habitId, count }` to a history log (new `AsyncStorage` key `habit-tracker/history`, a flat array).
- Reset each habit's `count` to 0 for the new day.
- `streak` was already updated at the moment of completion/un-completion (see below), so rollover doesn't touch it.
- Set `lastRolloverDate` to today.

This runs once per cold start (habit apps don't need a background task for this — catching up on next open is the standard pattern).

### Core loop reward layer

New hook `src/hooks/use-habit-rewards.ts` wraps `use-habits.ts`'s mutators. It stays the only place that imports `expo-haptics` / `expo-audio`; `use-habits.ts` itself stays pure data/storage.

For each action (`toggleDaily`, `incrementQuantity`, `decrementQuantity`):
- Compute completion before/after.
- Completing (false → true): `Haptics.notificationAsync(Success)` + short chime; streak += 1; if the new streak is in `[3, 7, 14, 30, 50, 100]`, also fire `Haptics.impactAsync(Heavy)` and a "milestone" flag (drives the flame animation) — and update `bestStreak` if exceeded.
- Un-completing (true → false, via decrement below target or un-checking): streak -= 1, silent — no sound/haptic.
- After any change, recompute "all habits completed today"; on the transition into true, fire the bigger celebration (chime + confetti) once.

The hook returns `{ toggleDaily, incrementQuantity, decrementQuantity, lastEvent }` where `lastEvent` is a short-lived discriminated union (`{ type: 'milestone', streak } | { type: 'allDone' } | null`) that `index.tsx` watches to trigger the overlay animations.

### UI

- `habit-card.tsx`: branches on `habit.type`. `daily` keeps the current checkbox. `quantity` renders `[−] count/target [+]`; tap +1/-1, long-press continues to repeat (standard RN `Pressable` `onLongPress` + interval, or a simple repeated-tap affordance — no need for anything fancier).
- New `components/daily-progress-bar.tsx`: `completedCount/total` pill above the list on `index.tsx`, animated width via `react-native-reanimated`.
- New `components/confetti-burst.tsx`: ~12 small `Animated.View` dots, randomized angle/distance, scale+opacity to 0 over ~700ms, mounted/key-bumped on trigger — no new dependency.
- New `components/streak-flame.tsx`: 🔥 emoji/icon with a scale pulse (`withSequence`) on milestone trigger.

### Sound assets

No audio assets or pipeline exist in the repo. Rather than sourcing external sound files (licensing risk), two short WAV tones are synthesized programmatically by a one-off script and committed under `assets/sounds/chime.wav` (two-note, on normal completion) and `assets/sounds/celebration.wav` (ascending triad, on all-done/challenge-complete). Dependency: `expo-audio`, played via `useAudioPlayer`.

## Phase 2 — History & Accountability

New screen `src/app/history.tsx`, reading `habit-tracker/history` (written by Phase 1's rollover) plus today's live state.

- **Calendar heat map**: a simple grid (weeks × days, last ~12 weeks) per habit or aggregated across all habits, shaded by completion ratio that day. Built with plain `View`s (no charting library needed for a heat map).
- **Consistency %**: per habit, `completedDays / totalDays` over the last 7 and 30 days, computed from the history log.
- **Streak records**: current `streak` (live) vs `bestStreak` (persisted, from Phase 1's model) shown side by side.

No new dependency required — all derived from arrays already being logged.

## Phase 3 — Challenges + Onboarding

### Data model

New `AsyncStorage` key `habit-tracker/challenge` holding at most one challenge at a time:

```ts
type Challenge = {
  habitIds: string[];
  durationDays: 3;
  startDate: string;      // ISO date
  daysCompleted: number;   // consecutive days where every target habit hit isCompleted()
  status: 'active' | 'completed' | 'failed';
};
```

Evaluated during the same day-rollover pass as Phase 1: for the day just closed, if every habit in `habitIds` was completed, `daysCompleted += 1`; otherwise `status = 'failed'`. When `daysCompleted === durationDays`, `status = 'completed'` and the rewards layer fires the big celebration (reusing Phase 1's `allDone`-style event, just scoped to the challenge). A failed or completed challenge can be restarted from the Challenge screen (creates a fresh record).

### Onboarding

`src/app/onboarding.tsx`, shown instead of the tab bar when `AsyncStorage['habit-tracker/onboarding-complete']` is unset. Lets the user add 1–3 habits (reuses the existing add-habit input/logic from `index.tsx`, pulled into a shared `useHabits().addHabit`), then a single "Start 3-day challenge" button creates the `Challenge` record targeting whatever habits were just added and sets `onboarding-complete`.

### Challenge screen

`src/app/challenge.tsx`: shows `daysCompleted/3`, the target habits, and status. On the `status → 'completed'` transition, shows the confetti/celebration overlay from Phase 1's components.

## Phase 4 — Push Notifications (native only)

Dependency: `expo-notifications`. **No web support** — every code path here is guarded with `Platform.OS !== 'web'`; Settings shows "Notifications require the mobile app" in the web build instead of the toggles.

Settings screen (`src/app/settings.tsx`) adds three toggles, each persisted in `AsyncStorage`:

- **Daily reminder** (default on, default 09:00): `Notifications.scheduleNotificationAsync` with a `SchedulableTriggerInputTypes.DAILY` trigger, static content ("Time to check your habits!").
- **Afternoon nudge** (default on, ~15:00): rather than a single fixed schedule, this is recomputed each time the app backgrounds (`AppState` listener) — cancel any existing nudge, then if any habit is still incomplete today, schedule one for later today; if everything's done, don't schedule one. This keeps the message relevant without needing a background task.
- **Streak-at-risk alert** (default on, ~20:00): same backgrounding hook — if any habit with `streak >= 3` is still incomplete today, schedule an evening alert naming it; otherwise cancel/skip.

All three are local notifications only (no push token/server), which per Expo's SDK 57 docs work in Expo Go on both platforms — no dev build required for this phase.

## Testing plan

No test runner is configured in this repo (per `CLAUDE.md`). Verification per phase:
- `npx tsc --noEmit` and `npm run lint` after each phase.
- Run the app on web (`npm run web`) to manually verify Phases 1–3 (sound works on web via `expo-audio`; haptics no-op harmlessly; confetti/animations render).
- Phase 4 cannot be exercised on web — ask for a manual check on a device or Expo Go after it's built.

## Open assumptions (flagged for review)

- Challenge failure is immediate (missing one day fails it) rather than "any 3 of N days" — matches typical streak-challenge UX, restart is one tap.
- Onboarding lets users add custom habits rather than choosing from a preset list, reusing existing add-habit logic.
- Milestone thresholds: 3, 7, 14, 30, 50, 100 days.
- Notification defaults (09:00 / 15:00 / 20:00) are placeholders — easy to change, not load-bearing on the architecture.

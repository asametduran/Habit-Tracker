# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

An Expo (SDK 57) + React Native + TypeScript app using Expo Router for file-based navigation. Implements a local-only habit tracker: daily and quantity habits, streaks, history, multi-habit challenges, per-habit reminders (local notifications), and haptic/sound/confetti rewards. All data is persisted on-device.

Design specs are dated files in `docs/superpowers/specs/`. The habit-tracker redesign spec covers the app as built. The Supabase sync/auth spec is a design for work that has not started — there is no backend, account, or sync code yet, so don't assume any of it exists.

## Commands

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm add — resolves SDK-compatible versions
npm start                   # or: npx expo start — dev server (scan QR with Expo Go, or press a/i/w)
npm run android / ios / web # start targeting a specific platform
npx tsc --noEmit            # typecheck
npm run lint                # expo lint (ESLint)
npx expo-doctor             # diagnose dependency/config issues
npx expo install --fix      # fix incompatible package versions
```

Run `npx tsc --noEmit` and `npm run lint` before declaring any task done. There is no test runner configured in this project.

For layout changes, `npm run web` in a browser at phone and desktop sizes is the quickest check, but it only covers the web variants — the tab bar and top spacing are implemented separately for native (see Architecture), so native needs a device or emulator.

Note: `npm run lint` currently reports one pre-existing error in the stock template file `src/hooks/use-color-scheme.web.ts` (`react-hooks/set-state-in-effect`). It predates any feature work in this repo — don't treat it as something you broke.

## Expo changes fast — verify before coding against its APIs

Expo ships breaking changes every SDK release; APIs remembered from training data are often renamed, moved, or removed. Before writing code against any Expo/EAS/React Native API:
1. Check the `expo` major version in `package.json` (currently SDK 57).
2. Check the matching versioned docs: `https://docs.expo.dev/versions/v57.0.0/`.
3. For anything else, check `https://docs.expo.dev/llms.txt` (index of docs with corrections to common LLM misconceptions) and follow its links — don't answer from memory.

Prefer Expo's own modules over third-party libraries. The `expo` Claude Code plugin is enabled in `.claude/settings.json`; check its skills before adding a dependency or working against an Expo API.

## Architecture

- **Entry point:** `package.json` `main` is `expo-router/entry` → resolves to `src/app/_layout.tsx` (root layout: wraps the app in `ThemeProvider` and `HabitsProvider`, then renders `AnimatedSplashOverlay` and the onboarding/tabs gate described below).
- **Routing:** file-based via Expo Router, rooted at `src/app/` (not the default `app/` — see `tsconfig.json` paths). Every file under `src/app/` is a screen; `_layout.tsx` files define navigators. Keep non-route code (components, hooks, constants) out of `src/app/`.
- **Tabs (dual implementation):** `src/components/app-tabs.tsx` (native platforms, built on `expo-router/unstable-native-tabs`) and `app-tabs.web.tsx` (web, built on `expo-router/ui` `Tabs`/`TabList`/`TabTrigger`) are separate implementations of the same tab bar — Metro picks the `.web.tsx` variant automatically on web via the platform-extension convention. When changing tabs/navigation, both files need updating together. Tabs: Today (`index`), History, Manage, Challenge, Settings — one screen file each in `src/app/`.
- **Root gating:** `src/app/_layout.tsx` wraps everything in `HabitsProvider` and shows `OnboardingScreen` until `onboardingComplete`. On web it is an overlay on top of an always-mounted navigator (so deep links/reloads keep their route); on native it replaces the tabs, since native tab bars can't be covered.
- **Theming:** `src/constants/theme.ts` defines `Colors` (light/dark palettes), `Spacing` scale, and `Fonts`. `src/hooks/use-theme.ts` and `use-color-scheme(.web).ts` resolve the active scheme. `src/components/themed-text.tsx` / `themed-view.tsx` are the base styled primitives — use these instead of raw RN `Text`/`View` so components stay color-scheme-aware.
- **Screen layout:** `src/components/screen.tsx` is the shared page shell (title, `ScrollView`, max content width, top/bottom spacing) used by every tab and by onboarding — except Today (`src/app/index.tsx`), which has its own layout: a vertically centered block with a `FlatList`, capped at the screen height so it can't overflow off the top. Top spacing is platform-specific in both: native adds the safe-area inset to `Spacing.three`; web uses a fixed `Spacing.six + Spacing.three` to clear the web tab bar, which is absolutely positioned over the top of the page. Changing the web tab bar's height means updating that padding in both files. Bottom spacing uses `BottomTabInset` from `theme.ts`.
- **Path aliases:** `@/*` → `src/*`, `@/assets/*` → `assets/*` (defined in `tsconfig.json`).
- **Habit state:** `src/hooks/use-habits.ts` exports `HabitsProvider` (context) and `useHabits()` — the single source of truth for habits, history, challenge, settings, and onboarding flag. Each piece is persisted to `AsyncStorage` under its own `habit-tracker/*` key (see `KEYS` in that file). Screens consume it via `useHabits()`; there is no other store.
- **Pure logic:** `src/lib/habit-logic.ts` holds the types (`Habit`, `HistoryEntry`, `Challenge`, `Settings`), date keys, day rollover, streak/count math, and storage migration (`migrateHabit`). Put rules there, not in components. "Today" comes from `getToday()`, which honors a dev-only day offset (Settings screen) for testing rollovers and challenges without waiting.
- **Rewards:** `src/hooks/use-habit-rewards.ts` wraps `setCount` and is the only module touching `expo-haptics`/`expo-audio`; it emits milestone/all-done events that drive `confetti-burst.tsx` and `streak-flame.tsx`. Sounds in `assets/sounds/` are synthesized by `node scripts/generate-sounds.js`.
- **Notifications:** `src/lib/notifications.ts` (native) and `notifications.web.ts` (no-op stub, same `.web` convention as the tabs) schedule per-habit reminders plus the afternoon-nudge and streak-at-risk alerts. `use-notification-sync.ts` (mounted in the root layout) reschedules when settings or habit reminders change and when the app backgrounds. Notifications need a development build, not Expo Go.
- **Continuous Native Generation:** no `ios/`/`android/` directories exist in this repo — they're generated on demand. Never hand-edit generated native projects; configure native behavior through `app.json` and config plugins.
- **Development builds:** Expo Go only bundles its own pre-included native modules. After adding any library with native code, a development build is required (`npx expo run:ios`/`run:android` locally, or `eas build --profile development`).
- **EAS:** cloud builds/signing/submission (`eas build`, `eas submit`) and OTA updates (`eas update`) run via `npx eas-cli@latest <command>`.

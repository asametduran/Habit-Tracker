# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

An Expo (SDK 57) + React Native + TypeScript app using Expo Router for file-based navigation. Implements a local-only habit tracker: daily and quantity habits, streaks, history, multi-habit challenges, per-habit reminders (local notifications), and haptic/sound/confetti rewards. All data is persisted on-device. The design spec is in `docs/superpowers/specs/`.

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

Note: `npm run lint` currently reports one pre-existing error in the stock template file `src/hooks/use-color-scheme.web.ts` (`react-hooks/set-state-in-effect`). It predates any feature work in this repo — don't treat it as something you broke.

## Expo changes fast — verify before coding against its APIs

Expo ships breaking changes every SDK release; APIs remembered from training data are often renamed, moved, or removed. Before writing code against any Expo/EAS/React Native API:
1. Check the `expo` major version in `package.json` (currently SDK 57).
2. Check the matching versioned docs: `https://docs.expo.dev/versions/v57.0.0/`.
3. For anything else, check `https://docs.expo.dev/llms.txt` (index of docs with corrections to common LLM misconceptions) and follow its links — don't answer from memory.

## Architecture

- **Entry point:** `package.json` `main` is `expo-router/entry` → resolves to `src/app/_layout.tsx` (root layout: wraps the app in `ThemeProvider`, `AnimatedSplashOverlay`, and `AppTabs`).
- **Routing:** file-based via Expo Router, rooted at `src/app/` (not the default `app/` — see `tsconfig.json` paths). Every file under `src/app/` is a screen; `_layout.tsx` files define navigators. Keep non-route code (components, hooks, constants) out of `src/app/`.
- **Tabs (dual implementation):** `src/components/app-tabs.tsx` (native platforms, built on `expo-router/unstable-native-tabs`) and `app-tabs.web.tsx` (web, built on `expo-router/ui` `Tabs`/`TabList`/`TabTrigger`) are separate implementations of the same tab bar — Metro picks the `.web.tsx` variant automatically on web via the platform-extension convention. When changing tabs/navigation, both files need updating together. Tabs: Today (`index`), History, Manage, Challenge, Settings — one screen file each in `src/app/`.
- **Root gating:** `src/app/_layout.tsx` wraps everything in `HabitsProvider` and shows `OnboardingScreen` until `onboardingComplete`. On web it is an overlay on top of an always-mounted navigator (so deep links/reloads keep their route); on native it replaces the tabs, since native tab bars can't be covered.
- **Theming:** `src/constants/theme.ts` defines `Colors` (light/dark palettes), `Spacing` scale, and `Fonts`. `src/hooks/use-theme.ts` and `use-color-scheme(.web).ts` resolve the active scheme. `src/components/themed-text.tsx` / `themed-view.tsx` are the base styled primitives — use these instead of raw RN `Text`/`View` so components stay color-scheme-aware.
- **Path aliases:** `@/*` → `src/*`, `@/assets/*` → `assets/*` (defined in `tsconfig.json`).
- **Habit state:** `src/hooks/use-habits.ts` exports `HabitsProvider` (context) and `useHabits()` — the single source of truth for habits, history, challenge, settings, and onboarding flag. Each piece is persisted to `AsyncStorage` under its own `habit-tracker/*` key (see `KEYS` in that file). Screens consume it via `useHabits()`; there is no other store.
- **Pure logic:** `src/lib/habit-logic.ts` holds the types (`Habit`, `HistoryEntry`, `Challenge`, `Settings`), date keys, day rollover, streak/count math, and storage migration (`migrateHabit`). Put rules there, not in components. "Today" comes from `getToday()`, which honors a dev-only day offset (Settings screen) for testing rollovers and challenges without waiting.
- **Rewards:** `src/hooks/use-habit-rewards.ts` wraps `setCount` and is the only module touching `expo-haptics`/`expo-audio`; it emits milestone/all-done events that drive `confetti-burst.tsx` and `streak-flame.tsx`. Sounds in `assets/sounds/` are synthesized by `node scripts/generate-sounds.js`.
- **Notifications:** `src/lib/notifications.ts` (native) and `notifications.web.ts` (no-op stub, same `.web` convention as the tabs) schedule per-habit reminders plus the afternoon-nudge and streak-at-risk alerts. `use-notification-sync.ts` (mounted in the root layout) reschedules when settings or habit reminders change and when the app backgrounds. Notifications need a development build, not Expo Go.
- **Continuous Native Generation:** no `ios/`/`android/` directories exist in this repo — they're generated on demand. Never hand-edit generated native projects; configure native behavior through `app.json` and config plugins.
- **Development builds:** Expo Go only bundles its own pre-included native modules. After adding any library with native code, a development build is required (`npx expo run:ios`/`run:android` locally, or `eas build --profile development`).
- **EAS:** cloud builds/signing/submission (`eas build`, `eas submit`) and OTA updates (`eas update`) run via `npx eas-cli@latest <command>`.

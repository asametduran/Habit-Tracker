# HabiTracker

A local-only habit tracker built with Expo (SDK 57), React Native and TypeScript. All data stays on the device.

## Features

- **Daily and quantity habits** with streaks and best streaks
- **History** of past days
- **Challenges** over multiple habits for a set number of days
- **Reminders** per habit, plus an afternoon nudge and a streak-at-risk alert (local notifications)
- **Rewards**: haptics, sounds, confetti and streak milestones
- Light and dark themes; runs on iOS, Android and web

## Getting started

```bash
npm install
npm start          # then press a / i / w, or scan the QR code with Expo Go
```

Notifications need a [development build](https://docs.expo.dev/develop/development-builds/introduction/) rather than Expo Go:

```bash
npx expo run:ios      # or: npx expo run:android
```

Add packages with `npx expo install <package>` so versions match the SDK.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the dev server |
| `npm run android` / `ios` / `web` | Start on a specific platform |
| `npm run lint` | ESLint via `expo lint` |
| `npx tsc --noEmit` | Typecheck |
| `node scripts/generate-sounds.js` | Regenerate the reward sounds in `assets/sounds/` |

## Project structure

- `src/app/` — Expo Router screens: Today, History, Manage, Challenge, Settings
- `src/hooks/use-habits.ts` — app state (context) persisted to AsyncStorage
- `src/lib/habit-logic.ts` — pure habit, streak and date logic
- `src/lib/notifications.ts` — notification scheduling (web has a no-op stub)
- `src/components/` — UI components; tabs have separate native and web implementations
- `docs/superpowers/specs/` — design spec

See `CLAUDE.md` for more architecture notes.

## Development tip

Settings has a dev-only day offset that shifts "today" forward, so you can test day rollovers and challenges without waiting.

## License

MIT

# HabiTracker

A local-first habit tracker for iOS, Android and the web. Every tap is saved on the device straight away and synced to your account in the background, so the app stays fast and works offline. Signed-in users also get an AI coach that writes a daily nudge and weekly and monthly reflections from their own streaks and consistency.

## Features

- **Daily and quantity habits** with streaks and best streaks
- **Today checklist** with haptics, sounds, confetti and streak milestones
- **History** of past days, with consistency over the last 7 and 30 days
- **Challenges** over several habits for a set number of days
- **Reminders** per habit, an afternoon nudge and a streak-at-risk alert (local notifications)
- **Accounts and sync**: email + password sign-in; your habits follow you across devices
- **AI coach**: a daily nudge on Today (also sent as a 3 pm push) and weekly/monthly reflections in History, written by Google Gemini
- Onboarding, light and dark themes

## Tech stack

| Area | Technology |
| --- | --- |
| App | React Native 0.88, [Expo SDK 58](https://docs.expo.dev/), Expo Router, TypeScript |
| Local data | SQLite (`expo-sqlite`) on phones, `localStorage` on web, synced in the background |
| Backend | [Supabase](https://supabase.com): Postgres with Row Level Security, Auth, Edge Functions (Deno), `pg_cron` + `pg_net`, Vault |
| AI | [Google Gemini API](https://ai.google.dev/) (`gemini-3.8-flash`, falling back to `gemini-3.6-flash` and `gemini-3.5-flash-lite`) |
| Notifications | `expo-notifications` (local reminders) and Expo's push service (the coach's afternoon push) |
| Bot protection | Cloudflare Turnstile (optional) |

## Getting started

```bash
npm install
npm start          # then press a / i / w, or scan the QR code with Expo Go
```

Without any further setup the app runs on the device only, with no sign-in. Notifications need a [development build](https://docs.expo.dev/develop/development-builds/introduction/) rather than Expo Go:

```bash
npx expo run:ios      # or: npx expo run:android
```

Add packages with `npx expo install <package>` so versions match the SDK.

## Environment variables

**App** — copy [`.env.example`](.env.example) to `.env.local` (git-ignored). These values are built into the app and are public by design:

| Variable | Required | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | for accounts | Supabase project URL (Project Settings → API) |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | for accounts | The **publishable** key. Never the `service_role` / secret key |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | no | Turns on the CAPTCHA on sign-in, sign-up and password reset |
| `EXPO_PUBLIC_TURNSTILE_PAGE_URL` | no | Phones only: the URL the CAPTCHA page claims (defaults to the Supabase URL) |

**Edge Functions** — copy [`supabase/.env.example`](supabase/.env.example) to `supabase/.env.local` (git-ignored) and upload it with `npx supabase secrets set --env-file supabase/.env.local`:

| Secret | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | for the coach | Google AI Studio API key |
| `COACH_CRON_SECRET` | for scheduled coaching | Shared secret the hourly job sends to `coach-scheduler` |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | no | Override the default models |
| `COACH_GLOBAL_DAILY_LIMIT` | no | Model calls per day for the whole project (default 2000) |
| `EXPO_ACCESS_TOKEN` | no | Only if Expo's enhanced push security is on |

The Supabase URL and keys inside functions are provided by Supabase automatically.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com) and fill in `.env.local` (above).
2. Create the tables, policies and functions:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

3. Restart the dev server so it picks up `.env.local`.

"Forgot password?" emails a code that the user types into the app, so the **Reset password** email template (Authentication → Emails → Templates) must include `{{ .Token }}`. Supabase's built-in email service only delivers to members of your Supabase team and is heavily rate-limited, so set up custom SMTP (Authentication → Emails → SMTP Settings) before real users rely on it.

### AI coach

1. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) and put it in `supabase/.env.local`, then upload the secrets and deploy:

   ```bash
   npx supabase secrets set --env-file supabase/.env.local
   npx supabase functions deploy coach-nudge reflection-report coach-scheduler
   ```

2. For the scheduled nudges and the 3 pm push, store the scheduler's address and the shared secret in Vault (SQL Editor), using the same value as `COACH_CRON_SECRET`:

   ```sql
   select vault.create_secret('https://<your-project-ref>.supabase.co/functions/v1/coach-scheduler', 'coach_scheduler_url');
   select vault.create_secret('<same value as COACH_CRON_SECRET>', 'coach_cron_secret');
   ```

   Phones only receive the push from an EAS build with a project ID (`npx eas-cli@latest init`).

Nudges and reflections are cached per day or period. Each user can trigger at most 10 model calls a day and the whole project 2,000 (`COACH_GLOBAL_DAILY_LIMIT`); a call is counted before it's made, so simultaneous requests can't get around either cap. If a model is overloaded, out of quota or slower than 40 seconds, the function moves on to the next one, and the app shows a friendly message with **Try again** if all of them fail. As a hard stop on the bill, also cap the Generative Language API's requests per day in Google Cloud (APIs & Services → Quotas) and add a budget alert.

### Security settings

`supabase/config.toml` only configures a local Supabase stack. Make the same settings on your hosted project in the dashboard:

- **Authentication → Sign In / Providers → Email:** turn on **Confirm email**, set the **email OTP length to 8** and the **email OTP expiration to 900** seconds, and turn on **secure password change**. The reset code signs the user in, so a short, long-lived code can be guessed; the app accepts 6–10 digit codes.
- **CAPTCHA (Cloudflare Turnstile):** create a Turnstile widget listing your web app's hostname and the hostname the phone app's CAPTCHA page uses (your Supabase project's host, or `EXPO_PUBLIC_TURNSTILE_PAGE_URL`). Ship a build with `EXPO_PUBLIC_TURNSTILE_SITE_KEY` first, then turn on **Authentication → Bot and Abuse Protection → Enable CAPTCHA protection** with the **secret key**. The other way round locks out builds without the widget.
- **Web hosting:** every page carries a Content-Security-Policy, and the app refuses to run inside another site's frame. If your host can send headers, also send `Content-Security-Policy: frame-ancestors 'none'`.

## Database

All tables live in `public`, and every one has Row Level Security: a signed-in user can only reach their own rows, and signed-out requests get nothing.

| Table | Contents |
| --- | --- |
| `habits` | Each habit: name, type (daily/quantity), target, today's count, streaks, reminder |
| `history` | One row per habit per day: the count logged and whether it was completed |
| `challenges` | The user's current challenge: habits, length, progress and status |
| `user_state` | Settings, onboarding state and the last day the app rolled over |
| `coach_insights` | AI coach output: daily nudges and weekly/monthly reflections (`kind`) |
| `coach_usage` | One row per model call, for the daily caps (service role only) |
| `push_tokens` | Expo push tokens of the user's devices (at most 10) |

A user's first name (for the coach's greeting) and time zone (for scheduling) are kept in their Supabase Auth profile. Schema changes go in new files in `supabase/migrations/`.

## Edge Functions

| Function | Called by | What it does |
| --- | --- | --- |
| `coach-nudge` | The app (signed-in users) | Returns today's nudge, writing it with Gemini if needed |
| `reflection-report` | The app (signed-in users) | Returns the weekly or monthly reflection |
| `coach-scheduler` | `pg_cron`, hourly, with `COACH_CRON_SECRET` | Pre-writes nudges and reflections and sends the 3 pm push |

The two app-facing functions verify the caller's session themselves and read data with the caller's own token, so Row Level Security applies. All numbers come from code (`supabase/functions/_shared/stats.ts`); the model only writes the words, as JSON that is validated before it's stored.

## Scripts and checks

| Command | Description |
| --- | --- |
| `npm start` | Start the dev server |
| `npm run android` / `ios` / `web` | Start on a specific platform |
| `npx tsc --noEmit` | Typecheck |
| `npm run lint` | ESLint via `expo lint` |
| `node scripts/check-sync.mjs` | Sync and merge checks |
| `node scripts/check-coach.mjs` | Checks for the stats and schedule the AI coach uses |
| `node scripts/generate-sounds.js` | Regenerate the reward sounds in `assets/sounds/` |
| `npx supabase db push` | Apply `supabase/migrations/` to the linked project |
| `npx supabase functions deploy <name>` | Deploy an Edge Function |

## Project structure

- `src/app/` — screens (Expo Router): Today, History, Manage, Challenge, Settings, plus the web root HTML
- `src/components/` — UI components; the tab bar has separate native and web versions
- `src/hooks/` — app state (`use-habits`), auth (`use-auth`), AI coach (`use-coach`), rewards and notifications
- `src/lib/habit-logic.ts` — pure habit, streak and date logic
- `src/lib/sync/` — local cache, sync engine and the Supabase adapter
- `supabase/migrations/` — schema, Row Level Security and database functions
- `supabase/functions/` — Edge Functions and their shared code
- `docs/superpowers/` — design specs and implementation plans

See [`CLAUDE.md`](CLAUDE.md) for detailed architecture notes.

## Development tools

Development builds have a **Developer tools** section in Settings: shift "today" forward to test day rollovers and challenges, complete every habit, trigger the challenge celebration, and preview the coach's push. It isn't included in release builds, which always use the real date.

## License

MIT

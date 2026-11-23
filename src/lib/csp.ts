// The Content-Security-Policy of the web build, added to every page by src/app/+html.tsx. On web
// the session lives in localStorage (a static site has no server to set httpOnly cookies), so
// this is what keeps an injected script from running or sending it anywhere: scripts only from
// this site (plus the one inline line Expo adds for hydration, allowed by its hash), and requests
// only to this site and the Supabase project. Turnstile's origin is added when CAPTCHA is on.
// A meta tag can't set frame-ancestors; a host that can send headers should add
// `frame-ancestors 'none'` there.

/**
 * Hash of the inline script Expo Router's static export puts on every page,
 * `globalThis.__EXPO_ROUTER_HYDRATE__=true;`. If an Expo upgrade changes that line, the browser
 * console reports it as a CSP violation; recompute the hash from the exported HTML.
 */
export const EXPO_HYDRATE_SCRIPT_HASH = "'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='";

const TURNSTILE = 'https://challenges.cloudflare.com';

export function contentSecurityPolicy(options: { supabaseUrl: string | null; turnstile: boolean }): string {
  const supabase = options.supabaseUrl ? new URL(options.supabaseUrl).origin : null;
  const turnstile = options.turnstile ? TURNSTILE : null;
  const sources = (...list: (string | null)[]) => list.filter((s) => s !== null).join(' ');
  return [
    "default-src 'self'",
    `script-src ${sources("'self'", EXPO_HYDRATE_SCRIPT_HASH, turnstile)}`,
    `connect-src ${sources("'self'", supabase, turnstile)}`,
    `frame-src ${turnstile ?? "'none'"}`,
    "img-src 'self' data: blob:",
    // React Native Web adds its styles at runtime.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

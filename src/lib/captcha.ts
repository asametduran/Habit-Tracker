// Cloudflare Turnstile on sign-in, sign-up and password reset. It's on when the build has a site
// key (site keys are public by design); Supabase then checks each token once CAPTCHA protection
// is switched on for the project (Authentication > Bot and Abuse Protection). Without a key the
// app shows no widget and sends no token, which is right while the project doesn't require one.

export const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || null;

export const captchaEnabled = TURNSTILE_SITE_KEY !== null;

/**
 * Phones run the widget on a small page inside a WebView, which claims this URL's origin; its
 * hostname must be in the Turnstile widget's hostname list. Defaults to the Supabase project URL.
 */
export const TURNSTILE_PAGE_URL =
  process.env.EXPO_PUBLIC_TURNSTILE_PAGE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://localhost';

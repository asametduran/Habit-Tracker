import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { TURNSTILE_SITE_KEY } from '@/lib/captcha';

// Web: Cloudflare's script renders the Turnstile widget into a <div>. It's loaded on first use
// from the exact URL Cloudflare requires (the file must not be proxied or cached). The phone
// version is captcha.tsx.

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
};

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  const ready = (window as { turnstile?: Turnstile }).turnstile;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const loaded = (window as { turnstile?: Turnstile }).turnstile;
      if (loaded) resolve(loaded);
      else reject(new Error('Turnstile did not load'));
    };
    script.onerror = () => reject(new Error('Turnstile did not load'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null; // let the next attempt try again
    throw error;
  });
  return loading;
}

export type CaptchaProps = {
  /** A fresh token, or null when there's none (not yet, expired, or failed). */
  onToken: (token: string | null) => void;
  /** Change it after each use for a new token: Supabase accepts a token only once. */
  resetKey: number;
};

export function Captcha({ onToken, resetKey }: CaptchaProps) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const emit = useEffectEvent((token: string | null) => onToken(token));
  const fail = useEffectEvent(() => {
    onToken(null);
    setFailed(true);
  });

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let turnstile: Turnstile | null = null;
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((loaded) => {
        if (cancelled || !container.current) return;
        turnstile = loaded;
        widgetId = loaded.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'auto',
          callback: (token: string) => emit(token),
          'expired-callback': () => emit(null),
          'error-callback': () => fail(),
        });
      })
      .catch(() => {
        if (!cancelled) fail();
      });
    return () => {
      cancelled = true;
      if (turnstile && widgetId !== null) turnstile.remove(widgetId);
    };
  }, [resetKey, attempt]);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <View style={styles.box}>
      <div ref={container} />
      {failed ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            The security check didn’t load. Check your connection and try again.
          </ThemedText>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    gap: Spacing.two,
  },
});

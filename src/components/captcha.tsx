import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { TURNSTILE_PAGE_URL, TURNSTILE_SITE_KEY } from '@/lib/captcha';

// Phones: Turnstile doesn't run natively, so (as Cloudflare's mobile guide describes) the widget
// runs on a small page in a WebView and posts its token back. The page claims
// TURNSTILE_PAGE_URL's origin, which must be one of the widget's hostnames. The web version is
// captcha.web.tsx.

export type CaptchaProps = {
  /** A fresh token, or null when there's none (not yet, expired, or failed). */
  onToken: (token: string | null) => void;
  /** Change it after each use for a new token: Supabase accepts a token only once. */
  resetKey: number;
};

function widgetPage(siteKey: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html, body { margin: 0; background: transparent; display: flex; justify-content: center; }</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer></script>
</head>
<body>
<div id="widget"></div>
<script>
function send(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
function onTurnstileLoad() {
  turnstile.render('#widget', {
    sitekey: ${JSON.stringify(siteKey)},
    theme: 'auto',
    callback: function (token) { send({ token: token }); },
    'expired-callback': function () { send({ token: null }); },
    'error-callback': function () { send({ error: true }); },
  });
}
</script>
</body>
</html>`;
}

export function Captcha({ onToken, resetKey }: CaptchaProps) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (!TURNSTILE_SITE_KEY) return null;

  const fail = () => {
    onToken(null);
    setFailed(true);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    let message: { token?: unknown; error?: unknown };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.error) fail();
    else onToken(typeof message.token === 'string' ? message.token : null);
  };

  return (
    <View style={styles.box}>
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
      ) : (
        <WebView
          key={`${resetKey}-${attempt}`}
          source={{ html: widgetPage(TURNSTILE_SITE_KEY), baseUrl: TURNSTILE_PAGE_URL }}
          originWhitelist={['https://*', 'about:blank', 'about:srcdoc']}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          scrollEnabled={false}
          onMessage={onMessage}
          onError={fail}
          style={styles.web}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  web: {
    width: 300,
    height: 70,
    backgroundColor: 'transparent',
  },
});

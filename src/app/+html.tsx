import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { captchaEnabled } from '@/lib/captcha';
import { contentSecurityPolicy } from '@/lib/csp';

// The root HTML of every web page (static rendering; this runs only in Node). It's Expo's SDK 58
// default plus the Content-Security-Policy from lib/csp.ts, which production builds carry; the
// dev server's live-reload code needs more than the policy allows, so it's left off there.

const CSP =
  process.env.NODE_ENV === 'production'
    ? contentSecurityPolicy({
        supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
        turnstile: captchaEnabled,
      })
    : null;

export default function Root({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {CSP ? <meta httpEquiv="Content-Security-Policy" content={CSP} /> : null}
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}

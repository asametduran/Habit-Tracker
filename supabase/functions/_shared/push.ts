// Sends phone notifications through Expo's push service, which delivers to both Android (FCM)
// and iOS (APNs) for apps built with EAS. Tokens come from the app (src/lib/push.ts).

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo's per-request limit

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  /** Read by the app when the notification is tapped. */
  data?: Record<string, unknown>;
};

type Ticket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

export type PushResult = {
  delivered: string[];
  /** Tokens Expo says no longer belong to an installed app: safe to forget. */
  stale: string[];
  errors: string[];
};

/** Expo's error messages can quote a device's push token; these errors end up in the logs. */
function withoutTokens(message: string): string {
  return message.replace(/Expo(nent)?PushToken\[[^\]]*\]/g, 'ExponentPushToken[…]');
}

export async function sendPushes(messages: PushMessage[]): Promise<PushResult> {
  const result: PushResult = { delivered: [], stale: [], errors: [] };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN'); // only needed with Expo's enhanced push security
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default', priority: 'high' }))),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      result.errors.push(withoutTokens(`Expo push ${res.status}: ${(await res.text()).slice(0, 300)}`));
      continue;
    }
    const tickets = ((await res.json()) as { data?: Ticket[] }).data ?? [];
    tickets.forEach((ticket, j) => {
      const token = batch[j].to;
      if (ticket.status === 'ok') result.delivered.push(token);
      else if (ticket.details?.error === 'DeviceNotRegistered') result.stale.push(token);
      else result.errors.push(withoutTokens(`${ticket.details?.error ?? 'error'}: ${ticket.message}`));
    });
  }
  return result;
}

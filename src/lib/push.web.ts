// Web build: no remote push. The coach still writes a daily nudge that shows on Today.
export const PUSH_SUPPORTED = false;

export type PushRegistration =
  | { ok: true }
  | { ok: false; reason: 'no-project' | 'simulator' | 'denied' | 'failed' | 'unsupported' };

export async function registerForCoachPush(): Promise<PushRegistration> {
  return { ok: false, reason: 'unsupported' };
}

export async function unregisterCoachPush(): Promise<void> {}

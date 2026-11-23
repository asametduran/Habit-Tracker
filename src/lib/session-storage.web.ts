// Where Supabase keeps the signed-in session on web: localStorage. Guarded because the static
// export renders in Node (no `window`), and because browsers can block storage entirely.

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      storage()?.setItem(key, value);
    } catch {
      // Storage is full or blocked: the session lasts until the tab closes.
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      storage()?.removeItem(key);
    } catch {
      // Nothing to remove if storage is blocked.
    }
  },
};

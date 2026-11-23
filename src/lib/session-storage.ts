import * as SecureStore from 'expo-secure-store';

// Where Supabase keeps the signed-in session on native: the device keychain/keystore.
// SecureStore values are size-limited and a session is bigger than the limit, so it is
// stored in pieces: `<key>.n` holds the number of pieces, `<key>.0`, `<key>.1`, … the pieces.
// The web variant is session-storage.web.ts.

const CHUNK = 600; // characters; stays under the limit even if every one takes 3 bytes

/** SecureStore keys may only contain letters, digits, `.`, `-` and `_`. */
function safe(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function split(value: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < value.length; ) {
    let end = Math.min(start + CHUNK, value.length);
    const last = value.charCodeAt(end - 1);
    // Don't cut a surrogate pair (e.g. an emoji) in half.
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(value.slice(start, end));
    start = end;
  }
  return parts;
}

async function countOf(name: string): Promise<number> {
  const count = Number(await SecureStore.getItemAsync(`${name}.n`));
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    const name = safe(key);
    const count = await countOf(name);
    if (count === 0) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${name}.${i}`)),
    );
    return parts.some((part) => part === null) ? null : parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const name = safe(key);
    const previous = await countOf(name);
    const parts = split(value);
    for (let i = 0; i < parts.length; i++) {
      await SecureStore.setItemAsync(`${name}.${i}`, parts[i]);
    }
    await SecureStore.setItemAsync(`${name}.n`, String(parts.length));
    for (let i = parts.length; i < previous; i++) {
      await SecureStore.deleteItemAsync(`${name}.${i}`);
    }
  },

  async removeItem(key: string): Promise<void> {
    const name = safe(key);
    const count = await countOf(name);
    await SecureStore.deleteItemAsync(`${name}.n`);
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${name}.${i}`);
  },
};

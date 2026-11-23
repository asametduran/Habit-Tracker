import { router } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

// A look-alike of a phone notification, drawn inside the app. The browser can't receive the
// coach's real push, so on web (and from Settings → Developer tools) this shows what it would say.

type Preview = { id: number; title: string; body: string };

const SHOW_MS = 9000;

let current: Preview | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(preview: Preview | null) {
  current = preview;
  listeners.forEach((listener) => listener());
}

/** Shows a notification-style banner at the top of the screen for a few seconds. */
export function showPushPreview(content: { title: string; body: string }) {
  emit({ id: nextId++, ...content });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Mounted once, in the root layout. */
export function PushPreview() {
  const insets = useSafeAreaInsets();
  const preview = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => {
      if (current?.id === preview.id) emit(null);
    }, SHOW_MS);
    return () => clearTimeout(timer);
  }, [preview]);

  if (!preview) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + Spacing.two }]}>
      <Pressable
        onPress={() => {
          emit(null);
          router.navigate('/'); // a real tap on the push opens Today too
        }}
        accessibilityRole="alert"
        accessibilityLabel={`Notification: ${preview.title}. ${preview.body}`}
        style={styles.pressable}>
        <ThemedView type="backgroundElement" style={styles.card}>
          <Image source={require('@/assets/images/icon.png')} style={styles.icon} />
          <View style={styles.text}>
            <ThemedText type="small" themeColor="textSecondary">
              HabiTracker · now{Platform.OS === 'web' ? ' · preview' : ''}
            </ThemedText>
            <ThemedText type="smallBold">{preview.title}</ThemedText>
            <ThemedText type="small">{preview.body}</ThemedText>
          </View>
          <Pressable onPress={() => emit(null)} accessibilityLabel="Dismiss" hitSlop={10}>
            <ThemedText type="small" themeColor="textSecondary">
              ✕
            </ThemedText>
          </Pressable>
        </ThemedView>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    zIndex: 20,
    pointerEvents: 'box-none',
  },
  pressable: {
    width: '100%',
    maxWidth: Math.min(MaxContentWidth, 520),
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Spacing.two,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});

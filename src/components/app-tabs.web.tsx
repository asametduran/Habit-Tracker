import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { useSyncExternalStore, type Ref } from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  useWindowDimensions,
  type PressableInstance,
} from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';

const TABS = [
  { name: 'index', href: '/', label: 'Today' },
  { name: 'history', href: '/history', label: 'History' },
  { name: 'manage', href: '/manage', label: 'Manage' },
  { name: 'challenge', href: '/challenge', label: 'Challenge' },
  { name: 'settings', href: '/settings', label: 'Settings' },
] as const;

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton>{tab.label}</TabButton>
            </TabTrigger>
          ))}
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

const NARROW_WIDTH = 600;

const subscribe = () => () => {};

/**
 * Narrow layout below NARROW_WIDTH. The static HTML is rendered in Node, where the window has no
 * width, so it's narrow; the first browser render must match it (or React throws away the page
 * and renders it again), and the real width applies right after hydration.
 */
function useNarrow(): boolean {
  const width = useWindowDimensions().width;
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? width < NARROW_WIDTH : true;
}

export function TabButton({ children, isFocused, ref, ...props }: TabTriggerSlotProps) {
  const narrow = useNarrow();
  return (
    <Pressable
      {...props}
      // expo-router types this ref as Ref<View>, which React Native 0.88 no longer accepts
      // for a Pressable; at runtime it's the same host-element ref, passed straight through.
      ref={ref as unknown as Ref<PressableInstance>}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.tabButtonView, narrow && styles.tabButtonViewNarrow]}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const narrow = useNarrow();
  return (
    <View {...props} style={[styles.tabListContainer, narrow && styles.tabListContainerNarrow]}>
      <ThemedView
        type="backgroundElement"
        style={[styles.innerContainer, narrow && styles.innerContainerNarrow]}>
        {narrow ? null : (
          <ThemedText type="smallBold" style={styles.brandText}>
            HabiTracker
          </ThemedText>
        )}

        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  tabListContainerNarrow: {
    padding: Spacing.two,
  },
  innerContainerNarrow: {
    paddingHorizontal: Spacing.two,
    justifyContent: 'space-between',
    gap: 0,
  },
  tabButtonViewNarrow: {
    paddingHorizontal: Spacing.two,
  },
  brandText: {
    marginRight: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});

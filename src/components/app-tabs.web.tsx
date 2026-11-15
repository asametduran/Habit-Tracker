import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Pressable, View, StyleSheet, useWindowDimensions } from 'react-native';

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

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const narrow = useWindowDimensions().width < NARROW_WIDTH;
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
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
  const narrow = useWindowDimensions().width < NARROW_WIDTH;
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

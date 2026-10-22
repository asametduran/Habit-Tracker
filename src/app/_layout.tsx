import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { OnboardingScreen } from '@/components/onboarding-screen';
import { HabitsProvider, useHabits } from '@/hooks/use-habits';
import { useNotificationSync } from '@/hooks/use-notification-sync';

SplashScreen.preventAutoHideAsync();

/** Onboarding is a one-time gate rendered instead of the tabs until it's completed. */
function Root() {
  const { isLoaded, onboardingComplete } = useHabits();
  useNotificationSync();

  const showOnboarding = isLoaded && !onboardingComplete;

  if (Platform.OS === 'web') {
    // The navigator must be mounted from the first render, or a deep link / reload on e.g.
    // /settings loses its route and falls back to the first tab. Onboarding covers it instead.
    return (
      <>
        <AppTabs />
        {showOnboarding ? (
          <View style={styles.onboardingOverlay}>
            <OnboardingScreen />
          </View>
        ) : null}
      </>
    );
  }

  // Native tab bars can't be covered by a JS overlay, so swap instead.
  if (!isLoaded) return null; // the animated splash overlay covers this
  return showOnboarding ? <OnboardingScreen /> : <AppTabs />;
}

const styles = StyleSheet.create({
  onboardingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
});

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <HabitsProvider>
        <AnimatedSplashOverlay />
        <Root />
      </HabitsProvider>
    </ThemeProvider>
  );
}

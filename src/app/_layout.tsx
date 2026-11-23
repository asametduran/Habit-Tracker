import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { AuthScreen } from '@/components/auth-screen';
import { OnboardingScreen } from '@/components/onboarding-screen';
import { PushPreview } from '@/components/push-preview';
import { SyncNotice } from '@/components/sync-notice';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { useCoachPush } from '@/hooks/use-coach-push';
import { useFramed } from '@/hooks/use-framed';
import { HabitsProvider, useHabits, useSync } from '@/hooks/use-habits';
import { useNotificationSync } from '@/hooks/use-notification-sync';
import { useSimulatedCoachPush } from '@/hooks/use-simulated-coach-push';

SplashScreen.preventAutoHideAsync();

/** Covers the gap between signing in on a new device and its habits arriving. */
function RestoringScreen() {
  return (
    <ThemedView style={styles.restoring}>
      <ThemedText themeColor="textSecondary">Loading your habits…</ThemedText>
    </ThemedView>
  );
}

/**
 * The gates rendered instead of the tabs: onboarding (once), then sign-in whenever nobody is
 * signed in. Without a Supabase project configured there is no sign-in gate at all.
 */
function Root() {
  const { isLoaded, onboardingComplete } = useHabits();
  const { status, authRequested } = useAuth();
  const { restoring } = useSync();
  const coachPush = useCoachPush();
  useNotificationSync(coachPush?.ok === true);
  useSimulatedCoachPush();

  const ready = isLoaded && status !== 'loading';
  const showAuth = ready && status === 'signedOut' && (onboardingComplete || authRequested);
  // Signed in with nothing on this device yet: the account may already have habits, so wait
  // for it to answer before offering onboarding.
  const showRestoring = ready && status === 'signedIn' && !onboardingComplete && restoring;
  const showOnboarding = ready && !onboardingComplete && !showAuth && !showRestoring;

  const gate = showAuth ? (
    <AuthScreen />
  ) : showRestoring ? (
    <RestoringScreen />
  ) : showOnboarding ? (
    <OnboardingScreen />
  ) : null;

  if (Platform.OS === 'web') {
    // The navigator must be mounted from the first render, or a deep link / reload on e.g.
    // /settings loses its route and falls back to the first tab. The gates cover it instead.
    return (
      <>
        <AppTabs />
        {gate ? <View style={styles.gateOverlay}>{gate}</View> : <SyncNotice />}
      </>
    );
  }

  // Native tab bars can't be covered by a JS overlay, so swap instead.
  if (!ready) return null; // the animated splash overlay covers this
  return (
    gate ?? (
      <>
        <AppTabs />
        <SyncNotice />
      </>
    )
  );
}

const styles = StyleSheet.create({
  gateOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  restoring: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  framed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const framed = useFramed();
  // Inside another site's frame (clickjacking): show nothing clickable.
  if (framed) {
    return (
      <View style={styles.framed}>
        <ThemedText>HabiTracker can’t be used inside another site. Open it in its own tab.</ThemedText>
      </View>
    );
  }
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <HabitsProvider>
          <AnimatedSplashOverlay />
          <Root />
          <PushPreview />
        </HabitsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

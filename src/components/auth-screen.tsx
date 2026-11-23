import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { Captcha } from '@/components/captcha';
import { PasswordReset } from '@/components/password-reset';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Danger, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useHabits, useSync } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { captchaEnabled } from '@/lib/captcha';

const MIN_PASSWORD_LENGTH = 6;

/** Gate shown instead of the tabs while nobody is signed in. */
export function AuthScreen() {
  const theme = useTheme();
  const { signIn, signUp, cancelAuthRequest } = useAuth();
  const { onboardingComplete } = useHabits();
  const { hasAccount } = useSync();
  // Someone who just set up habits here has no account yet; anyone else is coming back to one.
  const [creating, setCreating] = useState(onboardingComplete && !hasAccount);
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // Turnstile: each token is accepted once, so every attempt asks the widget for a new one.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  if (resetting) {
    return (
      <PasswordReset
        initialEmail={email}
        onDone={() => {
          setResetting(false);
          setPassword('');
          setError(null);
          setInfo(null);
        }}
      />
    );
  }

  const canSubmit =
    email.includes('@') &&
    password.length >= MIN_PASSWORD_LENGTH &&
    !busy &&
    (!captchaEnabled || captchaToken !== null);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await (creating
      ? signUp(email, password, firstName, captchaToken)
      : signIn(email, password, captchaToken));
    setBusy(false);
    setCaptchaToken(null);
    setCaptchaKey((key) => key + 1);
    if (!result.ok) {
      setError(result.message);
    } else if (result.needsConfirmation) {
      setCreating(false);
      setPassword('');
      setInfo('Check your email to confirm, then sign in.');
    }
    // Otherwise the session is live and the root layout swaps this screen out.
  };

  const switchMode = () => {
    setCreating((current) => !current);
    setError(null);
    setInfo(null);
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  return (
    <Screen title={creating ? 'Create account' : 'Sign in'}>
      <ThemedText themeColor="textSecondary">
        {creating
          ? 'Your habits are saved to your account, so they’re safe and follow you to any device.'
          : 'Sign in to pick up your habits where you left off.'}
      </ThemedText>

      {creating ? (
        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First name (optional, for your coach)"
          placeholderTextColor={theme.textSecondary}
          style={inputStyle}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          maxLength={40}
          returnKeyType="next"
          accessibilityLabel="First name"
        />
      ) : null}
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        accessibilityLabel="Email"
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        placeholder="Password"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={creating ? 'new-password' : 'current-password'}
        textContentType={creating ? 'newPassword' : 'password'}
        returnKeyType="done"
        accessibilityLabel="Password"
      />
      {creating ? (
        <ThemedText type="small" themeColor="textSecondary">
          At least {MIN_PASSWORD_LENGTH} characters.
        </ThemedText>
      ) : (
        <Pressable
          onPress={() => setResetting(true)}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.forgot}>
          <ThemedText type="small" themeColor="textSecondary">
            Forgot password?
          </ThemedText>
        </Pressable>
      )}

      {error ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
      {info ? <ThemedText type="small">{info}</ThemedText> : null}

      <Captcha onToken={setCaptchaToken} resetKey={captchaKey} />
      <Button
        label={busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}
        disabled={!canSubmit}
        onPress={submit}
      />
      <Button
        label={creating ? 'I already have an account' : 'Create a new account'}
        variant="secondary"
        onPress={switchMode}
      />
      {onboardingComplete ? null : (
        <Button label="Back" variant="secondary" onPress={cancelAuthRequest} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: '#60646C',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  error: {
    color: Danger,
  },
  forgot: {
    alignSelf: 'flex-end',
  },
});

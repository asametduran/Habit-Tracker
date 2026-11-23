import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { Captcha } from '@/components/captcha';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Danger, Spacing } from '@/constants/theme';
import { useAuth, type AuthResult } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { captchaEnabled } from '@/lib/captcha';

const MIN_PASSWORD_LENGTH = 6;

/** Supabase's email codes are 6 digits by default; the project setting allows up to 10. */
const CODE = /^\d{6,10}$/;

type Step = 'email' | 'code' | 'password';

/**
 * "Forgot password?": email → code from the email → new password. Shown by AuthScreen; once the
 * new password is saved the user is signed in and the root layout swaps this screen out.
 */
export function PasswordReset({ initialEmail, onDone }: { initialEmail: string; onDone: () => void }) {
  const theme = useTheme();
  const { sendPasswordReset, verifyPasswordReset, setNewPassword, cancelPasswordReset } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Turnstile (sending the code is CAPTCHA-protected): one token per send.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const cleanCode = code.replace(/\s/g, '');
  const canSend = email.includes('@') && !busy && (!captchaEnabled || captchaToken !== null);
  const canVerify = CODE.test(cleanCode) && !busy;
  const canSave = password.length >= MIN_PASSWORD_LENGTH && !busy;

  const run = async (action: () => Promise<AuthResult>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.message);
    return result.ok;
  };

  const send = async () => {
    if (!canSend) return;
    const sent = await run(() => sendPasswordReset(email, captchaToken));
    setCaptchaToken(null);
    setCaptchaKey((key) => key + 1);
    if (sent) {
      setStep('code');
      setInfo(`If ${email.trim()} has an account, a code is on its way. Check your spam folder too.`);
    }
  };

  // A new code needs a new security check, which lives on the email step.
  const resend = captchaEnabled
    ? () => {
        setStep('email');
        setError(null);
        setInfo('Let the check finish, then send a new code.');
      }
    : send;

  const verify = async () => {
    if (!canVerify) return;
    if (await run(() => verifyPasswordReset(email, cleanCode))) setStep('password');
  };

  const save = async () => {
    if (!canSave) return;
    await run(() => setNewPassword(password));
    // On success the user is signed in and this screen goes away.
  };

  const leave = async () => {
    await cancelPasswordReset();
    onDone();
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];
  const messages = (
    <>
      {error ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
      {info ? <ThemedText type="small">{info}</ThemedText> : null}
    </>
  );

  if (step === 'email') {
    return (
      <Screen title="Reset password">
        <ThemedText themeColor="textSecondary">
          Enter the email you signed up with and we’ll send you a code to set a new password.
        </ThemedText>
        <TextInput
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={send}
          placeholder="Email"
          placeholderTextColor={theme.textSecondary}
          style={inputStyle}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="send"
          accessibilityLabel="Email"
        />
        {messages}
        <Captcha onToken={setCaptchaToken} resetKey={captchaKey} />
        <Button label={busy ? 'One moment…' : 'Send code'} disabled={!canSend} onPress={send} />
        <Button label="Back to sign in" variant="secondary" onPress={onDone} />
      </Screen>
    );
  }

  if (step === 'code') {
    return (
      <Screen title="Check your email">
        <ThemedText themeColor="textSecondary">Enter the code from the email.</ThemedText>
        <TextInput
          value={code}
          onChangeText={setCode}
          onSubmitEditing={verify}
          placeholder="Code"
          placeholderTextColor={theme.textSecondary}
          style={[inputStyle, styles.code]}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="one-time-code"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={12}
          returnKeyType="done"
          accessibilityLabel="Code from the email"
        />
        {messages}
        <Button label={busy ? 'Checking…' : 'Continue'} disabled={!canVerify} onPress={verify} />
        <Pressable onPress={resend} disabled={busy} accessibilityRole="button" hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary">
            Didn’t get it? Send a new code
          </ThemedText>
        </Pressable>
        <Button
          label="Use a different email"
          variant="secondary"
          onPress={() => {
            setStep('email');
            setCode('');
            setError(null);
            setInfo(null);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="New password">
      <ThemedText themeColor="textSecondary">
        Choose a new password for {email.trim()}. You’ll be signed in right after.
      </ThemedText>
      <TextInput
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={save}
        placeholder="New password"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        accessibilityLabel="New password"
      />
      <ThemedText type="small" themeColor="textSecondary">
        At least {MIN_PASSWORD_LENGTH} characters.
      </ThemedText>
      {messages}
      <Button label={busy ? 'Saving…' : 'Save and sign in'} disabled={!canSave} onPress={save} />
      <Button label="Cancel" variant="secondary" onPress={leave} />
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
  code: {
    fontSize: 22,
    letterSpacing: 6,
  },
  error: {
    color: Danger,
  },
});

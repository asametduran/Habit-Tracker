import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Android sizes each line from the main font whenever a fixed lineHeight is set, so an emoji
// (drawn from the taller emoji font) gets its top cut off. Without a lineHeight Android makes
// room for the emoji font, so on Android, text that contains an emoji drops it. Covers the
// symbol blocks (✨ ✅ ⭐) and everything outside the Basic Multilingual Plane (🔥 🎉 📅).
const EMOJI = /[⌀-➿⬅-⭕]|[\uD83C-\uD83E][\uDC00-\uDFFF]/;
const FIT_EMOJI = { lineHeight: undefined };

function hasEmoji(children: ReactNode): boolean {
  if (typeof children === 'string') return EMOJI.test(children);
  if (Array.isArray(children)) return children.some(hasEmoji);
  return false;
}

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
        Platform.OS === 'android' && hasEmoji(rest.children) && FIT_EMOJI,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});

import { ReactNode } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';
import { useAppearance } from '@/lib/appearance-context';

const MAX_APP_WIDTH = 480;

export default function MobileFrame({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const { isDesktop } = useDesktopLayout();
  const { colors, resolvedTheme } = useAppearance();

  if (isDesktop) {
    return <>{children}</>;
  }

  if (Platform.OS !== 'web' || width <= MAX_APP_WIDTH) {
    return <>{children}</>;
  }

  const frameBg = resolvedTheme === 'dark' ? '#080C14' : '#E8ECF0';
  const borderColor = resolvedTheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  return (
    <View style={[styles.outerContainer, { backgroundColor: frameBg }]}>
      <View style={[styles.appContainer, { borderColor }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appContainer: {
    width: '100%',
    maxWidth: MAX_APP_WIDTH,
    height: '100%',
    overflow: 'hidden',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});

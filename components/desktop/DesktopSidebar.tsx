import { ReactNode } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useAppearance } from '@/lib/appearance-context';
import DesktopIconRail from '@/components/desktop/DesktopIconRail';

interface DesktopSidebarProps {
  children?: ReactNode;
}

export default function DesktopSidebar({ children }: DesktopSidebarProps) {
  const { colors } = useAppearance();

  return (
    <View
      style={[
        styles.container,
        {
          borderRightColor: colors.border,
          backgroundColor: colors.background,
        },
      ]}
    >
      <DesktopIconRail />
      <View
        style={[
          styles.contentPanel,
          { backgroundColor: colors.background },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 420,
    minWidth: 360,
    maxWidth: 500,
    flexDirection: 'row',
    borderRightWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      web: { transition: 'width 0.15s ease' },
      default: {},
    }) as any,
  },
  contentPanel: {
    flex: 1,
    overflow: 'hidden',
  },
});

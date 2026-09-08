import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppearance } from '@/lib/appearance-context';
import CachedImage from '@/components/CachedImage';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

const SIZE_MAP: Record<AvatarSize, number> = {
  xs: 34,
  sm: 38,
  md: 50,
  lg: 72,
  xl: 110,
  xxl: 150,
};

const FONT_MAP: Record<AvatarSize, number> = {
  xs: 14,
  sm: 15,
  md: 19,
  lg: 24,
  xl: 42,
  xxl: 56,
};

const ONLINE_SIZE_MAP: Record<AvatarSize, number> = {
  xs: 10,
  sm: 11,
  md: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
};

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: AvatarSize;
  showOnline?: boolean;
  isOnline?: boolean;
  variant?: 'default' | 'primary';
  icon?: React.ReactNode;
}

export default memo(function Avatar({
  uri,
  name,
  size = 'md',
  showOnline = false,
  isOnline = false,
  variant = 'default',
  icon,
}: AvatarProps) {
  const { colors } = useAppearance();
  const px = SIZE_MAP[size];
  const fontSize = FONT_MAP[size];
  const onlineSize = ONLINE_SIZE_MAP[size];
  const letter = (name || '?')[0].toUpperCase();

  const isPrimary = variant === 'primary';
  const placeholderBg = isPrimary ? colors.primary : colors.surfaceTertiary;
  const placeholderColor = isPrimary ? '#FFFFFF' : colors.text;

  return (
    <View style={[styles.container, { width: px, height: px }]}>
      {uri ? (
        <CachedImage
          uri={uri}
          style={[styles.image, { width: px, height: px, borderRadius: px / 2 }]}
        />
      ) : (
        <View
          style={[
            styles.placeholder,
            { width: px, height: px, borderRadius: px / 2, backgroundColor: placeholderBg },
          ]}
        >
          {icon || (
            <Text style={[styles.letter, { fontSize, color: placeholderColor }]}>
              {letter}
            </Text>
          )}
        </View>
      )}
      {showOnline && isOnline && (
        <View
          style={[
            styles.online,
            {
              width: onlineSize,
              height: onlineSize,
              borderRadius: onlineSize / 2,
              borderWidth: 2.5,
              backgroundColor: colors.online,
              borderColor: colors.background,
            },
          ]}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  image: {
    overflow: 'hidden',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  letter: {
    fontWeight: '700',
  },
  online: {
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
});

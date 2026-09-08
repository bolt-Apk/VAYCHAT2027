import { useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import {
  MessageCircle,
  Users,
  Phone,
  Settings,
} from 'lucide-react-native';
import { useAppearance } from '@/lib/appearance-context';
import { useDesktopChat, SidebarTab } from '@/lib/desktop-chat-context';
import { useAuth } from '@/lib/auth-context';
import Avatar from '@/components/Avatar';

const TABS: { key: SidebarTab; icon: typeof MessageCircle; label: string }[] = [
  { key: 'chats', icon: MessageCircle, label: 'Чаты' },
  { key: 'contacts', icon: Users, label: 'Контакты' },
  { key: 'calls', icon: Phone, label: 'Звонки' },
  { key: 'settings', icon: Settings, label: 'Настройки' },
];

function TabButton({
  tab,
  isActive,
  onPress,
}: {
  tab: (typeof TABS)[number];
  isActive: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppearance();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [hovered, setHovered] = useState(false);

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  }, [scaleAnim]);

  const Icon = tab.icon;
  const iconColor = isActive ? colors.primary : hovered ? colors.textSecondary : colors.textTertiary;

  return (
    <View style={styles.tabButtonWrapper}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityLabel={tab.label}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        {...(Platform.OS === 'web' ? {
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        } as any : {})}
      >
        <Animated.View
          style={[
            styles.tabButton,
            isActive && { backgroundColor: colors.primary + '18' },
            !isActive && hovered && { backgroundColor: colors.textTertiary + '12' },
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          {isActive && <View style={[styles.activeIndicator, { backgroundColor: colors.primary }]} />}
          <Icon size={21} color={iconColor} strokeWidth={isActive ? 2.2 : 1.6} />
        </Animated.View>
      </TouchableOpacity>
      {hovered && Platform.OS === 'web' && (
        <View style={[styles.tooltip, { backgroundColor: colors.surfaceTertiary }]} pointerEvents="none">
          <Text style={[styles.tooltipText, { color: colors.text }]}>{tab.label}</Text>
        </View>
      )}
    </View>
  );
}

function UserAvatar() {
  const { user } = useAuth();

  const avatarUrl = user?.user_metadata?.avatar_url;
  const displayName: string =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email ||
    '';

  return (
    <Avatar
      uri={avatarUrl || undefined}
      name={displayName || '?'}
      size="sm"
      variant="primary"
    />
  );
}

export default function DesktopIconRail() {
  const { colors } = useAppearance();
  const { activeSidebarTab, setSidebarTab } = useDesktopChat();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.backgroundSecondary,
          borderRightColor: colors.border,
        },
      ]}
    >
      <View style={styles.logoSection}>
        <View style={[styles.logoCircle, { backgroundColor: colors.primary }]}>
          <Text style={styles.logoText}>V</Text>
        </View>
      </View>

      <View style={styles.tabsSection}>
        {TABS.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            isActive={activeSidebarTab === tab.key}
            onPress={() => setSidebarTab(tab.key)}
          />
        ))}
      </View>

      <View style={styles.bottomSection}>
        <UserAvatar />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 64,
    borderRightWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    paddingVertical: 10,
  },
  logoSection: {
    paddingTop: 4,
    paddingBottom: 18,
    alignItems: 'center',
  },
  logoCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  tabsSection: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  tabButtonWrapper: {
    position: 'relative',
  },
  tabButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderRadius: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.15s ease' } as any : {}),
  },
  activeIndicator: {
    position: 'absolute',
    left: -2,
    width: 3,
    height: 18,
    borderRadius: 2,
  },
  tooltip: {
    position: 'absolute',
    left: 52,
    top: '50%',
    marginTop: -14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.18)' },
      default: {},
    }) as any,
  },
  tooltipText: {
    fontSize: 12,
    fontWeight: '500',
    whiteSpace: 'nowrap',
  } as any,
  bottomSection: {
    paddingTop: 12,
    alignItems: 'center',
  },
});

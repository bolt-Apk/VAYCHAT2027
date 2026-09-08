import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, AppState, Platform, TouchableOpacity, Animated, Easing, Pressable, Modal } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { MessageCircle, Users, Phone, Settings, Check, UserPlus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { useAppearance } from '@/lib/appearance-context';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';
import { ScrollToTopProvider, useScrollToTopTrigger } from '@/lib/scroll-to-top-context';
import CachedImage from '@/components/CachedImage';
import { useRouter } from 'expo-router';
import { StoredAccount } from '@/lib/multi-account';

function AnimatedPhoneIcon({ color, focused }: { color: string; focused: boolean }) {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const prevFocused = useRef(false);

  useEffect(() => {
    if (focused && !prevFocused.current) {
      Animated.sequence([
        Animated.timing(rotateAnim, { toValue: 1, duration: 80, useNativeDriver: true, easing: Easing.linear }),
        Animated.timing(rotateAnim, { toValue: -1, duration: 80, useNativeDriver: true, easing: Easing.linear }),
        Animated.timing(rotateAnim, { toValue: 1, duration: 80, useNativeDriver: true, easing: Easing.linear }),
        Animated.timing(rotateAnim, { toValue: -1, duration: 80, useNativeDriver: true, easing: Easing.linear }),
        Animated.timing(rotateAnim, { toValue: 0, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      ]).start();
    }
    prevFocused.current = focused;
  }, [focused]);

  const rotate = rotateAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-15deg', '0deg', '15deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Phone color={color} size={24} strokeWidth={focused ? 2.2 : 1.8} />
    </Animated.View>
  );
}

function AnimatedUsersIcon({ color, focused }: { color: string; focused: boolean }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const prevFocused = useRef(false);

  useEffect(() => {
    if (focused && !prevFocused.current) {
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.25, duration: 150, useNativeDriver: true, easing: Easing.out(Easing.back(3)) }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
      ]).start();
    }
    prevFocused.current = focused;
  }, [focused]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Users color={color} size={24} strokeWidth={focused ? 2.2 : 1.8} />
    </Animated.View>
  );
}

function AnimatedSettingsIcon({ color, focused }: { color: string; focused: boolean }) {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const prevFocused = useRef(false);

  useEffect(() => {
    if (focused && !prevFocused.current) {
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start(() => rotateAnim.setValue(0));
    }
    prevFocused.current = focused;
  }, [focused]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Settings color={color} size={24} strokeWidth={focused ? 2.2 : 1.8} />
    </Animated.View>
  );
}

function ChatTabIcon({ color, focused }: { color: string; size: number; focused: boolean }) {
  const { user } = useAuth();
  const { colors } = useAppearance();
  const [unreadTotal, setUnreadTotal] = useState(0);
  const mountedRef = useRef(true);
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const prevFocused = useRef(false);

  useEffect(() => {
    if (focused && !prevFocused.current) {
      Animated.sequence([
        Animated.timing(translateYAnim, { toValue: -4, duration: 120, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(translateYAnim, { toValue: 1, duration: 100, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(translateYAnim, { toValue: 0, duration: 80, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
      ]).start();
    }
    prevFocused.current = focused;
  }, [focused]);

  const loadUnreadCount = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: memberships } = await supabase
        .from('conversation_members')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id);
      if (!mountedRef.current) return;
      if (!memberships?.length) { setUnreadTotal(0); return; }

      const convIds = memberships.map(m => m.conversation_id);
      const { data, error } = await supabase.rpc('get_unread_counts' as any, {
        p_user_id: user.id,
        p_conversation_ids: convIds,
      });
      if (!mountedRef.current) return;

      if (!error && Array.isArray(data)) {
        const total = data.reduce((sum: number, r: any) => sum + (r.cnt || 0), 0);
        setUnreadTotal(total);
        if (Platform.OS !== 'web') {
          Notifications.setBadgeCountAsync(total).catch(() => {});
        }
        return;
      }

      let total = 0;
      for (let i = 0; i < memberships.length; i += 10) {
        const chunk = memberships.slice(i, i + 10);
        const counts = await Promise.all(
          chunk.map(async (m) => {
            let query = supabase
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .eq('conversation_id', m.conversation_id)
              .neq('sender_id', user.id)
              .is('deleted_at', null);
            if (m.last_read_at) query = query.gt('created_at', m.last_read_at);
            const { count } = await query;
            return count || 0;
          })
        );
        total += counts.reduce((a, b) => a + b, 0);
      }
      if (mountedRef.current) setUnreadTotal(prev => prev === total ? prev : total);
      if (Platform.OS !== 'web') {
        Notifications.setBadgeCountAsync(total).catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to load unread count:', e);
    }
  }, [user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    loadUnreadCount();

    const interval = setInterval(loadUnreadCount, 10000);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadUnreadCount();
    });

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      sub.remove();
    };
  }, [loadUnreadCount]);

  return (
    <Animated.View style={{ transform: [{ translateY: translateYAnim }] }}>
      <MessageCircle
        color={color}
        size={24}
        strokeWidth={focused ? 2.2 : 1.8}
      />
      {unreadTotal > 0 && (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeText}>{unreadTotal > 99 ? '99+' : unreadTotal}</Text>
        </View>
      )}
    </Animated.View>
  );
}

function TabBarButton({ children, onPress, accessibilityState, colors, accessibilityLabel }: any) {
  const focused = accessibilityState?.selected;
  const label = (accessibilityLabel || '').split(',')[0].trim();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pillAnim = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(pillAnim, {
      toValue: focused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [focused]);

  const handlePressIn = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  };

  const pillBg = pillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', `${colors.primary}18`],
  });

  const pillWidth = pillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      style={styles.tabButton}
    >
      <Animated.View style={[styles.tabButtonInner, { transform: [{ scale: scaleAnim }] }]}>
        <Animated.View
          style={[
            styles.activePill,
            {
              backgroundColor: pillBg,
              width: pillWidth,
            },
          ]}
        />
        {children}
        {label ? (
          <Text
            style={[
              styles.tabLabel,
              {
                color: focused ? colors.primary : colors.textTertiary,
                fontWeight: focused ? '600' : '500',
              },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        ) : null}
      </Animated.View>
    </TouchableOpacity>
  );
}

function ProfileTabButton({ children, onPress, accessibilityState, colors, accessibilityLabel }: any) {
  const focused = accessibilityState?.selected;
  const label = (accessibilityLabel || '').split(',')[0].trim();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pillAnim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const { accounts, switchAccount, user, startAddAccount } = useAuth();
  const { colors: themeColors } = useAppearance();
  const router = useRouter();
  const [menuVisible, setMenuVisible] = useState(false);
  const menuScaleAnim = useRef(new Animated.Value(0)).current;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    Animated.timing(pillAnim, {
      toValue: focused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [focused]);

  const showMenu = () => {
    if (accounts.length < 1) return;
    setMenuVisible(true);
    Animated.spring(menuScaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 200,
      friction: 15,
    }).start();
  };

  const hideMenu = () => {
    Animated.timing(menuScaleAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
      easing: Easing.in(Easing.quad),
    }).start(() => setMenuVisible(false));
  };

  const handlePressIn = () => {
    didLongPressRef.current = false;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();

    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      showMenu();
    }, 400);
  };

  const handlePressOut = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  };

  const handlePress = () => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }
    onPress?.();
  };

  const handleSwitchAccount = (userId: string) => {
    hideMenu();
    setTimeout(() => switchAccount(userId), 200);
  };

  const MAX_ACCOUNTS = 3;
  const [limitAlertVisible, setLimitAlertVisible] = useState(false);

  const handleAddAccount = () => {
    if (accounts.length >= MAX_ACCOUNTS) {
      hideMenu();
      setTimeout(() => setLimitAlertVisible(true), 200);
      return;
    }
    hideMenu();
    setTimeout(() => {
      startAddAccount();
      router.push('/login');
    }, 200);
  };

  const pillBg = pillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', `${colors.primary}18`],
  });

  const pillWidth = pillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });

  return (
    <>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={styles.tabButton}
      >
        <Animated.View style={[styles.tabButtonInner, { transform: [{ scale: scaleAnim }] }]}>
          <Animated.View
            style={[
              styles.activePill,
              {
                backgroundColor: pillBg,
                width: pillWidth,
              },
            ]}
          />
          {children}
          {label ? (
            <Text
              style={[
                styles.tabLabel,
                {
                  color: focused ? colors.primary : colors.textTertiary,
                  fontWeight: focused ? '600' : '500',
                },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          ) : null}
          {accounts.length > 1 && (
            <View style={[styles.multiAccountDot, { backgroundColor: colors.primary }]} />
          )}
        </Animated.View>
      </TouchableOpacity>

      {menuVisible && (
        <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={hideMenu}>
          <Pressable style={styles.menuOverlay} onPress={hideMenu}>
            <Animated.View
              style={[
                styles.menuContainer,
                {
                  backgroundColor: themeColors.backgroundSecondary,
                  borderColor: themeColors.border,
                  transform: [{ scale: menuScaleAnim }],
                  opacity: menuScaleAnim,
                },
              ]}
            >
              <Text style={[styles.menuTitle, { color: themeColors.textSecondary }]}>Аккаунты</Text>
              {accounts.map((acc: StoredAccount) => {
                const isActive = acc.userId === user?.id;
                return (
                  <Pressable
                    key={acc.userId}
                    style={({ pressed }) => [
                      styles.menuItem,
                      pressed && { backgroundColor: themeColors.border + '40' },
                      isActive && { backgroundColor: themeColors.primary + '10' },
                    ]}
                    onPress={() => {
                      if (!isActive) handleSwitchAccount(acc.userId);
                      else hideMenu();
                    }}
                  >
                    {acc.avatarUrl ? (
                      <CachedImage uri={acc.avatarUrl} style={styles.menuAvatar} />
                    ) : (
                      <View style={[styles.menuAvatar, styles.menuAvatarPlaceholder, { backgroundColor: themeColors.primary }]}>
                        <Text style={styles.menuAvatarLetter}>{(acc.displayName || '?').charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={styles.menuAccountInfo}>
                      <Text style={[styles.menuAccountName, { color: themeColors.text }]} numberOfLines={1}>
                        {acc.displayName || 'Без имени'}
                      </Text>
                      <Text style={[styles.menuAccountPhone, { color: themeColors.textTertiary }]} numberOfLines={1}>
                        {acc.phone}
                      </Text>
                    </View>
                    {isActive && <Check color={themeColors.primary} size={16} />}
                  </Pressable>
                );
              })}
              <View style={[styles.menuDivider, { backgroundColor: themeColors.border }]} />
              <Pressable
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && { backgroundColor: themeColors.border + '40' },
                ]}
                onPress={handleAddAccount}
              >
                <View style={[styles.menuAddIcon, { backgroundColor: themeColors.primary + '15' }]}>
                  <UserPlus color={themeColors.primary} size={16} />
                </View>
                <Text style={[styles.menuAddText, { color: themeColors.primary }]}>Добавить аккаунт</Text>
              </Pressable>
            </Animated.View>
          </Pressable>
        </Modal>
      )}

      {limitAlertVisible && (
        <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => setLimitAlertVisible(false)}>
          <Pressable style={[styles.menuOverlay, { justifyContent: 'center', paddingBottom: 0 }]} onPress={() => setLimitAlertVisible(false)}>
            <View style={[styles.limitAlertContainer, { backgroundColor: themeColors.backgroundSecondary, borderColor: themeColors.border }]}>
              <Text style={[styles.limitAlertTitle, { color: themeColors.text }]}>Достигнут лимит</Text>
              <Text style={[styles.limitAlertMessage, { color: themeColors.textSecondary }]}>
                Максимум 3 аккаунта. Чтобы добавить новый, выйдите из одного из текущих аккаунтов.
              </Text>
              <Pressable
                style={[styles.limitAlertButton, { backgroundColor: themeColors.primary }]}
                onPress={() => setLimitAlertVisible(false)}
              >
                <Text style={styles.limitAlertButtonText}>Понятно</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

export default function TabLayout() {
  return (
    <ScrollToTopProvider>
      <TabLayoutInner />
    </ScrollToTopProvider>
  );
}

function TabLayoutInner() {
  const { colors, resolvedTheme } = useAppearance();
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'web' ? 8 : 0);
  const { isDesktop } = useDesktopLayout();
  const triggerScrollToTop = useScrollToTopTrigger();
  const activeTabRef = useRef('index');

  const tabBarStyle = useMemo(() => isDesktop ? { display: 'none' as any } : {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Platform.OS === 'web' ? colors.tabBar : 'transparent',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.tabBarBorder,
    borderRadius: 0,
    height: 50 + bottomPadding,
    paddingBottom: bottomPadding,
    paddingTop: 0,
    elevation: 0,
    shadowOpacity: 0,
    overflow: 'hidden' as const,
  }, [isDesktop, colors.tabBar, colors.tabBarBorder, bottomPadding]);

  const tabBarBackground = useCallback(() =>
    Platform.OS !== 'web' ? (
      <BlurView
        intensity={80}
        tint={resolvedTheme === 'dark' ? 'dark' : 'light'}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.tabBar + 'CC' }]}
      />
    ) : null,
  [resolvedTheme, colors.tabBar]);

  const tabBarButton = useCallback((props: any) => {
    return <TabBarButton {...props} colors={colors} />;
  }, [colors]);

  const screenOptions = useMemo(() => ({
    headerShown: false,
    tabBarStyle,
    tabBarBackground,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.textTertiary,
    tabBarShowLabel: false,
    tabBarButton,
  }), [tabBarStyle, tabBarBackground, colors.primary, colors.textTertiary, tabBarButton]);

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="calls"
        options={{
          title: 'Звонки',
          tabBarIcon: ({ color, focused }) => (
            <AnimatedPhoneIcon color={color} focused={focused} />
          ),
        }}
        listeners={{
          tabPress: () => {
            if (activeTabRef.current === 'calls') triggerScrollToTop('calls');
            activeTabRef.current = 'calls';
          },
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Контакты',
          tabBarIcon: ({ color, focused }) => (
            <AnimatedUsersIcon color={color} focused={focused} />
          ),
        }}
        listeners={{
          tabPress: () => {
            if (activeTabRef.current === 'contacts') triggerScrollToTop('contacts');
            activeTabRef.current = 'contacts';
          },
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Чаты',
          tabBarIcon: ({ color, size, focused }) => (
            <ChatTabIcon color={color} size={size} focused={focused} />
          ),
        }}
        listeners={{
          tabPress: () => {
            if (activeTabRef.current === 'index') triggerScrollToTop('index');
            activeTabRef.current = 'index';
          },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Профиль',
          tabBarIcon: ({ color, focused }) => (
            <AnimatedSettingsIcon color={color} focused={focused} />
          ),
          tabBarButton: (props: any) => {
            return <ProfileTabButton {...props} colors={colors} />;
          },
        }}
        listeners={{
          tabPress: () => {
            if (activeTabRef.current === 'profile') triggerScrollToTop('profile');
            activeTabRef.current = 'profile';
          },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -14,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    position: 'relative',
  },
  activePill: {
    position: 'absolute',
    top: 0,
    height: 3,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    zIndex: 0,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.1,
    marginTop: 1,
  },
  multiAccountDot: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 80,
    paddingHorizontal: 16,
  },
  menuContainer: {
    alignSelf: 'flex-end',
    borderRadius: 16,
    paddingVertical: 8,
    minWidth: 240,
    maxWidth: 300,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  menuTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  menuAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  menuAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuAvatarLetter: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  menuAccountInfo: {
    flex: 1,
  },
  menuAccountName: {
    fontSize: 14,
    fontWeight: '500',
  },
  menuAccountPhone: {
    fontSize: 12,
    marginTop: 1,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  menuAddIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuAddText: {
    fontSize: 14,
    fontWeight: '500',
  },
  limitAlertContainer: {
    alignSelf: 'center',
    borderRadius: 16,
    padding: 24,
    minWidth: 260,
    maxWidth: 300,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
    alignItems: 'center',
  },
  limitAlertTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
  limitAlertMessage: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  limitAlertButton: {
    paddingHorizontal: 32,
    paddingVertical: 10,
    borderRadius: 10,
  },
  limitAlertButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet,
  Modal, Pressable, ScrollView, Animated, Platform,
} from 'react-native';
import CachedImage from '@/components/CachedImage';
import { ChannelPostSkeleton } from '@/components/Skeleton';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useAppearance } from '@/lib/appearance-context';
import { Users, X, ArrowLeft, Eye, Megaphone, Play, ChevronRight, Bell, BellOff, Share2 } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_INVITE_KEY } from '@/lib/pending-invite';
import { pluralize } from '@/lib/pluralize';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '@/components/Avatar';

interface ChannelPost {
  id: string;
  content: string;
  created_at: string;
  message_type: string;
  media_url: string | null;
  media_type: string | null;
  view_count: number;
}

function pluralizeSubscribers(n: number): string {
  return pluralize(n, 'подписчик', 'подписчика', 'подписчиков');
}

function formatPostDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} дн назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const AVATAR_SIZE = 100;
const STICKY_THRESHOLD = 180;

export default function ChannelByIdScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<{ id: string; name: string; avatar_url: string | null; description: string | null; username: string | null; is_verified?: boolean; subscriber_count: number } | null>(null);
  const [avatarFullscreen, setAvatarFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [posts, setPosts] = useState<ChannelPost[]>([]);

  const scrollY = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (!id) {
      setError('Неверная ссылка');
      setLoading(false);
      return;
    }
    loadChannelAndPosts(id);
  }, [id]);

  useEffect(() => {
    if (!user || !channel) return;
    checkSubscription(channel.id);
  }, [user, channel]);

  useEffect(() => {
    if (!loading && channel) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [loading, channel]);

  async function loadChannelAndPosts(channelId: string) {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('conversations')
      .select('id, name, avatar_url, description, username, is_verified')
      .eq('type', 'channel')
      .eq('id', channelId)
      .maybeSingle();

    if (err || !data) {
      setError('Канал не найден');
      setLoading(false);
      return;
    }

    const [countResult, postsResult] = await Promise.all([
      supabase
        .from('conversation_members')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', data.id),
      supabase
        .from('messages')
        .select('id, content, created_at, message_type, media_url, media_type')
        .eq('conversation_id', channelId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    setChannel({ ...data, subscriber_count: countResult.count || 0 });

    if (postsResult.data) {
      const postIds = postsResult.data.map(p => p.id);
      let viewCounts: Record<string, number> = {};
      if (postIds.length > 0) {
        const { data: views } = await supabase
          .from('message_views')
          .select('message_id')
          .in('message_id', postIds);
        if (views) {
          for (const v of views) {
            viewCounts[v.message_id] = (viewCounts[v.message_id] || 0) + 1;
          }
        }
      }
      setPosts(postsResult.data.map(p => ({
        ...p,
        view_count: viewCounts[p.id] || 0,
      })));
    }

    setLoading(false);
  }

  async function checkSubscription(channelId: string) {
    if (!user) return;
    const { data } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('conversation_id', channelId)
      .eq('user_id', user.id)
      .maybeSingle();
    setIsSubscribed(!!data);
  }

  async function handleSubscribe() {
    if (!channel) return;
    if (!user) {
      await AsyncStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ type: 'channel', id: channel.id }));
      router.push('/login');
      return;
    }
    setSubscribing(true);
    setError(null);
    try {
      const { error: memErr } = await supabase
        .from('conversation_members')
        .upsert({ conversation_id: channel.id, user_id: user.id, role: 'member' }, { onConflict: 'conversation_id,user_id' });
      if (memErr && memErr.code !== '23505') {
        setError('Не удалось подписаться. Попробуйте позже.');
        setSubscribing(false);
        return;
      }
      setIsSubscribed(true);
      setChannel(prev => prev ? { ...prev, subscriber_count: prev.subscriber_count + 1 } : prev);
      await loadChannelAndPosts(channel.id);
    } catch {
      setError('Ошибка сети. Проверьте подключение.');
    } finally {
      setSubscribing(false);
    }
  }

  function handleOpenChannel() {
    if (!channel) return;
    router.replace({ pathname: '/chat/[id]', params: { id: channel.id } });
  }

  if (loading || authLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { paddingTop: insets.top + 8, borderBottomColor: colors.border + '30' }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <ChannelPostSkeleton count={3} color={colors.skeleton || 'rgba(255,255,255,0.06)'} />
      </View>
    );
  }

  if (error && !channel) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { paddingTop: insets.top + 8, borderBottomColor: colors.border + '30' }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <View style={[styles.errorIcon, { backgroundColor: `${colors.error}15` }]}>
            <Megaphone color={colors.error} size={32} />
          </View>
          <Text style={[styles.errorTitle, { color: colors.text }]}>Канал не найден</Text>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.primaryButtonText}>На главную</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sticky compact header */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.stickyHeader,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            opacity: scrollY.interpolate({ inputRange: [STICKY_THRESHOLD - 40, STICKY_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [{ translateY: scrollY.interpolate({ inputRange: [STICKY_THRESHOLD - 40, STICKY_THRESHOLD], outputRange: [-8, 0], extrapolate: 'clamp' }) }],
          },
        ]}
      >
        <View style={styles.stickyInner} pointerEvents="auto">
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>
          <View style={styles.stickyCenter}>
            {channel?.avatar_url ? (
              <Avatar uri={channel.avatar_url} name={channel.name} size="xs" />
            ) : (
              <View style={[styles.stickyAvatarPlaceholder, { backgroundColor: colors.primary + '15' }]}>
                <Megaphone color={colors.primary} size={14} />
              </View>
            )}
            <Text style={[styles.stickyName, { color: colors.text }]} numberOfLines={1}>{channel?.name}</Text>
            {channel?.is_verified && (
              <View style={styles.verifiedBadgeSm}>
                <View style={styles.verifiedCheckmarkSm} />
              </View>
            )}
          </View>
          <View style={{ width: 40 }} />
        </View>
      </Animated.View>

      {/* Static top bar (fades out when sticky appears) */}
      <Animated.View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + 8,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1,
            opacity: scrollY.interpolate({ inputRange: [STICKY_THRESHOLD - 60, STICKY_THRESHOLD - 20], outputRange: [1, 0], extrapolate: 'clamp' }),
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <View style={{ width: 40 }} />
      </Animated.View>

      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== 'web' })}
      >
        {/* Profile card */}
        <Animated.View style={[styles.profileCard, { paddingTop: insets.top + 56, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {/* Avatar */}
          <View style={styles.avatarArea}>
            {channel?.avatar_url ? (
              <TouchableOpacity activeOpacity={0.85} onPress={() => setAvatarFullscreen(true)}>
                <Image source={{ uri: channel.avatar_url }} style={styles.avatar} />
              </TouchableOpacity>
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.primary + '15' }]}>
                <Megaphone color={colors.primary} size={40} />
              </View>
            )}
          </View>

          {/* Name */}
          <View style={styles.nameRow}>
            <Text style={[styles.channelName, { color: colors.text }]}>{channel?.name}</Text>
            {channel?.is_verified && (
              <View style={styles.verifiedBadge}>
                <View style={styles.verifiedCheckmark} />
              </View>
            )}
          </View>

          {/* Username */}
          {channel?.username && (
            <Text style={[styles.username, { color: colors.primary }]}>@{channel.username}</Text>
          )}

          {/* Subscriber count */}
          <View style={styles.subscriberRow}>
            <Users color={colors.textTertiary} size={15} />
            <Text style={[styles.subscriberText, { color: colors.textSecondary }]}>
              {pluralizeSubscribers(channel?.subscriber_count || 0)}
            </Text>
          </View>

          {/* Description */}
          {channel?.description && (
            <Text style={[styles.description, { color: colors.textSecondary }]}>{channel.description}</Text>
          )}

          {/* Action buttons */}
          <View style={styles.actionButtons}>
            {isSubscribed ? (
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary, flex: 1 }]}
                onPress={handleOpenChannel}
                activeOpacity={0.7}
              >
                <Megaphone color="#fff" size={18} />
                <Text style={styles.primaryButtonText}>Открыть канал</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary, flex: 1 }]}
                onPress={handleSubscribe}
                disabled={subscribing}
                activeOpacity={0.7}
              >
                {subscribing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Users color="#fff" size={18} />
                    <Text style={styles.primaryButtonText}>Подписаться</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {error && (
            <Text style={[styles.inlineError, { color: colors.error }]}>{error}</Text>
          )}
        </Animated.View>

        {/* Posts section */}
        {posts.length > 0 && (
          <View style={styles.postsSection}>
            <View style={styles.postsSectionHeader}>
              <Text style={[styles.postsSectionTitle, { color: colors.text }]}>Публикации</Text>
              <Text style={[styles.postsSectionCount, { color: colors.textTertiary }]}>{posts.length}</Text>
            </View>
            <View style={[styles.postsCard, { backgroundColor: colors.backgroundSecondary }]}>
              {posts.map((item, index) => {
                const hasMedia = !!item.media_url;
                const isImage = item.media_type?.startsWith('image') || item.message_type === 'image';
                const isVideo = item.media_type?.startsWith('video') || item.message_type === 'video';

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.postItem,
                      index < posts.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border + '40' },
                    ]}
                  >
                    {hasMedia && isImage && (
                      <CachedImage uri={item.media_url!} style={styles.postMedia} contentFit="cover" />
                    )}
                    {hasMedia && isVideo && (
                      <View style={[styles.postMediaPlaceholder, { backgroundColor: colors.backgroundTertiary }]}>
                        <View style={[styles.playButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                          <Play color="#FFFFFF" size={24} fill="#FFFFFF" />
                        </View>
                      </View>
                    )}
                    {item.content ? (
                      <Text style={[styles.postContent, { color: colors.text }]}>{item.content}</Text>
                    ) : null}
                    <View style={styles.postFooter}>
                      <Text style={[styles.postTime, { color: colors.textTertiary }]}>{formatPostDate(item.created_at)}</Text>
                      <View style={styles.postViews}>
                        <Eye color={colors.textTertiary} size={13} />
                        <Text style={[styles.postViewCount, { color: colors.textTertiary }]}>{item.view_count}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {posts.length === 0 && (
          <View style={styles.emptyPosts}>
            <Megaphone color={colors.textTertiary} size={28} />
            <Text style={[styles.emptyPostsText, { color: colors.textTertiary }]}>Пока нет публикаций</Text>
          </View>
        )}
      </Animated.ScrollView>

      {/* Avatar fullscreen modal */}
      {avatarFullscreen && channel?.avatar_url && (
        <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={() => setAvatarFullscreen(false)}>
          <View style={styles.viewerContainer}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setAvatarFullscreen(false)} />
            <Image source={{ uri: channel.avatar_url }} style={styles.viewerImage} resizeMode="contain" />
            <TouchableOpacity
              onPress={() => setAvatarFullscreen(false)}
              style={[styles.viewerClose, { top: insets.top + 12 }]}
              activeOpacity={0.7}
            >
              <X color="#fff" size={22} />
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
  },
  stickyInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  stickyCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stickyAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickyName: {
    fontSize: 16,
    fontWeight: '600',
  },
  profileCard: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  avatarArea: {
    marginBottom: 16,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  channelName: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  username: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  subscriberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  subscriberText: {
    fontSize: 14,
  },
  description: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    maxWidth: 320,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  inlineError: {
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  postsSection: {
    paddingHorizontal: 16,
  },
  postsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  postsSectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  postsSectionCount: {
    fontSize: 14,
  },
  postsCard: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  postItem: {
    paddingBottom: 0,
  },
  postMedia: {
    width: '100%',
    height: 200,
  },
  postMediaPlaceholder: {
    width: '100%',
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postContent: {
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  postFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  postTime: {
    fontSize: 12,
  },
  postViews: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  postViewCount: {
    fontSize: 12,
  },
  emptyPosts: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyPostsText: {
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 15,
    marginBottom: 24,
    textAlign: 'center',
  },
  verifiedBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1DA1F2',
    justifyContent: 'center',
    alignItems: 'center',
  } as any,
  verifiedCheckmark: {
    width: 8,
    height: 4.5,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#fff',
    transform: [{ rotate: '-45deg' }],
    marginTop: -1,
  } as any,
  verifiedBadgeSm: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1DA1F2',
    justifyContent: 'center',
    alignItems: 'center',
  } as any,
  verifiedCheckmarkSm: {
    width: 5,
    height: 3,
    borderLeftWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: '#fff',
    transform: [{ rotate: '-45deg' }],
    marginTop: -0.5,
  } as any,
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerClose: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

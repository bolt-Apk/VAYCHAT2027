import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Search, Megaphone, X, Lock, Users, Globe } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import Avatar from '@/components/Avatar';
import { pluralize } from '@/lib/pluralize';

interface ChannelItem {
  id: string;
  name: string;
  username: string | null;
  description: string | null;
  avatar_url: string | null;
  is_public: boolean;
  is_verified?: boolean;
  subscriber_count: number;
  is_subscribed: boolean;
}

export default function ChannelsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [searchResults, setSearchResults] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, name, username, description, avatar_url, is_public, is_verified')
        .eq('type', 'channel')
        .eq('is_public', true)
        .order('updated_at', { ascending: false })
        .limit(100);

      if (error) {
        setChannels([]);
        return;
      }

      const channelIds = (data || []).map(c => c.id);
      let subCountMap = new Map<string, number>();
      let mySubs = new Set<string>();

      if (channelIds.length > 0) {
        const countPromises = channelIds.map(cId =>
          supabase.from('channel_subscribers').select('*', { count: 'exact', head: true }).eq('channel_id', cId)
        );
        const mySubsPromise = user?.id
          ? supabase.from('channel_subscribers').select('channel_id').eq('user_id', user.id).in('channel_id', channelIds)
          : Promise.resolve({ data: [] as any[], error: null });

        const [countResults, mySubsRes] = await Promise.all([
          Promise.all(countPromises),
          mySubsPromise,
        ]);

        countResults.forEach((res, i) => {
          subCountMap.set(channelIds[i], res.count ?? 0);
        });
        if (mySubsRes.data) {
          mySubs = new Set(mySubsRes.data.map(s => s.channel_id));
        }
      }

      const built: ChannelItem[] = (data || []).map(c => ({
        id: c.id,
        name: c.name || 'Канал',
        username: c.username,
        description: c.description,
        avatar_url: c.avatar_url,
        is_public: c.is_public,
        is_verified: c.is_verified || false,
        subscriber_count: subCountMap.get(c.id) || 0,
        is_subscribed: mySubs.has(c.id),
      }));

      setChannels(built);
    } catch (e) {
      console.error('loadChannels exception:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const searchChannels = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);

    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, name, username, description, avatar_url, is_public, is_verified')
        .eq('type', 'channel')
        .eq('is_public', true)
        .or(`name.ilike.%${trimmed}%,username.ilike.%${trimmed}%,description.ilike.%${trimmed}%`)
        .order('updated_at', { ascending: false })
        .limit(30);

      if (error || !data) {
        setSearchResults([]);
        return;
      }

      const channelIds = data.map(c => c.id);
      let subCountMap = new Map<string, number>();
      let mySubs = new Set<string>();

      if (channelIds.length > 0) {
        const countPromises = channelIds.map(cId =>
          supabase.from('channel_subscribers').select('*', { count: 'exact', head: true }).eq('channel_id', cId)
        );
        const mySubsPromise = user?.id
          ? supabase.from('channel_subscribers').select('channel_id').eq('user_id', user.id).in('channel_id', channelIds)
          : Promise.resolve({ data: [] as any[], error: null });

        const [countResults, mySubsRes] = await Promise.all([
          Promise.all(countPromises),
          mySubsPromise,
        ]);

        countResults.forEach((res, i) => {
          subCountMap.set(channelIds[i], res.count ?? 0);
        });
        if (mySubsRes.data) {
          mySubs = new Set(mySubsRes.data.map(s => s.channel_id));
        }
      }

      const results: ChannelItem[] = data.map(c => ({
        id: c.id,
        name: c.name || 'Канал',
        username: c.username,
        description: c.description,
        avatar_url: c.avatar_url,
        is_public: c.is_public,
        is_verified: c.is_verified || false,
        subscriber_count: subCountMap.get(c.id) || 0,
        is_subscribed: mySubs.has(c.id),
      }));

      setSearchResults(results);
    } catch (e) {
      console.error('searchChannels exception:', e);
    } finally {
      setSearching(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (search.trim().length >= 1) {
      searchTimeoutRef.current = setTimeout(() => searchChannels(search), 300);
    } else {
      setSearchResults([]);
    }
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search, searchChannels]);

  const handleSubscribe = async (channel: ChannelItem) => {
    if (!user?.id || subscribing) return;
    if (channel.is_subscribed) {
      router.push({ pathname: '/channel/[id]', params: { id: channel.id } });
      return;
    }
    setSubscribing(channel.id);
    setSubscribeError(null);
    try {
      const { error: subErr } = await supabase
        .from('channel_subscribers')
        .insert({ channel_id: channel.id, user_id: user.id });
      if (subErr) {
        setSubscribeError('Не удалось подписаться');
        return;
      }
      await supabase
        .from('conversation_members')
        .insert({ conversation_id: channel.id, user_id: user.id, role: 'member' })
        .then(r => { if (r.error && r.error.code !== '23505') console.warn('membership insert:', r.error.message); });

      const updateChannel = (c: ChannelItem) =>
        c.id === channel.id ? { ...c, is_subscribed: true, subscriber_count: c.subscriber_count + 1 } : c;

      setChannels(prev => prev.map(updateChannel));
      setSearchResults(prev => prev.map(updateChannel));

      router.push({ pathname: '/channel/[id]', params: { id: channel.id } });
    } catch (e) {
      setSubscribeError('Произошла ошибка');
    } finally {
      setSubscribing(null);
    }
  };

  const isSearching = search.trim().length > 0;
  const displayData = isSearching ? searchResults : channels;

  const myChannels = displayData.filter(c => c.is_subscribed);
  const discoverChannels = displayData.filter(c => !c.is_subscribed);

  const renderSectionHeader = (title: string, icon: React.ReactNode, count: number) => (
    <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
      {icon}
      <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>{title}</Text>
      <Text style={[styles.sectionCount, { color: colors.textTertiary }]}>{count}</Text>
    </View>
  );

  const renderItem = (item: ChannelItem) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.channelItem, { backgroundColor: colors.background }]}
      onPress={() => item.is_subscribed
        ? router.push({ pathname: '/channel/[id]', params: { id: item.id } })
        : handleSubscribe(item)}
      activeOpacity={0.7}
    >
      <View style={{ marginRight: 12 }}>
        <Avatar
          uri={item.avatar_url}
          name={item.name}
          size="md"
          variant="primary"
          icon={<Megaphone color="#FFFFFF" size={22} />}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[styles.channelName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
          {item.is_verified && (
            <View style={styles.verifiedBadge}>
              <View style={styles.verifiedCheckmark} />
            </View>
          )}
          {!item.is_public && <Lock size={12} color={colors.textTertiary} />}
        </View>
        {item.username && (
          <Text style={[styles.channelUsername, { color: colors.primary }]} numberOfLines={1}>@{item.username}</Text>
        )}
        {item.description && (
          <Text style={[styles.channelDesc, { color: colors.textSecondary }]} numberOfLines={2}>{item.description}</Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Users color={colors.textTertiary} size={12} />
          <Text style={[styles.channelMeta, { color: colors.textTertiary }]}>
            {pluralize(item.subscriber_count, 'подписчик', 'подписчика', 'подписчиков')}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={[
          styles.subscribeBtn,
          { backgroundColor: item.is_subscribed ? colors.backgroundSecondary : colors.primary },
        ]}
        onPress={() => handleSubscribe(item)}
        disabled={subscribing === item.id}
        activeOpacity={0.7}
      >
        {subscribing === item.id ? (
          <ActivityIndicator size="small" color={item.is_subscribed ? colors.text : '#FFFFFF'} />
        ) : item.is_subscribed ? (
          <Text style={[styles.subscribeBtnText, { color: colors.text }]}>Открыть</Text>
        ) : (
          <Text style={styles.subscribeBtnTextWhite}>Подписаться</Text>
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderList = () => {
    if (loading) {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (isSearching && searching) {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>Поиск каналов...</Text>
        </View>
      );
    }

    if (displayData.length === 0) {
      return (
        <View style={styles.centerContent}>
          <Megaphone color={colors.textTertiary} size={44} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {isSearching ? 'Ничего не найдено' : 'Пока нет каналов'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {isSearching ? 'Попробуйте другой запрос' : 'Создайте первый канал из меню чатов'}
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={[]}
        renderItem={() => null}
        keyExtractor={() => ''}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
        refreshControl={
          !isSearching ? (
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadChannels(); }} tintColor={colors.primary} />
          ) : undefined
        }
        ListHeaderComponent={
          <View>
            {subscribeError && (
              <View style={[styles.errorBanner, { backgroundColor: colors.error + '18' }]}>
                <Text style={{ color: colors.error, fontSize: 13 }}>{subscribeError}</Text>
              </View>
            )}

            {myChannels.length > 0 && (
              <View>
                {renderSectionHeader('Мои каналы', <Megaphone color={colors.textTertiary} size={14} />, myChannels.length)}
                {myChannels.map(item => renderItem(item))}
              </View>
            )}

            {discoverChannels.length > 0 && (
              <View>
                {renderSectionHeader(
                  isSearching ? 'Найденные каналы' : 'Каналы для подписки',
                  <Globe color={colors.textTertiary} size={14} />,
                  discoverChannels.length
                )}
                {discoverChannels.map(item => renderItem(item))}
              </View>
            )}
          </View>
        }
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]} onPress={() => router.back()} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={20} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Каналы</Text>
        <View style={{ flex: 1 }} />
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.backgroundSecondary }]}>
        <Search color={colors.textTertiary} size={17} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск каналов..."
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <X color={colors.textSecondary} size={18} />
          </TouchableOpacity>
        )}
      </View>

      {renderList()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  channelName: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1DA1F2',
    justifyContent: 'center',
    alignItems: 'center',
  } as any,
  verifiedCheckmark: {
    width: 6,
    height: 3.5,
    borderLeftWidth: 1.8,
    borderBottomWidth: 1.8,
    borderColor: '#fff',
    transform: [{ rotate: '-45deg' }],
    marginTop: -1,
  } as any,
  channelUsername: {
    fontSize: 13,
    fontWeight: '500',
  },
  channelDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  channelMeta: {
    fontSize: 12,
    fontWeight: '400',
  },
  subscribeBtn: {
    paddingHorizontal: 16,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  subscribeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  subscribeBtnTextWhite: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
});

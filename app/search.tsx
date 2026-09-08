import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Keyboard,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search,
  ArrowLeft,
  X,
  MessageSquare,
  Megaphone,
  Users,
  User,
  MessageCircle,
  Hash,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import Avatar from '@/components/Avatar';

type SearchTab = 'all' | 'chats' | 'channels' | 'groups' | 'messages';

interface ChatResult {
  id: string;
  name: string;
  avatar_url: string | null;
  type: 'direct' | 'group' | 'channel';
  username?: string | null;
  last_message?: string | null;
  member_count?: number;
  is_online?: boolean;
  is_subscribed?: boolean;
  description?: string | null;
}

interface MessageResult {
  id: string;
  content: string;
  conversation_id: string;
  sender_id: string;
  message_type: string;
  created_at: string;
  sender_name: string;
  sender_avatar: string | null;
  conversation_name: string;
  conversation_type: string;
}

const TABS: { key: SearchTab; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'chats', label: 'Чаты' },
  { key: 'channels', label: 'Каналы' },
  { key: 'groups', label: 'Группы' },
  { key: 'messages', label: 'Сообщения' },
];

const PAGE_SIZE = 30;

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string; conversationName?: string }>();
  const { user } = useAuth();
  const { colors, fontScale } = useAppearance();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SearchTab>('all');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [chatResults, setChatResults] = useState<ChatResult[]>([]);
  const [channelResults, setChannelResults] = useState<ChatResult[]>([]);
  const [groupResults, setGroupResults] = useState<ChatResult[]>([]);
  const [messageResults, setMessageResults] = useState<MessageResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const messageOffsetRef = useRef(0);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const searchConversations = useCallback(async (searchQuery: string) => {
    if (!user?.id) return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 1) {
      setChatResults([]);
      setChannelResults([]);
      setGroupResults([]);
      return;
    }

    const escaped = trimmed.replace(/[%_\\]/g, c => '\\' + c).replace(/[,()]/g, '');

    const { data: memberData } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);

    const myConvIds = (memberData || []).map(m => m.conversation_id);

    const { data: convData } = await supabase
      .from('conversations')
      .select('id, type, name, avatar_url, username')
      .in('id', myConvIds.length > 0 ? myConvIds : ['00000000-0000-0000-0000-000000000000'])
      .or(`name.ilike.%${escaped}%,username.ilike.%${escaped}%`)
      .limit(20);

    const { data: publicChannels } = await supabase
      .from('conversations')
      .select('id, type, name, avatar_url, username, description')
      .eq('type', 'channel')
      .eq('is_public', true)
      .or(`name.ilike.%${escaped}%,username.ilike.%${escaped}%`)
      .limit(15);

    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, username, is_online')
      .neq('id', user.id)
      .eq('searchable', true)
      .or(`display_name.ilike.%${escaped}%,username.ilike.%${escaped}%`)
      .limit(10);

    const directChats: ChatResult[] = [];
    const groups: ChatResult[] = [];
    const channels: ChatResult[] = [];

    const seenIds = new Set<string>();
    const myConvIdSet = new Set(myConvIds);

    if (convData) {
      for (const conv of convData) {
        seenIds.add(conv.id);
        const item: ChatResult = {
          id: conv.id,
          name: conv.name || '',
          avatar_url: conv.avatar_url,
          type: conv.type,
          username: conv.username,
          is_subscribed: true,
        };
        if (conv.type === 'channel') channels.push(item);
        else if (conv.type === 'group') groups.push(item);
        else directChats.push(item);
      }
    }

    if (publicChannels) {
      for (const ch of publicChannels) {
        if (!seenIds.has(ch.id)) {
          seenIds.add(ch.id);
          channels.push({
            id: ch.id,
            name: ch.name || '',
            avatar_url: ch.avatar_url,
            type: 'channel',
            username: ch.username,
            is_subscribed: myConvIdSet.has(ch.id),
            description: (ch as any).description || null,
          });
        }
      }
    }

    // Fetch subscriber counts for channels
    if (channels.length > 0) {
      const channelIds = channels.map(c => c.id);
      const { data: countData } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .in('conversation_id', channelIds);

      if (countData) {
        const countMap: Record<string, number> = {};
        for (const row of countData) {
          countMap[row.conversation_id] = (countMap[row.conversation_id] || 0) + 1;
        }
        for (const ch of channels) {
          ch.member_count = countMap[ch.id] || 0;
        }
      }
    }

    if (profileData) {
      for (const p of profileData) {
        const existingDirect = directChats.find(dc => dc.name === p.display_name);
        if (!existingDirect) {
          const { data: directConv } = await supabase
            .from('conversation_members')
            .select('conversation_id')
            .eq('user_id', p.id)
            .in('conversation_id', myConvIds.length > 0 ? myConvIds : ['00000000-0000-0000-0000-000000000000']);

          let directId: string | null = null;
          if (directConv && directConv.length > 0) {
            for (const dc of directConv) {
              const { data: convCheck } = await supabase
                .from('conversations')
                .select('id, type')
                .eq('id', dc.conversation_id)
                .eq('type', 'direct')
                .single();
              if (convCheck) {
                directId = convCheck.id;
                break;
              }
            }
          }

          directChats.push({
            id: directId || `profile_${p.id}`,
            name: p.display_name || p.username || '',
            avatar_url: p.avatar_url,
            type: 'direct',
            username: p.username,
            is_online: p.is_online,
          });
        }
      }
    }

    setChatResults(directChats.slice(0, 8));
    setChannelResults(channels.slice(0, 8));
    setGroupResults(groups.slice(0, 8));
  }, [user?.id]);

  const searchMessages = useCallback(async (searchQuery: string, append = false) => {
    if (!user?.id || searchQuery.trim().length < 2) {
      if (!append) setMessageResults([]);
      return;
    }

    if (!append) messageOffsetRef.current = 0;

    const rpcParams: Record<string, unknown> = {
      p_query: searchQuery.trim(),
      p_limit: PAGE_SIZE,
      p_offset: append ? messageOffsetRef.current : 0,
    };

    if (params.conversationId) {
      rpcParams.p_conversation_id = params.conversationId;
    }

    if (activeTab === 'channels') {
      rpcParams.p_conversation_type = 'channel';
    } else if (activeTab === 'groups') {
      rpcParams.p_conversation_type = 'group';
    } else if (activeTab === 'chats') {
      rpcParams.p_conversation_type = 'direct';
    }

    const { data, error } = await supabase.rpc('search_messages' as any, rpcParams);

    if (error) {
      setLoadingMore(false);
      return;
    }

    const items = (data || []) as MessageResult[];
    setHasMore(items.length === PAGE_SIZE);

    if (append) {
      setMessageResults(prev => [...prev, ...items]);
      messageOffsetRef.current += items.length;
    } else {
      setMessageResults(items);
      messageOffsetRef.current = items.length;
    }
  }, [user?.id, activeTab, params.conversationId]);

  const performSearch = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 1) {
      setChatResults([]);
      setChannelResults([]);
      setGroupResults([]);
      setMessageResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    await Promise.all([
      searchConversations(searchQuery),
      trimmed.length >= 2 ? searchMessages(searchQuery) : Promise.resolve(),
    ]);

    if (trimmed.length >= 2) {
      setRecentSearches(prev => {
        const filtered = prev.filter(s => s !== trimmed);
        return [trimmed, ...filtered].slice(0, 8);
      });
    }

    setLoading(false);
  }, [searchConversations, searchMessages]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (query.trim().length >= 1) {
      searchTimeoutRef.current = setTimeout(() => performSearch(query), 350);
    } else {
      setChatResults([]);
      setChannelResults([]);
      setGroupResults([]);
      setMessageResults([]);
    }
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [query, performSearch]);

  useEffect(() => {
    if (query.trim().length >= 2) {
      searchMessages(query);
    }
  }, [activeTab]);

  const loadMoreMessages = useCallback(() => {
    if (!hasMore || loadingMore || query.trim().length < 2) return;
    setLoadingMore(true);
    searchMessages(query, true).finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, query, searchMessages]);

  const navigateToChat = (item: ChatResult) => {
    Keyboard.dismiss();
    if (item.id.startsWith('profile_')) {
      const profileId = item.id.replace('profile_', '');
      router.push({ pathname: '/u/[userId]', params: { userId: profileId } });
    } else {
      router.push({ pathname: '/chat/[id]', params: { id: item.id } });
    }
  };

  const navigateToMessage = (item: MessageResult) => {
    Keyboard.dismiss();
    router.push({ pathname: '/chat/[id]', params: { id: item.conversation_id } });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Вчера';
    if (days < 7) return date.toLocaleDateString('ru-RU', { weekday: 'short' });
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  const highlightQuery = (text: string) => {
    const q = query.trim();
    if (!q || q.length < 2) return <Text>{text}</Text>;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const splitRegex = new RegExp(`(${escaped})`, 'gi');
    const testRegex = new RegExp(`(${escaped})`, 'i');
    const parts = text.split(splitRegex);
    if (parts.length === 1) return <Text>{text}</Text>;
    return (
      <Text>
        {parts.map((part, i) =>
          testRegex.test(part) ? (
            <Text key={i} style={{ backgroundColor: 'rgba(42,171,238,0.25)', color: colors.text }}>
              {part}
            </Text>
          ) : (
            <Text key={i}>{part}</Text>
          )
        )}
      </Text>
    );
  };

  const totalResults = chatResults.length + channelResults.length + groupResults.length + messageResults.length;

  const filteredChatResults = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'chats') return chatResults;
    return [];
  }, [activeTab, chatResults]);

  const filteredChannelResults = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'channels') return channelResults;
    return [];
  }, [activeTab, channelResults]);

  const filteredGroupResults = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'groups') return groupResults;
    return [];
  }, [activeTab, groupResults]);

  const filteredMessageResults = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'messages' || activeTab === 'chats' || activeTab === 'channels' || activeTab === 'groups') return messageResults;
    return [];
  }, [activeTab, messageResults]);

  const showMessages = activeTab === 'all' || activeTab === 'messages' || activeTab === 'chats' || activeTab === 'channels' || activeTab === 'groups';

  const renderConversationItem = (item: ChatResult, type: 'direct' | 'channel' | 'group') => {
    const icon = type === 'channel'
      ? <Megaphone color={colors.primary} size={18} />
      : type === 'group'
        ? <Users color={colors.primary} size={18} />
        : null;

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.convItem, { backgroundColor: colors.background }]}
        onPress={() => navigateToChat(item)}
        activeOpacity={0.7}
      >
        {item.avatar_url ? (
          <Avatar uri={item.avatar_url} name={item.name || '?'} size="sm" />
        ) : (
          <View style={[styles.convAvatarPlaceholder, { backgroundColor: colors.primary + '15' }]}>
            {icon || <User color={colors.primary} size={20} />}
          </View>
        )}
        <View style={styles.convInfo}>
          <View style={styles.convNameRow}>
            <Text style={[styles.convName, { color: colors.text, fontSize: 15 * fontScale }]} numberOfLines={1}>
              {highlightQuery(item.name || '')}
            </Text>
            {item.is_online && <View style={[styles.onlineDot, { backgroundColor: colors.online }]} />}
          </View>
          {item.username && (
            <Text style={[styles.convUsername, { color: colors.textTertiary, fontSize: 13 * fontScale }]} numberOfLines={1}>
              @{item.username}
            </Text>
          )}
          {type === 'channel' && item.member_count !== undefined && (
            <Text style={[styles.subscriberCount, { color: colors.textTertiary, fontSize: 12 * fontScale }]}>
              {item.member_count} {formatSubscribers(item.member_count)}
            </Text>
          )}
        </View>
        <View style={[styles.convTypeBadge, { backgroundColor: colors.backgroundTertiary }]}>
          <Text style={[styles.convTypeBadgeText, { color: colors.textTertiary }]}>
            {type === 'channel' ? 'Канал' : type === 'group' ? 'Группа' : 'Чат'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderMessageItem = (item: MessageResult) => {
    const chatName = item.conversation_type === 'direct'
      ? item.sender_name
      : item.conversation_name || 'Чат';

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.msgItem, { backgroundColor: colors.background }]}
        onPress={() => navigateToMessage(item)}
        activeOpacity={0.7}
      >
        <Avatar uri={item.sender_avatar} name={item.sender_name || '?'} size="sm" />
        <View style={styles.msgContent}>
          <View style={styles.msgHeader}>
            <Text style={[styles.msgChatName, { color: colors.text, fontSize: 15 * fontScale }]} numberOfLines={1}>
              {chatName}
            </Text>
            <Text style={[styles.msgTime, { color: colors.textTertiary, fontSize: 12 * fontScale }]}>
              {formatDate(item.created_at)}
            </Text>
          </View>
          {item.conversation_type !== 'direct' && (
            <Text style={[styles.msgSender, { color: colors.primary, fontSize: 13 * fontScale }]} numberOfLines={1}>
              {item.sender_name}
            </Text>
          )}
          <Text style={[styles.msgText, { color: colors.textSecondary, fontSize: 14 * fontScale }]} numberOfLines={2}>
            {item.message_type === 'text' ? highlightQuery(item.content || '') : getTypeLabel(item.message_type)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Поиск...</Text>
        </View>
      );
    }

    if (query.trim().length < 1) {
      return (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconBg, { backgroundColor: colors.backgroundSecondary }]}>
            <Search color={colors.textTertiary} size={40} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Глобальный поиск</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Ищите по чатам, каналам, группам и сообщениям
          </Text>
          {recentSearches.length > 0 && (
            <View style={styles.recentSection}>
              <Text style={[styles.recentTitle, { color: colors.textTertiary }]}>Недавние</Text>
              <View style={styles.recentChips}>
                {recentSearches.map((term, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.recentChip, { backgroundColor: colors.backgroundSecondary }]}
                    onPress={() => setQuery(term)}
                  >
                    <Text style={[styles.recentChipText, { color: colors.text }]}>{term}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      );
    }

    const hasAnyResults = filteredChatResults.length > 0 || filteredChannelResults.length > 0 || filteredGroupResults.length > 0 || filteredMessageResults.length > 0;

    if (!hasAnyResults) {
      return (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconBg, { backgroundColor: colors.backgroundSecondary }]}>
            <Search color={colors.textTertiary} size={40} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Ничего не найдено</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Попробуйте изменить запрос или категорию
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={filteredMessageResults}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        ListHeaderComponent={
          <View>
            {filteredChatResults.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <User color={colors.textTertiary} size={14} />
                  <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Чаты</Text>
                  <Text style={[styles.sectionCount, { color: colors.textTertiary }]}>{filteredChatResults.length}</Text>
                </View>
                {filteredChatResults.map(item => renderConversationItem(item, 'direct'))}
              </View>
            )}

            {filteredChannelResults.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Megaphone color={colors.textTertiary} size={14} />
                  <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Каналы</Text>
                  <Text style={[styles.sectionCount, { color: colors.textTertiary }]}>{filteredChannelResults.length}</Text>
                </View>
                {filteredChannelResults.filter(c => c.is_subscribed).map(item => renderConversationItem(item, 'channel'))}
                {filteredChannelResults.some(c => !c.is_subscribed) && (
                  <>
                    <View style={[styles.discoverDivider, { borderTopColor: colors.border }]}>
                      <Text style={[styles.discoverLabel, { color: colors.textTertiary, backgroundColor: colors.background }]}>
                        Публичные каналы
                      </Text>
                    </View>
                    {filteredChannelResults.filter(c => !c.is_subscribed).map(item => renderConversationItem(item, 'channel'))}
                  </>
                )}
              </View>
            )}

            {filteredGroupResults.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Users color={colors.textTertiary} size={14} />
                  <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Группы</Text>
                  <Text style={[styles.sectionCount, { color: colors.textTertiary }]}>{filteredGroupResults.length}</Text>
                </View>
                {filteredGroupResults.map(item => renderConversationItem(item, 'group'))}
              </View>
            )}

            {filteredMessageResults.length > 0 && (
              <View style={styles.sectionHeader}>
                <MessageSquare color={colors.textTertiary} size={14} />
                <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Сообщения</Text>
                <Text style={[styles.sectionCount, { color: colors.textTertiary }]}>{filteredMessageResults.length}{hasMore ? '+' : ''}</Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => renderMessageItem(item)}
        onEndReached={loadMoreMessages}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <View style={[styles.searchBar, { backgroundColor: colors.backgroundSecondary }]}>
          <Search color={colors.textTertiary} size={17} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: colors.text, fontSize: 15 * fontScale }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск..."
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <X color={colors.textSecondary} size={16} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContainer}
        style={[styles.tabsScroll, { borderBottomColor: colors.border }]}
      >
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                isActive && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[
                styles.tabText,
                { color: isActive ? colors.primary : colors.textSecondary, fontSize: 14 * fontScale },
                isActive && styles.tabTextActive,
              ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Conversation scope indicator */}
      {params.conversationId && (
        <View style={[styles.scopeBar, { backgroundColor: colors.backgroundSecondary }]}>
          <Text style={[styles.scopeText, { color: colors.textSecondary }]}>
            Поиск в: <Text style={{ color: colors.text, fontWeight: '600' }}>{params.conversationName || 'чат'}</Text>
          </Text>
          <TouchableOpacity onPress={() => router.setParams({ conversationId: '', conversationName: '' })} hitSlop={8}>
            <X color={colors.textTertiary} size={16} />
          </TouchableOpacity>
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        {renderContent()}
      </View>
    </View>
  );
}

function getTypeLabel(type: string) {
  switch (type) {
    case 'image': return 'Фото';
    case 'video': return 'Видео';
    case 'voice': return 'Голосовое сообщение';
    case 'file': return 'Файл';
    case 'video_note': return 'Видеосообщение';
    case 'location': return 'Геолокация';
    case 'contact': return 'Контакт';
    default: return '';
  }
}

function formatSubscribers(count: number) {
  if (count % 10 === 1 && count % 100 !== 11) return 'подписчик';
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'подписчика';
  return 'подписчиков';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 0,
  },
  tabsScroll: {
    maxHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 4,
    alignItems: 'stretch',
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontWeight: '500',
  },
  tabTextActive: {
    fontWeight: '600',
  },
  scopeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  scopeText: {
    fontSize: 13,
    flex: 1,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  section: {
    marginBottom: 8,
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
  convItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 16,
    gap: 12,
  },
  convAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  convInfo: {
    flex: 1,
  },
  convNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  convName: {
    fontWeight: '600',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  convUsername: {},
  convTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  convTypeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  joinButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  joinButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  subscriberCount: {
    marginTop: 1,
  },
  discoverDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    position: 'relative',
    alignItems: 'center',
  },
  discoverLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    marginTop: -8,
  },
  msgItem: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
  },
  msgContent: {
    flex: 1,
  },
  msgHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 1,
  },
  msgChatName: {
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  msgTime: {},
  msgSender: {
    fontWeight: '500',
    marginBottom: 2,
  },
  msgText: {
    lineHeight: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 48,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  recentSection: {
    marginTop: 32,
    width: '100%',
    alignItems: 'center',
  },
  recentTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  recentChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  recentChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  recentChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  footerLoading: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});

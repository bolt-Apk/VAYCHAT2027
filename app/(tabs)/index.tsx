import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { pluralize } from '@/lib/pluralize';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Animated as RNAnimated,
  Easing,
  Dimensions,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Search, Plus, MessageCircle, Check, CheckCheck, Trash2, Ban, X, BellOff, Archive, Bell, ArchiveRestore, Pin, PinOff, Bookmark, Users, Eye, Clock, Megaphone, Camera, SquarePen, ChevronUp, ChevronDown, User, Globe } from 'lucide-react-native';
import UndoSnackbar from '@/components/UndoSnackbar';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';
import { dataCache, isUserOnline, type CachedLastMessage } from '@/lib/data-cache';
import StatusBar, { StatusBarRef } from '@/components/StatusBar';
import TypingDots from '@/components/TypingDots';

import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import EmptyState from '@/components/EmptyState';
import AnimatedEmptyState from '@/components/AnimatedEmptyState';
import { ChatListSkeleton } from '@/components/Skeleton';
import { getTotalQueuedCount, getQueuedCount, onQueueEvent, clearQueue } from '@/lib/message-queue';
import { useNetwork } from '@/lib/use-network';
import { usePerformance } from '@/lib/performance-context';
import { useScrollToTop } from '@/lib/scroll-to-top-context';
import { WifiOff } from 'lucide-react-native';

interface Conversation {
  id: string;
  type: string;
  name: string | null;
  avatar_url: string | null;
  updated_at: string;
  is_verified?: boolean;
  lastMessage?: {
    content: string;
    message_type: string;
    created_at: string;
    sender_id: string;
    is_read: boolean;
  };
  otherUser?: {
    display_name: string;
    avatar_url: string | null;
    is_online: boolean;
  };
  unreadCount: number;
  is_muted: boolean;
  is_archived: boolean;
  is_pinned: boolean;
  pin_order: number;
}

interface SearchResult {
  id: string;
  content: string;
  conversation_id: string;
  created_at: string;
  sender_name: string;
  chat_name: string;
}

interface ProfileResult {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  is_online: boolean;
}

interface ChannelResult {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  subscriber_count: number;
  is_subscribed: boolean;
}


const FILTER_TABS: Array<{ key: 'all' | 'direct' | 'channels' | 'groups'; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'direct', label: 'Чаты' },
  { key: 'channels', label: 'Каналы' },
  { key: 'groups', label: 'Группы' },
];

export function ChatListContent({ onChatPress, activeChatId }: { onChatPress?: (chatId: string) => void; activeChatId?: string | null } = {}) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, fontScale, chatSpacing } = useAppearance();
  const perf = usePerformance();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDesktopLayout();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [actionMenu, setActionMenu] = useState<Conversation | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [profileResults, setProfileResults] = useState<ProfileResult[]>([]);
  const [channelSearchResults, setChannelSearchResults] = useState<ChannelResult[]>([]);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherUserIdsRef = useRef<Map<string, string>>(new Map());
  const chatListRef = useRef<FlatList>(null);

  const scrollToTopUnsub = useScrollToTop('index', () => {
    chatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  });

  useEffect(() => {
    return scrollToTopUnsub();
  }, [scrollToTopUnsub]);
  const [showArchived, setShowArchived] = useState(false);
  const [typingMap, setTypingMap] = useState<Map<string, { name: string; activity: string }>>(new Map());
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchWidthAnim = useRef(new RNAnimated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);
  const statusBarRef = useRef<StatusBarRef>(null);
  const isConnected = useNetwork();
  const [queueTotal, setQueueTotal] = useState(getTotalQueuedCount());

  const [snackbar, setSnackbar] = useState<{ message: string; undoFn: () => void } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmText: string; destructive: boolean; onConfirm: () => void;
  } | null>(null);
  const removingAnimsRef = useRef<Map<string, RNAnimated.Value>>(new Map());

  useEffect(() => {
    const unsub = onQueueEvent(() => setQueueTotal(getTotalQueuedCount()));
    return unsub;
  }, []);
  const [chatFilter, setChatFilter] = useState<'all' | 'direct' | 'channels' | 'groups'>('all');
  const screenWidth = Dimensions.get('window').width;
  const swipeTranslateX = useRef(new RNAnimated.Value(0)).current;
  const tabIndicatorX = useRef(new RNAnimated.Value(0)).current;
  const currentFilterIndex = FILTER_TABS.findIndex(t => t.key === chatFilter);

  const switchToTab = useCallback((index: number) => {
    if (index < 0 || index >= FILTER_TABS.length) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const direction = index > currentFilterIndex ? -1 : 1;
    swipeTranslateX.setValue(0);
    RNAnimated.timing(swipeTranslateX, {
      toValue: direction * screenWidth,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setChatFilter(FILTER_TABS[index].key);
      swipeTranslateX.setValue(-direction * screenWidth);
      RNAnimated.timing(swipeTranslateX, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [currentFilterIndex, screenWidth]);

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const handleTouchStart = useCallback((e: any) => {
    const touch = e.nativeEvent?.touches?.[0] || e.nativeEvent;
    touchStartRef.current = { x: touch.pageX, y: touch.pageY, time: Date.now() };
  }, []);
  const handleTouchEnd = useCallback((e: any) => {
    if (!touchStartRef.current) return;
    const touch = e.nativeEvent?.changedTouches?.[0] || e.nativeEvent;
    const dx = touch.pageX - touchStartRef.current.x;
    const dy = touch.pageY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    if (Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (Math.abs(dx) > 80 || (Math.abs(dx) > 40 && dt < 300)) {
      if (dx > 0 && currentFilterIndex > 0) {
        switchToTab(currentFilterIndex - 1);
      } else if (dx < 0 && currentFilterIndex < FILTER_TABS.length - 1) {
        switchToTab(currentFilterIndex + 1);
      }
    }
  }, [currentFilterIndex, switchToTab]);
  const [editMode, setEditMode] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [showNewMenu, setShowNewMenu] = useState(false);
  const newMenuAnim = useRef(new RNAnimated.Value(0)).current;
  const scrollY = useRef(new RNAnimated.Value(0)).current;
  const searchBarTranslateY = useRef(new RNAnimated.Value(0)).current;
  const searchBarOpacity = useRef(new RNAnimated.Value(1)).current;
  const searchBarHeight = useRef(new RNAnimated.Value(52)).current;
  const searchBarVisible = useRef(true);
  const lastScrollY = useRef(0);
  const scrollDelta = useRef(0);
  const SCROLL_THRESHOLD = 35;
  const scrollHandler = useCallback((event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const diff = currentY - lastScrollY.current;
    lastScrollY.current = currentY;

    if (currentY <= 5) {
      scrollDelta.current = 0;
      if (!searchBarVisible.current) {
        searchBarVisible.current = true;
        RNAnimated.parallel([
          RNAnimated.timing(searchBarHeight, {
            toValue: 52,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          RNAnimated.timing(searchBarOpacity, {
            toValue: 1,
            duration: 180,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }),
        ]).start();
      }
      return;
    }

    scrollDelta.current += diff;

    if (scrollDelta.current > SCROLL_THRESHOLD && searchBarVisible.current) {
      searchBarVisible.current = false;
      scrollDelta.current = 0;
      RNAnimated.parallel([
        RNAnimated.timing(searchBarHeight, {
          toValue: 0,
          duration: 250,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
        RNAnimated.timing(searchBarOpacity, {
          toValue: 0,
          duration: 150,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ]).start();
    } else if (scrollDelta.current < -SCROLL_THRESHOLD && !searchBarVisible.current) {
      searchBarVisible.current = true;
      scrollDelta.current = 0;
      RNAnimated.parallel([
        RNAnimated.timing(searchBarHeight, {
          toValue: 52,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        RNAnimated.timing(searchBarOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ]).start();
    }

    if (diff > 0 && scrollDelta.current < 0) scrollDelta.current = 0;
    if (diff < 0 && scrollDelta.current > 0) scrollDelta.current = 0;
  }, []);
  const [hasStories, setHasStories] = useState(false);
  const [storiesExpanded, setStoriesExpanded] = useState(false);
  const storiesVisibleAnim = useRef(new RNAnimated.Value(0)).current;

  const handleStoriesCountChange = useCallback((count: number) => {
    const has = count > 0;
    setHasStories(has);
    if (!has && storiesExpanded) {
      setStoriesExpanded(false);
      RNAnimated.timing(storiesVisibleAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
  }, [storiesVisibleAnim, storiesExpanded]);

  const toggleStoriesExpanded = useCallback(() => {
    if (!hasStories) return;
    const next = !storiesExpanded;
    setStoriesExpanded(next);
    RNAnimated.spring(storiesVisibleAnim, {
      toValue: next ? 1 : 0,
      tension: 65,
      friction: 11,
      useNativeDriver: false,
    }).start();
  }, [hasStories, storiesExpanded, storiesVisibleAnim]);

  const toggleSearch = () => {
    if (searchExpanded) {
      setSearch('');
      RNAnimated.timing(searchWidthAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setSearchExpanded(false));
    } else {
      setSearchExpanded(true);
      RNAnimated.timing(searchWidthAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => searchInputRef.current?.focus());
    }
  };

  const toggleNewMenu = () => {
    if (showNewMenu) {
      RNAnimated.timing(newMenuAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setShowNewMenu(false));
    } else {
      setShowNewMenu(true);
      RNAnimated.timing(newMenuAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  };

  const handleNewMenuAction = (action: string) => {
    RNAnimated.timing(newMenuAnim, {
      toValue: 0,
      duration: 150,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setShowNewMenu(false);
      if (action === 'chat') router.push('/new-chat');
      else if (action === 'group') router.push({ pathname: '/new-chat', params: { mode: 'group' } });
      else if (action === 'channel') router.push({ pathname: '/new-chat', params: { mode: 'channel' } });
      else if (action === 'saved') router.push('/saved');
    });
  };

  const loadBlockedUsers = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('blocked_users')
      .select('blocked_user_id')
      .eq('user_id', user.id);
    if (error) {
      console.error('loadBlockedUsers error:', error.message);
      return;
    }
    if (data) {
      setBlockedIds(new Set(data.map((b) => b.blocked_user_id)));
    }
  }, [user?.id]);

  useEffect(() => {
    loadBlockedUsers();
  }, [loadBlockedUsers]);

  const buildFromCache = useCallback(() => {
    if (!user?.id) return false;
    const memberships = dataCache.getMemberships();
    const allConvs = dataCache.getAllConversations();
    if (!memberships.length || !allConvs.length) return false;

    const convMap = new Map(allConvs.map(c => [c.id, c]));
    const convMembers = dataCache.getConvMembers();
    const lastMsgs = dataCache.getAllLastMessages();

    const membershipMap = new Map(memberships.map(m => [m.conversation_id, m]));
    const directMemberMap = new Map<string, string>();
    convMembers.forEach(m => {
      if (m.user_id !== user.id) directMemberMap.set(m.conversation_id, m.user_id);
    });

    const built: Conversation[] = [];
    for (const m of memberships) {
      const conv = convMap.get(m.conversation_id);
      if (!conv) continue;
      const otherId = directMemberMap.get(m.conversation_id);
      otherUserIdsRef.current.set(m.conversation_id, otherId || '');
      let otherUser: Conversation['otherUser'];
      if (otherId) {
        const p = dataCache.getProfile(otherId);
        if (p) {
          otherUser = { display_name: p.display_name, avatar_url: p.avatar_url, is_online: isUserOnline(p.is_online, p.last_seen) };
        }
      }
      const lm = lastMsgs.get(m.conversation_id);
      built.push({
        ...conv,
        lastMessage: lm ? { content: lm.content, message_type: lm.message_type, created_at: lm.created_at, sender_id: lm.sender_id, is_read: lm.is_read } : undefined,
        otherUser,
        unreadCount: 0,
        is_muted: m.is_muted || false,
        is_archived: m.is_archived || false,
        is_pinned: (m as any).is_pinned || false,
        pin_order: (m as any).pin_order || 0,
      });
    }
    built.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    if (built.length > 0) {
      setConversations(built);
      setLoading(false);
      return true;
    }
    return false;
  }, [user?.id]);

  useEffect(() => {
    if (user?.id && loading) {
      buildFromCache();
    }
  }, [user?.id, loading, buildFromCache]);

  useEffect(() => {
    if (!user?.id || !loading) return;
    const unsub = dataCache.subscribe(() => {
      if (loading && dataCache.isPrefetched()) {
        buildFromCache();
      }
    });
    return unsub;
  }, [user?.id, loading, buildFromCache]);

  const loadConversations = useCallback(async () => {
    if (!user?.id) {
      setConversations([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const [membershipsRes, convsRes] = await Promise.all([
        supabase.from('conversation_members').select('conversation_id, is_muted, is_archived, is_pinned, pin_order, last_read_at').eq('user_id', user.id),
        null,
      ]);
      const memberships = membershipsRes.data;
      if (!memberships?.length) {
        setConversations([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const convIds = memberships.map(m => m.conversation_id);

      const [convsResult, lastMessagesRes, directMembersRes] = await Promise.all([
        supabase.from('conversations').select('*').in('id', convIds).order('updated_at', { ascending: false }),
        supabase.rpc('get_last_messages', { p_conversation_ids: convIds }),
        supabase.from('conversation_members').select('conversation_id, user_id').in('conversation_id', convIds).neq('user_id', user.id),
      ]);

      const convs = convsResult.data;
      if (!convs?.length) {
        setConversations([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const lastMsgByConv = new Map();
      (lastMessagesRes.data as any[] | null)?.forEach((msg: any) => {
        if (!lastMsgByConv.has(msg.conversation_id)) lastMsgByConv.set(msg.conversation_id, msg);
      });

      const lastReadMap = new Map<string, string>();
      memberships.forEach(m => { if (m.last_read_at) lastReadMap.set(m.conversation_id, m.last_read_at); });

      const directMembers = directMembersRes.data || [];
      directMembers.forEach(m => {
        otherUserIdsRef.current.set(m.conversation_id, m.user_id);
      });

      const otherUserIds = [...new Set(directMembers.map(m => m.user_id))];
      let otherUsersByConv = new Map();

      const unreadPromise = Promise.resolve(supabase.rpc('get_unread_counts' as any, {
        p_user_id: user.id,
        p_conversation_ids: convIds,
      })).then(({ data }) => {
        const map = new Map<string, number>();
        if (Array.isArray(data)) {
          data.forEach((r: any) => { if (r.cnt > 0) map.set(r.conversation_id, r.cnt); });
        }
        return map;
      }).catch(() => new Map<string, number>());

      if (otherUserIds.length > 0) {
        let profilesById = new Map<string, any>();
        const cachedAll = otherUserIds.every(id => dataCache.getProfile(id));
        if (cachedAll) {
          otherUserIds.forEach(id => {
            const p = dataCache.getProfile(id);
            if (p) profilesById.set(id, p);
          });
        } else {
          const { data: profiles } = await supabase.from('profiles').select('id, display_name, avatar_url, is_online, last_seen').in('id', otherUserIds);
          (profiles || []).forEach(p => profilesById.set(p.id, p));
        }
        directMembers.forEach(m => {
          const p = profilesById.get(m.user_id);
          if (p) {
            otherUsersByConv.set(m.conversation_id, { display_name: p.display_name, avatar_url: p.avatar_url, is_online: isUserOnline(p.is_online, p.last_seen) });
          }
        });
      }

      const unreadByConv = await unreadPromise;

      const membershipMap = new Map(memberships.map(m => [m.conversation_id, m]));
      setConversations(convs.map(conv => {
        const membership = membershipMap.get(conv.id);
        return {
          ...conv,
          lastMessage: lastMsgByConv.get(conv.id),
          otherUser: otherUsersByConv.get(conv.id),
          unreadCount: unreadByConv.get(conv.id) || 0,
          is_muted: membership?.is_muted || false,
          is_archived: membership?.is_archived || false,
          is_pinned: membership?.is_pinned || false,
          pin_order: membership?.pin_order || 0,
        };
      }));

      const lastMsgsList: CachedLastMessage[] = [];
      lastMsgByConv.forEach((v: any) => lastMsgsList.push(v));
      dataCache.setLastMessages(lastMsgsList);
      dataCache.setConvMembers(directMembers.map(m => ({ conversation_id: m.conversation_id, user_id: m.user_id })));
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  const searchMessages = useCallback(async (query: string) => {
    if (!user?.id || query.length < 2) {
      setSearchResults([]);
      setSearchingMessages(false);
      return;
    }
    setSearchingMessages(true);

    const { data: memberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (!memberships?.length) {
      setSearchResults([]);
      setSearchingMessages(false);
      return;
    }

    const convIds = memberships.map(m => m.conversation_id);
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, content, conversation_id, created_at, sender_id')
      .in('conversation_id', convIds)
      .ilike('content', `%${query}%`)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!msgs?.length) {
      setSearchResults([]);
      setSearchingMessages(false);
      return;
    }

    const senderIds = [...new Set(msgs.map(m => m.sender_id))];
    const { data: senders } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', senderIds);
    const senderMap = new Map((senders || []).map(s => [s.id, s.display_name]));

    const convNameMap = new Map<string, string>();
    conversations.forEach(c => {
      const name = c.type === 'direct' ? c.otherUser?.display_name || 'Чат' : c.name || 'Группа';
      convNameMap.set(c.id, name);
    });

    setSearchResults(msgs.map(m => ({
      id: m.id,
      content: m.content,
      conversation_id: m.conversation_id,
      created_at: m.created_at,
      sender_name: senderMap.get(m.sender_id) || 'Пользователь',
      chat_name: convNameMap.get(m.conversation_id) || 'Чат',
    })));
    setSearchingMessages(false);
  }, [user?.id, conversations]);

  const searchPeopleAndChannels = useCallback(async (query: string) => {
    if (!user?.id || query.trim().length < 1) {
      setProfileResults([]);
      setChannelSearchResults([]);
      return;
    }
    const trimmed = query.trim();

    const [profilesRes, channelsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, username, avatar_url, is_online')
        .neq('id', user.id)
        .eq('searchable', true)
        .or(`display_name.ilike.%${trimmed}%,username.ilike.%${trimmed}%`)
        .limit(10),
      supabase
        .from('conversations')
        .select('id, name, username, avatar_url, is_public')
        .eq('type', 'channel')
        .eq('is_public', true)
        .or(`name.ilike.%${trimmed}%,username.ilike.%${trimmed}%`)
        .limit(10),
    ]);

    if (profilesRes.data) {
      setProfileResults(profilesRes.data.map(p => ({
        id: p.id,
        display_name: p.display_name || p.username || '',
        username: p.username,
        avatar_url: p.avatar_url,
        is_online: p.is_online ?? false,
      })));
    }

    if (channelsRes.data) {
      const myMemberships = conversations.map(c => c.id);
      const mySet = new Set(myMemberships);

      const channelIds = channelsRes.data.map(c => c.id);
      const { data: countData } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .in('conversation_id', channelIds.length > 0 ? channelIds : ['00000000-0000-0000-0000-000000000000']);

      const countMap: Record<string, number> = {};
      if (countData) {
        for (const row of countData) {
          countMap[row.conversation_id] = (countMap[row.conversation_id] || 0) + 1;
        }
      }

      setChannelSearchResults(channelsRes.data.map(ch => ({
        id: ch.id,
        name: ch.name || 'Канал',
        username: ch.username,
        avatar_url: ch.avatar_url,
        subscriber_count: countMap[ch.id] || 0,
        is_subscribed: mySet.has(ch.id),
      })));
    }
  }, [user?.id, conversations]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (search.trim().length >= 1) {
      searchTimeoutRef.current = setTimeout(() => {
        searchPeopleAndChannels(search);
        if (search.trim().length >= 2) searchMessages(search);
        else { setSearchResults([]); setSearchingMessages(false); }
      }, 300);
    } else {
      setSearchResults([]);
      setProfileResults([]);
      setChannelSearchResults([]);
    }
  }, [search, searchMessages, searchPeopleAndChannels]);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
      loadBlockedUsers();
      searchBarTranslateY.setValue(0);
      searchBarOpacity.setValue(1);
      searchBarHeight.setValue(52);
      searchBarVisible.current = true;
      lastScrollY.current = 0;
    }, [loadConversations, loadBlockedUsers])
  );

  const loadConversationsRef = useRef(loadConversations);
  loadConversationsRef.current = loadConversations;
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let removed = false;

    const debouncedReload = () => {
      if (removed) return;
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = setTimeout(() => {
        if (!removed) loadConversationsRef.current();
      }, 300);
    };

    const animateRemoveConversation = (conversationId: string) => {
      if (removed) return;
      const anim = new RNAnimated.Value(1);
      removingAnimsRef.current.set(conversationId, anim);
      RNAnimated.timing(anim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start(() => {
        removingAnimsRef.current.delete(conversationId);
        setConversations(prev => prev.filter(c => c.id !== conversationId));
      });
    };

    const handleNewMessage = (payload: any) => {
      if (removed) return;
      const msg = payload.new;
      if (!msg?.conversation_id) { debouncedReload(); return; }

      const now = new Date().toISOString();
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === msg.conversation_id);
        if (idx === -1) { debouncedReload(); return prev; }
        const updated = [...prev];
        const conv = { ...updated[idx] };
        conv.lastMessage = {
          content: msg.content,
          message_type: msg.message_type,
          created_at: msg.created_at,
          sender_id: msg.sender_id,
          is_read: msg.is_read,
        };
        conv.updated_at = now;
        if (msg.sender_id !== user?.id) {
          conv.unreadCount = (conv.unreadCount || 0) + 1;
        }
        updated.splice(idx, 1);
        updated.unshift(conv);
        return updated;
      });
    };

    const handleMessageUpdate = (payload: any) => {
      if (removed) return;
      const msg = payload.new;
      if (!msg?.conversation_id) return;
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === msg.conversation_id);
        if (idx === -1) return prev;
        const conv = { ...prev[idx] };
        if (conv.lastMessage && (conv.lastMessage as any).id === msg.id) {
          conv.lastMessage = { ...conv.lastMessage, is_read: msg.is_read };
          const updated = [...prev];
          updated[idx] = conv;
          return updated;
        }
        if (conv.lastMessage && conv.lastMessage.created_at === msg.created_at && conv.lastMessage.sender_id === msg.sender_id) {
          conv.lastMessage = { ...conv.lastMessage, is_read: msg.is_read };
          const updated = [...prev];
          updated[idx] = conv;
          return updated;
        }
        return prev;
      });
    };

    const channel = supabase.channel(`messages-realtime-${user.id}`);
    channel
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, handleNewMessage)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
      }, handleMessageUpdate)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${user.id}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${user.id}`,
      }, (payload: any) => {
        if (removed) return;
        const convId = payload.old?.conversation_id;
        if (convId) {
          animateRemoveConversation(convId);
        } else {
          debouncedReload();
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${user.id}`,
      }, (payload: any) => {
        if (removed) return;
        const updated = payload.new;
        if (updated?.last_read_at && updated?.conversation_id) {
          setConversations(prev => prev.map(c =>
            c.id === updated.conversation_id ? { ...c, unreadCount: 0 } : c
          ));
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
      }, (payload: any) => {
        if (removed) return;
        const conv = payload.new;
        if (!conv?.id) { debouncedReload(); return; }
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === conv.id);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], updated_at: conv.updated_at, name: conv.name ?? updated[idx].name, avatar_url: conv.avatar_url ?? updated[idx].avatar_url };
          return updated;
        });
      })
      .subscribe();

    return () => {
      removed = true;
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const conversationIdsKey = useMemo(() => {
    return [...conversations.slice(0, 20).map(c => c.id)].sort().join(',');
  }, [conversations]);

  useEffect(() => {
    if (!user?.id || !conversationIdsKey) return;
    const convIds = conversationIdsKey.split(',').slice(0, 10);
    const channels: any[] = [];

    const currentUserId = user.id;
    for (const cid of convIds) {
      const ch = supabase.channel(`typing-${cid}-${currentUserId}`);
      ch.on('presence', { event: 'sync' }, () => {
          const state = ch.presenceState();
          let typingName = '';
          let typingActivity = 'typing';
          for (const key of Object.keys(state)) {
            if (key === currentUserId) continue;
            for (const entry of state[key] as any[]) {
              if (entry.typing && entry.name) {
                typingName = entry.name;
                typingActivity = entry.activity || 'typing';
                break;
              }
            }
            if (typingName) break;
          }
          setTypingMap(prev => {
            const current = prev.get(cid);
            if (!typingName && !current) return prev;
            if (current && current.name === typingName && current.activity === typingActivity) return prev;
            const next = new Map(prev);
            if (typingName) next.set(cid, { name: typingName, activity: typingActivity });
            else next.delete(cid);
            return next;
          });
        })
        .subscribe();
      channels.push(ch);
    }

    return () => {
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [user?.id, conversationIdsKey]);

  const handleDeleteChat = (conv: Conversation) => {
    if (!user?.id) return;
    setActionMenu(null);
    const name = conv.type === 'direct' ? conv.otherUser?.display_name || 'Пользователь' : conv.name || 'Группа';
    setConfirmDialog({
      title: 'Удалить чат',
      message: `Удалить чат с "${name}"? Это действие нельзя отменить.`,
      confirmText: 'Удалить',
      destructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        const anim = new RNAnimated.Value(1);
        removingAnimsRef.current.set(conv.id, anim);
        RNAnimated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: false }).start(() => {
          removingAnimsRef.current.delete(conv.id);
          setConversations((prev) => prev.filter((c) => c.id !== conv.id));
        });
        const { error } = await supabase
          .from('conversation_members')
          .delete()
          .eq('conversation_id', conv.id)
          .eq('user_id', user.id);
        if (error) loadConversations();
      },
    });
  };

  const toggleSelectChat = (chatId: string) => {
    setSelectedChats(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };

  const handleBatchDelete = () => {
    if (!user?.id || selectedChats.size === 0) return;
    const count = selectedChats.size;
    setConfirmDialog({
      title: 'Удалить чаты',
      message: `Удалить ${count} ${pluralize(count, 'чат', 'чата', 'чатов')}? Это действие нельзя отменить.`,
      confirmText: 'Удалить',
      destructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        const ids = Array.from(selectedChats);
        setConversations(prev => prev.filter(c => !selectedChats.has(c.id)));
        setSelectedChats(new Set());
        setEditMode(false);
        for (const cid of ids) {
          await supabase.from('conversation_members').delete().eq('conversation_id', cid).eq('user_id', user.id);
        }
      },
    });
  };

  const movePinnedChat = async (conv: Conversation, direction: 'up' | 'down') => {
    if (!user?.id) return;
    const pinned = conversations.filter(c => c.is_pinned && !c.is_archived).sort((a, b) => a.pin_order - b.pin_order);
    const idx = pinned.findIndex(c => c.id === conv.id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= pinned.length) return;
    const newOrder = pinned.map((c, i) => ({ ...c, pin_order: i }));
    [newOrder[idx].pin_order, newOrder[swapIdx].pin_order] = [newOrder[swapIdx].pin_order, newOrder[idx].pin_order];
    setConversations(prev => prev.map(c => {
      const updated = newOrder.find(p => p.id === c.id);
      return updated ? { ...c, pin_order: updated.pin_order } : c;
    }));
    await supabase.from('conversation_members').update({ pin_order: newOrder[idx].pin_order }).eq('conversation_id', pinned[idx].id).eq('user_id', user.id);
    await supabase.from('conversation_members').update({ pin_order: newOrder[swapIdx].pin_order }).eq('conversation_id', pinned[swapIdx].id).eq('user_id', user.id);
  };

  const handleBlockUser = (conv: Conversation) => {
    if (!user?.id || conv.type !== 'direct') return;
    setActionMenu(null);
    const otherUserId = conv.otherUser ? getOtherUserId(conv) : null;
    if (!otherUserId) return;
    const name = conv.otherUser?.display_name || 'Пользователь';
    setConfirmDialog({
      title: 'Заблокировать',
      message: `Заблокировать "${name}"? Пользователь не сможет отправлять вам сообщения.`,
      confirmText: 'Заблокировать',
      destructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        setBlockedIds((prev) => new Set([...prev, otherUserId]));
        const anim = new RNAnimated.Value(1);
        removingAnimsRef.current.set(conv.id, anim);
        RNAnimated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: false }).start(() => {
          removingAnimsRef.current.delete(conv.id);
          setConversations((prev) => prev.filter((c) => c.id !== conv.id));
        });
        await supabase.from('blocked_users').insert({ user_id: user.id, blocked_user_id: otherUserId });
        await supabase.from('conversation_members').delete().eq('conversation_id', conv.id).eq('user_id', user.id);
      },
    });
  };

  const handleToggleMute = async (conv: Conversation) => {
    if (!user?.id) return;
    setActionMenu(null);
    const newMuted = !conv.is_muted;
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, is_muted: newMuted } : c));
    await supabase.from('conversation_members').update({ is_muted: newMuted }).eq('conversation_id', conv.id).eq('user_id', user.id);
    const name = conv.type === 'direct' ? conv.otherUser?.display_name || 'Чат' : conv.name || 'Группа';
    setSnackbar({
      message: newMuted ? `"${name}" без звука` : `Звук "${name}" включён`,
      undoFn: async () => {
        setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, is_muted: !newMuted } : c));
        await supabase.from('conversation_members').update({ is_muted: !newMuted }).eq('conversation_id', conv.id).eq('user_id', user.id);
      },
    });
  };

  const handleToggleArchive = async (conv: Conversation) => {
    if (!user?.id) return;
    setActionMenu(null);
    const newArchived = !conv.is_archived;
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, is_archived: newArchived } : c));
    await supabase.from('conversation_members').update({ is_archived: newArchived }).eq('conversation_id', conv.id).eq('user_id', user.id);
    const name = conv.type === 'direct' ? conv.otherUser?.display_name || 'Чат' : conv.name || 'Группа';
    setSnackbar({
      message: newArchived ? `"${name}" в архиве` : `"${name}" из архива`,
      undoFn: async () => {
        setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, is_archived: !newArchived } : c));
        await supabase.from('conversation_members').update({ is_archived: !newArchived }).eq('conversation_id', conv.id).eq('user_id', user.id);
      },
    });
  };

  const handleTogglePin = async (conv: Conversation) => {
    if (!user?.id) return;
    setActionMenu(null);
    const newPinned = !conv.is_pinned;
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, is_pinned: newPinned } : c));
    await supabase.from('conversation_members').update({ is_pinned: newPinned }).eq('conversation_id', conv.id).eq('user_id', user.id);
  };

  const handleMarkAsRead = async (conv: Conversation) => {
    if (!user?.id) return;
    setActionMenu(null);
    await supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conv.id)
      .eq('user_id', user.id);
    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conv.id)
      .eq('is_read', false)
      .neq('sender_id', user.id);
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unreadCount: 0 } : c));
  };

  const getOtherUserId = (conv: Conversation): string | null => {
    return otherUserIdsRef.current.get(conv.id) || null;
  };

  const getMessagePreview = (msg?: Conversation['lastMessage'], isUserSender?: boolean) => {
    if (!msg) return 'Нет сообщений';
    switch (msg.message_type) {
      case 'image': return 'Фото';
      case 'video': return 'Видео';
      case 'voice': return 'Голосовое сообщение';
      case 'file':
      case 'document': return 'Файл';
      case 'video_note': return 'Видеокружок';
      case 'contact': return 'Контакт';
      case 'location': return 'Геолокация';
      case 'sticker': return msg.content || 'Стикер';
      case 'forwarded': return 'Пересланное сообщение';
      case 'call':
      case 'call_started':
      case 'call_ended': {
        try {
          const callData = JSON.parse(msg.content || '{}');
          const isVideo = callData.call_type === 'video';
          if (msg.message_type === 'call_ended' || callData.status === 'ended') {
            return isVideo ? 'Видеозвонок' : 'Звонок';
          }
          if (callData.status === 'missed' || callData.status === 'declined') {
            return isVideo ? 'Пропущенный видеозвонок' : 'Пропущенный звонок';
          }
          return isVideo ? 'Видеозвонок' : 'Звонок';
        } catch {
          return 'Звонок';
        }
      }
      case 'text':
        return msg.content || 'Новое сообщение';
      default: {
        if (msg.content && msg.content.startsWith('{')) {
          try {
            JSON.parse(msg.content);
            return 'Новое сообщение';
          } catch {
            return msg.content;
          }
        }
        return msg.content || 'Новое сообщение';
      }
    }
  };

  const formatTime = useCallback((dateStr: string) => {
    const ts = new Date(dateStr).getTime();
    const nowTs = Date.now();
    const diffMs = nowTs - ts;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    const date = new Date(ts);
    const now = new Date(nowTs);

    const isToday = date.getDate() === now.getDate()
      && date.getMonth() === now.getMonth()
      && date.getFullYear() === now.getFullYear();

    if (isToday) {
      if (diffMins < 1) return 'сейчас';
      if (diffMins < 60) return `${diffMins} мин. назад`;
      if (diffHours < 4) {
        const lastOne = diffHours % 10;
        const lastTwo = diffHours % 100;
        const suffix = (lastTwo >= 11 && lastTwo <= 19) ? 'часов'
          : lastOne === 1 ? 'час'
          : (lastOne >= 2 && lastOne <= 4) ? 'часа' : 'часов';
        return `${diffHours} ${suffix} назад`;
      }
      return 'сегодня';
    }

    const yesterday = new Date(nowTs);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getDate() === yesterday.getDate()
      && date.getMonth() === yesterday.getMonth()
      && date.getFullYear() === yesterday.getFullYear()) return 'вчера';

    if (date.getFullYear() === now.getFullYear()) {
      if (diffMs < 7 * 86400000) return date.toLocaleDateString('ru-RU', { weekday: 'short' });
      return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }

    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }, []);

  const archivedCount = useMemo(() => conversations.filter(c => c.is_archived).length, [conversations]);
  const archivedUnreadCount = useMemo(() => conversations.filter(c => c.is_archived && c.unreadCount > 0).reduce((sum, c) => sum + c.unreadCount, 0), [conversations]);

  const filteredConversations = useMemo(
    () => conversations.filter((conv) => {
      if (conv.type === 'saved') {
        if (showArchived) return false;
        if (chatFilter !== 'all') return false;
        if (search) {
          return 'избранное'.includes(search.toLowerCase());
        }
        return true;
      }
      if (chatFilter === 'direct' && conv.type !== 'direct') return false;
      if (chatFilter === 'channels' && conv.type !== 'channel') return false;
      if (chatFilter === 'groups' && conv.type !== 'group') return false;
      const otherUserId = otherUserIdsRef.current.get(conv.id);
      if (otherUserId && blockedIds.has(otherUserId)) return false;
      if (conv.is_archived !== showArchived) return false;
      if (!search) return true;
      const name = conv.type === 'direct'
        ? conv.otherUser?.display_name || ''
        : conv.name || '';
      return name.toLowerCase().includes(search.toLowerCase());
    }).sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      if (a.is_pinned && b.is_pinned) return a.pin_order - b.pin_order;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    }),
    [conversations, search, blockedIds, showArchived, chatFilter]
  );

  const searchHighlightRegex = useMemo(() => {
    const q = search.trim();
    if (!q) return null;
    return new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  }, [search]);


  const renderRightActions = (item: Conversation) => (
    <View style={styles.swipeActionsRight}>
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: colors.archiveSwipe }]}
        onPress={() => handleToggleArchive(item)}
      >
        {item.is_archived ? <ArchiveRestore color="#FFFFFF" size={20} /> : <Archive color="#FFFFFF" size={20} />}
        <Text style={styles.swipeActionText}>{item.is_archived ? 'Из архива' : 'Архив'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: colors.destructiveSwipe }]}
        onPress={() => handleDeleteChat(item)}
      >
        <Trash2 color="#FFFFFF" size={20} />
        <Text style={styles.swipeActionText}>Удалить</Text>
      </TouchableOpacity>
    </View>
  );

  const renderLeftActions = (item: Conversation) => (
    <View style={styles.swipeActionsLeft}>
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: item.is_pinned ? colors.accent : colors.primary }]}
        onPress={() => handleTogglePin(item)}
      >
        {item.is_pinned ? <PinOff color="#FFFFFF" size={20} /> : <Pin color="#FFFFFF" size={20} />}
        <Text style={styles.swipeActionText}>{item.is_pinned ? 'Откреп.' : 'Закреп.'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: item.is_muted ? colors.primary : colors.textTertiary }]}
        onPress={() => handleToggleMute(item)}
      >
        {item.is_muted ? <Bell color="#FFFFFF" size={20} /> : <BellOff color="#FFFFFF" size={20} />}
        <Text style={styles.swipeActionText}>{item.is_muted ? 'Вкл' : 'Выкл'}</Text>
      </TouchableOpacity>
      {item.unreadCount > 0 && (
        <TouchableOpacity
          style={[styles.swipeAction, { backgroundColor: colors.readSwipe }]}
          onPress={() => handleMarkAsRead(item)}
        >
          <Eye color="#FFFFFF" size={20} />
          <Text style={styles.swipeActionText}>Прочит.</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const CHAT_ITEM_HEIGHT = 78;
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: CHAT_ITEM_HEIGHT,
    offset: CHAT_ITEM_HEIGHT * index,
    index,
  }), []);

  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  const renderConversation = useCallback(({ item, index }: { item: Conversation; index: number }) => {
    const isSaved = item.type === 'saved';
    const isChannel = item.type === 'channel';
    const name = isSaved ? 'Избранное' : item.type === 'direct' ? item.otherUser?.display_name || 'Пользователь' : isChannel ? (item.name || 'Канал') : (item.name || 'Группа');

    const isUserSender = item.lastMessage?.sender_id === user?.id;

    const handlePress = isSaved
      ? () => router.push('/saved')
      : () => {
          if (onChatPress) { onChatPress(item.id); return; }
          router.push({ pathname: '/chat/[id]', params: { id: item.id } });
        };

    const removingAnim = removingAnimsRef.current.get(item.id);

    const content = (
      <View style={editMode ? styles.editModeRow : undefined}>
        {editMode && (
          <TouchableOpacity style={styles.editCheckbox} onPress={() => toggleSelectChat(item.id)} activeOpacity={0.7}>
            <View style={[styles.editCheckboxInner, { borderColor: selectedChats.has(item.id) ? colors.primary : colors.textTertiary, backgroundColor: selectedChats.has(item.id) ? colors.primary : 'transparent' }]}>
              {selectedChats.has(item.id) && <Check color="#FFFFFF" size={14} />}
            </View>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
        <Swipeable
          renderRightActions={isSaved || editMode ? undefined : () => renderRightActions(item)}
          renderLeftActions={isSaved || editMode ? undefined : () => renderLeftActions(item)}
          overshootRight={false}
          overshootLeft={false}
          friction={2}
          enabled={!isSaved && !editMode}
        >
          <TouchableOpacity style={[styles.chatItem, { backgroundColor: activeChatId === item.id ? colors.primary + '18' : colors.background }]} onPress={editMode ? () => toggleSelectChat(item.id) : handlePress} onLongPress={isSaved || editMode ? undefined : () => setActionMenu(item)} activeOpacity={0.7}>
          <View style={{ marginRight: 14 }}>
            <Avatar
              uri={isSaved ? null : (item.type === 'direct' ? item.otherUser?.avatar_url : item.avatar_url)}
              name={isSaved ? 'S' : (item.type === 'direct' ? (item.otherUser?.display_name || 'U') : isChannel ? (item.name || 'C') : (item.name || 'G'))}
              size="md"
              variant={isSaved ? 'primary' : 'default'}
              icon={isSaved ? <Bookmark color="#FFFFFF" size={22} /> : isChannel ? <Megaphone color="#FFFFFF" size={22} /> : undefined}
              showOnline={!isSaved && item.type === 'direct'}
              isOnline={item.otherUser?.is_online}
            />
          </View>
          <View style={[styles.chatContent, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border + '60', paddingBottom: 12 }]}>
            <View style={styles.chatHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                <Text style={[styles.chatName, { color: colors.text, fontSize: 16 * fontScale }]} numberOfLines={1}>{name}</Text>
                {item.is_verified && (
                  <View style={styles.verifiedBadge}>
                    <View style={styles.verifiedCheckmark} />
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {item.is_pinned && <Pin color={colors.textTertiary} size={12} />}
                {item.is_muted && <BellOff color={colors.textTertiary} size={12} />}
                {item.lastMessage && <Text style={[styles.chatTime, { color: colors.textTertiary }]}>{formatTime(item.lastMessage.created_at)}</Text>}
              </View>
            </View>
            <View style={styles.chatFooter}>
              <View style={styles.previewRow}>
                {typingMap.has(item.id) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[styles.chatPreview, { color: colors.primary, fontSize: 14 * fontScale, fontWeight: '500' }]} numberOfLines={1}>
                      {(() => {
                        const t = typingMap.get(item.id)!;
                        const label = t.activity === 'voice' ? 'записывает голосовое' : t.activity === 'media' ? 'отправляет медиа' : 'печатает';
                        return `${t.name} ${label}`;
                      })()}
                    </Text>
                    <TypingDots color={colors.primary} size={3} />
                  </View>
                ) : (
                  <>
                    {!isSaved && isUserSender && <View style={{ marginRight: 4 }}>{item.lastMessage?.is_read ? <CheckCheck size={14} color={colors.messageSent} strokeWidth={2.5} /> : <Check size={14} color={colors.textTertiary} strokeWidth={2.5} />}</View>}
                    <Text style={[styles.chatPreview, { color: colors.textSecondary, fontSize: 14 * fontScale, fontWeight: item.unreadCount > 0 ? '500' : '400' }]} numberOfLines={1}>{isSaved && !item.lastMessage ? 'Личное хранилище сообщений' : getMessagePreview(item.lastMessage, isSaved || isUserSender)}</Text>
                  </>
                )}
              </View>
              {item.unreadCount > 0 && <View accessibilityLabel={`${item.unreadCount} непрочитанных`} style={[styles.unreadBadge, { backgroundColor: item.is_muted ? colors.textTertiary : colors.unreadBadge }]}><Text style={styles.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View>}
              {getQueuedCount(item.id) > 0 && <View style={[styles.queueBadge, { backgroundColor: colors.warning }]}><Clock color="#FFF" size={10} /><Text style={styles.queueBadgeText}>{getQueuedCount(item.id)}</Text></View>}
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>
      </View>
      {editMode && item.is_pinned && (
        <View style={styles.editReorderButtons}>
          <TouchableOpacity onPress={() => movePinnedChat(item, 'up')} style={styles.editReorderBtn} activeOpacity={0.6}>
            <ChevronUp color={colors.textSecondary} size={18} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => movePinnedChat(item, 'down')} style={styles.editReorderBtn} activeOpacity={0.6}>
            <ChevronDown color={colors.textSecondary} size={18} />
          </TouchableOpacity>
        </View>
      )}
      </View>
    );

    if (!removingAnim) return content;

    return (
      <RNAnimated.View style={{
        opacity: removingAnim,
        maxHeight: removingAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 78] }),
        transform: [{ translateX: removingAnim.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] }) }],
      }}>
        {content}
      </RNAnimated.View>
    );
  }, [colors, user?.id, typingMap, fontScale, queueTotal, editMode, selectedChats]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {searchExpanded ? (
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
          <View style={styles.searchRow}>
            <RNAnimated.View style={[styles.searchBarExpanded, { backgroundColor: colors.backgroundSecondary, opacity: searchWidthAnim }]}>
              <Search color={colors.textTertiary} size={18} strokeWidth={2.2} />
              <TextInput
                ref={searchInputRef}
                style={[styles.searchInput, { color: colors.text }]}
                value={search}
                onChangeText={setSearch}
                placeholder="Поиск"
                placeholderTextColor={colors.textTertiary}
                autoFocus
                returnKeyType="search"
                selectionColor={colors.primary}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} style={[styles.searchClearButton, { backgroundColor: colors.textTertiary + '30' }]}>
                  <X color={colors.textSecondary} size={14} strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </RNAnimated.View>
            <TouchableOpacity onPress={toggleSearch} hitSlop={8} activeOpacity={0.6}>
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '500' }}>Отмена</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : showArchived ? (
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Архив</Text>
            <TouchableOpacity
              style={[styles.newChatButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowArchived(false)}
            >
              <X color="#FFFFFF" size={20} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ backgroundColor: colors.background, zIndex: 1 }}>
          <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
            <View style={styles.headerRow}>
              <TouchableOpacity
                style={[styles.editButton, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => { setEditMode(!editMode); setSelectedChats(new Set()); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.editButtonText, { color: editMode ? colors.primary : colors.text }]}>
                  {editMode ? 'Готово' : 'Изм.'}
                </Text>
              </TouchableOpacity>
              {editMode && selectedChats.size > 0 ? (
                <View style={styles.editHeaderCenter}>
                  <Text style={[styles.editSelectedText, { color: colors.text }]}>
                    {pluralize(selectedChats.size, 'выбран', 'выбрано', 'выбрано')}
                  </Text>
                </View>
              ) : (
              <TouchableOpacity style={styles.headerCenter} onPress={toggleStoriesExpanded} activeOpacity={0.7}>
                <StatusBar ref={statusBarRef} compact onStoriesCountChange={handleStoriesCountChange} />
                <Text style={[styles.headerTitle, { color: colors.text }]}>Чаты</Text>
              </TouchableOpacity>
              )}
              <View style={styles.headerRightButtons}>
                {editMode && selectedChats.size > 0 ? (
                  <TouchableOpacity
                    style={[styles.newChatButton, { backgroundColor: colors.error + '18' }]}
                    onPress={handleBatchDelete}
                  >
                    <Trash2 color={colors.error} size={20} />
                  </TouchableOpacity>
                ) : (
                <>
                <TouchableOpacity
                  style={[styles.newChatButton, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => statusBarRef.current?.openCreate()}
                >
                  <Camera color={colors.textSecondary} size={20} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.newChatButton, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => router.push('/new-chat')}
                >
                  <SquarePen color={colors.textSecondary} size={20} />
                </TouchableOpacity>
                </>
                )}
              </View>
            </View>
          </View>
          <RNAnimated.View style={[styles.storiesInlineContainer, {
            maxHeight: storiesVisibleAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 110],
            }),
            opacity: storiesVisibleAnim,
            transform: [{
              translateY: storiesVisibleAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-10, 0],
              }),
            }],
          }]}>
            <StatusBar />
          </RNAnimated.View>
          <RNAnimated.View style={{ opacity: searchBarOpacity, height: searchBarHeight, overflow: 'hidden' }}>
          <TouchableOpacity
            style={[styles.searchBarFake, { backgroundColor: colors.backgroundSecondary }]}
            onPress={toggleSearch}
            activeOpacity={0.7}
          >
            <Search color={colors.textTertiary} size={16} />
            <Text style={[styles.searchBarFakeText, { color: colors.textTertiary }]}>Поиск</Text>
          </TouchableOpacity>
          </RNAnimated.View>
          <View style={[styles.chatFilterBar]}>
            <View style={[styles.chatFilterContainer, { backgroundColor: colors.backgroundSecondary }]}>
              {FILTER_TABS.map((tab, idx) => {
                const isActive = chatFilter === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    onPress={() => {
                      if (idx !== currentFilterIndex) switchToTab(idx);
                    }}
                    activeOpacity={0.7}
                    style={[
                      styles.chatFilterTab,
                      isActive && { backgroundColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.chatFilterLabel, { color: isActive ? colors.text : colors.textSecondary }]}>{tab.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      )}
      {(!isConnected || queueTotal > 0) && (
        <View style={[styles.offlineQueueBanner, { backgroundColor: `${!isConnected ? colors.error : colors.warning}08`, borderBottomColor: colors.border }]}>
          <View style={[styles.offlineBannerDot, { backgroundColor: !isConnected ? colors.error : colors.warning }]} />
          {!isConnected ? <WifiOff color={colors.error} size={13} /> : <Clock color={colors.warning} size={13} />}
          <Text style={[styles.offlineQueueText, { color: !isConnected ? colors.error : colors.warning }]}>
            {!isConnected
              ? queueTotal > 0
                ? `Нет сети -- ${queueTotal} в очереди`
                : 'Нет подключения к сети'
              : `Отправка... ${pluralize(queueTotal, 'сообщение', 'сообщения', 'сообщений')}`}
          </Text>
          {!isConnected ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <TouchableOpacity onPress={() => clearQueue()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X color={colors.warning} size={14} />
            </TouchableOpacity>
          )}
        </View>
      )}
      <View
        style={{ flex: 1, overflow: 'hidden' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <RNAnimated.View style={[{ flex: 1 }, { transform: [{ translateX: swipeTranslateX }] }]}>
      {search.length >= 1 && (profileResults.length > 0 || channelSearchResults.length > 0 || searchResults.length > 0 || searchingMessages || filteredConversations.length > 0) ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: isDesktop ? 12 : insets.bottom + 76 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View>
              {/* Local chats matching */}
              {filteredConversations.length > 0 && (
                <View>
                  <View style={styles.searchSectionRow}>
                    <MessageCircle color={colors.textTertiary} size={14} />
                    <Text style={[styles.searchSectionLabelNew, { color: colors.textTertiary }]}>Мои чаты</Text>
                    <Text style={[styles.searchSectionCount, { color: colors.textTertiary }]}>{filteredConversations.length}</Text>
                  </View>
                  {filteredConversations.slice(0, 5).map((conv, index) => (
                    <View key={conv.id}>{renderConversation({ item: conv, index })}</View>
                  ))}
                </View>
              )}

              {/* People found on server */}
              {profileResults.length > 0 && (
                <View>
                  <View style={styles.searchSectionRow}>
                    <User color={colors.textTertiary} size={14} />
                    <Text style={[styles.searchSectionLabelNew, { color: colors.textTertiary }]}>Люди</Text>
                    <Text style={[styles.searchSectionCount, { color: colors.textTertiary }]}>{profileResults.length}</Text>
                  </View>
                  {profileResults.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.searchPersonItem}
                      onPress={() => router.push({ pathname: '/u/[userId]', params: { userId: p.id } })}
                      activeOpacity={0.7}
                    >
                      <Avatar uri={p.avatar_url} name={p.display_name || '?'} size="sm" />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.searchPersonName, { color: colors.text }]} numberOfLines={1}>
                            {p.display_name}
                          </Text>
                          {p.is_online && <View style={[styles.onlineDotSmall, { backgroundColor: colors.online }]} />}
                        </View>
                        {p.username && (
                          <Text style={[styles.searchPersonUsername, { color: colors.textTertiary }]} numberOfLines={1}>
                            @{p.username}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Public channels */}
              {channelSearchResults.length > 0 && (
                <View>
                  <View style={styles.searchSectionRow}>
                    <Globe color={colors.textTertiary} size={14} />
                    <Text style={[styles.searchSectionLabelNew, { color: colors.textTertiary }]}>Каналы</Text>
                    <Text style={[styles.searchSectionCount, { color: colors.textTertiary }]}>{channelSearchResults.length}</Text>
                  </View>
                  {channelSearchResults.map(ch => (
                    <TouchableOpacity
                      key={ch.id}
                      style={styles.searchPersonItem}
                      onPress={() => {
                        if (onChatPress) { onChatPress(ch.id); return; }
                        router.push({ pathname: '/chat/[id]', params: { id: ch.id } });
                      }}
                      activeOpacity={0.7}
                    >
                      {ch.avatar_url ? (
                        <Avatar uri={ch.avatar_url} name={ch.name} size="sm" />
                      ) : (
                        <View style={[styles.searchChannelIcon, { backgroundColor: colors.primary + '15' }]}>
                          <Megaphone color={colors.primary} size={18} />
                        </View>
                      )}
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[styles.searchPersonName, { color: colors.text }]} numberOfLines={1}>{ch.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {ch.username && (
                            <Text style={[styles.searchPersonUsername, { color: colors.textTertiary }]} numberOfLines={1}>
                              @{ch.username}
                            </Text>
                          )}
                          <Text style={[styles.searchChannelSubs, { color: colors.textTertiary }]}>
                            {ch.subscriber_count} подп.
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Messages header */}
              {(searchResults.length > 0 || searchingMessages) && (
                <View style={styles.searchSectionRow}>
                  <MessageCircle color={colors.textTertiary} size={14} />
                  <Text style={[styles.searchSectionLabelNew, { color: colors.textTertiary }]}>Сообщения</Text>
                  {searchResults.length > 0 && <Text style={[styles.searchSectionCount, { color: colors.textTertiary }]}>{searchResults.length}</Text>}
                </View>
              )}
              {searchingMessages && searchResults.length === 0 && (
                <View style={styles.searchLoading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.searchResultItem}
              onPress={() => {
                if (onChatPress) { onChatPress(item.conversation_id); return; }
                router.push({ pathname: '/chat/[id]', params: { id: item.conversation_id } });
              }}
              activeOpacity={0.7}
            >
              <View style={styles.searchResultContent}>
                <View style={styles.searchResultHeader}>
                  <Text style={[styles.searchResultChat, { color: colors.text }]} numberOfLines={1}>{item.chat_name}</Text>
                  <Text style={[styles.searchResultTime, { color: colors.textTertiary }]}>{formatTime(item.created_at)}</Text>
                </View>
                <Text style={[styles.searchResultSender, { color: colors.primary }]} numberOfLines={1}>{item.sender_name}</Text>
                <Text style={[styles.searchResultText, { color: colors.textSecondary }]} numberOfLines={2}>
                  {(() => {
                    if (!searchHighlightRegex) return item.content;
                    const parts = item.content.split(searchHighlightRegex);
                    if (parts.length === 1) return item.content;
                    return parts.map((p: string, i: number) =>
                      i % 2 === 1 ? <Text key={i} style={{ backgroundColor: colors.accent + '59', color: colors.text }}>{p}</Text> : p
                    );
                  })()}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : search.length >= 1 && !searchingMessages && filteredConversations.length === 0 && profileResults.length === 0 && channelSearchResults.length === 0 ? (
        <View style={styles.searchEmptyState}>
          <Search color={colors.textTertiary} size={32} />
          <Text style={[styles.searchEmptyTitle, { color: colors.text }]}>Ничего не найдено</Text>
          <Text style={[styles.searchEmptySubtitle, { color: colors.textSecondary }]}>
            Попробуйте изменить запрос
          </Text>
        </View>
      ) : loading ? (
        <ChatListSkeleton count={8} color={colors.backgroundTertiary} />
      ) : filteredConversations.length === 0 ? (
        showArchived ? (
          <EmptyState
            icon={<Archive color={colors.textTertiary} size={44} />}
            title="Архив пуст"
            subtitle="Архивированных чатов нет"
          />
        ) : (
          <AnimatedEmptyState section={chatFilter} />
        )
      ) : (
        <RNAnimated.FlatList
          ref={chatListRef as any}
          data={filteredConversations}
          renderItem={renderConversation}
          extraData={editMode ? `edit-${Array.from(selectedChats).join(',')}` : 'normal'}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          contentContainerStyle={[styles.list, { paddingBottom: isDesktop ? 12 : insets.bottom + 76 }]}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadConversations(); }} tintColor={colors.primary} />}
          windowSize={perf.listWindowRender}
          maxToRenderPerBatch={perf.listInitialRender}
          initialNumToRender={perf.listInitialRender}
          removeClippedSubviews={!perf.isLowEnd}
          updateCellsBatchingPeriod={100}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          ListHeaderComponent={!showArchived && archivedCount > 0 ? (
            <TouchableOpacity
              style={[styles.archivedRow, { backgroundColor: colors.background }]}
              onPress={() => setShowArchived(true)}
              activeOpacity={0.7}
            >
              <View style={[styles.archivedIconWrap, { backgroundColor: colors.primary + '15' }]}>
                <Archive color={colors.primary} size={18} />
              </View>
              <Text style={[styles.archivedRowText, { color: colors.text }]}>Архивные чаты</Text>
              <View style={styles.archivedRowRight}>
                {archivedUnreadCount > 0 && (
                  <View style={styles.archivedUnreadBadge}>
                    <Text style={styles.archivedUnreadBadgeText}>{archivedUnreadCount > 99 ? '99+' : archivedUnreadCount}</Text>
                  </View>
                )}
                <Text style={[styles.archivedRowCount, { color: colors.textTertiary }]}>{archivedCount}</Text>
              </View>
            </TouchableOpacity>
          ) : null}
          contentOffset={!showArchived && archivedCount > 0 ? { x: 0, y: 60 } : undefined}
        />
      )}
        </RNAnimated.View>
      </View>

      {showNewMenu && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={toggleNewMenu}
        />
      )}

      <BottomSheet visible={actionMenu !== null} onClose={() => setActionMenu(null)}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {actionMenu?.type === 'direct'
              ? actionMenu?.otherUser?.display_name || 'Пользователь'
              : actionMenu?.name || 'Группа'}
          </Text>
          <TouchableOpacity onPress={() => setActionMenu(null)}>
            <X color={colors.textSecondary} size={20} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.modalAction}
          onPress={() => actionMenu && handleTogglePin(actionMenu)}
        >
          {actionMenu?.is_pinned ? <PinOff color={colors.text} size={20} /> : <Pin color={colors.text} size={20} />}
          <Text style={[styles.modalActionText, { color: colors.text }]}>
            {actionMenu?.is_pinned ? 'Открепить' : 'Закрепить'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.modalAction}
          onPress={() => actionMenu && handleToggleMute(actionMenu)}
        >
          {actionMenu?.is_muted ? <Bell color={colors.text} size={20} /> : <BellOff color={colors.text} size={20} />}
          <Text style={[styles.modalActionText, { color: colors.text }]}>
            {actionMenu?.is_muted ? 'Включить уведомления' : 'Отключить уведомления'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.modalAction}
          onPress={() => actionMenu && handleToggleArchive(actionMenu)}
        >
          {actionMenu?.is_archived ? <ArchiveRestore color={colors.text} size={20} /> : <Archive color={colors.text} size={20} />}
          <Text style={[styles.modalActionText, { color: colors.text }]}>
            {actionMenu?.is_archived ? 'Разархивировать' : 'Архивировать'}
          </Text>
        </TouchableOpacity>

        {actionMenu && actionMenu.unreadCount > 0 && (
          <TouchableOpacity
            style={styles.modalAction}
            onPress={() => handleMarkAsRead(actionMenu)}
          >
            <Eye color={colors.text} size={20} />
            <Text style={[styles.modalActionText, { color: colors.text }]}>Прочитать всё</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.modalAction}
          onPress={() => actionMenu && handleDeleteChat(actionMenu)}
        >
          <Trash2 color={colors.error} size={20} />
          <Text style={[styles.modalActionText, { color: colors.error }]}>Удалить чат</Text>
        </TouchableOpacity>

        {actionMenu?.type === 'direct' && (
          <TouchableOpacity
            style={styles.modalAction}
            onPress={() => actionMenu && handleBlockUser(actionMenu)}
          >
            <Ban color={colors.error} size={20} />
            <Text style={[styles.modalActionText, { color: colors.error }]}>Заблокировать</Text>
          </TouchableOpacity>
        )}
      </BottomSheet>

      <UndoSnackbar
        visible={snackbar !== null}
        message={snackbar?.message || ''}
        onUndo={() => {
          snackbar?.undoFn();
          setSnackbar(null);
        }}
        onDismiss={() => setSnackbar(null)}
      />

      <ConfirmDialog
        visible={confirmDialog !== null}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmText={confirmDialog?.confirmText || 'Подтвердить'}
        destructive={confirmDialog?.destructive ?? false}
        onConfirm={() => confirmDialog?.onConfirm()}
        onCancel={() => setConfirmDialog(null)}
      />
    </View>
  );
}

export default function ChatsScreen() {
  const { isDesktop } = useDesktopLayout();
  if (isDesktop) return null;
  return <ChatListContent />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  newChatButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  newMenuRow: {
    position: 'absolute',
    right: 42,
    top: 0,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 4,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 1,
  },
  newMenuBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  newMenuDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    marginHorizontal: 2,
  },
  searchBarExpanded: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  searchClearButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingHorizontal: 0, paddingTop: 6 },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  chatContent: { flex: 1, justifyContent: 'center' },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: { fontWeight: '600', flexShrink: 1, letterSpacing: 0.1, fontSize: 15.5 },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1DA1F2',
    marginLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
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
  chatTime: { fontSize: 12, fontVariant: ['tabular-nums'] as any, letterSpacing: 0.3 },
  chatFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 6 },
  chatPreview: { flex: 1, lineHeight: 20, fontSize: 14 },
  unreadBadge: {
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 7,
    marginLeft: 8,
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },
  skeletonLine: { height: 8, borderRadius: 4 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', letterSpacing: 0.1 },
  modalAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  modalActionText: { fontSize: 16, fontWeight: '500', letterSpacing: 0.1 },
  searchSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  searchSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  searchSectionLabelNew: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  searchSectionCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchPersonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  searchPersonName: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  searchPersonUsername: {
    fontSize: 13,
  },
  onlineDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  searchChannelIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchChannelSubs: {
    fontSize: 12,
  },
  searchJoinBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  searchJoinBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  searchEmptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  searchEmptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginTop: 8,
  },
  searchEmptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  searchLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  searchResultItem: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  searchResultContent: { flex: 1 },
  searchResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  searchResultChat: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  searchResultTime: { fontSize: 12 },
  searchResultSender: { fontSize: 13, fontWeight: '500', marginBottom: 2 },
  searchResultText: { fontSize: 14, lineHeight: 20 },
  swipeActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swipeActionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swipeAction: {
    width: 76,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
  },
  swipeActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  offlineQueueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  offlineBannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  offlineQueueText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  queueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 4,
  },
  queueBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  chatFilterBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chatFilterContainer: {
    flexDirection: 'row',
    borderRadius: 22,
    padding: 4,
  },
  chatFilterTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatFilterLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    justifyContent: 'center',
  },
  storiesInlineContainer: {
    overflow: 'hidden',
  },
  editButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  headerRightButtons: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  searchBarFake: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  searchBarFakeText: {
    fontSize: 16,
  },
  editModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editCheckbox: {
    paddingLeft: 16,
    paddingRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editCheckboxInner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editReorderButtons: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 12,
    gap: 2,
  },
  editReorderBtn: {
    padding: 4,
  },
  editHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSelectedText: {
    fontSize: 16,
    fontWeight: '600',
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  archivedIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  archivedRowText: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  archivedRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  archivedUnreadBadge: {
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archivedUnreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  archivedRowCount: {
    fontSize: 14,
    fontWeight: '500',
  },
});

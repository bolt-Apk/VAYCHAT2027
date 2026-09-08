import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { pluralize } from '@/lib/pluralize';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Pressable,
  Animated as RNAnimated,
  Easing,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Phone as PhoneIcon,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Video,
  Trash2,
  Search,
  X,
  PhoneCall,
  Clock,
  Calendar,
  ArrowUpRight,
  ArrowDownLeft,
  Users,
} from 'lucide-react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useScrollToTop } from '@/lib/scroll-to-top-context';
import Avatar from '@/components/Avatar';
import ConfirmDialog from '@/components/ConfirmDialog';
import BottomSheet from '@/components/BottomSheet';
import EmptyState from '@/components/EmptyState';
import { CallsListSkeleton } from '@/components/Skeleton';
import { useAppearance } from '@/lib/appearance-context';
import { dataCache } from '@/lib/data-cache';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';

interface CallRecord {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: 'voice' | 'video';
  status: string;
  started_at: string;
  duration: number;
  is_group_call?: boolean;
  group_name?: string;
  otherUser: {
    display_name: string;
    avatar_url: string | null;
  };
}

interface GroupedCall {
  key: string;
  calls: CallRecord[];
  otherUser: CallRecord['otherUser'];
  otherId: string;
  call_type: 'voice' | 'video';
  isMissed: boolean;
  isOutgoing: boolean;
  latestDate: string;
  totalDuration: number;
}

type Filter = 'all' | 'missed';

export function CallsListContent() {
  const { user } = useAuth();
  const { colors, fontScale } = useAppearance();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDesktopLayout();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchWidthAnim = useRef(new RNAnimated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);
  const [detailGroup, setDetailGroup] = useState<GroupedCall | null>(null);
  const callsListRef = useRef<FlatList>(null);

  const scrollToTopUnsub = useScrollToTop('calls', () => {
    callsListRef.current?.scrollToOffset({ offset: 0, animated: true });
  });

  useEffect(() => {
    return scrollToTopUnsub();
  }, [scrollToTopUnsub]);

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

  const enrichCallsWithProfiles = useCallback((rawCalls: any[], userId: string, profileMap: Map<string, any>): CallRecord[] => {
    return rawCalls.map(call => {
      const otherId = call.caller_id === userId ? call.receiver_id : call.caller_id;
      const profile = profileMap.get(otherId);
      return {
        ...call,
        otherUser: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : { display_name: 'Пользователь', avatar_url: null },
      };
    });
  }, []);

  const buildCallsFromCache = useCallback(() => {
    if (!user?.id) return false;
    const cachedCalls = dataCache.getCalls();
    if (!cachedCalls.length) return false;

    const otherUserIds = [...new Set(cachedCalls.map(c => c.caller_id === user.id ? c.receiver_id : c.caller_id))];
    const profileMap = new Map<string, any>();
    otherUserIds.forEach(id => {
      const p = dataCache.getProfile(id);
      if (p) profileMap.set(id, p);
    });

    const enriched = enrichCallsWithProfiles(cachedCalls, user.id, profileMap);
    setCalls(enriched);
    setLoading(false);
    return true;
  }, [user?.id, enrichCallsWithProfiles]);

  const loadCalls = useCallback(async () => {
    if (!user?.id) return;

    const { data } = await supabase
      .from('calls')
      .select('id, caller_id, receiver_id, call_type, status, started_at, duration, is_group_call, group_name')
      .or(`caller_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('started_at', { ascending: false })
      .limit(100);

    if (!data) {
      setLoading(false);
      return;
    }

    dataCache.setCalls(data);

    const otherUserIds = [...new Set(data.map(c => c.caller_id === user.id ? c.receiver_id : c.caller_id))];

    const cachedAll = otherUserIds.every(id => dataCache.getProfile(id));
    let profileMap: Map<string, any>;
    if (cachedAll) {
      profileMap = new Map(otherUserIds.map(id => [id, dataCache.getProfile(id)!]));
    } else {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', otherUserIds);
      profileMap = new Map((profiles || []).map(p => [p.id, p]));
    }

    const enriched = enrichCallsWithProfiles(data, user.id, profileMap);
    setCalls(enriched);
    setLoading(false);
  }, [user, enrichCallsWithProfiles]);

  useEffect(() => {
    if (user?.id && loading) {
      buildCallsFromCache();
    }
  }, [user?.id, loading, buildCallsFromCache]);

  useEffect(() => {
    loadCalls();
    const unsub = dataCache.subscribe(() => {
      if (dataCache.isCallsFetched()) {
        buildCallsFromCache();
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase.channel('calls-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'calls',
        filter: `caller_id=eq.${user.id}`,
      }, () => { loadCalls(); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'calls',
        filter: `receiver_id=eq.${user.id}`,
      }, () => { loadCalls(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, loadCalls]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCalls();
    setRefreshing(false);
  };

  const groupCalls = useCallback((callList: CallRecord[]): GroupedCall[] => {
    if (!user?.id) return [];
    const groups: GroupedCall[] = [];
    let current: GroupedCall | null = null;

    for (const call of callList) {
      const otherId = call.caller_id === user.id ? call.receiver_id : call.caller_id;
      const isMissed = call.status === 'missed' || call.status === 'declined';
      const isOutgoing = call.caller_id === user.id;
      const dateKey = new Date(call.started_at).toDateString();

      if (
        current &&
        current.otherId === otherId &&
        current.call_type === call.call_type &&
        current.isMissed === isMissed &&
        current.isOutgoing === isOutgoing &&
        new Date(current.latestDate).toDateString() === dateKey
      ) {
        current.calls.push(call);
        current.totalDuration += call.duration || 0;
      } else {
        current = {
          key: call.id,
          calls: [call],
          otherUser: call.otherUser,
          otherId,
          call_type: call.call_type,
          isMissed,
          isOutgoing,
          latestDate: call.started_at,
          totalDuration: call.duration || 0,
        };
        groups.push(current);
      }
    }
    return groups;
  }, [user]);

  const filteredCalls = useMemo(() => {
    let result = filter === 'missed'
      ? calls.filter(c => c.status === 'missed' || c.status === 'declined')
      : calls;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c => c.otherUser.display_name.toLowerCase().includes(q));
    }

    return result;
  }, [calls, filter, search]);

  const groupedCalls = useMemo(() => groupCalls(filteredCalls), [filteredCalls, groupCalls]);

  const flatCallData = useMemo(() => {
    const result: Array<{ type: 'date'; label: string } | { type: 'call'; data: GroupedCall }> = [];
    let lastDateKey = '';
    for (const group of groupedCalls) {
      const date = new Date(group.latestDate);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      let dateKey: string;
      if (days === 0) dateKey = 'Сегодня';
      else if (days === 1) dateKey = 'Вчера';
      else if (days < 7) dateKey = date.toLocaleDateString('ru-RU', { weekday: 'long' });
      else dateKey = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

      if (dateKey !== lastDateKey) {
        result.push({ type: 'date', label: dateKey });
        lastDateKey = dateKey;
      }
      result.push({ type: 'call', data: group });
    }
    return result;
  }, [groupedCalls]);

  const handleDeleteGroup = async (group: GroupedCall) => {
    const ids = group.calls.map(c => c.id);
    setCalls(prev => prev.filter(c => !ids.includes(c.id)));
    await supabase.from('calls').delete().in('id', ids);
  };

  const handleDeleteSingleCall = async (callId: string) => {
    setCalls(prev => prev.filter(c => c.id !== callId));
    setDetailGroup(prev => {
      if (!prev) return null;
      const updated = prev.calls.filter(c => c.id !== callId);
      if (updated.length === 0) return null;
      return { ...prev, calls: updated };
    });
    await supabase.from('calls').delete().eq('id', callId);
  };

  const handleClearHistory = async () => {
    if (!user?.id) return;
    await supabase
      .from('calls')
      .delete()
      .or(`caller_id.eq.${user.id},receiver_id.eq.${user.id}`);
    setCalls([]);
  };

  const [callError, setCallError] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const callBack = async (group: GroupedCall) => {
    if (!user?.id) return;
    setCallError(null);
    const { data, error } = await supabase.from('calls').insert({
      caller_id: user.id,
      receiver_id: group.otherId,
      call_type: group.call_type,
      status: 'ringing',
    }).select('id').single();

    if (error || !data?.id) {
      setCallError('Не удалось начать звонок');
      setTimeout(() => setCallError(null), 3000);
      return;
    }

    let conversationId = '';
    const { data: myConvs } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', user.id);
    if (myConvs) {
      const { data: shared } = await supabase.from('conversation_members')
        .select('conversation_id').eq('user_id', group.otherId)
        .in('conversation_id', myConvs.map(c => c.conversation_id));
      if (shared && shared.length > 0) conversationId = shared[0].conversation_id;
    }

    router.push({
      pathname: '/call',
      params: {
        type: group.call_type,
        userId: group.otherId,
        name: group.otherUser.display_name,
        callId: data.id,
        role: 'caller',
        conversationId,
      },
    });
  };

  const getCallIcon = (group: GroupedCall) => {
    if (group.isMissed) return <PhoneMissed color={colors.error} size={16} />;
    if (group.isOutgoing) return <PhoneOutgoing color={colors.success} size={16} />;
    return <PhoneIncoming color={colors.primary} size={16} />;
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  const formatFullDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) +
      ' в ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusLabel = (group: GroupedCall) => {
    const type = group.call_type === 'video' ? 'Видео' : 'Аудио';
    const count = group.calls.length > 1 ? ` (${group.calls.length})` : '';
    const dur = group.totalDuration > 0 ? ` \u00B7 ${formatDuration(group.totalDuration)}` : '';
    return `${type}${count}${dur}`;
  };

  const getCallStatusText = (call: CallRecord) => {
    if (!user) return '';
    const isOutgoing = call.caller_id === user.id;
    if (call.status === 'missed') return isOutgoing ? 'Не ответили' : 'Пропущенный';
    if (call.status === 'declined') return isOutgoing ? 'Отклонено' : 'Отклонён';
    if (call.status === 'ended') return call.duration > 0 ? formatDuration(call.duration) : 'Завершён';
    return call.status;
  };

  const renderSwipeRight = (group: GroupedCall) => (
    <TouchableOpacity
      style={[styles.swipeDeleteAction, { backgroundColor: colors.error }]}
      onPress={() => handleDeleteGroup(group)}
    >
      <Trash2 color="#FFFFFF" size={20} />
      <Text style={styles.swipeDeleteText}>Удалить</Text>
    </TouchableOpacity>
  );

  const callKeyExtractor = useCallback((item: typeof flatCallData[number], idx: number) =>
    item.type === 'date' ? `date-${idx}` : item.data.key, []);

  const renderFlatItem = useCallback(({ item }: { item: typeof flatCallData[number] }) => {
    if (item.type === 'date') {
      return (
        <View style={styles.dateSectionHeader}>
          <Text style={[styles.dateSectionText, { color: colors.textSecondary }]}>{item.label}</Text>
        </View>
      );
    }

    const group = item.data;
    const latestCall = group.calls[0];
    const name = latestCall?.is_group_call && latestCall?.group_name
      ? latestCall.group_name
      : group.otherUser.display_name;

    return (
      <Swipeable
        renderRightActions={() => renderSwipeRight(group)}
        overshootRight={false}
        friction={2}
      >
        <Pressable
          style={[styles.callItem, { backgroundColor: colors.background }]}
          onPress={() => setDetailGroup(group)}
          accessibilityRole="button"
          accessibilityLabel={`Звонок ${group.otherUser.display_name}`}
        >
          <View style={styles.avatarContainer}>
            <Avatar
              uri={group.otherUser.avatar_url}
              name={group.otherUser.display_name || 'U'}
              size="md"
            />
            <View style={[styles.callTypeIcon, { backgroundColor: group.isMissed ? colors.error : colors.success, borderColor: colors.background }]}>
              {latestCall?.is_group_call ? (
                <Users color="#FFFFFF" size={10} />
              ) : group.call_type === 'video' ? (
                <Video color="#FFFFFF" size={10} />
              ) : (
                <PhoneIcon color="#FFFFFF" size={10} />
              )}
            </View>
          </View>

          <View style={styles.callContent}>
            <Text
              style={[styles.callName, { color: group.isMissed ? colors.error : colors.text, fontSize: 16 * fontScale }]}
              numberOfLines={1}
            >
              {name}
            </Text>
            <View style={styles.callInfo}>
              {getCallIcon(group)}
              <Text style={[styles.callType, { color: colors.textSecondary }]}>
                {getStatusLabel(group)}
              </Text>
            </View>
          </View>

          <View style={styles.callMeta}>
            <Text style={[styles.callDate, { color: colors.textTertiary }]}>{formatDate(group.latestDate)}</Text>
            <TouchableOpacity
              style={[styles.callBackButton, { backgroundColor: colors.backgroundTertiary }]}
              onPress={() => { callBack(group); }}
              accessibilityLabel="Перезвонить"
            >
              <PhoneCall color={colors.primary} size={16} />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Swipeable>
    );
  }, [colors, fontScale]);

  const missedCount = calls.filter(c => c.status === 'missed' || c.status === 'declined').length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 12 }]}>
        {searchExpanded ? (
          <RNAnimated.View style={[styles.searchBarExpanded, { backgroundColor: colors.backgroundSecondary, opacity: searchWidthAnim }]}>
            <Search color={colors.textTertiary} size={17} />
            <TextInput
              ref={searchInputRef}
              style={[styles.searchInput, { color: colors.text }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск по имени"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <TouchableOpacity onPress={toggleSearch} hitSlop={8} accessibilityLabel="Закрыть поиск">
              <X color={colors.textSecondary} size={18} />
            </TouchableOpacity>
          </RNAnimated.View>
        ) : (
          <>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Звонки</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.headerButton, { backgroundColor: colors.backgroundSecondary }]}
                onPress={toggleSearch}
                accessibilityLabel="Поиск"
              >
                <Search color={colors.textSecondary} size={18} />
              </TouchableOpacity>
              {calls.length > 0 && (
                <TouchableOpacity
                  style={[styles.headerButton, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={handleClearHistory}
                  accessibilityLabel="Очистить историю"
                >
                  <Trash2 color={colors.error} size={18} />
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </View>

      <View style={[styles.filterRow, { backgroundColor: colors.backgroundSecondary }]}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && { backgroundColor: colors.primary }]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterText, { color: filter === 'all' ? '#FFFFFF' : colors.textSecondary }]}>
            Все
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'missed' && { backgroundColor: colors.primary }]}
          onPress={() => setFilter('missed')}
        >
          <Text style={[styles.filterText, { color: filter === 'missed' ? '#FFFFFF' : colors.textSecondary }]}>
            Пропущенные{missedCount > 0 ? ` (${missedCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <CallsListSkeleton count={6} color={colors.skeleton} />
      ) : groupedCalls.length === 0 ? (
        <EmptyState
          icon={<PhoneIcon size={44} color={colors.textTertiary} />}
          title={search ? 'Ничего не найдено' : filter === 'missed' ? 'Нет пропущенных' : 'Нет звонков'}
          subtitle={search ? 'Попробуйте изменить запрос' : 'Ваша история звонков появится здесь'}
        />
      ) : (
        <FlatList
          ref={callsListRef}
          data={flatCallData}
          renderItem={renderFlatItem}
          keyExtractor={callKeyExtractor}
          contentContainerStyle={[styles.list, { paddingBottom: isDesktop ? 12 : insets.bottom + 76 }]}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          windowSize={7}
          maxToRenderPerBatch={10}
          initialNumToRender={15}
          removeClippedSubviews={true}
        />
      )}

      {callError && (
        <View style={[styles.errorToast, { backgroundColor: colors.error, bottom: insets.bottom + 80 }]}>
          <Text style={styles.errorToastText}>{callError}</Text>
        </View>
      )}

      {/* Call Detail Modal */}
      <BottomSheet visible={!!detailGroup} onClose={() => setDetailGroup(null)} scrollable maxHeight="80%">
            {detailGroup && (() => {
              const name = detailGroup.otherUser.display_name;
              return (
                <>
                  <View style={styles.detailHeader}>
                    <View style={styles.detailProfileRow}>
                      <Avatar
                        uri={detailGroup.otherUser.avatar_url}
                        name={detailGroup.otherUser.display_name || 'U'}
                        size="lg"
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.detailName, { color: colors.text }]}>{name}</Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 2 }}>
                          {pluralize(detailGroup.calls.length, 'звонок', 'звонка', 'звонков')}
                          {detailGroup.totalDuration > 0 ? ` \u00B7 ${formatDuration(detailGroup.totalDuration)}` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setDetailGroup(null)}
                        accessibilityLabel="Закрыть"
                        style={[styles.detailCloseBtn, { backgroundColor: colors.backgroundTertiary }]}
                      >
                        <X color={colors.textSecondary} size={16} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.detailQuickActions}>
                      <TouchableOpacity
                        style={[styles.detailActionBtn, { backgroundColor: `${colors.success}12` }]}
                        onPress={() => { setDetailGroup(null); callBack({ ...detailGroup, call_type: 'voice' }); }}
                        activeOpacity={0.7}
                      >
                        <PhoneIcon color={colors.success} size={18} />
                        <Text style={[styles.detailActionLabel, { color: colors.success }]}>Звонок</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.detailActionBtn, { backgroundColor: `${colors.primary}12` }]}
                        onPress={() => { setDetailGroup(null); callBack({ ...detailGroup, call_type: 'video' }); }}
                        activeOpacity={0.7}
                      >
                        <Video color={colors.primary} size={18} />
                        <Text style={[styles.detailActionLabel, { color: colors.primary }]}>Видео</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

                  <Text style={[styles.detailSectionTitle, { color: colors.textTertiary }]}>
                    История звонков
                  </Text>

                  {detailGroup.calls.map((call, idx) => {
                    const isOutgoing = call.caller_id === user?.id;
                    const isMissed = call.status === 'missed' || call.status === 'declined';
                    const isLast = idx === detailGroup.calls.length - 1;
                    return (
                      <View key={call.id} style={[styles.detailCallRow, !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                        <View style={[styles.detailCallIcon, { backgroundColor: isMissed ? `${colors.error}12` : `${colors.success}12` }]}>
                          {isOutgoing ? (
                            <ArrowUpRight color={isMissed ? colors.error : colors.success} size={16} />
                          ) : (
                            <ArrowDownLeft color={isMissed ? colors.error : colors.primary} size={16} />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailCallStatus, { color: isMissed ? colors.error : colors.text }]}>
                            {isOutgoing ? 'Исходящий' : 'Входящий'} {call.call_type === 'video' ? 'видео' : ''}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <Calendar color={colors.textTertiary} size={12} />
                            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{formatFullDate(call.started_at)}</Text>
                            {call.duration > 0 && (
                              <>
                                <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{'\u00B7'}</Text>
                                <Clock color={colors.textTertiary} size={12} />
                                <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{formatDuration(call.duration)}</Text>
                              </>
                            )}
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteSingleCall(call.id)}
                          hitSlop={12}
                          style={[styles.detailCallDeleteBtn, { backgroundColor: `${colors.error}08` }]}
                          accessibilityLabel="Удалить"
                        >
                          <Trash2 color={colors.error} size={15} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}

                  <TouchableOpacity
                    style={[styles.detailDeleteAll, { backgroundColor: `${colors.error}0A`, borderColor: `${colors.error}20`, borderWidth: 1 }]}
                    onPress={() => setConfirmDeleteAll(true)}
                    activeOpacity={0.7}
                  >
                    <Trash2 color={colors.error} size={16} />
                    <Text style={{ color: colors.error, fontSize: 14, fontWeight: '600' }}>Удалить все звонки</Text>
                  </TouchableOpacity>
                  <ConfirmDialog
                    visible={confirmDeleteAll}
                    title="Удалить все звонки"
                    message={`Удалить все звонки с ${detailGroup.otherUser.display_name || 'этим контактом'}?`}
                    confirmText="Удалить"
                    destructive
                    onConfirm={() => { setConfirmDeleteAll(false); handleDeleteGroup(detailGroup); setDetailGroup(null); }}
                    onCancel={() => setConfirmDeleteAll(false)}
                  />
                </>
              );
            })()}
      </BottomSheet>
    </View>
  );
}

export default function CallsScreen() {
  const { isDesktop } = useDesktopLayout();
  if (isDesktop) return null;
  return <CallsListContent />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBarExpanded: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 36,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  filterRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 3,
    marginBottom: 10,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  list: {
    paddingHorizontal: 0,
  },
  callItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  callTypeIcon: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  callContent: {
    flex: 1,
  },
  callName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 3,
    letterSpacing: 0.1,
  },
  callInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  callType: {
    fontSize: 13,
  },
  callMeta: {
    alignItems: 'flex-end',
    gap: 6,
  },
  callDate: {
    fontSize: 12,
  },
  callBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateSectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 5,
  },
  dateSectionText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  swipeDeleteAction: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeDeleteText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  detailHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  detailProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  detailName: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  detailCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailQuickActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  detailActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    gap: 8,
  },
  detailActionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 20,
    marginHorizontal: 20,
  },
  detailSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 8,
  },
  detailCallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  detailCallIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCallStatus: {
    fontSize: 15,
    fontWeight: '500',
  },
  detailCallDeleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailDeleteAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  errorToast: {
    position: 'absolute',
    left: 24,
    right: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    zIndex: 50,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.15)' },
      default: { elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    }) as any,
  },
  errorToastText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  skeletonLine: { height: 10, borderRadius: 5 },
});

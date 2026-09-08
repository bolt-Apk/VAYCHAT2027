import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { pluralize } from '@/lib/pluralize';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  RefreshControl, Pressable, Animated, Easing,
  Platform, ActivityIndicator,
  SectionList,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Search, UserPlus, MessageCircle, Users, Trash2, X,
  Phone as PhoneIcon, Video, UserX, Clock, UserCheck,
  Ban, Copy, BookUser, ChevronRight, RefreshCw, Contact as ContactIcon,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Contacts from 'expo-contacts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import EmptyState from '@/components/EmptyState';
import { useAppearance } from '@/lib/appearance-context';
import { useScrollToTop } from '@/lib/scroll-to-top-context';
import { dataCache, isUserOnline, applyPrivacy, type CachedContact } from '@/lib/data-cache';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';

type AppContact = CachedContact;

interface PhonebookMatch {
  profileId: string;
  display_name: string;
  avatar_url: string | null;
  phone: string;
  is_online: boolean;
  last_seen: string | null;
  phonebookName: string;
  alreadyAdded: boolean;
}

interface PendingContact {
  id: string;
  phone: string;
  nickname: string | null;
  created_at: string;
}

interface JoinNotification {
  id: string;
  joined_user_id: string;
  is_read: boolean;
  created_at: string;
  joined_profile?: {
    display_name: string;
    avatar_url: string | null;
    phone: string;
  };
}

export function ContactsListContent({ onContactPress }: { onContactPress?: (userId: string) => void } = {}) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, fontScale } = useAppearance();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDesktopLayout();

  const [contacts, setContacts] = useState<AppContact[]>([]);
  const [phonebookMatches, setPhonebookMatches] = useState<PhonebookMatch[]>([]);
  const [phonebookSyncing, setPhonebookSyncing] = useState(false);

  const [search, setSearch] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [newPhone, setNewPhone] = useState('+7');
  const [addError, setAddError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedContact, setSelectedContact] = useState<AppContact | null>(null);
  const [pendingContacts, setPendingContacts] = useState<PendingContact[]>([]);
  const [joinNotifications, setJoinNotifications] = useState<JoinNotification[]>([]);
  const [showPendingSavePrompt, setShowPendingSavePrompt] = useState(false);
  const [pendingSavePhone, setPendingSavePhone] = useState('');
  const [pendingNickname, setPendingNickname] = useState('');
  const joinBannerAnim = useRef(new Animated.Value(0)).current;
  const listRef = useRef<SectionList>(null);
  const mountedRef = useRef(true);

  const scrollToTopUnsub = useScrollToTop('contacts', () => {
    listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: true, viewOffset: 0 });
  });

  useEffect(() => {
    return scrollToTopUnsub();
  }, [scrollToTopUnsub]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Restore from cache instantly, then refresh from server
  useEffect(() => {
    if (!user) return;

    const cached = dataCache.getContacts();
    if (cached.length > 0) {
      setContacts(cached);
    }

    const unsub = dataCache.subscribe(() => {
      const fresh = dataCache.getContacts();
      if (fresh.length > 0 && mountedRef.current) setContacts(fresh);
    });

    loadContacts();
    loadPendingContacts();
    loadJoinNotifications();
    if (Platform.OS !== 'web') syncPhonebook();

    return unsub;
  }, [user]);

  // --- Data loading ---

  const loadContacts = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('contacts')
      .select(`id, contact_id, nickname, profile:profiles!contacts_contact_id_fkey(display_name, avatar_url, phone, is_online, status_text, last_seen, privacy_settings)`)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) {
      const mapped = data.map((c: any) => {
        const profile = Array.isArray(c.profile) ? c.profile[0] : c.profile;
        if (profile) {
          const cached = dataCache.getProfile(c.contact_id);
          if (cached) { profile.is_online = cached.is_online; profile.last_seen = cached.last_seen; }
        }
        return { ...c, profile };
      }).filter((c: any) => c.profile);
      setContacts(mapped);
      dataCache.setContacts(mapped);
    }
  };

  const loadPendingContacts = async () => {
    if (!user) return;
    const { data } = await supabase.from('pending_contacts').select('id, phone, nickname, created_at').eq('user_id', user.id).order('created_at', { ascending: false });
    if (data) setPendingContacts(data);
  };

  const loadJoinNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('contact_join_notifications').select('id, joined_user_id, is_read, created_at').eq('user_id', user.id).eq('is_read', false).order('created_at', { ascending: false }).limit(10);
    if (!data?.length) { setJoinNotifications([]); return; }
    const userIds = data.map(n => n.joined_user_id);
    const { data: profiles } = await supabase.from('profiles').select('id, display_name, avatar_url, phone, privacy_settings').in('id', userIds);
    const profileMap = new Map((profiles || []).map(p => {
      const ps = p.privacy_settings as { show_phone?: boolean } | null;
      return [p.id, { ...p, phone: ps?.show_phone === false ? null : p.phone }];
    }));
    const enriched = data.map(n => ({ ...n, joined_profile: profileMap.get(n.joined_user_id) }));
    setJoinNotifications(enriched);
    if (enriched.length > 0) {
      Animated.timing(joinBannerAnim, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [user?.id]);

  // --- Phonebook sync ---

  const normalizePhone = (raw: string): string => {
    const cleaned = raw.replace(/[^\d+]/g, '');
    let digits = cleaned.startsWith('+') ? cleaned : cleaned.replace(/\D/g, '');
    if (!digits.startsWith('+')) {
      if (digits.startsWith('8') && digits.length === 11) digits = '7' + digits.slice(1);
      digits = '+' + digits;
    }
    return digits;
  };

  const syncPhonebook = async () => {
    if (!user) return;
    if (Platform.OS === 'web') {
      return;
    }
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') return;
      setPhonebookSyncing(true);

      const { data: deviceContacts } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });

      const phoneMap = new Map<string, string>();
      for (const dc of deviceContacts) {
        if (!dc.phoneNumbers?.length) continue;
        const name = dc.name || dc.firstName || '';
        for (const pn of dc.phoneNumbers) {
          if (pn.number) {
            const normalized = normalizePhone(pn.number);
            if (normalized.length >= 10) phoneMap.set(normalized, name);
          }
        }
      }

      if (phoneMap.size === 0) { if (mountedRef.current) setPhonebookSyncing(false); return; }

      const phones = [...phoneMap.keys()];
      const batchSize = 50;
      const allProfiles: any[] = [];
      for (let i = 0; i < phones.length; i += batchSize) {
        const batch = phones.slice(i, i + batchSize);
        const { data } = await supabase.from('profiles').select('id, display_name, avatar_url, phone, is_online, last_seen, privacy_settings').in('phone', batch);
        if (data) allProfiles.push(...data);
      }

      const addedIds = new Set(contacts.map(c => c.contact_id));

      const matches: PhonebookMatch[] = allProfiles
        .filter(p => p.id !== user.id)
        .map(p => {
          const ps = p.privacy_settings as { show_online?: boolean; show_last_seen?: boolean; show_phone?: boolean } | null;
          return {
            profileId: p.id,
            display_name: p.display_name,
            avatar_url: p.avatar_url,
            phone: ps?.show_phone === false ? null : p.phone,
            is_online: ps?.show_online === false ? false : p.is_online,
            last_seen: ps?.show_last_seen === false ? null : p.last_seen,
            phonebookName: phoneMap.get(p.phone) || p.display_name,
            alreadyAdded: addedIds.has(p.id),
          };
        });

      if (mountedRef.current) {
        setPhonebookMatches(matches);
        setPhonebookSyncing(false);
      }
    } catch {
      if (mountedRef.current) setPhonebookSyncing(false);
    }
  };

  const addPhonebookContact = async (match: PhonebookMatch) => {
    if (!user) return;
    const { error } = await supabase.from('contacts').insert({ user_id: user.id, contact_id: match.profileId });
    if (!error) {
      setPhonebookMatches(prev => prev.map(m => m.profileId === match.profileId ? { ...m, alreadyAdded: true } : m));
      loadContacts();
    }
  };

  // --- Realtime ---

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`join-notifs-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contact_join_notifications', filter: `user_id=eq.${user.id}` }, () => {
        loadJoinNotifications();
        loadContacts();
        loadPendingContacts();
        if (Platform.OS !== 'web') syncPhonebook();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadContacts(), loadPendingContacts(), loadJoinNotifications(), syncPhonebook()]);
    setRefreshing(false);
  };

  // --- Contact actions ---

  const handleAddContact = async () => {
    if (!user) return;
    setAddError('');
    const cleanPhone = newPhone.replace(/[^\d+]/g, '');
    if (cleanPhone.length !== 12 || !cleanPhone.startsWith('+7')) { setAddError('Введите корректный номер'); return; }
    const { data: profile } = await supabase.from('profiles').select('id, privacy_settings, searchable').eq('phone', cleanPhone).maybeSingle();
    if (!profile) { setPendingSavePhone(cleanPhone); setShowPendingSavePrompt(true); return; }
    const ps = profile.privacy_settings as { show_phone?: boolean } | null;
    if (ps?.show_phone === false || profile.searchable === false) { setPendingSavePhone(cleanPhone); setShowPendingSavePrompt(true); return; }
    if (profile.id === user.id) { setAddError('Нельзя добавить себя'); return; }
    const { error } = await supabase.from('contacts').insert({ user_id: user.id, contact_id: profile.id });
    if (error) { setAddError(error.code === '23505' ? 'Контакт уже добавлен' : 'Ошибка добавления'); return; }
    setShowAddContact(false);
    setNewPhone('+7');
    loadContacts();
  };

  const handleSavePendingContact = async () => {
    if (!user) return;
    const { error } = await supabase.from('pending_contacts').insert({ user_id: user.id, phone: pendingSavePhone, nickname: pendingNickname.trim() || null });
    if (error && error.code === '23505') setAddError('Этот номер уже в ожидании');
    else loadPendingContacts();
    setShowPendingSavePrompt(false);
    setPendingNickname('');
    setShowAddContact(false);
    setNewPhone('+7');
  };

  const deletePendingContact = async (id: string) => {
    await supabase.from('pending_contacts').delete().eq('id', id);
    setPendingContacts(prev => prev.filter(p => p.id !== id));
  };

  const startChat = async (contactId: string) => {
    if (!user) return;
    const { data: convId, error } = await supabase.rpc('create_direct_conversation', {
      p_other_user_id: contactId,
    });
    if (error || !convId) return;
    if (onContactPress) { onContactPress(convId); return; }
    router.push({ pathname: '/chat/[id]', params: { id: convId } });
  };

  const initiateCall = async (contactId: string, contactName: string, callType: 'voice' | 'video') => {
    if (!user?.id) return;
    setSelectedContact(null);
    const { data, error } = await supabase.from('calls').insert({ caller_id: user.id, receiver_id: contactId, call_type: callType, status: 'ringing' }).select('id').single();
    if (error || !data?.id) return;
    router.push({ pathname: '/call', params: { type: callType, userId: contactId, name: contactName, callId: data.id, role: 'caller' } });
  };

  const deleteContact = async (contact: AppContact) => {
    if (!user) return;
    await supabase.from('contacts').delete().eq('id', contact.id);
    setSelectedContact(null);
    setContacts(prev => {
      const updated = prev.filter(c => c.id !== contact.id);
      dataCache.setContacts(updated);
      return updated;
    });
  };

  const blockContact = async (contact: AppContact) => {
    if (!user) return;
    setSelectedContact(null);
    setContacts(prev => prev.filter(c => c.id !== contact.id));
    await supabase.from('blocked_users').insert({ user_id: user.id, blocked_user_id: contact.contact_id });
    await supabase.from('contacts').delete().eq('id', contact.id);
  };

  const copyPhone = async (phone: string) => { await Clipboard.setStringAsync(phone); };

  const formatLastSeen = (dateStr: string | null) => {
    if (!dateStr) return 'Не в сети';
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    if (diffMin < 1) return 'Только что';
    if (diffMin < 60) return `${diffMin} мин назад`;
    if (diffHrs < 24) return `${diffHrs} ч назад`;
    if (diffHrs < 48) return 'Вчера';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  // --- Filtered & sectioned data ---

  const filteredContacts = useMemo(() => {
    if (!search) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c => {
      const name = c.nickname || c.profile?.display_name || '';
      return name.toLowerCase().includes(q) || c.profile?.phone?.includes(q);
    });
  }, [contacts, search]);

  const filteredPhonebook = useMemo(() => {
    const notAdded = phonebookMatches.filter(m => !m.alreadyAdded);
    if (!search) return notAdded;
    const q = search.toLowerCase();
    return notAdded.filter(m => m.phonebookName.toLowerCase().includes(q) || m.display_name.toLowerCase().includes(q) || m.phone.includes(q));
  }, [phonebookMatches, search]);

  const sections = useMemo(() => {
    const result: { title: string; key: string; data: any[] }[] = [];

    if (filteredContacts.length > 0) {
      const grouped: Record<string, AppContact[]> = {};
      for (const c of filteredContacts) {
        const name = c.nickname || c.profile?.display_name || 'У';
        const letter = name.charAt(0).toUpperCase();
        if (!grouped[letter]) grouped[letter] = [];
        grouped[letter].push(c);
      }
      const sortedLetters = Object.keys(grouped).sort();
      for (const letter of sortedLetters) {
        result.push({ title: letter, key: `app-${letter}`, data: grouped[letter].map(c => ({ type: 'contact' as const, contact: c })) });
      }
    }

    if (filteredPhonebook.length > 0 && !search) {
      result.push({
        title: 'Из записной книжки',
        key: 'phonebook',
        data: filteredPhonebook.map(m => ({ type: 'phonebook' as const, match: m })),
      });
    } else if (filteredPhonebook.length > 0 && search) {
      result.push({
        title: 'Из записной книжки',
        key: 'phonebook-search',
        data: filteredPhonebook.map(m => ({ type: 'phonebook' as const, match: m })),
      });
    }

    return result;
  }, [filteredContacts, filteredPhonebook, search]);

  const sidebarLetters = useMemo(() => sections.filter(s => s.key.startsWith('app-')).map(s => s.title), [sections]);

  const scrollToLetter = (letter: string) => {
    const sectionIndex = sections.findIndex(s => s.title === letter && s.key.startsWith('app-'));
    if (sectionIndex >= 0 && listRef.current) {
      listRef.current.scrollToLocation({ sectionIndex, itemIndex: 0, animated: true, viewOffset: 0 });
    }
  };

  // --- Render ---

  const renderSectionHeader = useCallback(({ section }: any) => {
    if (section.key === 'phonebook' || section.key === 'phonebook-search') {
      return (
        <View style={[styles.phonebookSectionHeader, { backgroundColor: colors.background }]}>
          <View style={[styles.phonebookHeaderIcon, { backgroundColor: `${colors.primary}15` }]}>
            <BookUser color={colors.primary} size={16} />
          </View>
          <Text style={[styles.phonebookHeaderText, { color: colors.textSecondary }]}>
            Из записной книжки ({section.data.length})
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
        <Text style={[styles.sectionLetter, { color: colors.text, fontSize: 15 * fontScale }]}>{section.title}</Text>
        <Text style={[styles.sectionCount, { color: colors.textSecondary }]}>{section.data.length}</Text>
      </View>
    );
  }, [colors, fontScale]);

  const renderItem = useCallback(({ item }: any) => {
    if (item.type === 'phonebook') {
      const m: PhonebookMatch = item.match;
      const letter = m.phonebookName.charAt(0).toUpperCase();
      const priv = applyPrivacy(m.is_online, m.last_seen, (m as any).privacy_settings);
      const online = isUserOnline(priv.is_online, priv.last_seen);
      return (
        <View style={styles.contactItem}>
          <TouchableOpacity style={styles.contactRow} onPress={() => startChat(m.profileId)} activeOpacity={0.7}>
            <View style={styles.avatarContainer}>
              <Avatar
                uri={m.avatar_url}
                name={m.phonebookName || 'U'}
                size="md"
                showOnline
                isOnline={online}
              />
              <View style={[styles.phonebookBadge, { backgroundColor: colors.primary }]}>
                <ContactIcon color="#FFFFFF" size={8} />
              </View>
            </View>
            <View style={styles.contactContent}>
              <View style={styles.nameRow}>
                <Text style={[styles.contactName, { color: colors.text }]} numberOfLines={1}>{m.phonebookName}</Text>
                {m.phonebookName !== m.display_name && (
                  <Text style={[styles.appName, { color: colors.textTertiary }]} numberOfLines={1}> ({m.display_name})</Text>
                )}
              </View>
              <Text style={[styles.contactStatus, { color: online ? colors.online : colors.textSecondary }]}>
                {online ? 'В сети' : formatLastSeen(priv.last_seen)}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addPbBtn, { backgroundColor: `${colors.primary}12` }]}
            onPress={() => addPhonebookContact(m)}
            activeOpacity={0.7}
            accessibilityLabel="Добавить контакт"
          >
            <UserPlus color={colors.primary} size={16} />
          </TouchableOpacity>
        </View>
      );
    }

    const contact: AppContact = item.contact;
    const name = contact.nickname || contact.profile?.display_name || 'Пользователь';
    const letter = name.charAt(0).toUpperCase();
    const priv = applyPrivacy(contact.profile?.is_online, contact.profile?.last_seen, contact.profile?.privacy_settings);
    const online = isUserOnline(priv.is_online, priv.last_seen);

    return (
      <Pressable
        style={styles.contactItem}
        onPress={() => startChat(contact.contact_id)}
        onLongPress={() => setSelectedContact(contact)}
        accessibilityRole="button"
        accessibilityLabel={`Контакт ${contact.nickname || contact.profile?.display_name}`}
      >
        <View style={styles.contactRow}>
          <View style={styles.avatarContainer}>
            <Avatar
              uri={contact.profile?.avatar_url}
              name={contact.nickname || contact.profile?.display_name || 'U'}
              size="md"
              showOnline
              isOnline={online}
            />
          </View>
          <View style={styles.contactContent}>
            <Text style={[styles.contactName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
            <Text style={[styles.contactStatus, { color: online ? colors.online : colors.textSecondary }]}>
              {online ? 'В сети' : formatLastSeen(priv.last_seen)}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={[styles.chatBtn, { backgroundColor: colors.surfaceSecondary }]} onPress={() => startChat(contact.contact_id)} accessibilityLabel="Написать">
          <MessageCircle color={colors.primary} size={18} />
        </TouchableOpacity>
      </Pressable>
    );
  }, [colors, fontScale]);

  const totalContacts = contacts.length;
  const isEmpty = sections.length === 0 && pendingContacts.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 12 }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Контакты</Text>
          {totalContacts > 0 && (
            <Text style={[styles.headerCount, { color: colors.textTertiary }]}>{pluralize(totalContacts, 'контакт', 'контакта', 'контактов')}</Text>
          )}
        </View>
        <View style={styles.headerActions}>
          {Platform.OS !== 'web' && (
            <TouchableOpacity style={[styles.headerBtn, { backgroundColor: colors.surfaceSecondary }]} onPress={() => syncPhonebook()} activeOpacity={0.7} accessibilityLabel="Синхронизировать контакты">
              {phonebookSyncing ? <ActivityIndicator size="small" color={colors.primary} /> : <RefreshCw color={colors.textSecondary} size={18} />}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.headerBtn, { backgroundColor: colors.primary }]} onPress={() => setShowAddContact(!showAddContact)} activeOpacity={0.7} accessibilityLabel="Добавить контакт">
            <UserPlus color="#FFFFFF" size={18} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Add contact form */}
      {showAddContact && (
        <View style={[styles.addForm, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.addLabel, { color: colors.textSecondary }]}>Добавить по номеру телефона</Text>
          <View style={styles.addRow}>
            <TextInput
              style={[styles.addInput, { backgroundColor: colors.surfaceTertiary, color: colors.text }]}
              value={newPhone}
              onChangeText={(text) => {
                let cleaned = text.replace(/[^\d+]/g, '');
                if (!cleaned.startsWith('+7')) cleaned = '+7';
                setNewPhone(cleaned.slice(0, 12));
              }}
              placeholder="+7 XXX XXX XX XX"
              placeholderTextColor={colors.textTertiary}
              keyboardType="phone-pad"
            />
            <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]} onPress={handleAddContact}>
              <UserPlus color="#FFFFFF" size={18} />
            </TouchableOpacity>
          </View>
          {addError ? <Text style={[styles.addError, { color: colors.error }]}>{addError}</Text> : null}
        </View>
      )}

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary }]}>
        <Search color={colors.textTertiary} size={18} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск контактов..."
          placeholderTextColor={colors.textTertiary}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Закрыть поиск">
            <X color={colors.textTertiary} size={16} />
          </TouchableOpacity>
        )}
      </View>

      {/* Join notifications */}
      {joinNotifications.length > 0 && (
        <Animated.View style={[styles.joinBanner, { backgroundColor: colors.surfaceSecondary, opacity: joinBannerAnim, transform: [{ translateY: joinBannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
          <TouchableOpacity style={styles.joinBannerTop} onPress={() => router.push('/new-contacts')} activeOpacity={0.7}>
            <View style={styles.joinBannerTitleRow}>
              <View style={[styles.joinCountBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.joinCountText}>{joinNotifications.length}</Text>
              </View>
              <View style={styles.joinBannerTextWrap}>
                <Text style={[styles.joinBannerTitle, { color: colors.text }]}>
                  {pluralize(joinNotifications.length, 'новый контакт', 'новых контакта', 'новых контактов')} в VayChat
                </Text>
                <Text style={[styles.joinBannerSub, { color: colors.textSecondary }]}>Нажмите, чтобы посмотреть</Text>
              </View>
            </View>
            <ChevronRight color={colors.textTertiary} size={18} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Pending contacts */}
      {pendingContacts.length > 0 && !search && (
        <View style={[styles.pendingSection, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={styles.pendingHeader}>
            <Clock color={colors.textTertiary} size={14} />
            <Text style={[styles.pendingTitle, { color: colors.textSecondary }]}>Ожидают регистрации ({pendingContacts.length})</Text>
          </View>
          {pendingContacts.map(pc => (
            <View key={pc.id} style={styles.pendingItem}>
              <View style={[styles.pendingAvatar, { backgroundColor: colors.backgroundTertiary }]}>
                <Clock color={colors.textTertiary} size={16} />
              </View>
              <View style={styles.pendingContent}>
                <Text style={[styles.pendingName, { color: colors.text }]}>{pc.nickname || pc.phone}</Text>
                {pc.nickname && <Text style={[styles.pendingPhone, { color: colors.textTertiary }]}>{pc.phone}</Text>}
              </View>
              <TouchableOpacity onPress={() => deletePendingContact(pc.id)} hitSlop={8} accessibilityLabel="Удалить контакт">
                <Trash2 color={colors.textTertiary} size={16} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Phonebook permission prompt for web */}
      {Platform.OS === 'web' && contacts.length === 0 && phonebookMatches.length === 0 && !search && (
        <View style={[styles.syncPrompt, { backgroundColor: colors.surfaceSecondary }]}>
          <BookUser color={colors.primary} size={24} />
          <View style={styles.syncPromptContent}>
            <Text style={[styles.syncPromptTitle, { color: colors.text }]}>Добавьте контакты</Text>
            <Text style={[styles.syncPromptDesc, { color: colors.textSecondary }]}>Используйте кнопку + чтобы добавить контакты по номеру телефона</Text>
          </View>
        </View>
      )}

      {/* Main list */}
      {isEmpty && !showAddContact ? (
        <EmptyState
          icon={<Users size={44} color={colors.textTertiary} />}
          title="Нет контактов"
          subtitle="Добавьте контакты, чтобы начать общение"
        />
      ) : sections.length > 0 ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <SectionList
            ref={listRef as any}
            sections={sections}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            keyExtractor={(item, index) => item.type === 'contact' ? `c-${item.contact.id}` : `pb-${item.match.profileId}-${index}`}
            contentContainerStyle={[styles.listContent, { paddingBottom: isDesktop ? 12 : insets.bottom + 76 }]}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
            keyboardDismissMode="on-drag"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            style={{ flex: 1 }}
            initialNumToRender={20}
            maxToRenderPerBatch={15}
            windowSize={7}
            removeClippedSubviews={true}
            updateCellsBatchingPeriod={100}
          />
          {sidebarLetters.length > 2 && (
            <View style={styles.alphabetSidebar}>
              {sidebarLetters.map(letter => (
                <TouchableOpacity key={letter} style={styles.alphabetBtn} onPress={() => scrollToLetter(letter)} activeOpacity={0.6}>
                  <Text style={[styles.alphabetText, { color: colors.primary }]}>{letter}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* Contact detail modal */}
      <BottomSheet visible={!!selectedContact} onClose={() => setSelectedContact(null)}>
          <View style={styles.modalContent}>
            <View style={styles.modalProfile}>
              <Avatar
                uri={selectedContact?.profile?.avatar_url}
                name={selectedContact?.profile?.display_name || '?'}
                size="lg"
              />
              <Text style={[styles.modalName, { color: colors.text }]}>{selectedContact?.profile?.display_name || 'Контакт'}</Text>
              {selectedContact?.profile?.status_text ? <Text style={[styles.modalStatus, { color: colors.textSecondary }]}>{selectedContact.profile.status_text}</Text> : null}
              <Text style={[styles.modalOnline, { color: (() => { const sp = applyPrivacy(selectedContact?.profile?.is_online, selectedContact?.profile?.last_seen, selectedContact?.profile?.privacy_settings); return isUserOnline(sp.is_online, sp.last_seen) ? colors.online : colors.textTertiary; })() }]}>
                {(() => { const sp = applyPrivacy(selectedContact?.profile?.is_online, selectedContact?.profile?.last_seen, selectedContact?.profile?.privacy_settings); return isUserOnline(sp.is_online, sp.last_seen) ? 'В сети' : formatLastSeen(sp.last_seen); })()}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.quickAction, { backgroundColor: colors.backgroundTertiary }]} onPress={() => selectedContact && startChat(selectedContact.contact_id)} accessibilityLabel="Написать">
                <MessageCircle color={colors.primary} size={22} />
                <Text style={[styles.quickLabel, { color: colors.textSecondary }]}>Чат</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.quickAction, { backgroundColor: colors.backgroundTertiary }]} onPress={() => selectedContact && initiateCall(selectedContact.contact_id, selectedContact.profile?.display_name || '', 'voice')} accessibilityLabel="Позвонить">
                <PhoneIcon color={colors.success || '#4CAF50'} size={22} />
                <Text style={[styles.quickLabel, { color: colors.textSecondary }]}>Звонок</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.quickAction, { backgroundColor: colors.backgroundTertiary }]} onPress={() => selectedContact && initiateCall(selectedContact.contact_id, selectedContact.profile?.display_name || '', 'video')} accessibilityLabel="Видеозвонок">
                <Video color={colors.primary} size={22} />
                <Text style={[styles.quickLabel, { color: colors.textSecondary }]}>Видео</Text>
              </TouchableOpacity>
            </View>

            {selectedContact?.profile?.phone && selectedContact?.profile?.privacy_settings?.show_phone !== false && (
              <TouchableOpacity style={[styles.phoneRow, { backgroundColor: colors.backgroundTertiary }]} onPress={() => copyPhone(selectedContact.profile.phone)} activeOpacity={0.7}>
                <PhoneIcon color={colors.textSecondary} size={16} />
                <Text style={[styles.phoneText, { color: colors.text }]}>{selectedContact.profile.phone}</Text>
                <Copy color={colors.textTertiary} size={14} />
              </TouchableOpacity>
            )}

            <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />

            <TouchableOpacity style={styles.modalAction} onPress={() => selectedContact && deleteContact(selectedContact)} accessibilityLabel="Удалить контакт">
              <UserX color={colors.error} size={20} />
              <Text style={[styles.modalActionText, { color: colors.error }]}>Удалить контакт</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalAction} onPress={() => selectedContact && blockContact(selectedContact)} accessibilityLabel="Заблокировать">
              <Ban color={colors.error} size={20} />
              <Text style={[styles.modalActionText, { color: colors.error }]}>Заблокировать</Text>
            </TouchableOpacity>
          </View>
      </BottomSheet>

      {/* Pending save prompt */}
      <BottomSheet visible={showPendingSavePrompt} onClose={() => setShowPendingSavePrompt(false)} avoidKeyboard>
            <Pressable style={[styles.pendingSaveModal, { backgroundColor: colors.backgroundSecondary }]} onPress={() => {}}>
              <View style={[styles.pendingSaveIconWrap, { backgroundColor: `${colors.primary}15` }]}>
                <UserCheck color={colors.primary} size={28} />
              </View>
              <Text style={[styles.pendingSaveTitle, { color: colors.text }]}>Пользователь не найден</Text>
              <Text style={[styles.pendingSaveDesc, { color: colors.textSecondary }]}>
                Номер {pendingSavePhone} ещё не зарегистрирован в VayChat. Сохранить его? Вы получите уведомление, когда этот человек присоединится.
              </Text>
              <TextInput
                style={[styles.pendingNicknameInput, { backgroundColor: colors.surfaceTertiary, color: colors.text }]}
                value={pendingNickname}
                onChangeText={setPendingNickname}
                placeholder="Имя (необязательно)"
                placeholderTextColor={colors.textTertiary}
                maxLength={50}
              />
              <View style={styles.pendingSaveButtons}>
                <TouchableOpacity style={[styles.pendingSaveBtn, { backgroundColor: colors.backgroundTertiary }]} onPress={() => { setShowPendingSavePrompt(false); setPendingNickname(''); }}>
                  <Text style={[styles.pendingSaveBtnText, { color: colors.textSecondary }]}>Отмена</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pendingSaveBtn, { backgroundColor: colors.primary }]} onPress={handleSavePendingContact}>
                  <Text style={[styles.pendingSaveBtnText, { color: '#FFFFFF' }]}>Сохранить</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
      </BottomSheet>
    </View>
  );
}

export default function ContactsScreen() {
  const { isDesktop } = useDesktopLayout();
  if (isDesktop) return null;
  return <ContactsListContent />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  headerCount: { fontSize: 13, fontWeight: '500', marginTop: 3, letterSpacing: 0.1 },
  headerActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },

  // Add form
  addForm: { marginHorizontal: 16, borderRadius: 14, padding: 14, marginBottom: 8 },
  addLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  addRow: { flexDirection: 'row', gap: 8 },
  addInput: { flex: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, fontWeight: '500' },
  addBtn: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  addError: { marginTop: 8, fontSize: 13, fontWeight: '500' },

  // Search
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, marginHorizontal: 16,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 6, gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },

  // List
  listContent: { paddingBottom: 20 },

  // Section headers
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8, marginTop: 4,
  },
  sectionLetter: { fontWeight: '700' },
  sectionCount: { fontSize: 12, fontWeight: '500' },

  phonebookSectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 10, marginTop: 8, gap: 8,
  },
  phonebookHeaderIcon: {
    width: 28, height: 28, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  phonebookHeaderText: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Contact item
  contactItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  contactRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  avatarContainer: { position: 'relative', marginRight: 14 },

  phonebookBadge: {
    position: 'absolute', top: -2, left: -2,
    width: 16, height: 16, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  contactContent: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  contactName: { fontSize: 16, fontWeight: '600', marginBottom: 3, flexShrink: 1, letterSpacing: 0.1 },
  appName: { fontSize: 13, flexShrink: 2 },
  contactStatus: { fontSize: 13 },

  chatBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  addPbBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },



  // Sidebar
  alphabetSidebar: {
    position: 'absolute', right: 0, top: 8, bottom: 8,
    justifyContent: 'center', alignItems: 'center', width: 24, zIndex: 10,
  },
  alphabetBtn: { paddingVertical: 1.5, paddingHorizontal: 4 },
  alphabetText: { fontSize: 11, fontWeight: '700' },

  // Sync prompt
  syncPrompt: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, borderRadius: 14, padding: 16, gap: 14,
    marginBottom: 8,
  },
  syncPromptContent: { flex: 1 },
  syncPromptTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  syncPromptDesc: { fontSize: 13, lineHeight: 18 },

  // Join banner
  joinBanner: { marginHorizontal: 16, borderRadius: 12, padding: 14, marginBottom: 8 },
  joinBannerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  joinBannerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  joinBannerTitle: { fontSize: 14, fontWeight: '700' },
  joinBannerSub: { fontSize: 12, marginTop: 1 },
  joinBannerTextWrap: { flex: 1 },
  joinCountBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  joinCountText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  joinDismissAll: { fontSize: 12, fontWeight: '500' },
  joinItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },

  joinContent: { flex: 1 },
  joinName: { fontSize: 14, fontWeight: '600' },
  joinText: { fontSize: 12 },
  joinClose: { padding: 4 },

  // Pending
  pendingSection: { marginHorizontal: 16, borderRadius: 12, padding: 14, marginBottom: 8 },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  pendingTitle: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  pendingItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  pendingAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  pendingContent: { flex: 1 },
  pendingName: { fontSize: 14, fontWeight: '500' },
  pendingPhone: { fontSize: 12 },

  // Modal
  modalContent: {},
  modalProfile: { alignItems: 'center', paddingBottom: 16 },
  modalName: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
  modalStatus: { fontSize: 14, marginBottom: 2 },
  modalOnline: { fontSize: 13 },
  modalActions: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginVertical: 16 },
  quickAction: { width: 72, height: 72, borderRadius: 14, justifyContent: 'center', alignItems: 'center', gap: 6 },
  quickLabel: { fontSize: 11, fontWeight: '500' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginBottom: 8 },
  phoneText: { flex: 1, fontSize: 15, fontWeight: '500', letterSpacing: 0.3 },
  modalDivider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  modalAction: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  modalActionText: { fontSize: 16, fontWeight: '500' },

  // Pending save
  pendingSaveModal: { alignItems: 'center', paddingTop: 10 },
  pendingSaveIconWrap: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  pendingSaveTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  pendingSaveDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  pendingNicknameInput: { width: '100%', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 20 },
  pendingSaveButtons: { flexDirection: 'row', gap: 10, width: '100%' },
  pendingSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  pendingSaveBtnText: { fontSize: 15, fontWeight: '600' },
});

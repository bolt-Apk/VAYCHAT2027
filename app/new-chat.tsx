import { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, Platform, ScrollView, Switch, ActivityIndicator, KeyboardAvoidingView, Image } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Search, MessageCircle, Users, Check, X, UserPlus, Phone as PhoneIcon, Megaphone, Globe, Lock, AtSign, Camera } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import { isUserOnline } from '@/lib/data-cache';
import Avatar from '@/components/Avatar';

interface Contact {
  id: string;
  contact_id: string;
  profile: {
    display_name: string;
    avatar_url: string | null;
    is_online: boolean;
  };
}

interface RecentChat {
  contact_id: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
}

export default function NewChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { user } = useAuth();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [groupMode, setGroupMode] = useState(false);
  const [channelMode, setChannelMode] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [phoneSearchResult, setPhoneSearchResult] = useState<{ id: string; display_name: string; avatar_url: string | null } | null>(null);
  const [phoneSearching, setPhoneSearching] = useState(false);
  const [nameSearchResults, setNameSearchResults] = useState<{ id: string; display_name: string; avatar_url: string | null; is_online: boolean }[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState<{ id: string; display_name: string; avatar_url: string | null; is_online: boolean }[]>([]);
  const [startingChat, setStartingChat] = useState(false);

  // Channel creation state
  const [channelName, setChannelName] = useState('');
  const [channelUsername, setChannelUsername] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelPublic, setChannelPublic] = useState(true);
  const [channelAvatarUri, setChannelAvatarUri] = useState<string | null>(null);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);

  useEffect(() => {
    if (params.mode === 'channel') setChannelMode(true);
    else if (params.mode === 'group') setGroupMode(true);
  }, [params.mode]);

  useEffect(() => {
    loadContacts();
    loadRecentChats();
    loadSuggestedUsers();
  }, [user]);

  const loadSuggestedUsers = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_online')
      .neq('id', user.id)
      .eq('searchable', true)
      .order('last_seen', { ascending: false })
      .limit(20);
    if (data) setSuggestedUsers(data);
  };

  const loadContacts = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('contacts')
      .select(`
        id,
        contact_id,
        profile:profiles!contacts_contact_id_fkey(display_name, avatar_url, is_online)
      `)
      .eq('user_id', user.id);

    if (data) {
      const mapped = data
        .map((c: any) => ({
          ...c,
          profile: Array.isArray(c.profile) ? c.profile[0] : c.profile,
        }))
        .filter((c: any) => c.profile);
      setContacts(mapped);
    }
  };

  const loadRecentChats = async () => {
    if (!user) return;
    const { data: memberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);
    if (!memberships?.length) return;

    const convIds = memberships.map(m => m.conversation_id);
    const { data: directConvs } = await supabase
      .from('conversations')
      .select('id')
      .in('id', convIds)
      .eq('type', 'direct')
      .order('updated_at', { ascending: false })
      .limit(10);
    if (!directConvs?.length) return;

    const { data: otherMembers } = await supabase
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', directConvs.map(c => c.id))
      .neq('user_id', user.id);
    if (!otherMembers?.length) return;

    const userIds = [...new Set(otherMembers.map(m => m.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_online')
      .in('id', userIds);
    if (!profiles) return;

    setRecentChats(profiles.slice(0, 6).map(p => ({
      contact_id: p.id,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      is_online: p.is_online,
    })));
  };

  const startChat = async (contactId: string) => {
    if (!user || startingChat) return;
    setStartingChat(true);

    try {
      const { data: convId, error } = await supabase.rpc('create_direct_conversation', {
        p_other_user_id: contactId,
      });

      if (error || !convId) {
        console.error('Failed to create conversation:', error);
        return;
      }

      router.replace({ pathname: '/chat/[id]', params: { id: convId } });
    } catch (e) {
      console.error('startChat error:', e);
    } finally {
      setStartingChat(false);
    }
  };

  const createGroup = async () => {
    if (!user || selectedContacts.length === 0 || !groupName.trim() || creatingGroup) return;
    setCreatingGroup(true);
    try {
      const convId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
      const { error: convErr } = await supabase.from('conversations').insert({ id: convId, type: 'group', name: groupName.trim(), created_by: user.id });
      if (convErr) throw convErr;
      const { error: selfErr } = await supabase.from('conversation_members').insert({ conversation_id: convId, user_id: user.id, role: 'admin' });
      if (selfErr) throw selfErr;
      for (const cid of selectedContacts) {
        const { error: memErr } = await supabase.from('conversation_members').insert({ conversation_id: convId, user_id: cid, role: 'member' });
        if (memErr) throw memErr;
      }
      router.replace({ pathname: '/chat/[id]', params: { id: convId } });
    } catch (e) {
      console.error('createGroup error:', e);
    } finally {
      setCreatingGroup(false);
    }
  };

  const pickChannelAvatar = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setChannelAvatarUri(result.assets[0].uri);
      }
    } catch (e) {
      console.error('pickChannelAvatar error:', e);
    }
  };

  const createChannel = async () => {
    if (!user || !channelName.trim() || creatingChannel) return;
    const cleanUsername = channelUsername.trim().toLowerCase().replace(/^@/, '');
    if (cleanUsername && !/^[a-z0-9_]{5,32}$/.test(cleanUsername)) return;
    if (cleanUsername && usernameAvailable === false) return;

    setCreatingChannel(true);
    try {
      const convId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
      const insertPayload: any = {
        id: convId,
        type: 'channel',
        name: channelName.trim(),
        created_by: user.id,
        is_public: channelPublic,
      };
      if (cleanUsername) insertPayload.username = cleanUsername;
      if (channelDescription.trim()) insertPayload.description = channelDescription.trim().slice(0, 255);

      if (channelAvatarUri) {
        try {
          const resp = await fetch(channelAvatarUri);
          const blob = await resp.blob();
          const ext = channelAvatarUri.split('.').pop()?.toLowerCase() || 'jpg';
          const filePath = convId + '/avatar.' + ext;
          const { error: uploadErr } = await supabase.storage.from('avatars').upload(filePath, blob, { contentType: ext === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
          if (!uploadErr) {
            const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
            if (urlData?.publicUrl) insertPayload.avatar_url = urlData.publicUrl;
          }
        } catch (e) {
          console.warn('Avatar upload failed:', e);
        }
      }

      const { error: convErr } = await supabase.from('conversations').insert(insertPayload);
      if (convErr) {
        console.error('Failed to create channel:', convErr);
        setCreatingChannel(false);
        return;
      }

      const { error: memErr } = await supabase
        .from('conversation_members')
        .insert({ conversation_id: convId, user_id: user.id, role: 'owner' });
      if (memErr) console.warn('Channel owner membership error:', memErr.message);

      const { error: subErr } = await supabase
        .from('channel_subscribers')
        .insert({ channel_id: convId, user_id: user.id });
      if (subErr) console.warn('Channel self-subscribe error:', subErr.message);

      router.replace({ pathname: '/chat/[id]', params: { id: convId } });
    } catch (e) {
      console.error('createChannel error:', e);
      setCreatingChannel(false);
    }
  };

  useEffect(() => {
    const clean = channelUsername.trim().toLowerCase().replace(/^@/, '');
    if (!clean) { setUsernameAvailable(null); return; }
    if (!/^[a-z0-9_]{5,32}$/.test(clean)) { setUsernameAvailable(false); return; }
    setUsernameChecking(true);
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .eq('username', clean)
        .maybeSingle();
      setUsernameAvailable(!data);
      setUsernameChecking(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [channelUsername]);

  const toggleContactSelection = (contactId: string) => {
    setSelectedContacts((prev) =>
      prev.includes(contactId) ? prev.filter(id => id !== contactId) : [...prev, contactId]
    );
  };

  useEffect(() => {
    const cleanSearch = search.replace(/[\s\-()]/g, '');
    const isPhone = /^\+?\d{7,}$/.test(cleanSearch);
    if (!isPhone || !user) {
      setPhoneSearchResult(null);
      return;
    }

    const phone = cleanSearch.startsWith('+') ? cleanSearch : `+${cleanSearch}`;
    setPhoneSearching(true);

    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .eq('phone', phone)
        .neq('id', user.id)
        .maybeSingle();

      setPhoneSearchResult(data || null);
      setPhoneSearching(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [search, user]);

  useEffect(() => {
    const cleanSearch = search.replace(/[\s\-()]/g, '');
    const isPhone = /^\+?\d{7,}$/.test(cleanSearch);
    if (isPhone || !search.trim() || search.trim().length < 2 || !user) {
      setNameSearchResults([]);
      return;
    }

    setNameSearching(true);
    const timer = setTimeout(async () => {
      const contactIds = contacts.map(c => c.contact_id);
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, is_online')
        .ilike('display_name', `%${search.trim()}%`)
        .neq('id', user.id)
        .eq('searchable', true)
        .limit(20);

      const results = (data || []).filter(p => !contactIds.includes(p.id));
      setNameSearchResults(results);
      setNameSearching(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [search, user, contacts]);

  const filteredContacts = contacts.filter((c) => {
    if (!search) return true;
    return c.profile?.display_name?.toLowerCase().includes(search.toLowerCase());
  });

  const renderContact = ({ item }: { item: Contact }) => {
    const name = item.profile?.display_name || 'Пользователь';
    const isSelected = selectedContacts.includes(item.contact_id);

    return (
      <TouchableOpacity
        style={[styles.contactItem, { backgroundColor: colors.backgroundSecondary }]}
        onPress={() => groupMode ? toggleContactSelection(item.contact_id) : startChat(item.contact_id)}
        activeOpacity={0.7}
      >
        <View style={{ marginRight: 12 }}>
          <Avatar uri={item.profile?.avatar_url} name={item.profile?.display_name || '?'} size="sm" showOnline={!groupMode} isOnline={isUserOnline(item.profile?.is_online, undefined)} />
        </View>
        <View style={styles.contactContent}>
          <Text style={[styles.contactName, { color: colors.text }]}>{name}</Text>
          <Text style={[styles.contactStatus, { color: colors.textSecondary }]}>
            {isUserOnline(item.profile?.is_online, undefined) ? 'В сети' : 'Не в сети'}
          </Text>
        </View>
        {groupMode ? (
          <View style={[styles.checkbox, { borderColor: colors.border, backgroundColor: isSelected ? colors.primary : 'transparent' }]}>
            {isSelected && <Check color="#FFFFFF" size={14} />}
          </View>
        ) : (
          <MessageCircle color={colors.textTertiary} size={20} />
        )}
      </TouchableOpacity>
    );
  };

  if (channelMode) {
    const cleanUsername = channelUsername.trim().toLowerCase().replace(/^@/, '');
    const usernameValid = !cleanUsername || /^[a-z0-9_]{5,32}$/.test(cleanUsername);
    const canCreate = channelName.trim().length > 0 && usernameValid && (!cleanUsername || usernameAvailable !== false) && !creatingChannel;

    return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
          <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]} onPress={() => setChannelMode(false)} accessibilityLabel="Назад">
            <ArrowLeft color={colors.text} size={20} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Новый канал</Text>
          <View style={{ flex: 1 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 24) + 80, gap: 12 }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={[styles.channelAvatarCircle, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border, overflow: 'hidden' }]} onPress={pickChannelAvatar} activeOpacity={0.7}>
            {channelAvatarUri ? (
              <Image source={{ uri: channelAvatarUri }} style={{ width: 96, height: 96, borderRadius: 48 }} />
            ) : (
              <>
                <Camera color={colors.primary} size={28} />
                <Text style={[styles.channelAvatarHint, { color: colors.textTertiary }]}>Добавить фото</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={[styles.inputGroup, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Название</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={channelName}
              onChangeText={setChannelName}
              placeholder="Введите название"
              placeholderTextColor={colors.textTertiary}
              maxLength={100}
            />
          </View>

          <View style={[styles.inputGroup, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Описание (необязательно)</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={channelDescription}
              onChangeText={setChannelDescription}
              placeholder="Расскажите о вашем канале"
              placeholderTextColor={colors.textTertiary}
              maxLength={255}
              multiline
            />
          </View>

          <View style={[styles.inputGroup, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Имя пользователя</Text>
            <View style={styles.usernameRow}>
              <AtSign color={colors.textTertiary} size={18} />
              <TextInput
                style={[styles.textInput, { color: colors.text, flex: 1 }]}
                value={channelUsername}
                onChangeText={setChannelUsername}
                placeholder="username"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={32}
              />
              {usernameChecking && <ActivityIndicator size="small" color={colors.textTertiary} />}
              {!usernameChecking && cleanUsername && usernameValid && usernameAvailable === true && <Check color={colors.online} size={18} />}
              {!usernameChecking && cleanUsername && usernameValid && usernameAvailable === false && <X color={colors.error} size={18} />}
            </View>
            <Text style={[styles.inputHint, { color: cleanUsername && !usernameValid ? colors.error : colors.textTertiary }]}>
              {!cleanUsername
                ? '5-32 символа: латиница, цифры, подчёркивание'
                : !usernameValid
                  ? 'Недопустимые символы или длина'
                  : usernameAvailable === false
                    ? 'Это имя уже занято'
                    : usernameAvailable === true
                      ? 'Имя доступно'
                      : '5-32 символа: латиница, цифры, подчёркивание'}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.inputGroup, { backgroundColor: colors.backgroundSecondary }]}
            onPress={() => setChannelPublic(!channelPublic)}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]}>Публичный канал</Text>
                <Text style={[styles.inputHint, { color: colors.textTertiary }]}>
                  {channelPublic ? 'Виден в поиске, подписаться может каждый' : 'Только по ссылке-приглашению'}
                </Text>
              </View>
              <Switch value={channelPublic} onValueChange={setChannelPublic} trackColor={{ false: colors.border, true: colors.primary }} />
            </View>
          </TouchableOpacity>
        </ScrollView>

        {canCreate && (
          <TouchableOpacity
            style={[styles.createGroupBtn, { backgroundColor: colors.primary, bottom: Math.max(insets.bottom, 16) + 14 }]}
            onPress={createChannel}
            disabled={creatingChannel}
            accessibilityLabel="Создать канал"
          >
            {creatingChannel ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.createGroupBtnText}>Создать канал</Text>}
          </TouchableOpacity>
        )}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]} onPress={() => groupMode ? setGroupMode(false) : router.back()} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={20} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {groupMode ? 'Новая группа' : 'Новый чат'}
        </Text>
        <View style={{ flex: 1 }} />
        {!groupMode && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]} onPress={() => setGroupMode(true)} accessibilityLabel="Создать группу">
              <Users color={colors.primary} size={18} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]} onPress={() => { setGroupMode(false); setChannelMode(true); }} accessibilityLabel="Создать канал">
              <Megaphone color={colors.primary} size={18} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {groupMode && (
        <View style={[styles.groupNameContainer, { backgroundColor: colors.backgroundSecondary }]}>
          <TextInput
            style={[styles.groupNameInput, { color: colors.text }]}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Название группы"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      )}



      {!groupMode && recentChats.length > 0 && !search && (
        <View style={styles.recentSection}>
          <Text style={[styles.recentTitle, { color: colors.textSecondary }]}>Недавние</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentScroll}>
            {recentChats.map((rc) => {
              return (
                <TouchableOpacity
                  key={rc.contact_id}
                  style={styles.recentItem}
                  onPress={() => startChat(rc.contact_id)}
                  activeOpacity={0.7}
                >
                  <Avatar uri={rc.avatar_url} name={rc.display_name || '?'} size="md" showOnline isOnline={!!rc.is_online} />
                  <Text style={[styles.recentName, { color: colors.text }]} numberOfLines={1}>
                    {rc.display_name?.split(' ')[0] || '?'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary }]}>
        <Search color={colors.textTertiary} size={18} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Имя или номер телефона"
          placeholderTextColor={colors.textTertiary}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Очистить поиск">
            <X color={colors.textTertiary} size={18} />
          </TouchableOpacity>
        )}
      </View>

      {phoneSearchResult && !groupMode && (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Найдено по номеру</Text>
          <TouchableOpacity
            style={[styles.contactItem, { backgroundColor: colors.backgroundSecondary }]}
            onPress={() => startChat(phoneSearchResult.id)}
            activeOpacity={0.7}
            disabled={startingChat}
          >
            <View style={{ marginRight: 12 }}>
              <Avatar uri={phoneSearchResult.avatar_url} name={phoneSearchResult.display_name || '?'} size="sm" variant="primary" icon={!phoneSearchResult.avatar_url ? <UserPlus color="#FFFFFF" size={20} /> : undefined} />
            </View>
            <View style={styles.contactContent}>
              <Text style={[styles.contactName, { color: colors.text }]}>{phoneSearchResult.display_name}</Text>
              <Text style={[styles.contactStatus, { color: colors.primary }]}>Начать чат</Text>
            </View>
            <MessageCircle color={colors.primary} size={20} />
          </TouchableOpacity>
        </View>
      )}

      {search && !phoneSearchResult && phoneSearching && /^\+?\d{7,}$/.test(search.replace(/[\s\-()]/g, '')) && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Поиск по номеру...</Text>
        </View>
      )}

      {search && !phoneSearchResult && !phoneSearching && /^\+?\d{7,}$/.test(search.replace(/[\s\-()]/g, '')) && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Пользователь с таким номером не найден</Text>
        </View>
      )}

      {nameSearchResults.length > 0 && !groupMode && (
        <View style={{ paddingHorizontal: 12, marginBottom: 8 }}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary, paddingHorizontal: 4 }]}>Глобальный поиск</Text>
          {nameSearchResults.map((p) => {
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.contactItem, { backgroundColor: colors.backgroundSecondary, marginBottom: 4 }]}
                onPress={() => startChat(p.id)}
                activeOpacity={0.7}
                disabled={startingChat}
              >
                <View style={{ marginRight: 12 }}>
                  <Avatar uri={p.avatar_url} name={p.display_name || '?'} size="sm" showOnline isOnline={!!p.is_online} />
                </View>
                <View style={styles.contactContent}>
                  <Text style={[styles.contactName, { color: colors.text }]}>{p.display_name}</Text>
                  <Text style={[styles.contactStatus, { color: colors.primary }]}>Начать чат</Text>
                </View>
                <MessageCircle color={colors.primary} size={20} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {!search && !groupMode && filteredContacts.length === 0 && recentChats.length === 0 && suggestedUsers.length > 0 && (
        <View style={{ paddingHorizontal: 12, marginBottom: 8 }}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary, paddingHorizontal: 4 }]}>Люди в VayChat</Text>
          {suggestedUsers.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.contactItem, { backgroundColor: colors.backgroundSecondary, marginBottom: 4 }]}
              onPress={() => startChat(p.id)}
              activeOpacity={0.7}
              disabled={startingChat}
            >
              <View style={{ marginRight: 12 }}>
                <Avatar uri={p.avatar_url} name={p.display_name || '?'} size="sm" showOnline isOnline={!!p.is_online} />
              </View>
              <View style={styles.contactContent}>
                <Text style={[styles.contactName, { color: colors.text }]}>{p.display_name}</Text>
                <Text style={[styles.contactStatus, { color: colors.primary }]}>Написать</Text>
              </View>
              <MessageCircle color={colors.primary} size={20} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {search && !phoneSearchResult && nameSearchResults.length === 0 && !nameSearching && !phoneSearching && filteredContacts.length === 0 && search.trim().length >= 2 && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Никого не найдено</Text>
        </View>
      )}

      {(nameSearching || phoneSearching) && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Поиск...</Text>
        </View>
      )}

      {groupMode && selectedContacts.length > 0 && (
        <View style={styles.chipsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
            {selectedContacts.map(cid => {
              const contact = contacts.find(c => c.contact_id === cid);
              const name = contact?.profile?.display_name || 'Пользователь';
              return (
                <View key={cid}>
                  <TouchableOpacity
                    style={[styles.chip, { backgroundColor: `${colors.primary}18`, borderColor: colors.primary }]}
                    onPress={() => toggleContactSelection(cid)}
                    activeOpacity={0.7}
                  >
                    <Avatar uri={contact?.profile?.avatar_url} name={name} size="xs" />
                    <Text style={[styles.chipName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
                    <X color={colors.textTertiary} size={14} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
          <Text style={[styles.selectedCount, { color: colors.textSecondary }]}>
            {selectedContacts.length} / 50
          </Text>
        </View>
      )}

      <FlatList
        data={filteredContacts}
        renderItem={renderContact}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Нет контактов. Добавьте контакты во вкладке "Контакты".
            </Text>
          </View>
        }
      />

      {groupMode && selectedContacts.length > 0 && groupName.trim() && (
        <TouchableOpacity style={[styles.createGroupBtn, { backgroundColor: colors.primary, bottom: Math.max(insets.bottom, 16) + 14 }]} onPress={createGroup} accessibilityLabel="Создать группу">
          <Text style={styles.createGroupBtnText}>Создать группу</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  list: {
    paddingHorizontal: 12,
    gap: 4,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },

  contactContent: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  contactStatus: {
    fontSize: 13,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  groupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    gap: 12,
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  groupNameContainer: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
  },
  groupNameInput: {
    fontSize: 16,
  },
  chipsContainer: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  chipsScroll: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 4,
    paddingRight: 10,
    borderRadius: 20,
    borderWidth: 1,
  },

  chipName: {
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 100,
  },
  selectedCount: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createGroupBtn: {
    position: 'absolute',
    left: 20,
    right: 20,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  createGroupBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  recentSection: {
    marginBottom: 8,
    paddingLeft: 16,
  },
  recentTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  recentScroll: {
    gap: 16,
    paddingRight: 16,
  },
  recentItem: {
    alignItems: 'center',
    width: 60,
  },

  recentName: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  channelAvatarCircle: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    marginBottom: 4,
  },
  channelAvatarHint: {
    fontSize: 11,
    fontWeight: '500',
  },
  inputGroup: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  textInput: {
    fontSize: 16,
    paddingVertical: 6,
  },
  inputHint: {
    fontSize: 12,
    fontWeight: '400',
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
  },
});

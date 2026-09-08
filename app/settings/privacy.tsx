import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, TextInput, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/hooks/useGoBack';
import { ArrowLeft, Eye, Clock, Users, Shield, Trash2, AlertTriangle, Download, ChevronRight, Lock, UserPlus, X, Star, SearchX, Keyboard } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';
import BottomSheet from '@/components/BottomSheet';

type StoryVisibility = 'everyone' | 'contacts' | 'close_friends' | 'nobody';

interface PrivacySettings {
  show_online: boolean;
  show_last_seen: boolean;
  show_read_receipts: boolean;
  show_typing: boolean;
  show_phone: boolean;
  allow_story_download: boolean;
  story_visibility: StoryVisibility;
}

export default function PrivacyScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { user, signOut } = useAuth();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<PrivacySettings>({
    show_online: true,
    show_last_seen: true,
    show_read_receipts: true,
    show_typing: true,
    show_phone: false,
    allow_story_download: true,
    story_visibility: 'everyone',
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [closeFriends, setCloseFriends] = useState<{ id: string; friend_id: string; display_name: string; avatar_url: string | null }[]>([]);
  const [showCloseFriends, setShowCloseFriends] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; display_name: string; avatar_url: string | null }[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [searchable, setSearchable] = useState(true);
  const [savingSearchable, setSavingSearchable] = useState(false);


  useEffect(() => {
  }, []);

  useEffect(() => {
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('privacy_settings, searchable')
      .eq('id', user.id)
      .maybeSingle();

    if (data?.privacy_settings) {
      setSettings(data.privacy_settings);
    }
    if (data) {
      setSearchable(data.searchable ?? true);
    }
  };

  const toggleSearchable = async () => {
    if (!user || savingSearchable) return;
    const newVal = !searchable;
    setSavingSearchable(true);
    setSearchable(newVal);
    const { error } = await supabase
      .from('profiles')
      .update({ searchable: newVal })
      .eq('id', user.id);
    if (error) {
      setSearchable(!newVal);
    }
    setSavingSearchable(false);
  };

  const loadCloseFriends = async () => {
    if (!user) return;
    setLoadingFriends(true);
    const { data } = await supabase
      .from('close_friends')
      .select('id, friend_id')
      .eq('user_id', user.id);
    if (data?.length) {
      const friendIds = data.map(d => d.friend_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', friendIds);
      setCloseFriends(data.map(d => {
        const p = profiles?.find(pr => pr.id === d.friend_id);
        return { id: d.id, friend_id: d.friend_id, display_name: p?.display_name || 'User', avatar_url: p?.avatar_url || null };
      }));
    } else {
      setCloseFriends([]);
    }
    const { data: myContacts } = await supabase
      .from('contacts')
      .select('contact_id')
      .eq('user_id', user.id);
    if (myContacts?.length) {
      const contactIds = myContacts.map(c => c.contact_id);
      const { data: cProfiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', contactIds);
      setContacts(cProfiles || []);
    } else {
      setContacts([]);
    }
    setLoadingFriends(false);
  };

  const addCloseFriend = async (friendId: string) => {
    if (!user) return;
    await supabase.from('close_friends').insert({ user_id: user.id, friend_id: friendId });
    loadCloseFriends();
  };

  const removeCloseFriend = async (id: string) => {
    await supabase.from('close_friends').delete().eq('id', id);
    setCloseFriends(prev => prev.filter(f => f.id !== id));
  };

  const updateStoryVisibility = async (value: StoryVisibility) => {
    const newSettings = { ...settings, story_visibility: value };
    setSettings(newSettings);
    setSavingKey('story_visibility');
    if (!user) return;
    await supabase
      .from('profiles')
      .update({ privacy_settings: newSettings, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    setSavingKey(null);
  };

  const VISIBILITY_OPTIONS: { key: StoryVisibility; label: string; icon: React.ReactNode }[] = [
    { key: 'everyone', label: 'Все', icon: <Users color={colors.text} size={16} /> },
    { key: 'contacts', label: 'Контакты', icon: <Users color={colors.text} size={16} /> },
    { key: 'close_friends', label: 'Близкие друзья', icon: <Star color={colors.text} size={16} /> },
    { key: 'nobody', label: 'Никто', icon: <Lock color={colors.text} size={16} /> },
  ];

  const updateSetting = async (key: keyof PrivacySettings, value: boolean) => {
    const prevSettings = { ...settings };
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    setSavingKey(key);

    if (!user) return;
    const { error } = await supabase
      .from('profiles')
      .update({ privacy_settings: newSettings, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) {
      setSettings(prevSettings);
    }
    setSavingKey(null);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'УДАЛИТЬ' || !user) return;
    setDeleting(true);

    try {
      await supabase.storage.from('avatars').remove([`${user.id}/avatar.jpg`]);
    } catch {}

    const { error } = await supabase.rpc('delete_own_account' as any);
    if (error) {
      setDeleting(false);
      return;
    }

    await signOut();
    router.replace('/login');
  };

  const renderToggle = (
    icon: React.ReactNode,
    iconBg: string,
    label: string,
    description: string,
    disabledHint: string,
    key: Exclude<keyof PrivacySettings, 'story_visibility'>
  ) => (
    <View style={[styles.settingRow, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.settingInfo}>
        <View style={[styles.settingIcon, { backgroundColor: iconBg }]}>
          {icon}
        </View>
        <View style={styles.settingTextContainer}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>{label}</Text>
          <Text style={[styles.settingDescription, { color: colors.textTertiary }]}>
            {settings[key] ? description : disabledHint}
          </Text>
        </View>
      </View>
      {savingKey === key ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Switch
          value={settings[key] as boolean}
          onValueChange={(v) => updateSetting(key, v)}
          trackColor={{ false: colors.backgroundTertiary, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]} onPress={() => goBack()} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Конфиденциальность</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[styles.contentContainer, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]} keyboardDismissMode="on-drag">
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Видимость</Text>
          {renderToggle(
            <Eye color="#FFFFFF" size={16} />, colors.secondary,
            'Онлайн-статус',
            'Другие видят, что вы в сети',
            'Никто не видит ваш онлайн-статус',
            'show_online'
          )}
          {renderToggle(
            <Clock color="#FFFFFF" size={16} />, colors.primary,
            'Время последнего визита',
            'Другие видят, когда вы были в сети',
            'Время последнего визита скрыто от всех',
            'show_last_seen'
          )}
          {renderToggle(
            <Shield color="#FFFFFF" size={16} />, '#06B6D4',
            'Отчёты о прочтении',
            'Отправители видят, когда вы прочитали сообщение',
            'Галочки прочтения отключены для всех',
            'show_read_receipts'
          )}

          {renderToggle(
            <Keyboard color="#FFFFFF" size={16} />, '#8B5CF6',
            'Индикатор набора',
            'Собеседники видят, когда вы печатаете',
            'Индикатор «печатает...» отключён',
            'show_typing'
          )}

          <View style={[styles.settingRow, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: '#EF4444' }]}>
                <SearchX color="#FFFFFF" size={16} />
              </View>
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Запретить поиск</Text>
                <Text style={[styles.settingDescription, { color: colors.textTertiary }]}>
                  {searchable ? 'Вас можно найти через поиск' : 'Вас не видно в результатах поиска'}
                </Text>
              </View>
            </View>
            <Switch
              value={!searchable}
              onValueChange={toggleSearchable}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
              disabled={savingSearchable}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Сторис</Text>
          {renderToggle(
            <Download color="#FFFFFF" size={16} />, '#FF9800',
            'Скачивание сторис',
            'Другие могут скачивать ваши сторис',
            'Никто не может скачивать ваши сторис',
            'allow_story_download'
          )}

          <View style={[styles.settingRow, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: '#3B82F6' }]}>
                <Eye color="#FFFFFF" size={16} />
              </View>
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Видимость сторис</Text>
                <Text style={[styles.settingDescription, { color: colors.textTertiary }]}>
                  Кто видит ваши сторис по умолчанию
                </Text>
              </View>
            </View>
            {savingKey === 'story_visibility' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.visibilityValue, { color: colors.primary }]}>
                {VISIBILITY_OPTIONS.find(o => o.key === settings.story_visibility)?.label || 'Все'}
              </Text>
            )}
          </View>
          <View style={styles.visibilityOptions}>
            {VISIBILITY_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.visibilityOption,
                  { backgroundColor: settings.story_visibility === opt.key ? `${colors.primary}15` : colors.backgroundSecondary,
                    borderColor: settings.story_visibility === opt.key ? colors.primary : 'transparent' },
                ]}
                onPress={() => updateStoryVisibility(opt.key)}
              >
                {opt.icon}
                <Text style={[styles.visibilityOptionText, { color: settings.story_visibility === opt.key ? colors.primary : colors.text }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.settingRow, { backgroundColor: colors.backgroundSecondary, marginTop: 8 }]}
            onPress={() => { setShowCloseFriends(true); loadCloseFriends(); }}
          >
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: '#10B981' }]}>
                <Star color="#FFFFFF" size={16} />
              </View>
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Близкие друзья</Text>
                <Text style={[styles.settingDescription, { color: colors.textTertiary }]}>
                  Управление списком близких друзей
                </Text>
              </View>
            </View>
            <ChevronRight color={colors.textTertiary} size={18} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Личные данные</Text>
          {renderToggle(
            <Users color="#FFFFFF" size={16} />, colors.accent,
            'Номер телефона',
            'Ваш номер виден другим пользователям',
            'Номер телефона скрыт от всех',
            'show_phone'
          )}
        </View>

        <TouchableOpacity
          style={[styles.infoCard, { backgroundColor: colors.backgroundSecondary }]}
          onPress={() => router.push('/settings/security')}
          activeOpacity={0.7}
        >
          <Shield color={colors.primary} size={24} />
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Настройте PIN-код, биометрию и сквозное шифрование сообщений
          </Text>
          <ChevronRight color={colors.textTertiary} size={18} />
        </TouchableOpacity>


        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.error }]}>Опасная зона</Text>
          <TouchableOpacity
            style={[styles.deleteAccountBtn, { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}30` }]}
            onPress={() => setShowDeleteConfirm(true)}
            accessibilityLabel="Удалить аккаунт"
          >
            <Trash2 color={colors.error} size={20} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.deleteAccountLabel, { color: colors.error }]}>Удалить аккаунт</Text>
              <Text style={[styles.deleteAccountHint, { color: colors.textTertiary }]}>
                Все данные будут безвозвратно удалены
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <BottomSheet visible={showCloseFriends} onClose={() => setShowCloseFriends(false)} scrollable maxHeight="70%">
        <View style={styles.closeFriendsHeader}>
          <Text style={[styles.closeFriendsTitle, { color: colors.text }]}>Близкие друзья</Text>
          <TouchableOpacity onPress={() => setShowCloseFriends(false)}>
            <X color={colors.textSecondary} size={22} />
          </TouchableOpacity>
        </View>
        {loadingFriends ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ) : (
          <>
            {closeFriends.length > 0 && (
              <View style={styles.closeFriendsSection}>
                <Text style={[styles.closeFriendsSectionTitle, { color: colors.textSecondary }]}>В списке</Text>
                {closeFriends.map(f => (
                  <View key={f.id} style={[styles.closeFriendRow, { borderBottomColor: colors.border }]}>
                    {f.avatar_url ? (
                      <Image source={{ uri: f.avatar_url }} style={styles.closeFriendAvatar} />
                    ) : (
                      <View style={[styles.closeFriendAvatar, { backgroundColor: colors.backgroundTertiary, justifyContent: 'center', alignItems: 'center' }]}>
                        <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{f.display_name.charAt(0)}</Text>
                      </View>
                    )}
                    <Text style={[styles.closeFriendName, { color: colors.text }]}>{f.display_name}</Text>
                    <TouchableOpacity
                      style={[styles.removeFriendBtn, { backgroundColor: `${colors.error}15` }]}
                      onPress={() => removeCloseFriend(f.id)}
                    >
                      <X color={colors.error} size={16} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {contacts.filter(c => !closeFriends.some(f => f.friend_id === c.id)).length > 0 && (
              <View style={styles.closeFriendsSection}>
                <Text style={[styles.closeFriendsSectionTitle, { color: colors.textSecondary }]}>Добавить</Text>
                {contacts.filter(c => !closeFriends.some(f => f.friend_id === c.id)).map(c => (
                  <View key={c.id} style={[styles.closeFriendRow, { borderBottomColor: colors.border }]}>
                    {c.avatar_url ? (
                      <Image source={{ uri: c.avatar_url }} style={styles.closeFriendAvatar} />
                    ) : (
                      <View style={[styles.closeFriendAvatar, { backgroundColor: colors.backgroundTertiary, justifyContent: 'center', alignItems: 'center' }]}>
                        <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{c.display_name.charAt(0)}</Text>
                      </View>
                    )}
                    <Text style={[styles.closeFriendName, { color: colors.text }]}>{c.display_name}</Text>
                    <TouchableOpacity
                      style={[styles.addFriendBtn, { backgroundColor: `${colors.primary}15` }]}
                      onPress={() => addCloseFriend(c.id)}
                    >
                      <UserPlus color={colors.primary} size={16} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {contacts.length === 0 && closeFriends.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                Нет контактов для добавления
              </Text>
            )}
          </>
        )}
      </BottomSheet>

      <BottomSheet visible={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} avoidKeyboard>
        <View style={[styles.deleteModalIcon, { backgroundColor: `${colors.error}15`, alignSelf: 'center' }]}>
          <AlertTriangle color={colors.error} size={28} />
        </View>
        <Text style={[styles.deleteModalTitle, { color: colors.text }]}>
          Удаление аккаунта
        </Text>
        <Text style={[styles.deleteModalDesc, { color: colors.textSecondary }]}>
          Это действие необратимо. Все ваши сообщения, контакты, медиа-файлы и данные профиля будут удалены навсегда.
        </Text>
        <Text style={[styles.deleteModalPrompt, { color: colors.textSecondary }]}>
          Введите УДАЛИТЬ для подтверждения:
        </Text>
        <TextInput
          style={[styles.deleteModalInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: deleteConfirmText === 'УДАЛИТЬ' ? colors.error : colors.border }]}
          value={deleteConfirmText}
          onChangeText={setDeleteConfirmText}
          placeholder="УДАЛИТЬ"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="characters"
        />
        <View style={styles.deleteModalButtons}>
          <TouchableOpacity
            style={[styles.deleteModalBtn, { backgroundColor: colors.backgroundTertiary }]}
            onPress={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
          >
            <Text style={[styles.deleteModalBtnText, { color: colors.textSecondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.deleteModalBtn, {
              backgroundColor: deleteConfirmText === 'УДАЛИТЬ' ? colors.error : colors.backgroundTertiary,
              opacity: deleteConfirmText === 'УДАЛИТЬ' ? 1 : 0.5,
            }]}
            onPress={handleDeleteAccount}
            disabled={deleteConfirmText !== 'УДАЛИТЬ' || deleting}
          >
            {deleting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={[styles.deleteModalBtnText, { color: deleteConfirmText === 'УДАЛИТЬ' ? '#FFFFFF' : colors.textTertiary }]}>
                Удалить навсегда
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheet>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingTextContainer: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 32,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  deleteAccountLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  deleteAccountHint: {
    fontSize: 12,
    marginTop: 2,
  },

  deleteModalIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  deleteModalDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  deleteModalPrompt: {
    fontSize: 13,
    fontWeight: '500',
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  deleteModalInput: {
    width: '100%',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
  },
  deleteModalButtons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  deleteModalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  visibilityValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  visibilityOptions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  visibilityOption: {
    flex: 1,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
  },
  visibilityOptionText: {
    fontSize: 11,
    fontWeight: '600',
  },

  closeFriendsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeFriendsTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeFriendsSection: {
    marginBottom: 16,
  },
  closeFriendsSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  closeFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  closeFriendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  closeFriendName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  removeFriendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addFriendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    paddingVertical: 24,
  },
});

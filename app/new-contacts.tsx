import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, MessageCircle, UserCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import Avatar from '@/components/Avatar';

interface JoinedContact {
  id: string;
  joined_user_id: string;
  is_read: boolean;
  created_at: string;
  profile: {
    display_name: string;
    avatar_url: string | null;
  } | null;
}

export default function NewContactsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, fontScale } = useAppearance();
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<JoinedContact[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJoinedContacts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('contact_join_notifications')
      .select('id, joined_user_id, is_read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!data?.length) {
      setContacts([]);
      setLoading(false);
      return;
    }

    const userIds = data.map(n => n.joined_user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, { display_name: p.display_name, avatar_url: p.avatar_url }]));

    setContacts(data.map(n => ({ ...n, profile: profileMap.get(n.joined_user_id) || null })));
    setLoading(false);

    const unreadIds = data.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length > 0) {
      supabase.from('contact_join_notifications').update({ is_read: true }).in('id', unreadIds).then(() => {});
    }
  }, [user?.id]);

  useEffect(() => { loadJoinedContacts(); }, [loadJoinedContacts]);

  const formatTime = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'сейчас';
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} ч`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} д`;
    return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  const startChat = async (userId: string) => {
    if (!user) return;

    const { data: convId, error: rpcError } = await supabase.rpc('create_direct_conversation', {
      p_other_user_id: userId,
    });
    if (rpcError || !convId) return;
    router.push({ pathname: '/chat/[id]', params: { id: convId } });
  };

  const getSectionLabel = (dateStr: string): string | null => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    if (isToday) return 'Сегодня';
    if (isYesterday) return 'Вчера';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };

  const renderItem = ({ item, index }: { item: JoinedContact; index: number }) => {
    const prevItem = index > 0 ? contacts[index - 1] : null;
    const currentLabel = getSectionLabel(item.created_at);
    const prevLabel = prevItem ? getSectionLabel(prevItem.created_at) : null;
    const showHeader = currentLabel !== prevLabel;

    return (
      <>
        {showHeader && (
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.sectionText, { color: colors.textSecondary, fontSize: 11 * fontScale }]}>{currentLabel}</Text>
            <View style={[styles.sectionLine, { backgroundColor: colors.border }]} />
          </View>
        )}
        <TouchableOpacity
          style={[styles.row, !item.is_read && { backgroundColor: colors.primaryLight || colors.surfaceSecondary }]}
          onPress={() => router.push({ pathname: '/u/[userId]', params: { userId: item.joined_user_id } })}
          activeOpacity={0.6}
        >
          <Avatar uri={item.profile?.avatar_url || null} name={item.profile?.display_name || '?'} size="sm" />
          <View style={styles.info}>
            <Text style={[styles.name, { color: colors.text, fontSize: 15 * fontScale }]} numberOfLines={1}>
              {item.profile?.display_name || 'Пользователь'}
            </Text>
            <Text style={[styles.time, { color: colors.textSecondary, fontSize: 12 * fontScale }]}>
              {formatTime(item.created_at)}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.chatBtn, { backgroundColor: colors.primary }]}
            onPress={() => startChat(item.joined_user_id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MessageCircle size={16} color="#FFF" />
          </TouchableOpacity>
        </TouchableOpacity>
      </>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text, fontSize: 17 * fontScale }]}>
          Новые контакты{contacts.length > 0 ? ` (${contacts.length})` : ''}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : contacts.length === 0 ? (
        <View style={styles.center}>
          <UserCheck size={40} color={colors.textTertiary} strokeWidth={1.5} />
          <Text style={[styles.emptyTitle, { color: colors.text, fontSize: 16 * fontScale }]}>Пока нет новых контактов</Text>
          <Text style={[styles.emptyDesc, { color: colors.textSecondary, fontSize: 13 * fontScale }]}>
            Когда кто-то из вашей телефонной книги зарегистрируется, он появится здесь
          </Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={c => c.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontWeight: '600' },
  list: { paddingVertical: 4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  sectionLine: { flex: 1, height: StyleSheet.hairlineWidth },
  sectionText: { fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  info: { flex: 1 },
  name: { fontWeight: '600' },
  time: { marginTop: 1 },
  chatBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontWeight: '600', marginTop: 12, textAlign: 'center' },
  emptyDesc: { marginTop: 6, textAlign: 'center', lineHeight: 18 },
});

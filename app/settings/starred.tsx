import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/hooks/useGoBack';
import { ArrowLeft, Star, Trash2, Image as ImageIcon, Mic, FileText, Video } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';

interface StarredItem {
  id: string;
  message_id: string;
  created_at: string;
  message: {
    id: string;
    content: string;
    message_type: string;
    created_at: string;
    conversation_id: string;
    sender_id: string;
  };
  sender_name: string;
  chat_name: string;
}

export default function StarredMessagesScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { user } = useAuth();
  const { colors, fontScale } = useAppearance();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<StarredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStarred = useCallback(async () => {
    if (!user) return;

    const { data: starred } = await supabase
      .from('starred_messages')
      .select('id, message_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!starred?.length) {
      setItems([]);
      setLoading(false);
      return;
    }

    const messageIds = starred.map(s => s.message_id);
    const { data: messages } = await supabase
      .from('messages')
      .select('id, content, message_type, created_at, conversation_id, sender_id')
      .in('id', messageIds);

    if (!messages?.length) {
      setItems([]);
      setLoading(false);
      return;
    }

    const senderIds = [...new Set(messages.map(m => m.sender_id))];
    const convIds = [...new Set(messages.map(m => m.conversation_id))];

    const [{ data: senders }, { data: convs }] = await Promise.all([
      supabase.from('profiles').select('id, display_name').in('id', senderIds),
      supabase.from('conversations').select('id, name, type').in('id', convIds),
    ]);

    const senderMap = new Map((senders || []).map(s => [s.id, s.display_name]));

    const directConvIds = (convs || []).filter(c => c.type === 'direct').map(c => c.id);
    const convNameMap = new Map<string, string>();
    (convs || []).forEach(c => {
      if (c.type === 'group') convNameMap.set(c.id, c.name || 'Группа');
    });

    if (directConvIds.length > 0) {
      const { data: members } = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', directConvIds)
        .neq('user_id', user.id);

      if (members) {
        const otherIds = [...new Set(members.map(m => m.user_id))];
        const { data: otherProfiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', otherIds);
        const otherMap = new Map((otherProfiles || []).map(p => [p.id, p.display_name]));
        members.forEach(m => {
          convNameMap.set(m.conversation_id, otherMap.get(m.user_id) || 'Чат');
        });
      }
    }

    const msgMap = new Map(messages.map(m => [m.id, m]));

    const enriched: StarredItem[] = starred
      .filter(s => msgMap.has(s.message_id))
      .map(s => {
        const msg = msgMap.get(s.message_id)!;
        return {
          ...s,
          message: msg,
          sender_name: senderMap.get(msg.sender_id) || 'Пользователь',
          chat_name: convNameMap.get(msg.conversation_id) || 'Чат',
        };
      });

    setItems(enriched);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadStarred();
  }, [loadStarred]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStarred();
    setRefreshing(false);
  };

  const handleRemoveStar = async (item: StarredItem) => {
    if (!user) return;
    await supabase
      .from('starred_messages')
      .delete()
      .eq('id', item.id);
    setItems(prev => prev.filter(i => i.id !== item.id));
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

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'image': return <ImageIcon color={colors.primary} size={16} />;
      case 'video': return <Video color={colors.primary} size={16} />;
      case 'voice': return <Mic color={colors.primary} size={16} />;
      case 'file': return <FileText color={colors.primary} size={16} />;
      default: return null;
    }
  };

  const getPreview = (msg: StarredItem['message']) => {
    switch (msg.message_type) {
      case 'image': return 'Фото';
      case 'video': return 'Видео';
      case 'voice': return 'Голосовое сообщение';
      case 'file': return 'Файл';
      default: return msg.content || '';
    }
  };

  const renderItem = ({ item, index }: { item: StarredItem; index: number }) => (
    <View>
      <TouchableOpacity
        style={[styles.starredItem, { backgroundColor: colors.backgroundSecondary }]}
        onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.message.conversation_id } })}
        activeOpacity={0.7}
      >
        <View style={styles.itemContent}>
          <View style={styles.itemHeader}>
            <View style={styles.itemHeaderLeft}>
              <Text style={[styles.senderName, { color: colors.primary, fontSize: 13 * fontScale }]}>
                {item.sender_name}
              </Text>
              <Text style={[styles.chatName, { color: colors.textTertiary, fontSize: 12 * fontScale }]}>
                {' в '}{item.chat_name}
              </Text>
            </View>
            <Text style={[styles.itemDate, { color: colors.textTertiary }]}>
              {formatDate(item.message.created_at)}
            </Text>
          </View>

          <View style={styles.previewRow}>
            {getTypeIcon(item.message.message_type)}
            <Text
              style={[styles.messagePreview, { color: colors.text, fontSize: 15 * fontScale }]}
              numberOfLines={2}
            >
              {getPreview(item.message)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.removeButton, { backgroundColor: colors.backgroundTertiary }]}
          onPress={() => handleRemoveStar(item)}
          accessibilityLabel="Удалить из избранного"
        >
          <Trash2 color={colors.error} size={16} />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]}
          onPress={() => goBack()}
          accessibilityLabel="Назад"
        >
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Избранное</Text>
        <View style={styles.backButton} />
      </View>

      {items.length === 0 && !loading ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.backgroundSecondary }]}>
            <Star color={colors.textTertiary} size={40} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text, fontSize: 20 * fontScale }]}>
            Нет избранных сообщений
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary, fontSize: 15 * fontScale }]}>
            Нажмите и удерживайте сообщение, чтобы добавить его в избранное
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
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
  list: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  starredItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
  },
  itemContent: {
    flex: 1,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  itemHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  senderName: {
    fontWeight: '600',
  },
  chatName: {
    fontWeight: '400',
  },
  itemDate: {
    fontSize: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  messagePreview: {
    flex: 1,
    lineHeight: 22,
  },
  removeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    textAlign: 'center',
    lineHeight: 22,
  },
});

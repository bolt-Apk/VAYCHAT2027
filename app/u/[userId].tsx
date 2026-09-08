import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useAppearance } from '@/lib/appearance-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_INVITE_KEY } from '@/lib/pending-invite';

export default function InviteLinkScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { colors } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (!userId) {
      setError('Неверная ссылка');
      setProcessing(false);
      return;
    }

    if (userId === user.id) {
      router.replace('/(tabs)');
      return;
    }

    startOrOpenChat(userId);
  }, [user, authLoading, userId]);

  useEffect(() => {
    if (!authLoading && !user && userId) {
      AsyncStorage.setItem(PENDING_INVITE_KEY, userId as string);
    }
  }, [authLoading, user, userId]);

  async function startOrOpenChat(contactId: string) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', contactId)
        .maybeSingle();

      if (!profile) {
        setError('Пользователь не найден');
        setProcessing(false);
        return;
      }

      const { data: convId, error: rpcError } = await supabase.rpc('create_direct_conversation', {
        p_other_user_id: contactId,
      });
      if (rpcError || !convId) throw rpcError || new Error('Failed');

      router.replace({ pathname: '/chat/[id]', params: { id: convId } });
    } catch (e) {
      console.error('Invite link error:', e);
      setError('Не удалось открыть чат');
      setProcessing(false);
    }
  }

  if (authLoading) {
    return (
      <View style={[s.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[s.text, { color: colors.textSecondary }]}>Загрузка...</Text>
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (error) {
    return (
      <View style={[s.container, { backgroundColor: colors.background }]}>
        <Text style={[s.errorText, { color: colors.error }]}>{error}</Text>
        <Text style={[s.link, { color: colors.primary }]} onPress={() => router.replace('/(tabs)')}>
          Вернуться в чаты
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[s.text, { color: colors.textSecondary }]}>Открываем чат...</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  text: {
    fontSize: 16,
    marginTop: 16,
  },
  errorText: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  link: {
    fontSize: 16,
    marginTop: 8,
  },
});

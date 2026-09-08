import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useAppearance } from '@/lib/appearance-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_INVITE_KEY } from '@/lib/pending-invite';

export default function ChannelByUsernameScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { colors } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!username) {
      setError('Неверная ссылка');
      setLoading(false);
      return;
    }
    resolve(username);
  }, [username, authLoading]);

  async function resolve(uname: string) {
    // Check channels first
    const { data: channelData } = await supabase
      .from('conversations')
      .select('id')
      .eq('type', 'channel')
      .eq('username', uname)
      .maybeSingle();

    if (channelData) {
      if (!user) {
        await AsyncStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ type: 'channel', id: channelData.id }));
      }
      router.replace({ pathname: '/chat/[id]', params: { id: channelData.id } });
      return;
    }

    // Check user profiles
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', uname)
      .maybeSingle();

    if (profileData) {
      // Redirect to the username route (without @)
      router.replace({ pathname: '/[username]', params: { username: uname } });
      return;
    }

    setError('Канал или пользователь не найден');
    setLoading(false);
  }

  if (loading || authLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
      <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.buttonText}>На главную</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    marginBottom: 20,
  },
});

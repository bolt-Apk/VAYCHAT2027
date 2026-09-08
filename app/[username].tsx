import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useAppearance } from '@/lib/appearance-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_INVITE_KEY } from '@/lib/pending-invite';
import { User, MessageCircle, UserPlus, ArrowLeft } from 'lucide-react-native';
import CachedImage from '@/components/CachedImage';

type ResolvedProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  status_text: string | null;
  is_online: boolean;
  last_seen: string | null;
};

export default function InviteByUsernameScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { colors } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ResolvedProfile | null>(null);
  const [opening, setOpening] = useState(false);

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
    // First check if it's a channel username
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

    // Then check if it's a user profile username
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, status_text, is_online, last_seen')
      .eq('username', uname)
      .maybeSingle();

    if (profileData) {
      // If it's the current user, go home
      if (user && profileData.id === user.id) {
        router.replace('/(tabs)/profile');
        return;
      }

      // If user is logged in, show the profile card
      if (user) {
        setProfile(profileData);
        setLoading(false);
        return;
      }

      // Not logged in - save pending invite and redirect to login
      await AsyncStorage.setItem(PENDING_INVITE_KEY, profileData.id);
      setProfile(profileData);
      setLoading(false);
      return;
    }

    setError('Пользователь не найден');
    setLoading(false);
  }

  async function handleOpenChat() {
    if (!profile || !user) return;
    setOpening(true);

    try {
      const { data: convId, error } = await supabase.rpc('create_direct_conversation', {
        p_other_user_id: profile.id,
      });
      if (error || !convId) throw error || new Error('Failed');

      router.replace({ pathname: '/chat/[id]', params: { id: convId } });
    } catch {
      setError('Не удалось открыть чат');
      setOpening(false);
    }
  }

  if (loading || authLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textSecondary, marginTop: 16, fontSize: 15 }}>Загрузка...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.errorIcon, { backgroundColor: `${colors.error}15` }]}>
          <User color={colors.error} size={32} />
        </View>
        <Text style={[styles.errorTitle, { color: colors.text }]}>Не найдено</Text>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.buttonText}>На главную</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Not logged in - redirect to login
  if (!user && profile) {
    return <Redirect href="/login" />;
  }

  // Show profile card
  if (profile) {
    const letter = (profile.display_name || '?').charAt(0).toUpperCase();
    const isOnline = profile.is_online;

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.backgroundSecondary }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowLeft color={colors.text} size={20} />
        </TouchableOpacity>

        <View style={styles.card}>
          <View style={styles.avatarWrapper}>
            {profile.avatar_url ? (
              <CachedImage uri={profile.avatar_url} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={styles.avatarLetter}>{letter}</Text>
              </View>
            )}
            {isOnline && <View style={[styles.onlineDot, { borderColor: colors.background }]} />}
          </View>

          <Text style={[styles.name, { color: colors.text }]}>{profile.display_name || 'Пользователь'}</Text>
          <Text style={[styles.username, { color: colors.primary }]}>@{username}</Text>

          {profile.status_text && (
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>{profile.status_text}</Text>
          )}

          <Text style={[styles.onlineStatus, { color: isOnline ? colors.online : colors.textTertiary }]}>
            {isOnline ? 'В сети' : 'Не в сети'}
          </Text>

          <TouchableOpacity
            style={[styles.chatButton, { backgroundColor: colors.primary }]}
            onPress={handleOpenChat}
            disabled={opening}
            activeOpacity={0.7}
          >
            {opening ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MessageCircle color="#fff" size={20} />
                <Text style={styles.chatButtonText}>Написать сообщение</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  backBtn: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    alignItems: 'center',
    maxWidth: 360,
    width: '100%',
    paddingHorizontal: 20,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 20,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  avatarLetter: {
    fontSize: 44,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#22C55E',
    borderWidth: 3,
  },
  name: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  username: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  statusText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  onlineStatus: {
    fontSize: 14,
    marginBottom: 28,
  },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
    justifyContent: 'center',
  },
  chatButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 15,
    marginBottom: 24,
    textAlign: 'center',
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

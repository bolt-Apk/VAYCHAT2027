import { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import { Bookmark } from 'lucide-react-native';

export default function SavedMessagesRedirect() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useAppearance();
  const [error, setError] = useState<string | null>(null);

  const getOrCreateSavedConversation = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase.rpc('get_or_create_saved_conversation');
    if (error || !data) return null;
    return data;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let navigated = false;

    (async () => {
      const convId = await getOrCreateSavedConversation();
      if (navigated) return;
      if (convId) {
        navigated = true;
        router.replace(`/chat/${convId}`);
      } else {
        setError('Не удалось открыть Избранное');
      }
    })();

    return () => { navigated = true; };
  }, [user, getOrCreateSavedConversation]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {error ? (
        <>
          <Bookmark color={colors.textTertiary} size={48} />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
        </>
      ) : (
        <ActivityIndicator size="large" color={colors.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});

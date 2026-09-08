import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAppearance } from '@/lib/appearance-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PERMISSIONS_COMPLETED_KEY = '@vaychat_permissions_completed';

export default function Index() {
  const { session, loading } = useAuth();
  const { colors } = useAppearance();
  const [permissionsChecked, setPermissionsChecked] = useState(false);
  const [permissionsCompleted, setPermissionsCompleted] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PERMISSIONS_COMPLETED_KEY).then((value) => {
      setPermissionsCompleted(value === 'true');
      setPermissionsChecked(true);
    });
  }, []);

  if (loading || !permissionsChecked) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (session) {
    if (!permissionsCompleted) {
      return <Redirect href="/permissions" />;
    }
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

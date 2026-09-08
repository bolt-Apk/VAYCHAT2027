import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

let signingOut = false;
let refreshingToken = false;

const customFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401 && !signingOut && !refreshingToken) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
    if (url.includes('/auth/')) return response;
    if (url.includes('/rest/v1/') || url.includes('/realtime/')) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        signingOut = true;
        supabase.auth.signOut().finally(() => { signingOut = false; });
      }
    }
  }
  return response;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: {
    fetch: customFetch,
  },
});

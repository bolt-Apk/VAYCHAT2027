import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { dataCache } from './data-cache';
import { setDraftsUserId, loadDraftsFromServer, clearAllDrafts } from './drafts';
import { clearBadge, unregisterPushToken } from './notifications';
import { generateKeyPair, saveKeyPair, hasKeyPair, getStoredPublicKey, clearSharedSecretCache } from './encryption';
import {
  StoredAccount,
  getStoredAccounts,
  saveAccount,
  removeAccount,
  updateAccountTokens,
  updateAccountProfile,
  getActiveAccountId,
  setActiveAccountId,
} from './multi-account';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  accounts: StoredAccount[];
  switchAccount: (userId: string) => Promise<void>;
  switchingAccount: boolean;
  addAccountMode: boolean;
  startAddAccount: () => void;
  removeAccountById: (userId: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
  accounts: [],
  switchAccount: async () => {},
  switchingAccount: false,
  addAccountMode: false,
  startAddAccount: () => {},
  removeAccountById: async () => {},
  refreshAccounts: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [addAccountMode, setAddAccountMode] = useState(false);
  const initializedRef = useRef(false);
  const switchingRef = useRef(false);

  const loadAccounts = useCallback(async () => {
    const stored = await getStoredAccounts();
    setAccounts(stored);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (switchingRef.current) return;

      if (event === 'INITIAL_SESSION') {
        setSession(newSession);
        setLoading(false);
        initializedRef.current = true;
        if (newSession?.user?.id) {
          dataCache.restoreFromDisk(newSession.user.id);
          setDraftsUserId(newSession.user.id);
          loadDraftsFromServer();
          ensureKeyPair(newSession.user.id);
          persistCurrentSession(newSession);
        }
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (newSession) {
          if (event === 'SIGNED_IN' && addAccountMode) {
            await supabase.removeAllChannels();
            dataCache.clear();
            clearAllDrafts();
            clearSharedSecretCache();
            setAddAccountMode(false);
            if (newSession.user?.id) {
              dataCache.restoreFromDisk(newSession.user.id);
              setDraftsUserId(newSession.user.id);
              loadDraftsFromServer();
              ensureKeyPair(newSession.user.id);
            }
          }
          setSession(newSession);
          persistCurrentSession(newSession);
        }
        return;
      }

      if (event === 'SIGNED_OUT') {
        if (!switchingRef.current) {
          setSession(null);
          dataCache.clear();
          clearAllDrafts();
        }
        return;
      }

      if (newSession) {
        setSession(newSession);
      }
    });

    if (!initializedRef.current) {
      supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
        if (!initializedRef.current) {
          setSession(existingSession);
          setLoading(false);
          initializedRef.current = true;
          if (existingSession?.user?.id) {
            persistCurrentSession(existingSession);
          }
        }
      }).catch(() => {
        if (!initializedRef.current) {
          setSession(null);
          setLoading(false);
          initializedRef.current = true;
        }
      });
    }

    return () => subscription.unsubscribe();
  }, [addAccountMode]);

  async function persistCurrentSession(sess: Session) {
    if (!sess.user) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, phone, avatar_url')
      .eq('id', sess.user.id)
      .maybeSingle();

    const account: StoredAccount = {
      userId: sess.user.id,
      displayName: profile?.display_name || sess.user.user_metadata?.display_name || '',
      phone: profile?.phone || sess.user.phone || '',
      avatarUrl: profile?.avatar_url || null,
      accessToken: sess.access_token,
      refreshToken: sess.refresh_token,
      expiresAt: sess.expires_at || 0,
    };
    await saveAccount(account);
    await setActiveAccountId(sess.user.id);
    await loadAccounts();
  }

  async function ensureKeyPair(userId: string) {
    try {
      const exists = await hasKeyPair();
      if (exists) {
        const pubJwk = await getStoredPublicKey();
        if (pubJwk) {
          const { data } = await supabase.from('profiles').select('public_key').eq('id', userId).maybeSingle();
          if (!data?.public_key) {
            await supabase.from('profiles').update({ public_key: JSON.stringify(pubJwk) }).eq('id', userId);
          }
        }
        return;
      }
      const pair = await generateKeyPair();
      if (!pair) return;
      await saveKeyPair(pair);
      await supabase.from('profiles').update({ public_key: JSON.stringify(pair.publicKeyJwk) }).eq('id', userId);
    } catch {}
  }

  const switchAccount = useCallback(async (targetUserId: string) => {
    if (switchingRef.current) return;
    if (session?.user?.id === targetUserId) return;

    const stored = await getStoredAccounts();
    const target = stored.find(a => a.userId === targetUserId);
    if (!target) return;

    switchingRef.current = true;
    setSwitchingAccount(true);

    try {
      // Save current session tokens before switching
      if (session) {
        await updateAccountTokens(
          session.user.id,
          session.access_token,
          session.refresh_token,
          session.expires_at || 0,
        );
      }

      // Clear current state
      dataCache.clear();
      clearAllDrafts();
      clearSharedSecretCache();

      // Remove all realtime channels to prevent subscription conflicts
      await supabase.removeAllChannels();

      // Set the new session using the stored refresh token
      const { data, error } = await supabase.auth.setSession({
        access_token: target.accessToken,
        refresh_token: target.refreshToken,
      });

      if (error || !data.session) {
        // Token expired, try to refresh
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: target.refreshToken,
        });

        if (refreshError || !refreshData.session) {
          // Session is invalid, remove it
          await removeAccount(targetUserId);
          await loadAccounts();
          switchingRef.current = false;
          setSwitchingAccount(false);
          return;
        }

        setSession(refreshData.session);
        await updateAccountTokens(
          targetUserId,
          refreshData.session.access_token,
          refreshData.session.refresh_token,
          refreshData.session.expires_at || 0,
        );
        await setActiveAccountId(targetUserId);
        dataCache.restoreFromDisk(targetUserId);
        setDraftsUserId(targetUserId);
        loadDraftsFromServer();
        ensureKeyPair(targetUserId);
      } else {
        setSession(data.session);
        await updateAccountTokens(
          targetUserId,
          data.session.access_token,
          data.session.refresh_token,
          data.session.expires_at || 0,
        );
        await setActiveAccountId(targetUserId);
        dataCache.restoreFromDisk(targetUserId);
        setDraftsUserId(targetUserId);
        loadDraftsFromServer();
        ensureKeyPair(targetUserId);
      }

      await loadAccounts();
    } catch {
      // If switching fails, stay on current session
    } finally {
      switchingRef.current = false;
      setSwitchingAccount(false);
    }
  }, [session, loadAccounts]);

  const startAddAccount = useCallback(() => {
    setAddAccountMode(true);
  }, []);

  const removeAccountById = useCallback(async (userId: string) => {
    if (session?.user?.id === userId) {
      // Removing current account - sign out and switch to another
      await unregisterPushToken(userId);
      await removeAccount(userId);
      const remaining = (await getStoredAccounts()).filter(a => a.userId !== userId);
      if (remaining.length > 0) {
        await switchAccount(remaining[0].userId);
      } else {
        await supabase.auth.signOut();
      }
    } else {
      await removeAccount(userId);
    }
    await loadAccounts();
  }, [session, switchAccount, loadAccounts]);

  const signOut = async () => {
    const userId = session?.user?.id;
    if (userId) {
      await unregisterPushToken(userId);
      await removeAccount(userId);
    }
    await clearBadge();
    clearSharedSecretCache();
    await supabase.auth.signOut();
    await loadAccounts();
  };

  const authUser = useMemo(() => session?.user ?? null, [session]);
  const contextValue = useMemo(() => ({
    session,
    user: authUser,
    loading,
    signOut,
    accounts,
    switchAccount,
    switchingAccount,
    addAccountMode,
    startAddAccount,
    removeAccountById,
    refreshAccounts: loadAccounts,
  }), [session, authUser, loading, signOut, accounts, switchAccount, switchingAccount, addAccountMode, startAddAccount, removeAccountById, loadAccounts]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

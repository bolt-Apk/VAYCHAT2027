import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const PIN_HASH_KEY = '@vaychat_pin_hash';
const PIN_ENABLED_KEY = '@vaychat_pin_enabled';
const PIN_LENGTH_KEY = '@vaychat_pin_length';
const BIOMETRIC_ENABLED_KEY = '@vaychat_biometric_enabled';
const LOCK_TIMEOUT_KEY = '@vaychat_lock_timeout';

const LocalAuthentication = Platform.OS !== 'web' ? (() => { try { return require('expo-local-authentication'); } catch { return null; } })() : null;

interface SecuritySettings {
  pin_hash: string | null;
  pin_enabled: boolean;
  pin_length: number;
  biometric_enabled: boolean;
  lock_timeout: number;
}

interface SecurityContextType {
  isLocked: boolean;
  pinEnabled: boolean;
  pinLength: number;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  lockTimeout: number;
  unlock: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  setupPin: (pin: string) => Promise<void>;
  removePin: () => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  setLockTimeout: (seconds: number) => Promise<void>;
  lockNow: () => void;
}

const SecurityContext = createContext<SecurityContextType>({
  isLocked: false,
  pinEnabled: false,
  pinLength: 4,
  biometricEnabled: false,
  biometricAvailable: false,
  lockTimeout: 0,
  unlock: async () => false,
  unlockWithBiometric: async () => false,
  setupPin: async () => {},
  removePin: async () => {},
  verifyPin: async () => false,
  setBiometricEnabled: async () => {},
  setLockTimeout: async () => {},
  lockNow: () => {},
});

async function hashPin(pin: string): Promise<string> {
  const salted = pin + 'vaychat_salt_2024';
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(salted);
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hash);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    const ExpoCrypto = await import('expo-crypto');
    const hash = await ExpoCrypto.digestStringAsync(
      ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      salted
    );
    return hash;
  } catch {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof TextEncoder === 'undefined') {
      throw new Error('No secure hashing available');
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(salted);
    const hash = await subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hash);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

async function checkBiometricAvailability(): Promise<boolean> {
  if (Platform.OS === 'web' || !LocalAuthentication) return false;
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return enrolled;
  } catch {
    return false;
  }
}

async function syncSettingsToServer(settings: SecuritySettings) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { pin_hash: _omit, ...safeSettings } = settings;
  await supabase
    .from('user_secrets')
    .upsert({ user_id: user.id, security_settings: safeSettings, updated_at: new Date().toISOString() })
    .eq('user_id', user.id);
}

export function SecurityProvider({ children, isAuthenticated }: { children: ReactNode; isAuthenticated: boolean }) {
  const [isLocked, setIsLocked] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinLength, setPinLength] = useState(4);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [lockTimeout, setLockTimeoutState] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const backgroundTimeRef = useRef<number | null>(null);

  useEffect(() => {
    loadSettings();
    checkBiometricAvailability().then(setBiometricAvailable);
  }, []);

  useEffect(() => {
    if (!loaded || !isAuthenticated || !pinEnabled) return;

    const handleAppState = (nextState: string) => {
      if (nextState === 'active') {
        if (backgroundTimeRef.current && lockTimeout > 0) {
          const elapsed = (Date.now() - backgroundTimeRef.current) / 1000;
          if (elapsed >= lockTimeout) {
            setIsLocked(true);
          }
        } else if (backgroundTimeRef.current && lockTimeout === 0) {
          setIsLocked(true);
        }
        backgroundTimeRef.current = null;
      } else {
        backgroundTimeRef.current = Date.now();
      }
    };

    const appSub = AppState.addEventListener('change', handleAppState);

    let visibilityHandler: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      visibilityHandler = () => {
        if (document.hidden) {
          backgroundTimeRef.current = Date.now();
        } else if (backgroundTimeRef.current) {
          const elapsed = (Date.now() - backgroundTimeRef.current) / 1000;
          const threshold = lockTimeout > 0 ? lockTimeout : 0;
          if (elapsed >= threshold) {
            setIsLocked(true);
          }
          backgroundTimeRef.current = null;
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }

    return () => {
      appSub.remove();
      if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
    };
  }, [loaded, isAuthenticated, pinEnabled, lockTimeout]);

  const loadSettings = async () => {
    // Load from local storage first for instant UI
    const [pinEn, bioEn, timeout, storedPinLen] = await Promise.all([
      AsyncStorage.getItem(PIN_ENABLED_KEY),
      AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
      AsyncStorage.getItem(LOCK_TIMEOUT_KEY),
      AsyncStorage.getItem(PIN_LENGTH_KEY),
    ]);

    let localPinEnabled = pinEn === 'true';
    let localBioEnabled = bioEn === 'true';
    let localTimeout = timeout ? parseInt(timeout, 10) : 0;
    let localPinLength = storedPinLen ? parseInt(storedPinLen, 10) : 4;

    setPinEnabled(localPinEnabled);
    setBiometricEnabledState(localBioEnabled);
    setLockTimeoutState(localTimeout);
    setPinLength(localPinLength);
    if (localPinEnabled) {
      setIsLocked(true);
    }
    setLoaded(true);

    // Then sync from server (server is source of truth for cross-device)
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: secrets } = await supabase
        .from('user_secrets')
        .select('security_settings')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!secrets?.security_settings) return;

      const s = secrets.security_settings as SecuritySettings;
      if (!s.pin_enabled) return;

      const currentLocalEnabled = await AsyncStorage.getItem(PIN_ENABLED_KEY);
      if (currentLocalEnabled === 'true') return;

      if (s.pin_hash) {
        await AsyncStorage.setItem(PIN_HASH_KEY, s.pin_hash);
      }
      await AsyncStorage.setItem(PIN_ENABLED_KEY, 'true');
      await AsyncStorage.setItem(PIN_LENGTH_KEY, s.pin_length.toString());
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, s.biometric_enabled ? 'true' : 'false');
      await AsyncStorage.setItem(LOCK_TIMEOUT_KEY, s.lock_timeout.toString());

      if (s.pin_enabled !== localPinEnabled) {
        setPinEnabled(s.pin_enabled);
        if (s.pin_enabled && !localPinEnabled) setIsLocked(true);
      }
      setPinLength(s.pin_length);
      setBiometricEnabledState(s.biometric_enabled);
      setLockTimeoutState(s.lock_timeout);
    })();
  };

  const buildAndSyncSettings = useCallback(async (
    pinHash: string | null,
    enabled: boolean,
    length: number,
    bio: boolean,
    timeout: number
  ) => {
    const settings: SecuritySettings = {
      pin_hash: pinHash,
      pin_enabled: enabled,
      pin_length: length,
      biometric_enabled: bio,
      lock_timeout: timeout,
    };
    syncSettingsToServer(settings);
  }, []);

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    const storedHash = await AsyncStorage.getItem(PIN_HASH_KEY);
    if (!storedHash) return false;
    const inputHash = await hashPin(pin);
    if (inputHash === storedHash) {
      setIsLocked(false);
      return true;
    }
    return false;
  }, []);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web' || !LocalAuthentication) return false;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Разблокировать VayChat',
        cancelLabel: 'Отмена',
        disableDeviceFallback: true,
      });
      if (result.success) {
        setIsLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const setupPin = useCallback(async (pin: string) => {
    const pinHash = await hashPin(pin);
    await AsyncStorage.setItem(PIN_HASH_KEY, pinHash);
    await AsyncStorage.setItem(PIN_ENABLED_KEY, 'true');
    await AsyncStorage.setItem(PIN_LENGTH_KEY, pin.length.toString());
    setPinEnabled(true);
    setPinLength(pin.length);
    setIsLocked(false);
    buildAndSyncSettings(pinHash, true, pin.length, biometricEnabled, lockTimeout);
  }, [biometricEnabled, lockTimeout, buildAndSyncSettings]);

  const removePin = useCallback(async () => {
    await AsyncStorage.removeItem(PIN_HASH_KEY);
    await AsyncStorage.setItem(PIN_ENABLED_KEY, 'false');
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'false');
    setPinEnabled(false);
    setBiometricEnabledState(false);
    setIsLocked(false);
    buildAndSyncSettings(null, false, 4, false, lockTimeout);
  }, [lockTimeout, buildAndSyncSettings]);

  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    const storedHash = await AsyncStorage.getItem(PIN_HASH_KEY);
    if (!storedHash) return false;
    const inputHash = await hashPin(pin);
    return inputHash === storedHash;
  }, []);

  const setBiometricEnabled = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const available = await checkBiometricAvailability();
      if (!available) return;
    }
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
    setBiometricEnabledState(enabled);
    const pinHash = await AsyncStorage.getItem(PIN_HASH_KEY);
    buildAndSyncSettings(pinHash, pinEnabled, pinLength, enabled, lockTimeout);
  }, [pinEnabled, pinLength, lockTimeout, buildAndSyncSettings]);

  const setLockTimeoutFn = useCallback(async (seconds: number) => {
    await AsyncStorage.setItem(LOCK_TIMEOUT_KEY, seconds.toString());
    setLockTimeoutState(seconds);
    const pinHash = await AsyncStorage.getItem(PIN_HASH_KEY);
    buildAndSyncSettings(pinHash, pinEnabled, pinLength, biometricEnabled, seconds);
  }, [pinEnabled, pinLength, biometricEnabled, buildAndSyncSettings]);

  const lockNow = useCallback(() => {
    if (pinEnabled) setIsLocked(true);
  }, [pinEnabled]);

  return (
    <SecurityContext.Provider value={{
      isLocked: isLocked && isAuthenticated,
      pinEnabled,
      pinLength,
      biometricEnabled,
      biometricAvailable,
      lockTimeout,
      unlock,
      unlockWithBiometric,
      setupPin,
      removePin,
      verifyPin,
      setBiometricEnabled,
      setLockTimeout: setLockTimeoutFn,
      lockNow,
    }}>
      {children}
    </SecurityContext.Provider>
  );
}

export const useSecurity = () => useContext(SecurityContext);

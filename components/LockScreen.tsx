import { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Animated, Easing, Platform } from 'react-native';
import { Shield, Delete, Fingerprint } from 'lucide-react-native';
import { useAppearance } from '@/lib/appearance-context';
import { useSecurity } from '@/lib/security-context';

export default function LockScreen() {
  const { colors } = useAppearance();
  const security = useSecurity();
  const expectedLength = security.pinLength || 4;
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number>(0);
  const [lockCountdown, setLockCountdown] = useState(0);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const inputRef = useRef<TextInput>(null);
  const biometricTriedRef = useRef(false);

  const showBiometric = security.biometricEnabled && security.biometricAvailable && Platform.OS !== 'web';

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (showBiometric && !biometricTriedRef.current) {
      biometricTriedRef.current = true;
      security.unlockWithBiometric();
    }
  }, [showBiometric, security]);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true, easing: Easing.linear }),
    ]).start();
  };

  useEffect(() => {
    if (lockedUntil <= Date.now()) {
      setLockCountdown(0);
      return;
    }
    const id = setInterval(() => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockCountdown(0);
        clearInterval(id);
      } else {
        setLockCountdown(remaining);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const isLockedOut = lockCountdown > 0;

  const handleDigit = (digit: string) => {
    if (isLockedOut) return;
    if (pin.length >= expectedLength) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length === expectedLength) {
      attemptUnlock(newPin);
    }
  };

  const attemptUnlock = (value: string) => {
    setTimeout(async () => {
      const ok = await security.unlock(value);
      if (!ok) {
        shake();
        setError('Неверный PIN-код');
        setPin('');
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= 5) {
          const delay = Math.min(30, Math.pow(2, newAttempts - 5)) * 1000;
          const until = Date.now() + delay;
          setLockedUntil(until);
          setLockCountdown(Math.ceil(delay / 1000));
        }
      }
    }, 100);
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  };

  const handleBiometric = async () => {
    const ok = await security.unlockWithBiometric();
    if (!ok) {
      setError('Биометрия не распознана');
    }
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', showBiometric ? 'bio' : '', '0', 'del'];

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.background, opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
      <View style={styles.topSection}>
        <View style={[styles.lockIconCircle, { backgroundColor: `${colors.primary}15` }]}>
          <Shield color={colors.primary} size={36} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>VayChat заблокирован</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Введите PIN-код для разблокировки
        </Text>

        <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
          {Array.from({ length: expectedLength }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i < pin.length ? colors.primary : 'transparent',
                  borderColor: i < pin.length ? colors.primary : colors.border,
                  transform: [{ scale: i < pin.length ? 1.15 : 1 }],
                },
              ]}
            />
          ))}
        </Animated.View>

        {error ? (
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
        ) : (
          <View style={{ height: 20 }} />
        )}

        {attempts >= 5 && (
          <Text style={[styles.warning, { color: colors.error }]}>
            {isLockedOut ? `Подождите ${lockCountdown} сек.` : 'Слишком много попыток.'}
          </Text>
        )}
      </View>

      <View style={styles.keypad}>
        {digits.map((d, i) => {
          if (d === '') return <View key={i} style={styles.keyEmpty} />;
          if (d === 'bio') {
            return (
              <TouchableOpacity
                key={i}
                style={styles.key}
                onPress={handleBiometric}
                activeOpacity={0.6}
                accessibilityLabel="Разблокировать биометрией"
              >
                <Fingerprint color={colors.primary} size={28} />
              </TouchableOpacity>
            );
          }
          if (d === 'del') {
            return (
              <TouchableOpacity
                key={i}
                style={styles.key}
                onPress={handleDelete}
                activeOpacity={0.6}
                disabled={pin.length === 0}
                accessibilityLabel="Удалить цифру"
              >
                <Delete color={pin.length > 0 ? colors.text : colors.textTertiary} size={24} />
              </TouchableOpacity>
            );
          }
          return (
            <TouchableOpacity
              key={i}
              style={[styles.key, { backgroundColor: colors.backgroundSecondary }]}
              onPress={() => handleDigit(d)}
              activeOpacity={0.6}
              disabled={isLockedOut}
              accessibilityLabel={String(d)}
              accessibilityRole="button"
            >
              <Text style={[styles.keyText, { color: colors.text }]}>{d}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        value={pin}
        onChangeText={(t) => {
          if (isLockedOut) return;
          const cleaned = t.replace(/\D/g, '').slice(0, expectedLength);
          setPin(cleaned);
          if (cleaned.length === expectedLength) {
            attemptUnlock(cleaned);
          }
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={expectedLength}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  topSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  lockIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    marginBottom: 28,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 8,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  error: {
    fontSize: 14,
    fontWeight: '500',
    height: 20,
    marginTop: 4,
  },
  warning: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: 270,
    gap: 12,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyEmpty: {
    width: 72,
    height: 72,
  },
  keyText: {
    fontSize: 28,
    fontWeight: '500',
  },
  hiddenInput: {
    position: 'absolute',
    top: -9999,
    left: -9999,
    width: 1,
    height: 1,
    opacity: 0,
  },
});

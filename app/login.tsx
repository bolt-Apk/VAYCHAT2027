import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
  Keyboard,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Phone, ArrowRight, Shield, Lock, ArrowLeft, Fingerprint } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAppearance } from '@/lib/appearance-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_INVITE_KEY } from '@/lib/pending-invite';

const PERMISSIONS_COMPLETED_KEY = '@vaychat_permissions_completed';

function PulsingRings({ color }: { color: string }) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createRingAnim = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 2800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );

    const a1 = createRingAnim(ring1, 0);
    const a2 = createRingAnim(ring2, 900);
    a1.start();
    a2.start();
    return () => { a1.stop(); a2.stop(); };
  }, []);

  const renderRing = (val: Animated.Value, baseSize: number) => {
    const scale = val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
    const opacity = val.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.1, 0] });
    return (
      <Animated.View
        style={{
          position: 'absolute',
          width: baseSize,
          height: baseSize,
          borderRadius: baseSize / 2,
          borderWidth: 1.5,
          borderColor: color,
          opacity,
          transform: [{ scale }],
        }}
      />
    );
  };

  return (
    <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', width: 90, height: 90 }}>
      {renderRing(ring1, 80)}
      {renderRing(ring2, 80)}
    </View>
  );
}

function FadeIn({ delay = 0, children, style }: { delay?: number; children: React.ReactNode; style?: any }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, delay, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, delay, tension: 60, friction: 9, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

function PinDot({ filled, color, borderColor }: { filled: boolean; color: string; borderColor: string }) {
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: filled ? 1 : 0,
      tension: 200,
      friction: 12,
      useNativeDriver: true,
    }).start();
  }, [filled]);

  return (
    <View style={[styles.pinDotOuter, { borderColor: filled ? color : borderColor }]}>
      <Animated.View
        style={[
          styles.pinDotInner,
          { backgroundColor: color, transform: [{ scale }] },
        ]}
      />
    </View>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppearance();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const isDark = resolvedTheme === 'dark';
  const [phone, setPhone] = useState('+7');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'phone' | 'pin'>('phone');
  const pinInputRef = useRef<TextInput>(null);

  const stepAnim = useRef(new Animated.Value(0)).current;
  const cardShakeX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (step === 'pin') {
      setTimeout(() => pinInputRef.current?.focus(), 200);
    }
  }, [step]);

  useEffect(() => {
    Animated.spring(stepAnim, {
      toValue: step === 'pin' ? 1 : 0,
      tension: 50,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [step]);

  const shakeCard = useCallback(() => {
    Animated.sequence([
      Animated.timing(cardShakeX, { toValue: 12, duration: 60, useNativeDriver: true }),
      Animated.timing(cardShakeX, { toValue: -12, duration: 60, useNativeDriver: true }),
      Animated.timing(cardShakeX, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(cardShakeX, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(cardShakeX, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [cardShakeX]);

  const formatPhone = (text: string) => {
    let cleaned = text.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+7')) {
      cleaned = '+7' + cleaned.replace(/^\+?7?/, '');
    }
    if (cleaned.length > 12) cleaned = cleaned.slice(0, 12);
    setPhone(cleaned);
  };

  const displayPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length <= 1) return '+7';
    let result = '+7';
    const rest = digits.slice(1);
    if (rest.length > 0) result += ' (' + rest.slice(0, 3);
    if (rest.length >= 3) result += ') ';
    if (rest.length > 3) result += rest.slice(3, 6);
    if (rest.length > 6) result += '-' + rest.slice(6, 8);
    if (rest.length > 8) result += '-' + rest.slice(8, 10);
    return result;
  };

  const isValidPhone = () => phone.length === 12 && phone.startsWith('+7');
  const isValidPin = () => pin.length >= 4;

  const phoneToEmail = (phoneNum: string) => `${phoneNum.replace('+', '')}@messenger.local`;
  const pinToPassword = (p: string) => {
    const combined = `${phone}:${p}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < combined.length; i++) {
      hash ^= combined.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const h1 = (hash >>> 0).toString(36);
    hash ^= combined.length;
    for (let i = combined.length - 1; i >= 0; i--) {
      hash ^= combined.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const h2 = (hash >>> 0).toString(36);
    return `Vc!${h1}${h2}#${p}xK9`;
  };

  const handleContinue = () => {
    if (!isValidPhone()) {
      setError('Введите корректный номер телефона');
      shakeCard();
      return;
    }
    setError('');
    setStep('pin');
  };

  const handleSubmit = async () => {
    if (loading) return;
    if (!isValidPin()) {
      setError('Код должен содержать минимум 4 цифры');
      shakeCard();
      return;
    }

    setLoading(true);
    setError('');

    const email = phoneToEmail(phone);
    const password = pinToPassword(pin);

    try {
      let { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError?.message.includes('Invalid login credentials')) {
        const legacyPassword = `Vc!${pin}#xK9mQ`;
        const legacyResult = await supabase.auth.signInWithPassword({ email, password: legacyPassword });
        if (!legacyResult.error && legacyResult.data.user) {
          await supabase.auth.updateUser({ password });
          data = legacyResult.data;
          signInError = null;
        }
      }

      if (signInError?.message.includes('Invalid login credentials')) {
        const rawPinResult = await supabase.auth.signInWithPassword({ email, password: pin });
        if (!rawPinResult.error && rawPinResult.data.user) {
          await supabase.auth.updateUser({ password });
          data = rawPinResult.data;
          signInError = null;
        }
      }

      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
          const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
          const signUpResponse = await fetch(`${supabaseUrl}/functions/v1/auth-signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
            body: JSON.stringify({ email, password }),
          });
          const signUpResult = await signUpResponse.json();

          if (!signUpResponse.ok) {
            if (signUpResult.error?.includes('already registered')) {
              setError('Неверный код. Попробуйте ещё раз.');
            } else if (signUpResult.error?.includes('weak') || signUpResult.error?.includes('data breach') || signUpResult.error?.includes('leaked')) {
              setError('Этот код слишком простой. Выберите другой.');
            } else if (signUpResult.error?.includes('rate limit') || signUpResult.error?.includes('too many') || signUpResponse.status === 429) {
              setError('Слишком много попыток. Подождите немного и попробуйте снова.');
            } else {
              setError(signUpResult.error || 'Ошибка регистрации. Попробуйте ещё раз.');
            }
            shakeCard();
          } else if (signUpResult.user) {
            const { error: newSignInError } = await supabase.auth.signInWithPassword({
              email,
              password,
            });

            if (newSignInError) {
              setError('Аккаунт создан. Войдите ещё раз.');
              shakeCard();
            } else {
              await supabase.from('profiles').insert({
                id: signUpResult.user.id,
                phone,
                display_name: '',
              });
              router.replace('/setup-profile');
            }
          }
        } else {
          setError(signInError.message);
          shakeCard();
        }
      } else if (data.user) {
        await supabase.from('profiles').update({ is_online: true }).eq('id', data.user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', data.user.id)
          .maybeSingle();

        if (!profile || !profile.display_name) {
          router.replace('/setup-profile');
        } else {
          const pendingInvite = await AsyncStorage.getItem(PENDING_INVITE_KEY);
          if (pendingInvite) {
            await AsyncStorage.removeItem(PENDING_INVITE_KEY);
            router.replace(`/u/${pendingInvite}` as any);
          } else {
            const permsDone = await AsyncStorage.getItem(PERMISSIONS_COMPLETED_KEY);
            if (permsDone === 'true') {
              router.replace('/(tabs)');
            } else {
              router.replace('/permissions');
            }
          }
        }
      }
    } catch (e) {
      setError('Ошибка соединения. Попробуйте позже.');
      shakeCard();
    } finally {
      setLoading(false);
    }
  };

  const cardBg = isDark ? 'rgba(23,33,43,0.92)' : 'rgba(255,255,255,0.95)';
  const cardBorder = isDark ? 'rgba(42,171,238,0.12)' : 'rgba(42,171,238,0.08)';
  const inputBg = isDark ? 'rgba(14,22,33,0.7)' : 'rgba(247,249,250,0.9)';
  const inputBorder = isDark ? 'rgba(42,171,238,0.2)' : 'rgba(230,236,240,1)';
  const featurePillBg = isDark ? 'rgba(42,171,238,0.08)' : 'rgba(42,171,238,0.06)';
  const featurePillColor = isDark ? colors.primaryLight : colors.primaryDark;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Animated.View
          style={{
            position: 'absolute',
            top: -60,
            left: SCREEN_W * 0.15,
            width: SCREEN_W * 0.7,
            height: 220,
            borderRadius: 110,
            backgroundColor: colors.primary,
            opacity: isDark ? 0.05 : 0.03,
          }}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Pressable style={styles.innerContent} onPress={Keyboard.dismiss}>
            <FadeIn delay={0} style={styles.header}>
              <View style={styles.logoArea}>
                <PulsingRings color={colors.primary} />
                <View style={[
                  styles.logoContainer,
                  {
                    shadowColor: colors.primary,
                    shadowOffset: { width: 0, height: 8 },
                    shadowOpacity: isDark ? 0.5 : 0.25,
                    shadowRadius: 20,
                    elevation: 12,
                  },
                ]}>
                  <Image
                    source={require('@/assets/images/app-icon.png')}
                    style={styles.logoImage}
                  />
                </View>
              </View>
              <Text style={[styles.title, { color: colors.text }]}>VayChat</Text>
            </FadeIn>

            <FadeIn delay={150}>
              <Animated.View
                style={[
                  styles.card,
                  {
                    backgroundColor: cardBg,
                    borderColor: cardBorder,
                    transform: [{ translateX: cardShakeX }],
                    ...Platform.select({
                      ios: {
                        shadowColor: isDark ? '#000' : colors.primary,
                        shadowOffset: { width: 0, height: 6 },
                        shadowOpacity: isDark ? 0.35 : 0.06,
                        shadowRadius: 20,
                      },
                      android: { elevation: 6 },
                      default: {},
                    }),
                  },
                ]}
              >
                {step === 'phone' ? (
                  <View key="phone-step">
                    <Text style={[styles.cardTitle, { color: colors.text }]}>Вход по номеру</Text>
                    <Text style={[styles.cardDesc, { color: colors.textTertiary }]}>
                      Введите номер для входа или регистрации
                    </Text>

                    <View style={[styles.inputContainer, {
                      backgroundColor: inputBg,
                      borderColor: error ? colors.error : inputBorder,
                    }]}>
                      <View style={[styles.inputIconWrap, { backgroundColor: `${colors.primary}12` }]}>
                        <Phone color={colors.primary} size={18} strokeWidth={2.2} />
                      </View>
                      <TextInput
                        style={[styles.input, { color: colors.text }]}
                        value={phone}
                        onChangeText={formatPhone}
                        placeholder="+7 (XXX) XXX-XX-XX"
                        placeholderTextColor={colors.textTertiary}
                        keyboardType="phone-pad"
                        maxLength={12}
                        autoFocus
                      />
                    </View>

                    {error ? (
                      <View style={styles.errorWrap}>
                        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={[
                        styles.button,
                        { backgroundColor: colors.primary },
                        !isValidPhone() && styles.buttonDisabled,
                      ]}
                      onPress={handleContinue}
                      disabled={!isValidPhone()}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.buttonText}>Продолжить</Text>
                      <ArrowRight color="#FFFFFF" size={18} strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View key="pin-step">
                    <TouchableOpacity
                      onPress={() => { setStep('phone'); setError(''); setPin(''); }}
                      style={styles.backRow}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.backArrowWrap, { backgroundColor: `${colors.primary}12` }]}>
                        <ArrowLeft color={colors.primary} size={16} strokeWidth={2.5} />
                      </View>
                      <Text style={[styles.phoneDisplay, { color: colors.primary }]}>
                        {displayPhone(phone)}
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.pinSection}>
                      <View style={[styles.pinIconWrap, { backgroundColor: `${colors.primary}10` }]}>
                        <Fingerprint color={colors.primary} size={26} strokeWidth={1.8} />
                      </View>

                      <Text style={[styles.pinTitle, { color: colors.text }]}>Код-пароль</Text>

                      <Pressable style={styles.pinDotsRow} onPress={() => pinInputRef.current?.focus()}>
                        {Array.from({ length: 6 }, (_, i) => (
                          <PinDot
                            key={i}
                            filled={i < pin.length}
                            color={colors.primary}
                            borderColor={isDark ? 'rgba(42,171,238,0.2)' : 'rgba(42,171,238,0.25)'}
                          />
                        ))}
                      </Pressable>

                      <TextInput
                        ref={pinInputRef}
                        style={styles.pinHiddenInput}
                        value={pin}
                        onChangeText={(text) => setPin(text.replace(/[^\d]/g, '').slice(0, 6))}
                        keyboardType="number-pad"
                        maxLength={6}
                        autoFocus
                        caretHidden
                      />

                      <Text style={[styles.pinHint, { color: colors.textTertiary }]}>
                        Минимум 4 цифры
                      </Text>
                    </View>

                    {error ? (
                      <View style={styles.errorWrap}>
                        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={[
                        styles.button,
                        { backgroundColor: colors.primary },
                        (!isValidPin() || loading) && styles.buttonDisabled,
                      ]}
                      onPress={handleSubmit}
                      disabled={!isValidPin() || loading}
                      activeOpacity={0.85}
                    >
                      {loading ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <>
                          <Text style={styles.buttonText}>Войти</Text>
                          <ArrowRight color="#FFFFFF" size={18} strokeWidth={2.5} />
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </Animated.View>
            </FadeIn>

            <FadeIn delay={300} style={styles.footer}>
              <View style={styles.featuresRow}>
                <View style={[styles.featurePill, { backgroundColor: featurePillBg }]}>
                  <Shield color={featurePillColor} size={11} strokeWidth={2.5} />
                  <Text style={[styles.featurePillText, { color: featurePillColor }]}>E2E</Text>
                </View>
                <View style={[styles.featurePill, { backgroundColor: featurePillBg }]}>
                  <Lock color={featurePillColor} size={11} strokeWidth={2.5} />
                  <Text style={[styles.featurePillText, { color: featurePillColor }]}>Приватность</Text>
                </View>
              </View>
              <Text style={[styles.termsText, { color: colors.textTertiary }]}>
                Продолжая, вы соглашаетесь с{' '}
                <Text style={{ color: colors.primary }} onPress={() => router.push('/terms')}>
                  Условиями
                </Text>
                {' '}и{' '}
                <Text style={{ color: colors.primary }} onPress={() => router.push('/privacy')}>
                  Политикой конфиденциальности
                </Text>
              </Text>
            </FadeIn>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  innerContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoArea: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 90,
    height: 90,
    marginBottom: 14,
  },
  logoContainer: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 22,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    marginBottom: 28,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingRight: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  inputIconWrap: {
    width: 44,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.3,
    paddingVertical: 14,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  backArrowWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  phoneDisplay: {
    fontSize: 14,
    fontWeight: '600',
  },
  pinSection: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  pinIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  pinTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 14,
  },
  pinDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 12,
  },
  pinDotOuter: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinDotInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  pinHiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
    top: -1000,
  },
  pinHint: {
    fontSize: 12,
    textAlign: 'center',
  },
  errorWrap: {
    marginTop: 10,
    paddingHorizontal: 4,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 18,
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  footer: {
    alignItems: 'center',
    gap: 12,
  },
  featuresRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  featurePillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  termsText: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});

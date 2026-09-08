import { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, TextInput, Platform, Modal, Pressable } from 'react-native';
import BottomSheet from '@/components/BottomSheet';
import { useGoBack } from '@/hooks/useGoBack';
import { ArrowLeft, Lock, Fingerprint, Shield, Key, Clock, Eye, EyeOff, ShieldCheck, ShieldAlert, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';
import { useSecurity } from '@/lib/security-context';
import { isE2EEnabled, setE2EEnabled, exportKeyBackup, importKeyBackup, hasKeyPair } from '@/lib/encryption';

const TIMEOUT_OPTIONS = [
  { label: 'Сразу', value: 0 },
  { label: '1 минута', value: 60 },
  { label: '5 минут', value: 300 },
  { label: '15 минут', value: 900 },
  { label: '1 час', value: 3600 },
];

export default function SecurityScreen() {
  const goBack = useGoBack();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const security = useSecurity();

  const [showPinSetup, setShowPinSetup] = useState(false);
  const [showPinVerify, setShowPinVerify] = useState(false);
  const [showTimeoutPicker, setShowTimeoutPicker] = useState(false);
  const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter');
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifyPin, setVerifyPin] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [e2eEnabled, setE2eEnabled] = useState(false);
  const [hasKeys, setHasKeys] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [showBackupSheet, setShowBackupSheet] = useState(false);
  const [showRestoreSheet, setShowRestoreSheet] = useState(false);
  const [restoreData, setRestoreData] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [backupResult, setBackupResult] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const pinInputRef = useRef<TextInput>(null);

  useEffect(() => {
    isE2EEnabled().then(setE2eEnabled);
    hasKeyPair().then(setHasKeys);
  }, []);

  const handleSetupPin = () => {
    setPinStep('enter');
    setPinValue('');
    setPinConfirm('');
    setPinError('');
    setShowPinSetup(true);
    setTimeout(() => pinInputRef.current?.focus(), 100);
  };

  const handlePinSubmit = async () => {
    if (pinStep === 'enter') {
      if (pinValue.length < 4) {
        setPinError('Минимум 4 цифры');
        return;
      }
      setPinConfirm(pinValue);
      setPinValue('');
      setPinStep('confirm');
      setPinError('');
      setTimeout(() => pinInputRef.current?.focus(), 50);
    } else {
      if (pinValue !== pinConfirm) {
        setPinError('PIN-коды не совпадают');
        setPinValue('');
        return;
      }
      await security.setupPin(pinValue);
      setShowPinSetup(false);
    }
  };

  const handleRemovePin = () => {
    setVerifyPin('');
    setVerifyError('');
    setShowPinVerify(true);
  };

  const handleVerifyAndRemove = async () => {
    const valid = await security.verifyPin(verifyPin);
    if (valid) {
      await security.removePin();
      setShowPinVerify(false);
    } else {
      setVerifyError('Неверный PIN-код');
      setVerifyPin('');
    }
  };

  const handleToggleBiometric = async (value: boolean) => {
    if (value && !security.biometricAvailable) return;
    if (value) {
      const ok = await security.unlockWithBiometric();
      if (!ok) return;
    }
    await security.setBiometricEnabled(value);
  };

  const handleToggleE2E = async (value: boolean) => {
    await setE2EEnabled(value);
    setE2eEnabled(value);
  };

  const getTimeoutLabel = (seconds: number) => {
    const opt = TIMEOUT_OPTIONS.find(o => o.value === seconds);
    return opt?.label || 'Сразу';
  };

  const renderPinDots = (length: number, maxDots: number = 6) => (
    <View style={styles.pinDotsRow}>
      {Array.from({ length: maxDots }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.pinDot,
            {
              backgroundColor: i < length ? colors.primary : 'transparent',
              borderColor: i < length ? colors.primary : colors.border,
            },
          ]}
        />
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]} onPress={() => goBack()} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Безопасность</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[styles.contentContainer, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]} keyboardDismissMode="on-drag">
        {/* PIN Lock Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Блокировка приложения</Text>

          <View style={[styles.settingRow, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: '#2196F3' }]}>
                <Lock color="#FFFFFF" size={16} />
              </View>
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>PIN-код</Text>
                <Text style={[styles.settingDescription, { color: colors.textTertiary }]}>
                  {security.pinEnabled ? 'Защита включена' : 'Установите PIN для входа в приложение'}
                </Text>
              </View>
            </View>
            {security.pinEnabled ? (
              <TouchableOpacity
                style={[styles.removeBtn, { backgroundColor: `${colors.error}15` }]}
                onPress={handleRemovePin}
                accessibilityLabel="Удалить PIN-код"
              >
                <Text style={[styles.removeBtnText, { color: colors.error }]}>Убрать</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.setupBtn, { backgroundColor: `${colors.primary}15` }]}
                onPress={handleSetupPin}
                accessibilityLabel="Установить PIN-код"
              >
                <Text style={[styles.setupBtnText, { color: colors.primary }]}>Установить</Text>
              </TouchableOpacity>
            )}
          </View>

          {security.pinEnabled && (
            <>
              <View style={[styles.settingRow, { backgroundColor: colors.backgroundSecondary }]}>
                <View style={styles.settingInfo}>
                  <View style={[styles.settingIcon, { backgroundColor: '#9C27B0' }]}>
                    <Fingerprint color="#FFFFFF" size={16} />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={[styles.settingLabel, { color: colors.text }]}>Биометрия</Text>
                    <Text style={[styles.settingDescription, { color: colors.textTertiary }]}>
                      {Platform.OS === 'web'
                        ? 'Недоступно в веб-версии'
                        : !security.biometricAvailable
                          ? 'Биометрия не настроена на устройстве'
                          : security.biometricEnabled
                            ? 'Face ID / Touch ID включен'
                            : 'Разблокировка по лицу или отпечатку'
                      }
                    </Text>
                  </View>
                </View>
                <Switch
                  value={security.biometricEnabled}
                  onValueChange={handleToggleBiometric}
                  trackColor={{ false: colors.backgroundTertiary, true: colors.primary }}
                  thumbColor="#FFFFFF"
                  disabled={Platform.OS === 'web' || !security.biometricAvailable}
                />
              </View>

              <TouchableOpacity
                style={[styles.settingRow, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => setShowTimeoutPicker(true)}
              >
                <View style={styles.settingInfo}>
                  <View style={[styles.settingIcon, { backgroundColor: '#FF9800' }]}>
                    <Clock color="#FFFFFF" size={16} />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={[styles.settingLabel, { color: colors.text }]}>Автоблокировка</Text>
                    <Text style={[styles.settingDescription, { color: colors.textTertiary }]}>
                      {getTimeoutLabel(security.lockTimeout)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.lockNowBtn, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30` }]}
                onPress={security.lockNow}
                accessibilityLabel="Заблокировать сейчас"
              >
                <Lock color={colors.primary} size={18} />
                <Text style={[styles.lockNowText, { color: colors.primary }]}>Заблокировать сейчас</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* E2E Encryption Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Шифрование</Text>

          <View style={[styles.settingRow, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: '#4CAF50' }]}>
                <Key color="#FFFFFF" size={16} />
              </View>
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Сквозное шифрование</Text>
                <Text style={[styles.settingDescription, { color: colors.textTertiary }]}>
                  {e2eEnabled ? 'Сообщения шифруются на устройстве' : 'AES-256-GCM шифрование сообщений'}
                </Text>
              </View>
            </View>
            <Switch
              value={e2eEnabled}
              onValueChange={handleToggleE2E}
              trackColor={{ false: colors.backgroundTertiary, true: '#4CAF50' }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={[styles.infoCard, { backgroundColor: colors.backgroundSecondary }]}>
            {e2eEnabled ? (
              <>
                <ShieldCheck color="#4CAF50" size={24} />
                <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                  Сообщения шифруются с помощью AES-256-GCM перед отправкой. Ключи хранятся только на вашем устройстве.
                </Text>
              </>
            ) : (
              <>
                <ShieldAlert color={colors.textTertiary} size={24} />
                <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                  Включите сквозное шифрование, чтобы защитить сообщения. Только участники беседы смогут их прочитать.
                </Text>
              </>
            )}
          </View>

          {hasKeys && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TouchableOpacity
                style={[styles.setupBtn, { backgroundColor: `${colors.primary}15`, flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 }]}
                onPress={() => { setBackupPassword(''); setBackupResult(null); setShowBackupSheet(true); }}
              >
                <Text style={[styles.setupBtnText, { color: colors.primary }]}>Экспорт ключей</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.setupBtn, { backgroundColor: `${colors.primary}15`, flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 }]}
                onPress={() => { setRestoreData(''); setRestorePassword(''); setRestoreError(''); setShowRestoreSheet(true); }}
              >
                <Text style={[styles.setupBtnText, { color: colors.primary }]}>Импорт ключей</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={[styles.securityStatus, { backgroundColor: colors.backgroundSecondary }]}>
          <Shield color={security.pinEnabled && e2eEnabled ? '#4CAF50' : colors.textTertiary} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.securityStatusTitle, { color: colors.text }]}>
              {security.pinEnabled && e2eEnabled
                ? 'Максимальная защита'
                : security.pinEnabled || e2eEnabled
                  ? 'Базовая защита'
                  : 'Защита не настроена'}
            </Text>
            <Text style={[styles.securityStatusDesc, { color: colors.textSecondary }]}>
              {!security.pinEnabled && !e2eEnabled
                ? 'Установите PIN-код и включите шифрование'
                : !security.pinEnabled
                  ? 'Установите PIN-код для полной защиты'
                  : !e2eEnabled
                    ? 'Включите шифрование для полной защиты'
                    : 'PIN-код и шифрование активны'}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* PIN Setup Modal */}
      <BottomSheet visible={showPinSetup} onClose={() => setShowPinSetup(false)} avoidKeyboard>
        <View style={styles.pinModalIcon}>
          <View style={[styles.pinModalIconInner, { backgroundColor: `${colors.primary}15` }]}>
            <Lock color={colors.primary} size={28} />
          </View>
        </View>
        <Text style={[styles.pinModalTitle, { color: colors.text }]}>
          {pinStep === 'enter' ? 'Создайте PIN-код' : 'Повторите PIN-код'}
        </Text>
        <Text style={[styles.pinModalDesc, { color: colors.textSecondary }]}>
          {pinStep === 'enter'
            ? 'Введите 4-6 цифр для блокировки приложения'
            : 'Введите PIN-код ещё раз для подтверждения'}
        </Text>

        {renderPinDots(pinValue.length)}

        {pinError ? (
          <Text style={[styles.pinError, { color: colors.error }]}>{pinError}</Text>
        ) : null}

        <TextInput
          ref={pinInputRef}
          style={styles.hiddenInput}
          value={pinValue}
          onChangeText={(t) => {
            const cleaned = t.replace(/\D/g, '').slice(0, 6);
            setPinValue(cleaned);
            setPinError('');
          }}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          maxLength={6}
        />

        <View style={styles.pinModalButtons}>
          <TouchableOpacity
            style={[styles.pinModalBtn, { backgroundColor: colors.backgroundTertiary }]}
            onPress={() => setShowPinSetup(false)}
          >
            <Text style={[styles.pinModalBtnText, { color: colors.textSecondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pinModalBtn, {
              backgroundColor: pinValue.length >= 4 ? colors.primary : colors.backgroundTertiary,
            }]}
            onPress={handlePinSubmit}
            disabled={pinValue.length < 4}
          >
            <Text style={[styles.pinModalBtnText, { color: pinValue.length >= 4 ? '#FFFFFF' : colors.textTertiary }]}>
              {pinStep === 'enter' ? 'Далее' : 'Установить'}
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* PIN Verify (for removal) Modal */}
      <BottomSheet visible={showPinVerify} onClose={() => setShowPinVerify(false)} avoidKeyboard>
        <View style={styles.pinModalIcon}>
          <View style={[styles.pinModalIconInner, { backgroundColor: `${colors.error}15` }]}>
            <Lock color={colors.error} size={28} />
          </View>
        </View>
        <Text style={[styles.pinModalTitle, { color: colors.text }]}>Введите PIN-код</Text>
        <Text style={[styles.pinModalDesc, { color: colors.textSecondary }]}>
          Для отключения введите текущий PIN-код
        </Text>

        {renderPinDots(verifyPin.length)}

        {verifyError ? (
          <Text style={[styles.pinError, { color: colors.error }]}>{verifyError}</Text>
        ) : null}

        <TextInput
          style={styles.hiddenInput}
          value={verifyPin}
          onChangeText={(t) => {
            setVerifyPin(t.replace(/\D/g, '').slice(0, 6));
            setVerifyError('');
          }}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          maxLength={6}
        />

        <View style={styles.pinModalButtons}>
          <TouchableOpacity
            style={[styles.pinModalBtn, { backgroundColor: colors.backgroundTertiary }]}
            onPress={() => setShowPinVerify(false)}
          >
            <Text style={[styles.pinModalBtnText, { color: colors.textSecondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pinModalBtn, {
              backgroundColor: verifyPin.length >= 4 ? colors.error : colors.backgroundTertiary,
            }]}
            onPress={handleVerifyAndRemove}
            disabled={verifyPin.length < 4}
          >
            <Text style={[styles.pinModalBtnText, { color: verifyPin.length >= 4 ? '#FFFFFF' : colors.textTertiary }]}>
              Отключить
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Timeout Picker */}
      <BottomSheet visible={showTimeoutPicker} onClose={() => setShowTimeoutPicker(false)} scrollable>
        <Text style={[styles.timeoutTitle, { color: colors.text }]}>Автоблокировка</Text>
        <Text style={[styles.timeoutDesc, { color: colors.textSecondary }]}>
          Время до автоматической блокировки после сворачивания приложения
        </Text>
        {TIMEOUT_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.timeoutOption, {
              backgroundColor: security.lockTimeout === opt.value ? `${colors.primary}15` : 'transparent',
              borderColor: security.lockTimeout === opt.value ? colors.primary : colors.border,
            }]}
            onPress={() => {
              security.setLockTimeout(opt.value);
              setShowTimeoutPicker(false);
            }}
          >
            <Text style={[styles.timeoutOptionText, {
              color: security.lockTimeout === opt.value ? colors.primary : colors.text,
              fontWeight: security.lockTimeout === opt.value ? '700' : '500',
            }]}>
              {opt.label}
            </Text>
            {security.lockTimeout === opt.value && (
              <View style={[styles.timeoutCheck, { backgroundColor: colors.primary }]}>
                <Check color="#FFF" size={14} />
              </View>
            )}
          </TouchableOpacity>
        ))}
      </BottomSheet>

      <Modal visible={showBackupSheet} transparent animationType="fade" onRequestClose={() => setShowBackupSheet(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowBackupSheet(false)}>
          <Pressable style={[styles.backupModal, { backgroundColor: colors.surface }]} onPress={e => e.stopPropagation()}>
            <Text style={[styles.backupTitle, { color: colors.text }]}>Экспорт ключей</Text>
            <Text style={[styles.backupDesc, { color: colors.textSecondary }]}>Введите пароль для шифрования резервной копии</Text>
            {!backupResult ? (
              <>
                <TextInput
                  style={[styles.backupInput, { backgroundColor: colors.backgroundSecondary, color: colors.text }]}
                  placeholder="Пароль (мин. 6 символов)"
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry
                  value={backupPassword}
                  onChangeText={setBackupPassword}
                />
                <TouchableOpacity
                  style={[styles.backupBtn, { backgroundColor: colors.primary, opacity: backupPassword.length >= 6 ? 1 : 0.5 }]}
                  onPress={async () => {
                    if (backupPassword.length < 6) return;
                    const result = await exportKeyBackup(backupPassword);
                    if (result) setBackupResult(result);
                  }}
                  disabled={backupPassword.length < 6}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Создать копию</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={[styles.backupInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, height: 80 }]}
                  value={backupResult}
                  multiline
                  editable={false}
                  selectTextOnFocus
                />
                <Text style={[styles.backupDesc, { color: colors.success, marginTop: 8 }]}>Скопируйте и сохраните в надёжном месте</Text>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showRestoreSheet} transparent animationType="fade" onRequestClose={() => setShowRestoreSheet(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowRestoreSheet(false)}>
          <Pressable style={[styles.backupModal, { backgroundColor: colors.surface }]} onPress={e => e.stopPropagation()}>
            <Text style={[styles.backupTitle, { color: colors.text }]}>Импорт ключей</Text>
            <TextInput
              style={[styles.backupInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, height: 80 }]}
              placeholder="Вставьте резервную копию"
              placeholderTextColor={colors.textSecondary}
              multiline
              value={restoreData}
              onChangeText={setRestoreData}
            />
            <TextInput
              style={[styles.backupInput, { backgroundColor: colors.backgroundSecondary, color: colors.text }]}
              placeholder="Пароль"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
              value={restorePassword}
              onChangeText={setRestorePassword}
            />
            {restoreError ? <Text style={{ color: colors.error, fontSize: 13, marginTop: 4 }}>{restoreError}</Text> : null}
            <TouchableOpacity
              style={[styles.backupBtn, { backgroundColor: colors.primary, opacity: restoreData.length > 10 && restorePassword.length >= 6 ? 1 : 0.5 }]}
              onPress={async () => {
                const ok = await importKeyBackup(restoreData, restorePassword);
                if (ok) {
                  setShowRestoreSheet(false);
                  setHasKeys(true);
                } else {
                  setRestoreError('Неверный пароль или повреждённая копия');
                }
              }}
              disabled={restoreData.length <= 10 || restorePassword.length < 6}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Восстановить</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 20 },
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  settingInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingTextContainer: { flex: 1 },
  settingLabel: { fontSize: 16, fontWeight: '500' },
  settingDescription: { fontSize: 13, marginTop: 2 },
  removeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  removeBtnText: { fontSize: 13, fontWeight: '600' },
  setupBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  setupBtnText: { fontSize: 13, fontWeight: '600' },
  lockNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  lockNowText: { fontSize: 15, fontWeight: '600' },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
  securityStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 20,
    gap: 16,
    marginBottom: 32,
  },
  securityStatusTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  securityStatusDesc: { fontSize: 13, lineHeight: 18 },

  pinModalIcon: {
    alignItems: 'center',
    marginBottom: 16,
  },
  pinModalIconInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinModalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  pinModalDesc: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  pinDotsRow: { flexDirection: 'row', gap: 12, marginBottom: 20, justifyContent: 'center' },
  pinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  pinError: { fontSize: 13, fontWeight: '500', marginBottom: 12, textAlign: 'center' },
  hiddenInput: {
    position: 'absolute',
    top: -1000,
    left: -1000,
    width: 1,
    height: 1,
    opacity: 0,
  },
  pinModalButtons: { flexDirection: 'row', gap: 10, width: '100%' },
  pinModalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinModalBtnText: { fontSize: 14, fontWeight: '600' },

  timeoutTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  timeoutDesc: { fontSize: 14, marginBottom: 20 },
  timeoutOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
  },
  timeoutOptionText: { fontSize: 16 },
  timeoutCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  backupModal: {
    width: 320,
    borderRadius: 16,
    padding: 24,
  },
  backupTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 8,
  },
  backupDesc: {
    fontSize: 13,
    marginBottom: 12,
  },
  backupInput: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 8,
  },
  backupBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center' as const,
  },
});

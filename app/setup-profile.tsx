import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { User, Camera, ArrowRight, MessageCircle } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import AvatarCropper from '@/components/AvatarCropper';
import { PENDING_INVITE_KEY } from '@/lib/pending-invite';
import { uploadAvatarNative, uploadAvatarBlob } from '@/lib/upload-avatar';

export default function SetupProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useAppearance();
  const [name, setName] = useState('');
  const [statusText, setStatusText] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cropperVisible, setCropperVisible] = useState(false);
  const [cropperImage, setCropperImage] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleAvatarUpload = async () => {
    if (!user) return;
    if (Platform.OS === 'web') {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
      fileInput.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(fileInput);
      fileInput.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        document.body.removeChild(fileInput);
        if (!file || file.size > 5 * 1024 * 1024) return;
        setPendingFile(file);
        const url = URL.createObjectURL(file);
        setCropperImage(url);
        setCropperVisible(true);
      };
      fileInput.addEventListener('cancel', () => document.body.removeChild(fileInput));
      fileInput.click();
    } else {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const { publicUrl } = await uploadAvatarNative(user.id, result.assets[0].uri);
      if (publicUrl) setAvatarUrl(publicUrl);
    }
  };

  const handleCroppedAvatar = async (blob: Blob) => {
    setCropperVisible(false);
    if (cropperImage) URL.revokeObjectURL(cropperImage);
    setCropperImage('');
    setPendingFile(null);
    if (!user) return;
    const { publicUrl } = await uploadAvatarBlob(user.id, blob);
    if (publicUrl) setAvatarUrl(publicUrl);
  };

  const resizeAndUpload = async (file: File) => {
    if (!user) return;
    try {
      const blob = await new Promise<Blob>((resolve) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 512;
          canvas.height = 512;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(file); return; }
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 512, 512);
          canvas.toBlob((b) => resolve(b || file), 'image/jpeg', 0.85);
        };
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
      });
      const { publicUrl } = await uploadAvatarBlob(user.id, blob);
      if (publicUrl) setAvatarUrl(publicUrl);
    } catch {}
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Введите ваше имя');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const updates: Record<string, any> = {
        display_name: name.trim(),
        is_online: true,
      };
      if (statusText.trim()) updates.status_text = statusText.trim();
      if (avatarUrl) updates.avatar_url = avatarUrl;

      const { error: updateError } = await supabase
        .from('profiles')
        .upsert({ id: user?.id, phone: user?.email || '', ...updates }, { onConflict: 'id' });

      if (updateError) {
        setError('Ошибка сохранения. Попробуйте ещё раз.');
      } else {
        const pendingInvite = await AsyncStorage.getItem(PENDING_INVITE_KEY);
        if (pendingInvite) {
          await AsyncStorage.removeItem(PENDING_INVITE_KEY);
          router.replace(`/u/${pendingInvite}` as any);
        } else {
          router.replace('/permissions');
        }
      }
    } catch (e) {
      setError('Ошибка соединения.');
    } finally {
      setLoading(false);
    }
  };

  const letter = name.trim() ? name.trim().charAt(0).toUpperCase() : null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false} keyboardDismissMode="on-drag">
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={[styles.logoIcon, { backgroundColor: colors.primary }]}>
              <MessageCircle color="#FFFFFF" size={24} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Настройка профиля</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Расскажите о себе, чтобы друзья могли вас узнать
            </Text>
          </View>

          <View>
            <TouchableOpacity style={styles.avatarContainer} onPress={handleAvatarUpload} activeOpacity={0.8} accessibilityLabel="Загрузить фото">
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : letter ? (
                <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primary }]}>
                  <Text style={styles.avatarLetter}>{letter}</Text>
                </View>
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border, borderWidth: 2 }]}>
                  <User color={colors.textTertiary} size={40} />
                </View>
              )}
              <View style={[styles.cameraButton, { backgroundColor: colors.text, borderColor: colors.background }]}>
                <Camera color={colors.background} size={14} />
              </View>
            </TouchableOpacity>
            <Text style={[styles.avatarHint, { color: colors.textTertiary }]}>Нажмите, чтобы загрузить фото</Text>
          </View>

          <AvatarCropper
            visible={cropperVisible}
            imageUri={cropperImage}
            onCrop={handleCroppedAvatar}
            onCancel={() => {
              setCropperVisible(false);
              if (pendingFile && user) {
                const f = pendingFile;
                setPendingFile(null);
                resizeAndUpload(f);
              }
            }}
            colors={colors}
          />

          <View style={styles.form}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Имя</Text>
            <View style={[styles.inputContainer, { backgroundColor: colors.backgroundSecondary, borderColor: error ? colors.error : colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={name}
                onChangeText={(t) => { setName(t); setError(''); }}
                placeholder="Как вас зовут?"
                placeholderTextColor={colors.textTertiary}
                autoFocus
                maxLength={50}
              />
            </View>

            <Text style={[styles.label, { color: colors.textSecondary, marginTop: 16 }]}>Статус (необязательно)</Text>
            <View style={[styles.inputContainer, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={statusText}
                onChangeText={setStatusText}
                placeholder="Чем вы занимаетесь?"
                placeholderTextColor={colors.textTertiary}
                maxLength={100}
              />
            </View>

            {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }, !name.trim() && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!name.trim() || loading}
              activeOpacity={0.8}
              accessibilityLabel="Продолжить"
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.buttonText}>Начать общение</Text>
                  <ArrowRight color="#FFFFFF" size={18} />
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  avatarContainer: {
    alignSelf: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    fontSize: 38,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cameraButton: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  avatarHint: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
  },
  form: {},
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  inputContainer: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
  },
  input: {
    fontSize: 17,
    fontWeight: '500',
  },
  error: {
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 24,
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

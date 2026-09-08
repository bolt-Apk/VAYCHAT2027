import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView,
  ActivityIndicator, Platform, Modal, Pressable, FlatList,
  Animated, Easing, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Camera, LogOut, ChevronRight, Bell, Lock, CircleHelp as HelpCircle,
  Moon, Edit3, Shield, Bookmark, Ban, X, Trash2, UserCheck, Phone,
  Info, ImagePlus, RotateCcw, ZoomIn, HardDrive, QrCode, Pencil, Link2,
  UserPlus, Check, CircleUser,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle } from 'react-native-svg';
import { uploadAvatarNative, uploadAvatarBlob } from '@/lib/upload-avatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import { useScrollToTop } from '@/lib/scroll-to-top-context';
import AvatarCropper from '@/components/AvatarCropper';
import Avatar from '@/components/Avatar';
import CachedImage from '@/components/CachedImage';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';
import { useDesktopChat } from '@/lib/desktop-chat-context';

const SCREEN_W_FALLBACK = 400;
const AVATAR_SIZE = 110;
const STICKY_THRESHOLD = 220;
const STICKY_AVATAR = 34;

interface Profile {
  display_name: string;
  phone: string;
  avatar_url: string | null;
  status_text: string;
  username: string | null;
}


interface BlockedUser {
  id: string;
  blocked_user_id: string;
  display_name: string;
  avatar_url: string | null;
}

export function ProfileContent() {
  const router = useRouter();
  const { user, signOut, accounts, switchAccount, switchingAccount, startAddAccount } = useAuth();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { isDesktop } = useDesktopLayout();
  const { openSettings } = useDesktopChat();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [cropperVisible, setCropperVisible] = useState(false);
  const [cropperImage, setCropperImage] = useState('');
  const [cropperFile, setCropperFile] = useState<File | null>(null);
  const cropperFileRef = useRef<File | null>(null);
  const profileScrollRef = useRef<any>(null);

  const scrollToTopUnsub = useScrollToTop('profile', () => {
    profileScrollRef.current?.scrollTo?.({ y: 0, animated: true });
  });

  useEffect(() => {
    return scrollToTopUnsub();
  }, [scrollToTopUnsub]);
  const [showBlocked, setShowBlocked] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedCount, setBlockedCount] = useState(0);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [avatarViewer, setAvatarViewer] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const scrollY = useRef(new Animated.Value(0)).current;
  const headerAnim = useRef(new Animated.Value(0)).current;
  const avatarScaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  const settingsAnim = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);
  const uploadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (uploadTimeoutRef.current) clearTimeout(uploadTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    loadProfile();

    loadBlockedCount();
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start(() => {
      Animated.timing(settingsAnim, { toValue: 1, duration: 400, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
    });
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('display_name, phone, avatar_url, status_text, username')
      .eq('id', user.id)
      .maybeSingle();
    if (data) {
      setProfile(data);
      setEditName(data.display_name);
      setEditStatus(data.status_text || '');
      setEditUsername(data.username || '');
    }
  };


  const loadBlockedCount = async () => {
    if (!user) return;
    const { count } = await supabase.from('blocked_users').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    setBlockedCount(count || 0);
  };

  const loadBlockedUsers = async () => {
    if (!user) return;
    const { data } = await supabase.from('blocked_users').select('id, blocked_user_id').eq('user_id', user.id);
    if (!data?.length) { setBlockedUsers([]); return; }
    const ids = data.map(b => b.blocked_user_id);
    const { data: profiles } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', ids);
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    setBlockedUsers(data.map(b => {
      const p = profileMap.get(b.blocked_user_id);
      return { id: b.id, blocked_user_id: b.blocked_user_id, display_name: p?.display_name || 'Пользователь', avatar_url: p?.avatar_url || null };
    }));
  };

  const handleUnblock = async (entry: BlockedUser) => {
    await supabase.from('blocked_users').delete().eq('id', entry.id);
    setBlockedUsers(prev => prev.filter(b => b.id !== entry.id));
    setBlockedCount(prev => Math.max(0, prev - 1));
  };

  const handleRemoveAvatar = async () => {
    if (!user || !profile?.avatar_url) return;
    setRemovingAvatar(true);
    await supabase.from('profiles').update({ avatar_url: null }).eq('id', user.id);
    try { await supabase.storage.from('avatars').remove([`${user.id}/avatar.jpg`]); } catch (e) { console.warn('Avatar cleanup failed:', e); }
    setRemovingAvatar(false);
    setAvatarViewer(false);
    loadProfile();
  };

  const handleSave = async () => {
    if (!user || !editName.trim()) return;
    setSaving(true);
    setUsernameError(null);
    const updates: Record<string, any> = { display_name: editName.trim(), status_text: editStatus.trim() };
    const trimmedUsername = editUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    updates.username = trimmedUsername || null;
    const { error: saveErr } = await supabase.from('profiles').update(updates).eq('id', user.id);
    if (saveErr && saveErr.code === '23505') {
      setUsernameError('Этот username уже занят');
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(false);
    loadProfile();
  };

  const handleSignOut = async () => {
    await supabase.from('profiles').update({ is_online: false }).eq('id', user!.id);
    await signOut();
    router.replace('/login');
  };

  const MAX_ACCOUNTS = 3;
  const [accountLimitVisible, setAccountLimitVisible] = useState(false);

  const handleAddAccount = () => {
    if (accounts.length >= MAX_ACCOUNTS) {
      setAccountLimitVisible(true);
      return;
    }
    startAddAccount();
    router.push('/login');
  };

  const handleAvatarUpload = async () => {
    if (!user) return;
    try {
      if (Platform.OS === 'web') {
        const file = await new Promise<File | null>((resolve) => {
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
          fileInput.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
          document.body.appendChild(fileInput);
          fileInput.onchange = (e: any) => {
            const f = e.target.files?.[0];
            document.body.removeChild(fileInput);
            resolve(f && f.size <= 10 * 1024 * 1024 ? f : null);
          };
          fileInput.addEventListener('cancel', () => {
            document.body.removeChild(fileInput);
            resolve(null);
          });
          fileInput.click();
        });
        if (!file) return;
        const url = URL.createObjectURL(file);
        setCropperFile(file);
        cropperFileRef.current = file;
        setCropperImage(url);
        setCropperVisible(true);
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.85,
          exif: false,
        });
        if (result.canceled || !result.assets?.[0]) return;
        await uploadAvatarFromUri(result.assets[0].uri);
      }
    } catch (e: any) {
      setAvatarError(e?.message || 'Не удалось выбрать фото');
    }
  };

  const uploadAvatarFromUri = async (uri: string) => {
    if (!user) return;
    setUploadingAvatar(true);
    setUploadProgress(10);
    setAvatarError(null);
    try {
      const { publicUrl, error } = await uploadAvatarNative(
        user.id,
        uri,
        (p) => setUploadProgress(p),
      );
      if (error || !publicUrl) {
        setAvatarError(error || 'Не удалось загрузить фото');
        setUploadingAvatar(false);
        setUploadProgress(0);
        return;
      }
      const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
      if (updateErr) {
        setAvatarError(updateErr.message);
      } else {
        setProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : prev);
        loadProfile();
      }
    } catch (e: any) {
      setAvatarError(e?.message || 'Не удалось загрузить фото');
    }
    uploadTimeoutRef.current = setTimeout(() => { if (mountedRef.current) { setUploadingAvatar(false); setUploadProgress(0); } }, 300);
  };

  const handleCroppedAvatar = async (blob: Blob) => {
    setCropperVisible(false);
    if (cropperImage) URL.revokeObjectURL(cropperImage);
    setCropperImage('');
    setCropperFile(null);
    cropperFileRef.current = null;
    if (!user) return;
    setAvatarError(null);
    setUploadingAvatar(true);
    setUploadProgress(20);
    try {
      const { publicUrl, error } = await uploadAvatarBlob(
        user.id,
        blob,
        (p) => setUploadProgress(p),
      );
      if (error) throw new Error(error);
      if (publicUrl) {
        const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
        if (updateErr) {
          setAvatarError(updateErr.message);
        } else {
          setProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : prev);
          loadProfile();
        }
      }
    } catch (e: any) {
      console.warn('Avatar upload error:', e);
      setAvatarError(e?.message || 'Не удалось загрузить фото');
    } finally {
      uploadTimeoutRef.current = setTimeout(() => { if (mountedRef.current) { setUploadingAvatar(false); setUploadProgress(0); } }, 300);
    }
  };

  const uploadRawFile = async (file: File) => {
    if (!user) return;
    setAvatarError(null);
    setUploadingAvatar(true);
    setUploadProgress(20);
    try {
      const resizedBlob = await resizeFileToBlob(file, 512);
      setUploadProgress(50);
      const { publicUrl, error } = await uploadAvatarBlob(
        user.id,
        resizedBlob,
        (p) => setUploadProgress(Math.max(50, p)),
      );
      if (error) throw new Error(error);
      if (publicUrl) {
        const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
        if (updateErr) {
          setAvatarError(updateErr.message);
        } else {
          setProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : prev);
          loadProfile();
        }
      }
    } catch (e: any) {
      setAvatarError(e?.message || 'Не удалось загрузить фото');
    } finally {
      uploadTimeoutRef.current = setTimeout(() => { if (mountedRef.current) { setUploadingAvatar(false); setUploadProgress(0); } }, 300);
    }
  };

  const resizeFileToBlob = (file: File, maxSize: number): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(file); return; }
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxSize, maxSize);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            try {
              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
              const byteString = atob(dataUrl.split(',')[1]);
              const ab = new ArrayBuffer(byteString.length);
              const ia = new Uint8Array(ab);
              for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
              resolve(new Blob([ab], { type: 'image/jpeg' }));
            } catch {
              resolve(file);
            }
          }
        }, 'image/jpeg', 0.85);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        resolve(file);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const openAvatarViewer = () => {
    if (!profile?.avatar_url) return;
    Animated.spring(avatarScaleAnim, { toValue: 0.95, useNativeDriver: true, tension: 100, friction: 8 }).start(() => {
      Animated.spring(avatarScaleAnim, { toValue: 1, useNativeDriver: true }).start();
    });
    setAvatarViewer(true);
  };

  const letter = profile?.display_name?.charAt(0).toUpperCase() || '?';


  const settingsItems = [
    { icon: Bookmark, color: '#E8A838', label: 'Избранное', route: '/saved' },
    { icon: Bell, color: '#F44336', label: 'Уведомления', route: '/settings/notifications' },
    { icon: Lock, color: '#2AABEE', label: 'Конфиденциальность', route: '/settings/privacy' },
    { icon: Shield, color: '#4CAF50', label: 'Безопасность', route: '/settings/security' },
    { icon: Moon, color: '#6B7C8A', label: 'Оформление', route: '/settings/appearance' },
    { icon: HardDrive, color: '#E8A838', label: 'Данные и память', route: '/settings/storage' },
    { icon: Ban, color: '#FF5252', label: `Заблокированные${blockedCount > 0 ? ` (${blockedCount})` : ''}`, route: '__blocked__' },
    { icon: HelpCircle, color: '#2CC76B', label: 'Помощь', route: '/settings/help' },
  ];

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>

    {/* Sticky compact header */}
    <Animated.View
      pointerEvents="box-none"
      style={[
        s.stickyHeader,
        {
          paddingTop: Math.max(insets.top, 12),
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
          opacity: scrollY.interpolate({ inputRange: [STICKY_THRESHOLD - 40, STICKY_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ translateY: scrollY.interpolate({ inputRange: [STICKY_THRESHOLD - 40, STICKY_THRESHOLD], outputRange: [-8, 0], extrapolate: 'clamp' }) }],
        },
      ]}
    >
      <View style={s.stickyInner} pointerEvents="auto">
        {profile?.avatar_url ? (
          <CachedImage uri={profile.avatar_url} style={s.stickyAvatar} />
        ) : (
          <Avatar uri={null} name={letter} size="xs" variant="primary" />
        )}
        <View style={[s.stickyInfo, { flex: 1 }]}>
          <Text style={[s.stickyName, { color: colors.text }]} numberOfLines={1}>{profile?.display_name || 'Без имени'}</Text>
          <View style={s.stickyOnlineRow}>
            <View style={[s.stickyOnlineDot, { backgroundColor: colors.online }]} />
            <Text style={[s.stickyOnlineText, { color: colors.primary }]}>В сети</Text>
          </View>
        </View>
        <View style={s.stickyActions}>
          <TouchableOpacity style={s.stickyActionBtn} activeOpacity={0.7} onPress={() => router.push('/qr-code')} accessibilityLabel="QR-код">
            <QrCode color={colors.textSecondary} size={20} />
          </TouchableOpacity>
          <TouchableOpacity style={s.stickyActionBtn} onPress={() => setEditing(true)} activeOpacity={0.7} accessibilityLabel="Редактировать профиль">
            <Pencil color={colors.textSecondary} size={20} />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>

    <Animated.ScrollView
      ref={profileScrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={[s.content, { paddingBottom: isDesktop ? 12 : insets.bottom + 76 }]}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== 'web' })}
    >
      {/* Profile card */}
      <Animated.View style={[s.profileCard, { paddingTop: Math.max(insets.top, 12) + 12, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* Avatar row with side icons */}
        <View style={s.avatarRow}>
          <TouchableOpacity style={s.sideIconBtn} activeOpacity={0.7} onPress={() => router.push('/qr-code')} accessibilityLabel="QR код">
            <QrCode color={colors.textSecondary} size={22} />
          </TouchableOpacity>

          <View style={s.avatarArea}>
            <Animated.View style={{ transform: [{ scale: avatarScaleAnim }] }}>
              <TouchableOpacity
                onPress={profile?.avatar_url ? openAvatarViewer : handleAvatarUpload}
                activeOpacity={0.85}
                style={s.avatarTouch}
                accessibilityLabel="Фото профиля"
              >
                {profile?.avatar_url ? (
                  <CachedImage uri={profile.avatar_url} style={s.avatar} />
                ) : (
                  <View style={[s.avatar, s.avatarPlaceholder, { backgroundColor: colors.primary }]}>
                    <Text style={s.avatarLetter}>{letter}</Text>
                  </View>
                )}

                {uploadingAvatar && (
                  <View style={s.avatarUploadOverlay}>
                    {Platform.OS === 'web' ? (
                      // @ts-ignore
                      <svg width={60} height={60}>
                        {/* @ts-ignore */}
                        <circle cx={30} cy={30} r={26} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={3} />
                        {/* @ts-ignore */}
                        <circle
                          cx={30} cy={30} r={26} fill="none" stroke="#FFFFFF" strokeWidth={3}
                          strokeDasharray={163.36} strokeDashoffset={163.36 * (1 - uploadProgress / 100)}
                          strokeLinecap="round" transform="rotate(-90 30 30)"
                          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
                        />
                      </svg>
                    ) : (
                      <Svg width={60} height={60}>
                        <Circle cx={30} cy={30} r={26} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={3} />
                        <Circle cx={30} cy={30} r={26} fill="none" stroke="#FFFFFF" strokeWidth={3}
                          strokeDasharray={`${163.36}`} strokeDashoffset={163.36 * (1 - uploadProgress / 100)}
                          strokeLinecap="round" rotation={-90} origin="30,30"
                        />
                      </Svg>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity
              style={[s.cameraBtn, { backgroundColor: colors.primary }]}
              onPress={handleAvatarUpload}
              activeOpacity={0.8}
              accessibilityLabel="Изменить фото"
            >
              <Camera color="#FFFFFF" size={16} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.sideIconBtn} onPress={() => setEditing(true)} activeOpacity={0.7} accessibilityLabel="Редактировать профиль">
            <Pencil color={colors.textSecondary} size={22} />
          </TouchableOpacity>
        </View>

        {avatarError ? (
          <Text style={[s.avatarError, { color: colors.error }]}>{avatarError}</Text>
        ) : null}

        {/* Name & info */}
        {editing ? (
          <View style={s.editSection}>
            <View style={s.editField}>
              <Text style={[s.editLabel, { color: colors.textSecondary }]}>Имя</Text>
              <TextInput
                style={[s.editInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
                value={editName}
                onChangeText={setEditName}
                placeholder="Ваше имя"
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
            </View>
            <View style={s.editField}>
              <Text style={[s.editLabel, { color: colors.textSecondary }]}>О себе</Text>
              <TextInput
                style={[s.editInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
                value={editStatus}
                onChangeText={setEditStatus}
                placeholder="Расскажите о себе..."
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={140}
              />
            </View>
            <View style={{ paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: 4 }}>Username (для ссылки-приглашения)</Text>
              <TextInput
                style={[s.editInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: usernameError ? colors.error : colors.border }]}
                value={editUsername}
                onChangeText={(t) => { setEditUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, '')); setUsernameError(null); }}
                placeholder="username"
                placeholderTextColor={colors.textTertiary}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {usernameError && <Text style={{ fontSize: 12, color: colors.error, marginTop: 4 }}>{usernameError}</Text>}
              {editUsername.trim() && !usernameError && (
                <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 4 }}>vaychat.net/{editUsername.trim()}</Text>
              )}
            </View>
            <View style={s.editBtns}>
              <TouchableOpacity style={[s.editBtn, { backgroundColor: colors.backgroundTertiary }]} onPress={() => setEditing(false)} accessibilityLabel="Отменить">
                <Text style={[s.editBtnLabel, { color: colors.textSecondary }]}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.editBtn, { backgroundColor: colors.primary }]} onPress={handleSave} disabled={saving} accessibilityLabel="Сохранить">
                {saving ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={[s.editBtnLabel, { color: '#FFF' }]}>Сохранить</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={s.infoArea}>
            <Text style={[s.displayName, { color: colors.text }]}>{profile?.display_name || 'Без имени'}</Text>
            {profile?.username && (
              <Text style={{ fontSize: 14, color: colors.primary, fontWeight: '500', marginTop: 2 }}>@{profile.username}</Text>
            )}
            <Text style={[s.phoneText, { color: colors.primary }]}>{profile?.phone || ''}</Text>
            {profile?.status_text ? (
              <Text style={[s.statusText, { color: colors.textSecondary }]}>{profile.status_text}</Text>
            ) : null}
          </View>
        )}
      </Animated.View>



      {/* Account Switcher */}
      {accounts.length > 0 && (
        <Animated.View style={[s.settingsSection, { opacity: settingsAnim, transform: [{ translateY: settingsAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
          <Text style={[s.sectionTitle, { color: colors.textSecondary }]}>Аккаунты</Text>
          <View style={[s.settingsCard, { backgroundColor: colors.backgroundSecondary }]}>
            {accounts.map((acc, i) => {
              const isActive = acc.userId === user?.id;
              return (
                <TouchableOpacity
                  key={acc.userId}
                  style={[
                    s.settingsItem,
                    i < accounts.length && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  ]}
                  onPress={() => { if (!isActive) switchAccount(acc.userId); }}
                  activeOpacity={isActive ? 1 : 0.6}
                  disabled={switchingAccount}
                >
                  <View style={s.accountRow}>
                    {acc.avatarUrl ? (
                      <CachedImage uri={acc.avatarUrl} style={s.accountAvatar} />
                    ) : (
                      <View style={[s.accountAvatar, s.accountAvatarPlaceholder, { backgroundColor: colors.primary }]}>
                        <Text style={s.accountAvatarLetter}>{(acc.displayName || '?').charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={s.accountInfo}>
                      <Text style={[s.accountName, { color: colors.text }]} numberOfLines={1}>{acc.displayName || 'Без имени'}</Text>
                      <Text style={[s.accountPhone, { color: colors.textTertiary }]} numberOfLines={1}>{acc.phone}</Text>
                    </View>
                    {isActive && <Check color={colors.primary} size={18} />}
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={s.settingsItem}
              onPress={handleAddAccount}
              activeOpacity={0.6}
              disabled={switchingAccount}
            >
              <View style={[s.settingsIcon, { backgroundColor: colors.primary }]}>
                <UserPlus color="#FFFFFF" size={16} />
              </View>
              <Text style={[s.settingsLabel, { color: colors.primary }]}>Добавить аккаунт</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* Settings */}
      <Animated.View style={[s.settingsSection, { opacity: settingsAnim, transform: [{ translateY: settingsAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
        <Text style={[s.sectionTitle, { color: colors.textSecondary }]}>Настройки</Text>
        <View style={[s.settingsCard, { backgroundColor: colors.backgroundSecondary }]}>
          {settingsItems.map((item, i) => (
            <TouchableOpacity
              key={item.route}
              style={[
                s.settingsItem,
                i < settingsItems.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              ]}
              onPress={() => {
                if (item.route === '__blocked__') {
                  loadBlockedUsers();
                  setShowBlocked(true);
                } else if (isDesktop) {
                  openSettings(item.route);
                } else {
                  router.push(item.route as any);
                }
              }}
              activeOpacity={0.6}
            >
              <View style={[s.settingsIcon, { backgroundColor: item.color }]}>
                <item.icon color="#FFFFFF" size={16} />
              </View>
              <Text style={[s.settingsLabel, { color: colors.text }]}>{item.label}</Text>
              <ChevronRight color={colors.textTertiary} size={16} />
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>

      {/* Logout */}
      <TouchableOpacity style={[s.logoutBtn, { backgroundColor: colors.backgroundSecondary }]} onPress={handleSignOut} activeOpacity={0.6}>
        <LogOut color={colors.error} size={18} />
        <Text style={[s.logoutLabel, { color: colors.error }]}>Выйти из аккаунта</Text>
      </TouchableOpacity>

      <View style={[s.securityBadge, { backgroundColor: colors.backgroundSecondary }]}>
        <Shield color={colors.success || '#4CAF50'} size={15} />
        <Text style={[s.securityLabel, { color: colors.textSecondary }]}>Ваши данные защищены шифрованием</Text>
      </View>
      <Text style={[s.version, { color: colors.textTertiary }]}>VayChat 2026</Text>

      {/* Avatar fullscreen viewer */}
      {avatarViewer && profile?.avatar_url && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setAvatarViewer(false)}>
          <View style={s.viewerContainer}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setAvatarViewer(false)} />

            <View style={[s.viewerTop, { paddingTop: Math.max(insets.top, 12) }]}>
              <TouchableOpacity style={s.viewerBtn} onPress={() => setAvatarViewer(false)} activeOpacity={0.7} accessibilityLabel="Закрыть">
                <X color="#FFFFFF" size={22} />
              </TouchableOpacity>
              <View style={s.viewerTopCenter}>
                <Text style={s.viewerTitle}>{profile.display_name}</Text>
                <Text style={s.viewerSubtitle}>Фото профиля</Text>
              </View>
              <View style={{ width: 40 }} />
            </View>

            <View style={s.viewerImageWrap}>
              <CachedImage uri={profile.avatar_url} style={[s.viewerImage, { width: Math.min(screenWidth, 480) - 32, height: Math.min(screenWidth, 480) - 32 }]} contentFit="contain" />
            </View>

            <View style={[s.viewerBottom, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <TouchableOpacity style={s.viewerAction} onPress={() => { setAvatarViewer(false); handleAvatarUpload(); }} activeOpacity={0.7} accessibilityLabel="Новое фото">
                <ImagePlus color="#FFFFFF" size={20} />
                <Text style={s.viewerActionText}>Новое фото</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.viewerAction} onPress={handleRemoveAvatar} disabled={removingAvatar} activeOpacity={0.7} accessibilityLabel="Удалить фото">
                {removingAvatar ? <ActivityIndicator color="#FF5252" size="small" /> : <Trash2 color="#FF5252" size={20} />}
                <Text style={[s.viewerActionText, { color: '#FF5252' }]}>Удалить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Blocked users modal */}
      <Modal visible={showBlocked} transparent animationType="fade" onRequestClose={() => setShowBlocked(false)}>
        <Pressable style={s.blockedBackdrop} onPress={() => setShowBlocked(false)}>
          <View style={[s.blockedModal, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={s.blockedHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ban color={colors.error} size={18} />
                <Text style={[s.blockedTitle, { color: colors.text }]}>Заблокированные</Text>
              </View>
              <TouchableOpacity onPress={() => setShowBlocked(false)}>
                <X color={colors.textSecondary} size={20} />
              </TouchableOpacity>
            </View>
            {blockedUsers.length === 0 ? (
              <View style={s.blockedEmpty}>
                <UserCheck color={colors.textTertiary} size={36} />
                <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 12 }}>Нет заблокированных</Text>
              </View>
            ) : (
              <FlatList
                data={blockedUsers}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <View style={[s.blockedItem, { borderBottomColor: colors.border }]}>
                    <View style={{ marginRight: 12 }}>
                      <Avatar uri={item.avatar_url} name={item.display_name} size="sm" />
                    </View>
                    <Text style={[s.blockedName, { color: colors.text }]}>{item.display_name}</Text>
                    <TouchableOpacity style={[s.unblockBtn, { backgroundColor: `${colors.primary}15` }]} onPress={() => handleUnblock(item)} accessibilityLabel={`Разблокировать ${item.display_name}`}>
                      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>Разблокировать</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={accountLimitVisible} transparent animationType="fade" onRequestClose={() => setAccountLimitVisible(false)}>
        <Pressable style={s.blockedBackdrop} onPress={() => setAccountLimitVisible(false)}>
          <View style={[s.blockedModal, { backgroundColor: colors.backgroundSecondary, maxWidth: 320 }]}>
            <Text style={[s.blockedTitle, { color: colors.text }]}>Достигнут лимит</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 20 }}>
              Максимум 3 аккаунта. Чтобы добавить новый, выйдите из одного из текущих аккаунтов.
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, paddingHorizontal: 32, paddingVertical: 10, borderRadius: 10 }}
              onPress={() => setAccountLimitVisible(false)}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>Понятно</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <AvatarCropper
        visible={cropperVisible}
        imageUri={cropperImage}
        onCrop={handleCroppedAvatar}
        onCancel={() => {
          setCropperVisible(false);
          if (cropperImage) URL.revokeObjectURL(cropperImage);
          setCropperImage('');
          const file = cropperFileRef.current;
          if (file) {
            uploadRawFile(file);
            setCropperFile(null);
            cropperFileRef.current = null;
          }
        }}
        colors={colors}
      />
    </Animated.ScrollView>
    </View>
  );
}

export default function ProfileScreen() {
  const { isDesktop } = useDesktopLayout();
  if (isDesktop) return null;
  return <ProfileContent />;
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 40 },

  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderBottomWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      web: { boxShadow: '0 2px 12px rgba(0,0,0,0.1)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5 },
    }),
  },
  stickyInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  stickyAvatar: {
    width: STICKY_AVATAR,
    height: STICKY_AVATAR,
    borderRadius: STICKY_AVATAR / 2,
  },
  stickyInfo: {
    marginLeft: 10,
    flexShrink: 1,
  },
  stickyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
  },
  stickyActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickyName: {
    fontSize: 16,
    fontWeight: '700',
  },
  stickyOnlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  stickyOnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  stickyOnlineText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Header
  profileCard: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  sideIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarArea: {
    position: 'relative',
  },
  avatarTouch: {
    position: 'relative',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    fontSize: 42,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBtn: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  avatarError: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 20,
  },
  infoArea: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  displayName: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 5,
  },
  statusText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 5,
    letterSpacing: 0.1,
  },
  phoneText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 5,
    letterSpacing: 0.3,
  },


  // Edit section
  editSection: {
    width: '100%',
    paddingHorizontal: 20,
  },
  editField: {
    marginBottom: 14,
  },
  editLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  editInput: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  editBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  editBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnLabel: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Stats
  // Settings
  settingsSection: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  settingsCard: {
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 8px rgba(0,0,0,0.06)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
    }),
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  settingsIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  settingsLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.1,
  },

  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    ...Platform.select({
      web: { boxShadow: '0 1px 8px rgba(0,0,0,0.06)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
    }),
  },
  logoutLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  securityLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 16,
    letterSpacing: 0.2,
  },

  // Avatar viewer
  viewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  viewerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  viewerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerTopCenter: {
    flex: 1,
    alignItems: 'center',
  },
  viewerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  viewerSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  viewerImageWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  viewerImage: {
    width: SCREEN_W_FALLBACK - 32,
    height: SCREEN_W_FALLBACK - 32,
    borderRadius: 16,
  },
  viewerBottom: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
    paddingTop: 16,
  },
  viewerAction: {
    alignItems: 'center',
    gap: 6,
  },
  viewerActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  },

  // Blocked
  blockedBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  blockedModal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  blockedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  blockedTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  blockedEmpty: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  blockedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  blockedName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  unblockBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  accountAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  accountAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountAvatarLetter: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '500',
  },
  accountPhone: {
    fontSize: 13,
    marginTop: 2,
  },
});

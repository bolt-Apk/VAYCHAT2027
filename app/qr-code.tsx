import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, Dimensions,
  Platform, Animated, Easing, Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { X, Share2, Copy, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import * as Clipboard from 'expo-clipboard';

const { width: SCREEN_W } = Dimensions.get('window');
const QR_CARD_SIZE = Math.min(SCREEN_W - 64, 280);
const QR_MODULE_COUNT = 25;
const QR_MODULE_SIZE = Math.floor(QR_CARD_SIZE / (QR_MODULE_COUNT + 8));
const QR_TOTAL = QR_MODULE_SIZE * QR_MODULE_COUNT;
const AVATAR_SIZE = 56;

interface Profile {
  display_name: string;
  phone: string;
  avatar_url: string | null;
  username?: string | null;
}

const THEMES = [
  { id: 'blue', bg: '#1B2838', accent: '#2AABEE', card: '#FFFFFF' },
  { id: 'teal', bg: '#0D2926', accent: '#00897B', card: '#FFFFFF' },
  { id: 'orange', bg: '#2A1A0E', accent: '#E8A838', card: '#FFFFFF' },
  { id: 'pink', bg: '#2A0E1E', accent: '#E91E63', card: '#FFFFFF' },
  { id: 'green', bg: '#0E2A14', accent: '#2CC76B', card: '#FFFFFF' },
  { id: 'dark', bg: '#0E1621', accent: '#5EB5F7', card: '#1E2C3A' },
];

function generateQRMatrix(data: string): boolean[][] {
  const size = QR_MODULE_COUNT;
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  const addFinderPattern = (row: number, col: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (r === 0 || r === 6 || c === 0 || c === 6 ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          if (row + r < size && col + c < size) matrix[row + r][col + c] = true;
        }
      }
    }
  };

  addFinderPattern(0, 0);
  addFinderPattern(0, size - 7);
  addFinderPattern(size - 7, 0);

  let seed = 0;
  for (let i = 0; i < data.length; i++) {
    seed = ((seed << 5) - seed + data.charCodeAt(i)) | 0;
  }
  const pseudoRandom = (max: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % max;
  };

  for (let r = 8; r < size; r++) {
    for (let c = 8; c < size; c++) {
      if (r < 7 && c >= size - 7) continue;
      if (r >= size - 7 && c < 7) continue;
      const centerDist = Math.abs(r - size / 2) + Math.abs(c - size / 2);
      if (centerDist < 4) continue;
      matrix[r][c] = pseudoRandom(100) < 42;
    }
  }

  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  return matrix;
}

function QRCodeView({ data, accent, cardBg }: { data: string; accent: string; cardBg: string }) {
  const matrix = generateQRMatrix(data);
  const isDarkCard = cardBg !== '#FFFFFF';
  const moduleColor = isDarkCard ? '#FFFFFF' : '#000000';

  return (
    <View style={[qrStyles.wrapper, { backgroundColor: cardBg }]}>
      <View style={qrStyles.grid}>
        {matrix.map((row, r) =>
          row.map((cell, c) => {
            const isInCenter = Math.abs(r - QR_MODULE_COUNT / 2) < 3.5 &&
                               Math.abs(c - QR_MODULE_COUNT / 2) < 3.5;
            if (isInCenter) return null;

            const isFinderOuter =
              (r < 7 && c < 7) || (r < 7 && c >= QR_MODULE_COUNT - 7) || (r >= QR_MODULE_COUNT - 7 && c < 7);
            const isFinderInner =
              ((r >= 2 && r <= 4 && c >= 2 && c <= 4) ||
               (r >= 2 && r <= 4 && c >= QR_MODULE_COUNT - 5 && c <= QR_MODULE_COUNT - 3) ||
               (r >= QR_MODULE_COUNT - 5 && r <= QR_MODULE_COUNT - 3 && c >= 2 && c <= 4));

            if (!cell) return null;

            return (
              <View
                key={`${r}-${c}`}
                style={{
                  position: 'absolute',
                  left: c * QR_MODULE_SIZE,
                  top: r * QR_MODULE_SIZE,
                  width: QR_MODULE_SIZE,
                  height: QR_MODULE_SIZE,
                  borderRadius: isFinderOuter ? (isFinderInner ? 1 : 2) : 1.5,
                  backgroundColor: isFinderOuter ? accent : moduleColor,
                }}
              />
            );
          })
        )}
      </View>
    </View>
  );
}

const qrStyles = StyleSheet.create({
  wrapper: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  grid: {
    width: QR_TOTAL,
    height: QR_TOTAL,
    position: 'relative',
  },
});

export default function QRCodeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [themeIndex, setThemeIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.92)).current;

  const theme = THEMES[themeIndex];
  const inviteLink = user
    ? (profile?.username ? `https://vaychat.net/${profile.username}` : `https://vaychat.net/u/${user.id}`)
    : '';
  const letter = (profile?.display_name || '?').charAt(0).toUpperCase();

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('display_name, phone, avatar_url, username')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setProfile(data);
      });
  }, [user?.id]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `${profile?.display_name || 'VayChat'}\n${inviteLink}`,
        url: inviteLink,
      });
    } catch {}
  }, [inviteLink, profile?.display_name]);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [inviteLink]);

  return (
    <Animated.View style={[s.container, { backgroundColor: theme.bg, opacity: fadeAnim }]}>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity style={s.headerBtn} onPress={() => router.back()} activeOpacity={0.7} accessibilityLabel="Закрыть">
          <X color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>QR-код</Text>
        <TouchableOpacity style={s.headerBtn} onPress={handleShare} activeOpacity={0.7} accessibilityLabel="Поделиться">
          <Share2 color="#FFFFFF" size={22} />
        </TouchableOpacity>
      </View>

      <Animated.View style={[s.cardContainer, { transform: [{ scale: cardScale }] }]}>
        <View style={[s.card, { backgroundColor: theme.card }]}>
          <View style={s.avatarContainer}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={s.avatar} />
            ) : (
              <View style={[s.avatar, { backgroundColor: theme.accent }]}>
                <Text style={s.avatarLetter}>{letter}</Text>
              </View>
            )}
          </View>

          <Text style={[s.displayName, { color: theme.card === '#FFFFFF' ? '#1A1A1A' : '#F5F5F5' }]}>
            {profile?.display_name || 'Без имени'}
          </Text>

          <View style={s.qrContainer}>
            <QRCodeView data={inviteLink} accent={theme.accent} cardBg={theme.card} />
            <View style={[s.qrAvatarOverlay, { backgroundColor: theme.card }]}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={s.qrAvatar} />
              ) : (
                <View style={[s.qrAvatar, { backgroundColor: theme.accent }]}>
                  <Text style={s.qrAvatarLetter}>{letter}</Text>
                </View>
              )}
            </View>
          </View>

          <TouchableOpacity
            style={[s.linkRow, { backgroundColor: theme.card === '#FFFFFF' ? '#F0F4F8' : 'rgba(255,255,255,0.08)' }]}
            onPress={handleCopy}
            activeOpacity={0.7}
            accessibilityLabel="Копировать ссылку"
          >
            {copied ? (
              <>
                <Check color={theme.accent} size={16} />
                <Text style={[s.linkText, { color: theme.accent }]}>Скопировано!</Text>
              </>
            ) : (
              <>
                <Copy color={theme.card === '#FFFFFF' ? '#556570' : '#A8B8C8'} size={16} />
                <Text
                  style={[s.linkText, { color: theme.card === '#FFFFFF' ? '#556570' : '#A8B8C8' }]}
                  numberOfLines={1}
                >
                  {inviteLink}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>

      <View style={[s.themeRow, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        {THEMES.map((t, i) => (
          <TouchableOpacity
            key={t.id}
            style={[
              s.themeDot,
              { backgroundColor: t.accent },
              i === themeIndex && s.themeDotActive,
            ]}
            onPress={() => setThemeIndex(i)}
            activeOpacity={0.7}
            accessibilityLabel={"Тема " + (i + 1)}
          />
        ))}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  cardContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0 8px 32px rgba(0,0,0,0.25)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 32, elevation: 12 },
    }),
  },
  avatarContainer: {
    marginBottom: 12,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
    letterSpacing: -0.3,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  qrAvatarOverlay: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 3,
  },
  qrAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrAvatarLetter: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    width: '100%',
  },
  linkText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  themeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 16,
  },
  themeDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeDotActive: {
    borderColor: '#FFFFFF',
    borderWidth: 3,
  },
});

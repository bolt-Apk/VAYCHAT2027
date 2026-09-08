import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch,
  ActivityIndicator, Platform, Animated,
} from 'react-native';
import { useGoBack } from '@/hooks/useGoBack';
import {
  ArrowLeft, HardDrive, Wifi, Signal, Trash2, RefreshCw,
  Image as ImageIcon, FileVideo, File as FileIcon, Check,
  Database, Globe, MessageSquare, Mic,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Paths, Directory } from 'expo-file-system';
import { invalidateStorageSettingsCache } from '@/lib/storage-settings';
import { dataCache } from '@/lib/data-cache';
import { supabase } from '@/lib/supabase';

const STORAGE_KEY = 'storage_settings';

interface NetworkDownloadCfg {
  photos: boolean;
  videos: boolean;
  files: boolean;
  maxPhotoMb: number;
  maxVideoMb: number;
  maxFileMb: number;
}

interface StorageSettings {
  autoDownloadMobile: NetworkDownloadCfg;
  autoDownloadWifi: NetworkDownloadCfg;
  reducedCallTraffic: boolean;
}

const DEFAULT_SETTINGS: StorageSettings = {
  autoDownloadMobile: { photos: true, videos: false, files: false, maxPhotoMb: 10, maxVideoMb: 10, maxFileMb: 1 },
  autoDownloadWifi: { photos: true, videos: true, files: true, maxPhotoMb: 50, maxVideoMb: 50, maxFileMb: 10 },
  reducedCallTraffic: false,
};

interface StorageBreakdown {
  totalBytes: number;
  dataCacheBytes: number;
  imageCacheBytes: number;
  settingsBytes: number;
  labels: { name: string; color: string; size: number }[];
}

interface ConvMediaStats {
  conversation_id: string;
  name: string;
  avatar_url: string | null;
  photoCount: number;
  videoCount: number;
  voiceCount: number;
  fileCount: number;
  totalMedia: number;
}

async function measureAsyncStorageBytes(): Promise<{ total: number; dataCache: number; settings: number }> {
  let total = 0;
  let dataCache = 0;
  let settings = 0;

  if (Platform.OS === 'web') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key);
        const entryBytes = ((key.length + (val?.length || 0)) * 2);
        total += entryBytes;
        if (key.startsWith('@vaychat_cache_')) dataCache += entryBytes;
        if (key === STORAGE_KEY) settings += entryBytes;
      }
    } catch {}
  } else {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const pairs = await AsyncStorage.multiGet(keys);
      for (const [key, val] of pairs) {
        const entryBytes = (key.length + (val?.length || 0)) * 2;
        total += entryBytes;
        if (key.startsWith('@vaychat_cache_')) dataCache += entryBytes;
        if (key === STORAGE_KEY) settings += entryBytes;
      }
    } catch {}
  }
  return { total, dataCache, settings };
}

async function measureImageCacheBytes(): Promise<number> {
  if (Platform.OS !== 'web') {
    try {
      const cacheDir = Paths.cache;
      if (cacheDir.exists) return cacheDir.size ?? 0;
    } catch {}
  }
  return 0;
}

async function measureStorageBreakdown(): Promise<StorageBreakdown> {
  const [asyncSizes, imgCache] = await Promise.all([
    measureAsyncStorageBytes(),
    measureImageCacheBytes(),
  ]);

  const totalBytes = asyncSizes.total + imgCache;

  const labels = [
    { name: 'Кэш сообщений', color: '#2AABEE', size: asyncSizes.dataCache },
    { name: 'Кэш изображений', color: '#E8A838', size: imgCache },
    { name: 'Настройки', color: '#8B5CF6', size: asyncSizes.settings },
    { name: 'Прочее', color: '#6B7280', size: Math.max(0, asyncSizes.total - asyncSizes.dataCache - asyncSizes.settings) },
  ].filter(l => l.size > 0);

  return {
    totalBytes,
    dataCacheBytes: asyncSizes.dataCache,
    imageCacheBytes: imgCache,
    settingsBytes: asyncSizes.settings,
    labels,
  };
}

async function fetchConversationMediaStats(): Promise<ConvMediaStats[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: memberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);
    if (!memberships || memberships.length === 0) return [];

    const convIds = memberships.map(m => m.conversation_id);

    const { data: mediaMessages } = await supabase
      .from('messages')
      .select('conversation_id, message_type')
      .in('conversation_id', convIds)
      .in('message_type', ['image', 'video', 'voice', 'file', 'video_note'])
      .is('deleted_at', null);

    if (!mediaMessages || mediaMessages.length === 0) return [];

    const convMap = new Map<string, { photos: number; videos: number; voices: number; files: number }>();
    for (const msg of mediaMessages) {
      let entry = convMap.get(msg.conversation_id);
      if (!entry) {
        entry = { photos: 0, videos: 0, voices: 0, files: 0 };
        convMap.set(msg.conversation_id, entry);
      }
      switch (msg.message_type) {
        case 'image': entry.photos++; break;
        case 'video': case 'video_note': entry.videos++; break;
        case 'voice': entry.voices++; break;
        case 'file': entry.files++; break;
      }
    }

    const results: ConvMediaStats[] = [];
    for (const [convId, counts] of convMap.entries()) {
      const conv = dataCache.getConversation(convId);
      let name = conv?.name || 'Чат';
      if (!conv?.name && conv?.type === 'direct') {
        const members = dataCache.getConvMembersByConv(convId);
        if (members.length > 0) {
          const other = dataCache.getProfile(members[0].user_id);
          if (other) name = other.display_name;
        }
      }
      results.push({
        conversation_id: convId,
        name,
        avatar_url: conv?.avatar_url || null,
        photoCount: counts.photos,
        videoCount: counts.videos,
        voiceCount: counts.voices,
        fileCount: counts.files,
        totalMedia: counts.photos + counts.videos + counts.voices + counts.files,
      });
    }
    return results.sort((a, b) => b.totalMedia - a.totalMedia).slice(0, 20);
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

export default function StorageScreen() {
  const goBack = useGoBack();
  const insets = useSafeAreaInsets();
  const { colors } = useAppearance();

  const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(null);
  const [convStats, setConvStats] = useState<ConvMediaStats[] | null>(null);

  const [settings, setSettings] = useState<StorageSettings>(DEFAULT_SETTINGS);
  const [saveFlash] = useState(() => new Animated.Value(0));
  const [clearingConv, setClearingConv] = useState<string | null>(null);


  useEffect(() => {
    measureStorageBreakdown().then(setBreakdown);
    fetchConversationMediaStats().then(setConvStats);
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setSettings(prev => ({
            ...prev,
            ...parsed,
            autoDownloadMobile: { ...prev.autoDownloadMobile, ...parsed.autoDownloadMobile },
            autoDownloadWifi: { ...prev.autoDownloadWifi, ...parsed.autoDownloadWifi },
          }));
        } catch {}
      }
    });
  }, []);

  const flashSaved = useCallback(() => {
    saveFlash.setValue(0);
    Animated.sequence([
      Animated.timing(saveFlash, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1200),
      Animated.timing(saveFlash, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [saveFlash]);

  const saveSettings = useCallback(async (next: StorageSettings) => {
    setSettings(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      invalidateStorageSettingsCache();
      flashSaved();
    } catch {}
  }, [flashSaved]);



  const clearConvCache = useCallback(async (convId: string) => {
    setClearingConv(convId);
    try {
      const existing = dataCache.getMessages(convId);
      if (existing) {
        dataCache.setMessages(convId, []);
      }
      setConvStats(prev =>
        prev ? prev.filter(c => c.conversation_id !== convId) : prev
      );
    } catch {}
    setClearingConv(null);
  }, []);

  const refreshAll = useCallback(async () => {
    setBreakdown(null);
    setConvStats(null);
    const [bd, cs] = await Promise.all([
      measureStorageBreakdown(),
      fetchConversationMediaStats(),
    ]);
    setBreakdown(bd);
    setConvStats(cs);
  }, []);

  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => goBack()} style={s.backBtn} hitSlop={8} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>Данные и память</Text>
        <TouchableOpacity onPress={refreshAll} hitSlop={12} style={s.backBtn} accessibilityLabel="Обновить">
          <RefreshCw size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <Animated.View
        pointerEvents="none"
        style={[
          s.saveToast,
          {
            backgroundColor: colors.success,
            opacity: saveFlash,
            transform: [{ translateY: saveFlash.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
            top: insets.top + 56,
          },
        ]}
      >
        <Check size={14} color="#FFFFFF" />
        <Text style={s.saveToastText}>Сохранено</Text>
      </Animated.View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>

        {/* === Cache Stats === */}
        <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>ХРАНИЛИЩЕ УСТРОЙСТВА</Text>
        <View style={[s.card, { backgroundColor: colors.surface }]}>
          <View style={s.cacheRow}>
            <View style={[s.iconWrap, { backgroundColor: '#E8A838' }]}>
              <HardDrive size={18} color="#FFFFFF" />
            </View>
            <View style={s.cacheInfo}>
              <Text style={[s.cacheLabel, { color: colors.text }]}>Использование памяти</Text>
              <Text style={[s.cacheSubLabel, { color: colors.textSecondary }]}>
                {breakdown === null ? 'Подсчёт...' : formatBytes(breakdown.totalBytes)}
              </Text>
            </View>
          </View>

          {breakdown !== null && breakdown.labels.length > 0 && (
            <View style={s.breakdownSection}>
              <View style={[s.usageBar, { backgroundColor: colors.border }]}>
                {breakdown.labels.map(seg => (
                  <View
                    key={seg.name}
                    style={[s.usageSegment, { width: `${Math.max((seg.size / breakdown.totalBytes) * 100, 1)}%`, backgroundColor: seg.color }]}
                  />
                ))}
              </View>
              <View style={s.breakdownLegend}>
                {breakdown.labels.map(seg => (
                  <View key={seg.name} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: seg.color }]} />
                    <Text style={[s.legendText, { color: colors.textSecondary }]}>{seg.name}</Text>
                    <Text style={[s.legendValue, { color: colors.textTertiary }]}>{formatBytes(seg.size)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {breakdown !== null && breakdown.totalBytes === 0 && (
            <View style={s.emptyCache}>
              <Database size={16} color={colors.textTertiary} />
              <Text style={[s.emptyCacheText, { color: colors.textTertiary }]}>Кэш пуст</Text>
            </View>
          )}
        </View>



        {/* === Per-conversation media === */}
        <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>МЕДИА ПО ЧАТАМ</Text>
        <View style={[s.card, { backgroundColor: colors.surface }]}>
          {convStats === null && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={[s.loadingText, { color: colors.textSecondary }]}>Загрузка статистики...</Text>
            </View>
          )}
          {convStats !== null && convStats.length === 0 && (
            <View style={s.emptyCache}>
              <MessageSquare size={16} color={colors.textTertiary} />
              <Text style={[s.emptyCacheText, { color: colors.textTertiary }]}>Нет медиафайлов в чатах</Text>
            </View>
          )}
          {convStats !== null && convStats.map((conv, idx) => (
            <View key={conv.conversation_id}>
              {idx > 0 && <View style={[s.divider, { backgroundColor: colors.border }]} />}
              <View style={s.convRow}>
                <View style={s.convInfo}>
                  <Text style={[s.convName, { color: colors.text }]} numberOfLines={1}>{conv.name}</Text>
                  <View style={s.mediaCountsRow}>
                    {conv.photoCount > 0 && (
                      <View style={s.mediaTag}>
                        <ImageIcon size={11} color={colors.textTertiary} />
                        <Text style={[s.mediaTagText, { color: colors.textTertiary }]}>{conv.photoCount}</Text>
                      </View>
                    )}
                    {conv.videoCount > 0 && (
                      <View style={s.mediaTag}>
                        <FileVideo size={11} color={colors.textTertiary} />
                        <Text style={[s.mediaTagText, { color: colors.textTertiary }]}>{conv.videoCount}</Text>
                      </View>
                    )}
                    {conv.voiceCount > 0 && (
                      <View style={s.mediaTag}>
                        <Mic size={11} color={colors.textTertiary} />
                        <Text style={[s.mediaTagText, { color: colors.textTertiary }]}>{conv.voiceCount}</Text>
                      </View>
                    )}
                    {conv.fileCount > 0 && (
                      <View style={s.mediaTag}>
                        <FileIcon size={11} color={colors.textTertiary} />
                        <Text style={[s.mediaTagText, { color: colors.textTertiary }]}>{conv.fileCount}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={s.convRight}>
                  <Text style={[s.convTotal, { color: colors.textSecondary }]}>{conv.totalMedia} файлов</Text>
                  <TouchableOpacity
                    onPress={() => clearConvCache(conv.conversation_id)}
                    disabled={clearingConv === conv.conversation_id}
                    hitSlop={8}
                    style={s.convClearBtn}
                    accessibilityLabel="Очистить кеш"
                  >
                    {clearingConv === conv.conversation_id ? (
                      <ActivityIndicator size="small" color={colors.textTertiary} />
                    ) : (
                      <Trash2 size={14} color={colors.textTertiary} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* === Auto-download === */}
        <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>АВТОЗАГРУЗКА МЕДИА</Text>

        {Platform.OS === 'web' && (
          <View style={[s.webNote, { backgroundColor: colors.surfaceTertiary }]}>
            <Globe size={14} color={colors.textTertiary} />
            <Text style={[s.webNoteText, { color: colors.textTertiary }]}>
              В веб-версии используются настройки Wi-Fi для всех типов соединения
            </Text>
          </View>
        )}

        <NetworkSection
          label="Мобильная сеть"
          icon={<Signal size={18} color="#FFFFFF" />}
          iconColor="#4CAF50"
          net="autoDownloadMobile"
          settings={settings}
          onSave={saveSettings}
          colors={colors}
        />
        <View style={{ height: 8 }} />
        <NetworkSection
          label="Wi-Fi"
          icon={<Wifi size={18} color="#FFFFFF" />}
          iconColor="#2AABEE"
          net="autoDownloadWifi"
          settings={settings}
          onSave={saveSettings}
          colors={colors}
        />

        <TouchableOpacity
          style={[s.card, s.resetRow, { backgroundColor: colors.surface }]}
          onPress={() => saveSettings(DEFAULT_SETTINGS)}
          activeOpacity={0.7}
        >
          <RefreshCw size={16} color={colors.textSecondary} />
          <Text style={[s.switchLabel, { color: colors.textSecondary }]}>Сбросить настройки</Text>
        </TouchableOpacity>

        {/* === Calls === */}
        <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>ЗВОНКИ</Text>
        <View style={[s.card, { backgroundColor: colors.surface }]}>
          <View style={s.switchRow}>
            <View style={s.switchRowLeft}>
              <Text style={[s.switchLabel, { color: colors.text }]}>Сократить трафик звонков</Text>
            </View>
            <Switch
              value={settings.reducedCallTraffic}
              onValueChange={v => saveSettings({ ...settings, reducedCallTraffic: v })}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
          <Text style={[s.helperText, { color: colors.textSecondary }]}>
            Снижает качество звука и видео для экономии трафика при плохом соединении.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}



function NetworkSection({
  label, icon, iconColor, net, settings, onSave, colors,
}: {
  label: string;
  icon: React.ReactNode;
  iconColor: string;
  net: 'autoDownloadMobile' | 'autoDownloadWifi';
  settings: StorageSettings;
  onSave: (s: StorageSettings) => void;
  colors: any;
}) {
  const cfg = settings[net];
  const rows = [
    { key: 'photos' as const, label: 'Фото', Icon: ImageIcon },
    { key: 'videos' as const, label: 'Видео', Icon: FileVideo },
    { key: 'files' as const, label: 'Файлы', Icon: FileIcon },
  ];
  const activeCount = rows.filter(r => cfg[r.key]).length;

  return (
    <View style={[ns.card, { backgroundColor: colors.surface }]}>
      <View style={ns.networkHeader}>
        <View style={[ns.iconWrap, { backgroundColor: iconColor }]}>{icon}</View>
        <View style={ns.networkInfo}>
          <Text style={[ns.networkLabel, { color: colors.text }]}>{label}</Text>
          <Text style={[ns.networkSub, { color: colors.textTertiary }]}>
            {activeCount === 0 ? 'Ничего не загружать' : activeCount === 3 ? 'Все типы медиа' : `${activeCount} из 3 типов`}
          </Text>
        </View>
      </View>
      <View style={[ns.divider, { backgroundColor: colors.border }]} />
      {rows.map(({ key, label: rowLabel, Icon }, idx) => (
        <View key={key}>
          {idx > 0 && <View style={[ns.divider, { backgroundColor: colors.border }]} />}
          <View style={ns.switchRow}>
            <View style={ns.switchRowLeft}>
              <Icon size={16} color={cfg[key] ? colors.primary : colors.textTertiary} />
              <Text style={[ns.switchLabel, { color: colors.text }]}>{rowLabel}</Text>
            </View>
            <Switch
              value={cfg[key]}
              onValueChange={v => onSave({ ...settings, [net]: { ...cfg, [key]: v } })}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const ns = StyleSheet.create({
  card: { marginHorizontal: 16, borderRadius: 14, overflow: 'hidden' },
  networkHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  networkInfo: { flex: 1 },
  networkLabel: { fontSize: 15, fontWeight: '600' },
  networkSub: { fontSize: 12, marginTop: 2 },
  iconWrap: { width: 34, height: 34, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
  switchRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  switchLabel: { fontSize: 15 },
});

const createStyles = (colors: any) =>
  StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '600' },
    saveToast: {
      position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
      gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, zIndex: 100,
    },
    saveToastText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
    sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginTop: 24, marginBottom: 6, marginHorizontal: 20 },
    card: { marginHorizontal: 16, borderRadius: 14, overflow: 'hidden' },
    cacheRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    iconWrap: { width: 34, height: 34, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
    cacheInfo: { flex: 1 },
    cacheLabel: { fontSize: 15, fontWeight: '500' },
    cacheSubLabel: { fontSize: 12, marginTop: 2 },
    breakdownSection: { paddingHorizontal: 16, paddingBottom: 14 },
    usageBar: { height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden' },
    usageSegment: { height: 6 },
    breakdownLegend: { marginTop: 10, gap: 6 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: 13, flex: 1 },
    legendValue: { fontSize: 12 },
    emptyCache: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 16 },
    emptyCacheText: { fontSize: 13 },
    statsGrid: { flexDirection: 'row', justifyContent: 'space-around' },
    divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
    clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
    clearBtnText: { fontSize: 15, fontWeight: '500' },
    errorText: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 10 },
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 16 },
    loadingText: { fontSize: 13 },
    convRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
    convInfo: { flex: 1 },
    convName: { fontSize: 14, fontWeight: '500' },
    mediaCountsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    mediaTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    mediaTagText: { fontSize: 11 },
    convRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    convTotal: { fontSize: 12 },
    convClearBtn: { width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },
    webNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
    webNoteText: { fontSize: 12, flex: 1, lineHeight: 16 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
    switchRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    switchLabel: { fontSize: 15 },
    resetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, marginTop: 8 },
    helperText: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 14, lineHeight: 17 },
  });

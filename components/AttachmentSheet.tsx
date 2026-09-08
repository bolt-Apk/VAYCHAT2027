import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Animated, Dimensions, Platform, Image, FlatList,
  PanResponder, ActivityIndicator, Pressable, Linking, Alert,
  TextInput,
} from 'react-native';
import {
  X, Images, FileText, MapPin, UserCircle, ChevronRight,
  Camera, ShieldAlert, Settings, ArrowUp, FolderOpen, ChevronLeft,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

let SCREEN_H = Dimensions.get('window').height;
let SCREEN_W = Dimensions.get('window').width;
Dimensions.addEventListener('change', ({ window }) => { SCREEN_H = window.height; SCREEN_W = window.width; });
const SNAP_TOP = SCREEN_H * 0.12;
const SNAP_MID = SCREEN_H * 0.45;
const SHEET_BORDER_RADIUS = 14;
const GRID_GAP = 2;
const NUM_COLUMNS = 3;
const ITEM_SIZE = (SCREEN_W - GRID_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;
const TAB_BAR_HEIGHT = 90;

interface MediaAsset {
  id: string;
  uri: string;
  mediaType: 'photo' | 'video';
  duration?: number;
  width?: number;
  height?: number;
}

interface Album {
  id: string;
  title: string;
  assetCount: number;
  coverUri?: string;
}

type ViewMode = 'photos' | 'albums' | 'album-detail';

interface AttachmentSheetProps {
  visible: boolean;
  onClose: () => void;
  onPickImage: () => void;
  onPickFile: () => void;
  onPickLocation: () => void;
  onPickContact: () => void;
  onSendMedia: (assets: MediaAsset[], caption?: string, hdMode?: boolean) => void;
  colors: {
    background: string;
    backgroundSecondary: string;
    backgroundTertiary: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    primary: string;
    border: string;
    error: string;
  };
}

export default function AttachmentSheet({
  visible, onClose, onPickImage, onPickFile, onPickLocation,
  onPickContact, onSendMedia, colors,
}: AttachmentSheetProps) {
  const insets = useSafeAreaInsets();
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<'undetermined' | 'granted' | 'denied' | 'limited'>('undetermined');
  const [viewMode, setViewMode] = useState<ViewMode>('photos');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [currentAlbum, setCurrentAlbum] = useState<Album | null>(null);
  const [albumAssets, setAlbumAssets] = useState<MediaAsset[]>([]);
  const [hdMode, setHdMode] = useState(false);
  const [caption, setCaption] = useState('');

  const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(SNAP_MID);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
      onPanResponderMove: (_, g) => {
        const newY = sheetY.current + g.dy;
        if (newY >= SNAP_TOP) {
          slideAnim.setValue(newY);
        }
      },
      onPanResponderRelease: (_, g) => {
        const currentY = sheetY.current + g.dy;
        const velocity = g.vy;

        if (velocity > 1.2 || currentY > SCREEN_H * 0.7) {
          closeSheet();
        } else if (velocity < -0.8 || currentY < SNAP_MID * 0.7) {
          snapTo(SNAP_TOP);
        } else {
          snapTo(SNAP_MID);
        }
      },
    })
  ).current;

  const snapTo = useCallback((target: number) => {
    sheetY.current = target;
    Animated.spring(slideAnim, {
      toValue: target,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [slideAnim]);

  const closeSheet = useCallback(() => {
    sheetY.current = SNAP_MID;
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: SCREEN_H,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setSelectedAssets([]);
      setViewMode('photos');
      setCurrentAlbum(null);
      setCaption('');
      onClose();
    });
  }, [slideAnim, backdropOpacity, onClose]);

  useEffect(() => {
    if (visible) {
      setSelectedAssets([]);
      setViewMode('photos');
      setCurrentAlbum(null);
      setCaption('');
      loadMedia();
      sheetY.current = SNAP_MID;
      slideAnim.setValue(SCREEN_H);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: SNAP_MID,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const loadMedia = async () => {
    if (Platform.OS === 'web') {
      setPermissionStatus('granted');
      setMediaAssets([]);
      return;
    }

    try {
      const MediaLibrary = require('expo-media-library');
      const { status } = await MediaLibrary.requestPermissionsAsync();

      if (status === 'granted') {
        setPermissionStatus('granted');
      } else if (status === 'limited') {
        setPermissionStatus('limited');
      } else {
        setPermissionStatus('denied');
        return;
      }

      setLoading(true);
      const result = await MediaLibrary.getAssetsAsync({
        first: 60,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });

      const assets: MediaAsset[] = result.assets.map((a: any) => ({
        id: a.id,
        uri: a.uri,
        mediaType: a.mediaType === 'video' ? 'video' : 'photo',
        duration: a.duration,
        width: a.width,
        height: a.height,
      }));
      setMediaAssets(assets);
    } catch {
      setPermissionStatus('denied');
    } finally {
      setLoading(false);
    }
  };

  const loadAlbums = async () => {
    if (Platform.OS === 'web') return;
    try {
      const MediaLibrary = require('expo-media-library');
      const albumList = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      const mapped: Album[] = [];
      for (const a of albumList) {
        if (a.assetCount === 0) continue;
        const preview = await MediaLibrary.getAssetsAsync({
          first: 1, album: a.id,
          mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
          sortBy: [MediaLibrary.SortBy.creationTime],
        });
        mapped.push({
          id: a.id,
          title: a.title,
          assetCount: a.assetCount,
          coverUri: preview.assets[0]?.uri,
        });
      }
      mapped.sort((a, b) => b.assetCount - a.assetCount);
      setAlbums(mapped);
    } catch (err) {
      console.warn('[AttachmentSheet] loadAlbums failed:', err);
    }
  };

  const openAlbum = async (album: Album) => {
    if (Platform.OS === 'web') return;
    setCurrentAlbum(album);
    setViewMode('album-detail');
    setLoading(true);
    try {
      const MediaLibrary = require('expo-media-library');
      const result = await MediaLibrary.getAssetsAsync({
        first: 80,
        album: album.id,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      const assets: MediaAsset[] = result.assets.map((a: any) => ({
        id: a.id,
        uri: a.uri,
        mediaType: a.mediaType === 'video' ? 'video' : 'photo',
        duration: a.duration,
        width: a.width,
        height: a.height,
      }));
      setAlbumAssets(assets);
    } catch (err) {
      console.warn('[AttachmentSheet] openAlbum failed:', err);
    }
    setLoading(false);
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedAssets(prev => {
      if (prev.includes(id)) return prev.filter(a => a !== id);
      if (prev.length >= 10) return prev;
      return [...prev, id];
    });
  }, []);

  const handleSendSelected = useCallback(() => {
    const allAssets = viewMode === 'album-detail' ? [...mediaAssets, ...albumAssets] : mediaAssets;
    const selected = allAssets.filter(a => selectedAssets.includes(a.id));
    if (selected.length === 0) return;
    const toSend = [...selected];
    setSelectedAssets([]);
    setCaption('');
    closeSheet();
    setTimeout(() => onSendMedia(toSend, caption.trim() || undefined, hdMode), 300);
  }, [mediaAssets, albumAssets, selectedAssets, onSendMedia, closeSheet, caption, hdMode, viewMode]);

  const openNativeGallery = useCallback(async () => {
    closeSheet();
    setTimeout(onPickImage, 300);
  }, [closeSheet, onPickImage]);

  const openNativeCamera = useCallback(async () => {
    closeSheet();

    setTimeout(async () => {
      try {
        if (Platform.OS === 'web') {
          onPickImage();
          return;
        }

        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Нет доступа к камере',
            'Для съемки фото и видео необходимо разрешить доступ к камере в настройках устройства.',
            [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Открыть настройки', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }

        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images', 'videos'],
          allowsEditing: false,
          quality: 0.8,
          exif: false,
          videoMaxDuration: 120,
        });

        if (!result.canceled && result.assets?.length) {
          const assets: MediaAsset[] = result.assets.map((asset, i) => ({
            id: `camera-${Date.now()}-${i}`,
            uri: asset.uri,
            mediaType: asset.type === 'video' ? 'video' as const : 'photo' as const,
            width: asset.width,
            height: asset.height,
          }));
          onSendMedia(assets);
        }
      } catch (err) {
        console.warn('[AttachmentSheet] camera failed:', err);
      }
    }, 300);
  }, [closeSheet, onSendMedia, onPickImage]);

  const requestPermissionAgain = useCallback(async () => {
    if (Platform.OS === 'web') return;

    try {
      const MediaLibrary = require('expo-media-library');
      const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync();

      if (status === 'granted' || status === 'limited') {
        setPermissionStatus(status === 'granted' ? 'granted' : 'limited');
        loadMedia();
      } else if (!canAskAgain) {
        Alert.alert(
          'Доступ к фото запрещен',
          'Вы ранее запретили доступ к фото. Чтобы разрешить его, перейдите в настройки устройства.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть настройки', onPress: () => Linking.openSettings() },
          ]
        );
      }
    } catch (err) {
      console.warn('[AttachmentSheet] requestPermission failed:', err);
    }
  }, []);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleTabPress = useCallback((action: 'file' | 'location' | 'contact' | 'camera') => {
    switch (action) {
      case 'camera':
        openNativeCamera();
        break;
      case 'file':
        closeSheet();
        setTimeout(onPickFile, 300);
        break;
      case 'location':
        closeSheet();
        setTimeout(onPickLocation, 300);
        break;
      case 'contact':
        closeSheet();
        setTimeout(onPickContact, 300);
        break;
    }
  }, [closeSheet, openNativeCamera, onPickFile, onPickLocation, onPickContact]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === 'albums' && albums.length === 0) {
      loadAlbums();
    }
    setViewMode(mode);
  }, [albums.length]);

  const renderMediaItem = useCallback(({ item }: { item: MediaAsset }) => {
    const isSelected = selectedAssets.includes(item.id);
    const selIndex = selectedAssets.indexOf(item.id);

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => toggleSelect(item.id)}
        style={[s.gridItem, { width: ITEM_SIZE, height: ITEM_SIZE }]}
      >
        <Image source={{ uri: item.uri }} style={s.gridImage} />
        {item.mediaType === 'video' && item.duration ? (
          <View style={s.videoDuration}>
            <Text style={s.videoDurationText}>{formatDuration(item.duration)}</Text>
          </View>
        ) : null}
        <View style={[
          s.selectCircle,
          isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
        ]}>
          {isSelected ? (
            <Text style={s.selectNumber}>{selIndex + 1}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }, [selectedAssets, colors.primary, toggleSelect]);

  const renderAlbumItem = useCallback(({ item }: { item: Album }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => openAlbum(item)}
      style={s.albumItem}
    >
      <View style={[s.albumCover, { backgroundColor: colors.backgroundTertiary }]}>
        {item.coverUri ? (
          <Image source={{ uri: item.coverUri }} style={s.albumCoverImage} />
        ) : (
          <FolderOpen color={colors.textTertiary} size={24} />
        )}
      </View>
      <View style={s.albumInfo}>
        <Text style={[s.albumTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[s.albumCount, { color: colors.textSecondary }]}>{item.assetCount}</Text>
      </View>
      <ChevronRight color={colors.textTertiary} size={18} />
    </TouchableOpacity>
  ), [colors, openAlbum]);

  if (!visible) return null;

  const tabs = [
    { key: 'camera', icon: Camera, label: 'Камера', color: '#9C27B0' },
    { key: 'file', icon: FileText, label: 'Файл', color: '#FF9800' },
    { key: 'location', icon: MapPin, label: 'Геолокация', color: '#4CAF50' },
    { key: 'contact', icon: UserCircle, label: 'Контакт', color: '#00BCD4' },
  ] as const;

  const displayAssets = viewMode === 'album-detail' ? albumAssets : mediaAssets;
  const firstSelectedUri = selectedAssets.length > 0
    ? displayAssets.find(a => a.id === selectedAssets[0])?.uri
    : null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={closeSheet}>
      <View style={s.container}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        </Animated.View>

        <Animated.View
          style={[
            s.sheet,
            {
              backgroundColor: colors.backgroundSecondary,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View {...panResponder.panHandlers} style={s.handleArea}>
            <View style={[s.handle, { backgroundColor: colors.textTertiary }]} />
          </View>

          <View style={s.header}>
            {viewMode === 'album-detail' ? (
              <TouchableOpacity
                onPress={() => { setViewMode('albums'); setCurrentAlbum(null); }}
                style={[s.closeBtn, { backgroundColor: colors.backgroundTertiary }]}
                activeOpacity={0.7}
                accessibilityLabel="Назад"
              >
                <ChevronLeft color={colors.text} size={20} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={closeSheet}
                style={[s.closeBtn, { backgroundColor: colors.backgroundTertiary }]}
                activeOpacity={0.7}
                accessibilityLabel="Закрыть"
              >
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            )}
            <View style={s.headerCenter}>
              {viewMode === 'album-detail' && currentAlbum ? (
                <Text style={[s.headerTitle, { color: colors.text }]} numberOfLines={1}>
                  {currentAlbum.title}
                </Text>
              ) : Platform.OS !== 'web' ? (
                <View style={s.viewModeTabs}>
                  <TouchableOpacity
                    style={[s.viewModeTab, viewMode === 'photos' && { backgroundColor: colors.primary }]}
                    onPress={() => handleViewModeChange('photos')}
                    activeOpacity={0.7}
                    accessibilityLabel="Фото"
                  >
                    <Text style={[s.viewModeTabText, viewMode === 'photos' && { color: '#FFFFFF' }, viewMode !== 'photos' && { color: colors.textSecondary }]}>
                      Фото
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.viewModeTab, viewMode === 'albums' && { backgroundColor: colors.primary }]}
                    onPress={() => handleViewModeChange('albums')}
                    activeOpacity={0.7}
                    accessibilityLabel="Альбомы"
                  >
                    <Text style={[s.viewModeTabText, viewMode === 'albums' && { color: '#FFFFFF' }, viewMode !== 'albums' && { color: colors.textSecondary }]}>
                      Альбомы
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[s.headerTitle, { color: colors.text }]}>
                  {selectedAssets.length > 0 ? `Выбрано: ${selectedAssets.length}` : 'Недавние'}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => setHdMode(!hdMode)}
              style={[s.hdBtn, hdMode && { backgroundColor: colors.primary }]}
              activeOpacity={0.7}
              accessibilityLabel="HD качество"
            >
              <Text style={[s.hdText, hdMode && { color: '#FFFFFF' }]}>HD</Text>
            </TouchableOpacity>
          </View>

          <View style={s.galleryContainer}>
            {loading ? (
              <View style={s.loadingContainer}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
            ) : Platform.OS === 'web' ? (
              <TouchableOpacity
                style={[s.webGalleryPlaceholder, { backgroundColor: colors.backgroundTertiary }]}
                onPress={openNativeGallery}
                activeOpacity={0.7}
              >
                <Images color={colors.textTertiary} size={48} />
                <Text style={[s.webGalleryText, { color: colors.textSecondary }]}>
                  Нажмите, чтобы выбрать фото или видео
                </Text>
                <Text style={[s.webGalleryHint, { color: colors.textTertiary }]}>
                  до 10 файлов
                </Text>
              </TouchableOpacity>
            ) : permissionStatus === 'denied' ? (
              <View style={s.permissionContainer}>
                <View style={[s.permissionIconWrap, { backgroundColor: `${colors.error}15` }]}>
                  <ShieldAlert color={colors.error} size={32} />
                </View>
                <Text style={[s.permissionTitle, { color: colors.text }]}>
                  Нет доступа к фото
                </Text>
                <Text style={[s.permissionDesc, { color: colors.textSecondary }]}>
                  Разрешите доступ к фотографиям, чтобы выбирать и отправлять медиафайлы
                </Text>
                <TouchableOpacity
                  style={[s.permissionBtn, { backgroundColor: colors.primary }]}
                  onPress={requestPermissionAgain}
                  activeOpacity={0.7}
                >
                  <Text style={s.permissionBtnText}>Разрешить доступ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.settingsBtn, { borderColor: colors.border }]}
                  onPress={() => Linking.openSettings()}
                  activeOpacity={0.7}
                >
                  <Settings color={colors.textSecondary} size={16} />
                  <Text style={[s.settingsBtnText, { color: colors.textSecondary }]}>
                    Открыть настройки
                  </Text>
                </TouchableOpacity>
              </View>
            ) : viewMode === 'albums' ? (
              albums.length === 0 ? (
                <View style={s.loadingContainer}>
                  <ActivityIndicator color={colors.primary} size="large" />
                </View>
              ) : (
                <FlatList
                  data={albums}
                  renderItem={renderAlbumItem}
                  keyExtractor={item => item.id}
                  contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}
                  showsVerticalScrollIndicator={false}
                  ItemSeparatorComponent={() => <View style={[s.albumSeparator, { backgroundColor: colors.border }]} />}
                />
              )
            ) : displayAssets.length === 0 ? (
              <View style={s.loadingContainer}>
                <Images color={colors.textTertiary} size={40} />
                <Text style={[s.permText, { color: colors.textSecondary }]}>
                  Нет медиафайлов
                </Text>
              </View>
            ) : (
              <FlatList
                data={displayAssets}
                renderItem={renderMediaItem}
                keyExtractor={item => item.id}
                numColumns={NUM_COLUMNS}
                columnWrapperStyle={{ gap: GRID_GAP }}
                contentContainerStyle={{ gap: GRID_GAP, paddingHorizontal: GRID_GAP }}
                showsVerticalScrollIndicator={false}
                initialNumToRender={12}
                maxToRenderPerBatch={18}
                windowSize={5}
                ListFooterComponent={
                  viewMode !== 'album-detail' ? (
                    <TouchableOpacity
                      style={[s.openGalleryBtn, { backgroundColor: colors.backgroundTertiary }]}
                      onPress={openNativeGallery}
                      activeOpacity={0.7}
                    >
                      <Images color={colors.primary} size={20} />
                      <Text style={[s.openGalleryText, { color: colors.primary }]}>
                        Открыть галерею
                      </Text>
                      <ChevronRight color={colors.primary} size={18} />
                    </TouchableOpacity>
                  ) : null
                }
              />
            )}
          </View>

          {/* Caption bar (when items selected) */}
          {selectedAssets.length > 0 && (
            <View style={[s.captionBar, { backgroundColor: colors.backgroundTertiary, borderTopColor: colors.border }]}>
              {firstSelectedUri && (
                <Image source={{ uri: firstSelectedUri }} style={s.captionThumb} />
              )}
              <TextInput
                style={[s.captionInput, { color: colors.text }]}
                placeholder="Добавить подпись..."
                placeholderTextColor={colors.textTertiary}
                value={caption}
                onChangeText={setCaption}
                multiline
                maxLength={512}
              />
              <TouchableOpacity
                onPress={handleSendSelected}
                style={[s.sendBtn, { backgroundColor: colors.primary }]}
                activeOpacity={0.7}
                accessibilityLabel="Отправить выбранные"
              >
                <ArrowUp color="#FFFFFF" size={18} strokeWidth={2.5} />
                <View style={s.sendBadge}>
                  <Text style={s.sendBadgeText}>{selectedAssets.length}</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

        </Animated.View>

        <Animated.View
          style={[
            s.tabBarContainer,
            {
              backgroundColor: colors.backgroundSecondary,
              paddingBottom: insets.bottom,
              opacity: backdropOpacity,
            },
          ]}
        >
          <View style={[s.tabBar, { borderTopColor: colors.border }]}>
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={s.tab}
                  onPress={() => handleTabPress(tab.key)}
                  activeOpacity={0.7}
                  accessibilityLabel={tab.label}
                >
                  <View style={[s.tabIcon, { backgroundColor: tab.color }]}>
                    <Icon color="#FFFFFF" size={20} />
                  </View>
                  <Text
                    style={[s.tabLabel, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SCREEN_H - SNAP_TOP + 40,
    borderTopLeftRadius: SHEET_BORDER_RADIUS,
    borderTopRightRadius: SHEET_BORDER_RADIUS,
    overflow: 'hidden',
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  viewModeTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(128,128,128,0.15)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  viewModeTab: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 10,
  },
  viewModeTabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  hdBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  hdText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(128,128,128,0.7)',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: '#E53935',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  sendBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  galleryContainer: {
    flex: 1,
    paddingBottom: TAB_BAR_HEIGHT,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  permText: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  permissionIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  permissionBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  settingsBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  webGalleryPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 12,
    borderRadius: 16,
    gap: 12,
  },
  webGalleryText: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  webGalleryHint: {
    fontSize: 13,
  },
  gridItem: {
    position: 'relative',
    overflow: 'hidden',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
  },
  videoDuration: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  videoDurationText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  selectCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  selectNumber: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  openGalleryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: GRID_GAP,
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  openGalleryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  // Albums
  albumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  albumCover: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  albumCoverImage: {
    width: '100%',
    height: '100%',
  },
  albumInfo: {
    flex: 1,
    gap: 2,
  },
  albumTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  albumCount: {
    fontSize: 13,
  },
  albumSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },
  // Caption bar
  captionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginBottom: TAB_BAR_HEIGHT,
  },
  captionThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
  },
  captionInput: {
    flex: 1,
    fontSize: 14,
    maxHeight: 60,
    paddingVertical: 4,
  },
  // Tab bar
  tabBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 10,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    minHeight: 60,
  },
  tabIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});

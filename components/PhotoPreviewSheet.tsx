import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  TextInput, FlatList, Animated, Dimensions, Platform,
  KeyboardAvoidingView, Pressable, ScrollView, PanResponder,
  ActivityIndicator, useWindowDimensions,
} from 'react-native';
import {
  X, Send, ChevronLeft, ChevronRight, ImagePlus, Play, Pause,
  Trash2, RotateCw, Crop, Scissors, Check, RectangleHorizontal,
  Square, RectangleVertical, Maximize, Pencil, Type, FlipHorizontal,
  RotateCcw, Sparkles, Volume2, VolumeX, SkipBack, SkipForward,
  SunDim, Smile, Sticker,
} from 'lucide-react-native';
import { Video as ExpoVideo, ResizeMode } from 'expo-av';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticLight, hapticMedium, hapticKeypress } from '@/lib/chat-feedback';
import SwipeToClose from './SwipeToClose';

const THUMB_SIZE = 56;
const THUMB_GAP = 6;

export interface PreviewAsset {
  id: string;
  uri: string;
  width?: number;
  height?: number;
  mediaType: 'photo' | 'video';
  _file?: File;
  rotation?: number;
  cropRegion?: { originX: number; originY: number; width: number; height: number };
  trimStart?: number;
  trimEnd?: number;
  caption?: string;
  [key: string]: any;
}

interface PhotoPreviewSheetProps {
  visible: boolean;
  assets: PreviewAsset[];
  onClose: () => void;
  onSend: (assets: PreviewAsset[], caption: string, hdMode: boolean) => void;
  onSchedule?: (assets: PreviewAsset[], caption: string, hdMode: boolean) => void;
  onAddMore: () => void;
  onRemoveAsset?: (id: string) => void;
  colors: {
    background: string;
    backgroundSecondary: string;
    backgroundTertiary: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    primary: string;
    border: string;
  };
}

type EditorMode = 'none' | 'crop' | 'trim' | 'draw' | 'text' | 'rotate' | 'filter' | 'sticker';

interface PhotoFilter {
  id: string;
  label: string;
  matrix: number[] | null;
}

const PHOTO_FILTERS: PhotoFilter[] = [
  { id: 'original', label: 'Оригинал', matrix: null },
  { id: 'vivid', label: 'Яркий', matrix: [1.3, 0, 0, 0, 10, 0, 1.3, 0, 0, 10, 0, 0, 1.3, 0, 10, 0, 0, 0, 1, 0] },
  { id: 'warm', label: 'Тёплый', matrix: [1.2, 0.1, 0, 0, 15, 0, 1.05, 0, 0, 5, 0, 0, 0.9, 0, -10, 0, 0, 0, 1, 0] },
  { id: 'cool', label: 'Холодный', matrix: [0.9, 0, 0, 0, -10, 0, 1.0, 0.05, 0, 0, 0, 0.1, 1.2, 0, 15, 0, 0, 0, 1, 0] },
  { id: 'bw', label: 'Ч/Б', matrix: [0.33, 0.33, 0.33, 0, 0, 0.33, 0.33, 0.33, 0, 0, 0.33, 0.33, 0.33, 0, 0, 0, 0, 0, 1, 0] },
  { id: 'sepia', label: 'Сепия', matrix: [0.39, 0.77, 0.19, 0, 0, 0.35, 0.69, 0.17, 0, 0, 0.27, 0.53, 0.13, 0, 0, 0, 0, 0, 1, 0] },
  { id: 'vintage', label: 'Винтаж', matrix: [0.6, 0.3, 0.1, 0, 30, 0.2, 0.7, 0.1, 0, 15, 0.1, 0.2, 0.6, 0, 10, 0, 0, 0, 0.9, 0] },
  { id: 'drama', label: 'Драма', matrix: [1.5, -0.2, -0.1, 0, -20, -0.2, 1.5, -0.1, 0, -20, -0.1, -0.2, 1.5, 0, -20, 0, 0, 0, 1, 0] },
  { id: 'fade', label: 'Выцветший', matrix: [1.0, 0, 0, 0, 40, 0, 1.0, 0, 0, 40, 0, 0, 1.0, 0, 40, 0, 0, 0, 0.85, 0] },
  { id: 'noir', label: 'Нуар', matrix: [0.4, 0.4, 0.2, 0, -30, 0.3, 0.4, 0.3, 0, -30, 0.2, 0.3, 0.5, 0, -30, 0, 0, 0, 1, 0] },
  { id: 'chrome', label: 'Хром', matrix: [1.3, -0.1, 0, 0, 20, -0.1, 1.3, 0, 0, 20, 0, 0, 1.3, 0, 20, 0, 0, 0, 1, 0] },
  { id: 'sunset', label: 'Закат', matrix: [1.2, 0.15, 0, 0, 20, 0.05, 1.0, 0, 0, 5, 0, 0, 0.8, 0, -15, 0, 0, 0, 1, 0] },
];

const STICKER_SETS = [
  { id: 'emotions', label: 'Эмоции', stickers: ['😀','😂','🥹','😍','🤩','😎','🥳','😤','😱','🤯','😈','👻','💀','🤡','👽'] },
  { id: 'gestures', label: 'Жесты', stickers: ['👍','👎','✌️','🤞','🤟','👌','🤙','💪','👏','🙌','🫶','🫡','🤝','✋','👋'] },
  { id: 'hearts', label: 'Сердца', stickers: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❤️‍🔥','💕','💖','💗','💝','💘'] },
  { id: 'objects', label: 'Объекты', stickers: ['⭐','🌟','✨','💫','🔥','💥','🎉','🎊','🎁','🏆','🥇','💎','🔮','🪩','🎯'] },
  { id: 'nature', label: 'Природа', stickers: ['🌸','🌺','🌻','🌹','🍀','🌈','☀️','🌙','⚡','❄️','🌊','🍂','🦋','🐱','🐶'] },
];

interface CropRatio {
  label: string;
  icon: any;
  value: number | null;
}

const CROP_RATIOS: CropRatio[] = [
  { label: 'Свободно', icon: Maximize, value: null },
  { label: '1:1', icon: Square, value: 1 },
  { label: '4:3', icon: RectangleHorizontal, value: 4 / 3 },
  { label: '3:4', icon: RectangleVertical, value: 3 / 4 },
  { label: '16:9', icon: RectangleHorizontal, value: 16 / 9 },
];

interface DrawPath {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
}

const DRAW_COLORS = ['#FFFFFF', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#000000'];

function DraggableTextOverlay({ overlay, onMove, onResize, onRemove }: {
  overlay: TextOverlay;
  onMove: (dx: number, dy: number) => void;
  onResize: (size: number) => void;
  onRemove: () => void;
}) {
  const panRef = useRef({ lastDx: 0, lastDy: 0 });
  const pinchRef = useRef({ initialDist: 0, initialSize: 0 });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: (evt) => {
        panRef.current = { lastDx: 0, lastDy: 0 };
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length === 2) {
          const dx = touches[1].pageX - touches[0].pageX;
          const dy = touches[1].pageY - touches[0].pageY;
          pinchRef.current = { initialDist: Math.sqrt(dx * dx + dy * dy), initialSize: overlay.fontSize };
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length === 2) {
          const dx = touches[1].pageX - touches[0].pageX;
          const dy = touches[1].pageY - touches[0].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (pinchRef.current.initialDist > 0) {
            const scale = dist / pinchRef.current.initialDist;
            onResize(Math.round(pinchRef.current.initialSize * scale));
          }
          return;
        }
        const dx = gestureState.dx - panRef.current.lastDx;
        const dy = gestureState.dy - panRef.current.lastDy;
        panRef.current = { lastDx: gestureState.dx, lastDy: gestureState.dy };
        onMove(dx, dy);
      },
      onPanResponderRelease: () => {},
    })
  ).current;

  return (
    <View
      {...panResponder.panHandlers}
      style={[ps.textOverlayItem, { left: overlay.x - 60, top: overlay.y - 20 }]}
    >
      <TouchableOpacity onLongPress={onRemove} activeOpacity={0.8} delayLongPress={400}>
        <Text style={{
          color: overlay.color,
          fontSize: overlay.fontSize,
          fontWeight: '700',
          textShadowColor: 'rgba(0,0,0,0.8)',
          textShadowOffset: { width: 1, height: 1 },
          textShadowRadius: 3,
          textAlign: 'center',
        }}>{overlay.text}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function PhotoPreviewSheet({
  visible, assets: initialAssets, onClose, onSend, onSchedule, onAddMore, onRemoveAsset, colors,
}: PhotoPreviewSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const [assets, setAssets] = useState<PreviewAsset[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [carouselHeight, setCarouselHeight] = useState(SCREEN_H * 0.55);
  const [caption, setCaption] = useState('');
  const [hdMode, setHdMode] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('none');
  const [cropRatioIdx, setCropRatioIdx] = useState(0);
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [imageLayout, setImageLayout] = useState({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H * 0.6 });
  const [trimValues, setTrimValues] = useState({ start: 0, end: 100 });
  const [trimPlaying, setTrimPlaying] = useState(false);
  const [trimMuted, setTrimMuted] = useState(false);
  const [trimProgress, setTrimProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimFrames, setTrimFrames] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const trimVideoRef = useRef<any>(null);
  const frameExtractorRef = useRef<HTMLVideoElement | null>(null);

  const [drawPaths, setDrawPaths] = useState<DrawPath[]>([]);
  const [currentDrawPath, setCurrentDrawPath] = useState<DrawPath | null>(null);
  const [drawColor, setDrawColor] = useState('#FF3B30');
  const [drawWidth, setDrawWidth] = useState(4);

  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [newTextInput, setNewTextInput] = useState('');
  const [textColor, setTextColor] = useState('#FFFFFF');

  const [rotateAngle, setRotateAngle] = useState(0);
  const [rotateOriginalUri, setRotateOriginalUri] = useState('');

  const [activeFilter, setActiveFilter] = useState<string>('original');
  const [stickerOverlays, setStickerOverlays] = useState<{ id: string; emoji: string; x: number; y: number; size: number }[]>([]);
  const [activeStickerSet, setActiveStickerSet] = useState(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const flatListRef = useRef<FlatList>(null);
  const thumbListRef = useRef<ScrollView>(null);
  const videoRef = useRef<any>(null);

  const sendingRef = useRef(false);
  useEffect(() => {
    if (visible) {
      setAssets([...initialAssets]);
      setActiveIndex(0);
      setCaption('');
      setEditorMode('none');
      setZoomScale(1);
      setPanOffset({ x: 0, y: 0 });
      setDrawPaths([]);
      setTextOverlays([]);
      sendingRef.current = false;
    }
  }, [visible, initialAssets]);

  const currentAsset = assets[activeIndex] || null;

  const handleClose = useCallback(() => {
    if (editorMode !== 'none') {
      setEditorMode('none');
      setDrawPaths([]);
      setCurrentDrawPath(null);
      setTextOverlays([]);
      return;
    }
    onClose();
  }, [onClose, editorMode]);

  const handleSend = useCallback(() => {
    if (assets.length === 0 || sendingRef.current) return;
    sendingRef.current = true;
    hapticMedium();
    const finalAssets = assets.map(a => ({
      ...a,
      caption: a.caption || caption.trim() || undefined,
    }));
    const effectiveCaption = assets.length > 1
      ? (assets[0]?.caption || caption.trim())
      : caption.trim();
    onSend(finalAssets, effectiveCaption, hdMode);
  }, [assets, caption, hdMode, onSend]);

  const handleScheduleLongPress = useCallback(() => {
    if (!onSchedule || assets.length === 0) return;
    hapticLight();
    const finalAssets = assets.map(a => ({
      ...a,
      caption: a.caption || caption.trim() || undefined,
    }));
    const effectiveCaption = assets.length > 1
      ? (assets[0]?.caption || caption.trim())
      : caption.trim();
    onSchedule(finalAssets, effectiveCaption, hdMode);
  }, [assets, caption, hdMode, onSchedule]);

  const scrollToIndex = useCallback((index: number) => {
    if (index < 0 || index >= assets.length) return;
    setActiveIndex(index);
    setEditorMode('none');
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    flatListRef.current?.scrollToIndex({ index, animated: true });
    const thumbOffset = index * (THUMB_SIZE + THUMB_GAP) - (SCREEN_W / 2 - THUMB_SIZE / 2);
    thumbListRef.current?.scrollTo({ x: Math.max(0, thumbOffset), animated: true });
  }, [assets.length, SCREEN_W]);

  const removeAsset = useCallback((id: string) => {
    hapticKeypress();
    setAssets(prev => {
      const next = prev.filter(a => a.id !== id);
      if (next.length === 0) {
        onClose();
        return prev;
      }
      const newIdx = Math.min(activeIndex, next.length - 1);
      setActiveIndex(newIdx);
      return next;
    });
    onRemoveAsset?.(id);
  }, [activeIndex, onClose, onRemoveAsset]);

  const rotateCurrentAsset = useCallback(async () => {
    if (!currentAsset || currentAsset.mediaType !== 'photo') return;
    setProcessing(true);
    try {
      const ImageManipulator = await import('expo-image-manipulator');
      const currentRotation = currentAsset.rotation || 0;
      const newRotation = (currentRotation + 90) % 360;
      const result = await ImageManipulator.manipulateAsync(
        currentAsset.uri,
        [{ rotate: 90 }],
        { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
      );
      setAssets(prev => prev.map(a =>
        a.id === currentAsset.id
          ? { ...a, uri: result.uri, width: result.width, height: result.height, rotation: newRotation }
          : a
      ));
    } catch {}
    setProcessing(false);
  }, [currentAsset]);

  const initCropBox = useCallback(() => {
    const padding = 24;
    const availW = SCREEN_W - padding * 2;
    const availH = SCREEN_H * 0.55;
    const imgW = currentAsset?.width || availW;
    const imgH = currentAsset?.height || availH;
    const scale = Math.min(availW / imgW, availH / imgH);
    const dispW = imgW * scale;
    const dispH = imgH * scale;
    const ox = (SCREEN_W - dispW) / 2;
    const oy = (availH - dispH) / 2 + 60;
    setImageLayout({ x: ox, y: oy, w: dispW, h: dispH });
    setCropBox({ x: ox, y: oy, w: dispW, h: dispH });
    setCropRatioIdx(0);
  }, [currentAsset, SCREEN_W, SCREEN_H]);

  const openCropEditor = useCallback(() => {
    if (!currentAsset || currentAsset.mediaType !== 'photo') return;
    initCropBox();
    setEditorMode('crop');
  }, [currentAsset, initCropBox]);

  const extractVideoFrames = useCallback((videoUri: string, frameCount: number) => {
    if (Platform.OS !== 'web') return;
    setTrimFrames([]);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    (frameExtractorRef as any).current = video;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames: string[] = [];
    let currentFrame = 0;

    video.onloadedmetadata = () => {
      canvas.width = 80;
      canvas.height = 56;
      const duration = video.duration;
      if (!duration || duration === Infinity) return;
      setVideoDuration(duration);

      const seekToFrame = () => {
        if (currentFrame >= frameCount) {
          setTrimFrames(frames);
          video.src = '';
          return;
        }
        const time = (currentFrame / frameCount) * duration;
        video.currentTime = time;
      };

      video.onseeked = () => {
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          try {
            frames.push(canvas.toDataURL('image/jpeg', 0.5));
          } catch {
            frames.push('');
          }
        }
        currentFrame++;
        seekToFrame();
      };

      seekToFrame();
    };

    video.onerror = () => {
      setTrimFrames([]);
    };

    video.src = videoUri;
  }, []);

  const openTrimEditor = useCallback(() => {
    if (!currentAsset || currentAsset.mediaType !== 'video') return;
    setTrimValues({ start: currentAsset.trimStart ?? 0, end: currentAsset.trimEnd ?? 100 });
    setTrimPlaying(false);
    setTrimProgress(0);
    setTrimFrames([]);
    setEditorMode('trim');
    extractVideoFrames(currentAsset.uri, 12);
  }, [currentAsset, extractVideoFrames]);

  const openDrawEditor = useCallback(() => {
    if (!currentAsset || currentAsset.mediaType !== 'photo') return;
    setDrawPaths([]);
    setCurrentDrawPath(null);
    setEditorMode('draw');
  }, [currentAsset]);

  const openTextEditor = useCallback(() => {
    if (!currentAsset || currentAsset.mediaType !== 'photo') return;
    setTextOverlays([]);
    setNewTextInput('');
    setEditingTextId(null);
    setEditorMode('text');
  }, [currentAsset]);

  const openFilterEditor = useCallback(() => {
    if (!currentAsset || currentAsset.mediaType !== 'photo') return;
    setActiveFilter('original');
    setEditorMode('filter');
  }, [currentAsset]);

  const openStickerEditor = useCallback(() => {
    if (!currentAsset || currentAsset.mediaType !== 'photo') return;
    setStickerOverlays([]);
    setActiveStickerSet(0);
    setEditorMode('sticker');
  }, [currentAsset]);

  const openRotateEditor = useCallback(() => {
    if (!currentAsset || currentAsset.mediaType !== 'photo') return;
    setRotateAngle(0);
    setRotateOriginalUri(currentAsset.uri);
    setEditorMode('rotate');
  }, [currentAsset]);

  const applyCropRatio = useCallback((ratioIdx: number) => {
    setCropRatioIdx(ratioIdx);
    const ratio = CROP_RATIOS[ratioIdx].value;
    if (ratio === null) {
      setCropBox({ x: imageLayout.x, y: imageLayout.y, w: imageLayout.w, h: imageLayout.h });
      return;
    }
    let w = imageLayout.w;
    let h = w / ratio;
    if (h > imageLayout.h) {
      h = imageLayout.h;
      w = h * ratio;
    }
    const x = imageLayout.x + (imageLayout.w - w) / 2;
    const y = imageLayout.y + (imageLayout.h - h) / 2;
    setCropBox({ x, y, w, h });
  }, [imageLayout]);

  const applyCrop = useCallback(async () => {
    if (!currentAsset) return;
    setProcessing(true);
    try {
      const ImageManipulator = await import('expo-image-manipulator');
      const imgW = currentAsset.width || imageLayout.w;
      const imgH = currentAsset.height || imageLayout.h;
      const scaleX = imgW / imageLayout.w;
      const scaleY = imgH / imageLayout.h;
      const originX = Math.max(0, (cropBox.x - imageLayout.x) * scaleX);
      const originY = Math.max(0, (cropBox.y - imageLayout.y) * scaleY);
      const cw = Math.min(imgW - originX, cropBox.w * scaleX);
      const ch = Math.min(imgH - originY, cropBox.h * scaleY);
      const result = await ImageManipulator.manipulateAsync(
        currentAsset.uri,
        [{ crop: { originX, originY, width: cw, height: ch } }],
        { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
      );
      setAssets(prev => prev.map(a =>
        a.id === currentAsset.id
          ? { ...a, uri: result.uri, width: result.width, height: result.height }
          : a
      ));
      setEditorMode('none');
    } catch {}
    setProcessing(false);
  }, [currentAsset, imageLayout, cropBox]);

  const applyTrim = useCallback(() => {
    if (!currentAsset) return;
    hapticLight();
    setAssets(prev => prev.map(a =>
      a.id === currentAsset.id
        ? { ...a, trimStart: trimValues.start, trimEnd: trimValues.end }
        : a
    ));
    setEditorMode('none');
  }, [currentAsset, trimValues]);

  const applyRotation = useCallback(async () => {
    if (!currentAsset || rotateAngle === 0) {
      setEditorMode('none');
      return;
    }
    setProcessing(true);
    try {
      const ImageManipulator = await import('expo-image-manipulator');
      const result = await ImageManipulator.manipulateAsync(
        rotateOriginalUri,
        [{ rotate: rotateAngle }],
        { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
      );
      setAssets(prev => prev.map(a =>
        a.id === currentAsset.id
          ? { ...a, uri: result.uri, width: result.width, height: result.height, rotation: ((a.rotation || 0) + rotateAngle) % 360 }
          : a
      ));
      setEditorMode('none');
    } catch {}
    setProcessing(false);
  }, [currentAsset, rotateAngle, rotateOriginalUri]);

  const applyFlipH = useCallback(async () => {
    if (!currentAsset) return;
    setProcessing(true);
    try {
      const ImageManipulator = await import('expo-image-manipulator');
      const result = await ImageManipulator.manipulateAsync(
        currentAsset.uri,
        [{ flip: ImageManipulator.FlipType.Horizontal }],
        { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
      );
      setAssets(prev => prev.map(a =>
        a.id === currentAsset.id
          ? { ...a, uri: result.uri, width: result.width, height: result.height }
          : a
      ));
    } catch {}
    setProcessing(false);
  }, [currentAsset]);

  const applyFilter = useCallback(async () => {
    if (!currentAsset || activeFilter === 'original') {
      setEditorMode('none');
      return;
    }
    const filter = PHOTO_FILTERS.find(f => f.id === activeFilter);
    if (!filter?.matrix) { setEditorMode('none'); return; }
    setProcessing(true);
    try {
      if (Platform.OS === 'web') {
        const img = new (window as any).Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = currentAsset.uri; });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        const m = filter.matrix;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
          d[i]   = Math.min(255, Math.max(0, m[0]*r + m[1]*g + m[2]*b + m[3]*a + m[4]));
          d[i+1] = Math.min(255, Math.max(0, m[5]*r + m[6]*g + m[7]*b + m[8]*a + m[9]));
          d[i+2] = Math.min(255, Math.max(0, m[10]*r + m[11]*g + m[12]*b + m[13]*a + m[14]));
          d[i+3] = Math.min(255, Math.max(0, m[15]*r + m[16]*g + m[17]*b + m[18]*a + m[19]));
        }
        ctx.putImageData(imageData, 0, 0);
        const uri = canvas.toDataURL('image/jpeg', 0.95);
        setAssets(prev => prev.map(a => a.id === currentAsset.id ? { ...a, uri } : a));
      } else {
        const ImageManipulator = await import('expo-image-manipulator');
        const m = filter.matrix;
        const brightness = (m[4] + m[9] + m[14]) / 3;
        const result = await ImageManipulator.manipulateAsync(
          currentAsset.uri,
          [{ resize: { width: currentAsset.width || 2560 } }],
          { compress: brightness > 20 ? 0.85 : 0.95, format: ImageManipulator.SaveFormat.JPEG }
        );
        setAssets(prev => prev.map(a => a.id === currentAsset.id ? { ...a, uri: result.uri, width: result.width, height: result.height } : a));
      }
      setEditorMode('none');
    } catch {}
    setProcessing(false);
  }, [currentAsset, activeFilter]);

  const addStickerOverlay = useCallback((emoji: string) => {
    const sticker = {
      id: `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      emoji,
      x: SCREEN_W / 2 - 25,
      y: SCREEN_H * 0.3,
      size: 50,
    };
    setStickerOverlays(prev => [...prev, sticker]);
  }, [SCREEN_W, SCREEN_H]);

  const removeStickerOverlay = useCallback((id: string) => {
    setStickerOverlays(prev => prev.filter(s => s.id !== id));
  }, []);

  const applyStickerOverlays = useCallback(() => {
    if (!currentAsset || stickerOverlays.length === 0) {
      setEditorMode('none');
      return;
    }
    setAssets(prev => prev.map(a =>
      a.id === currentAsset.id
        ? { ...a, _stickers: [...(a as any)._stickers || [], ...stickerOverlays] }
        : a
    ));
    setEditorMode('none');
  }, [currentAsset, stickerOverlays]);

  const bakeTextOverlays = useCallback(async () => {
    if (!currentAsset || textOverlays.length === 0) {
      setEditorMode('none');
      return;
    }
    setProcessing(true);
    try {
      if (Platform.OS === 'web') {
        const img = new (window as any).Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = currentAsset.uri; });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        const drawAreaW = SCREEN_W;
        const drawAreaH = SCREEN_H * 0.6;
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const areaAspect = drawAreaW / drawAreaH;
        let renderW: number, renderH: number, offsetX: number, offsetY: number;
        if (imgAspect > areaAspect) {
          renderW = drawAreaW;
          renderH = drawAreaW / imgAspect;
          offsetX = 0;
          offsetY = (drawAreaH - renderH) / 2;
        } else {
          renderH = drawAreaH;
          renderW = drawAreaH * imgAspect;
          offsetX = (drawAreaW - renderW) / 2;
          offsetY = 0;
        }
        const scaleX = img.naturalWidth / renderW;
        const scaleY = img.naturalHeight / renderH;

        for (const overlay of textOverlays) {
          const canvasX = (overlay.x - 60 - offsetX) * scaleX;
          const canvasY = (overlay.y - 20 - offsetY) * scaleY + overlay.fontSize * scaleY;
          const scaledFontSize = overlay.fontSize * scaleY;
          ctx.font = `bold ${scaledFontSize}px sans-serif`;
          ctx.fillStyle = overlay.color;
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 3 * scaleY;
          ctx.shadowOffsetX = 1 * scaleX;
          ctx.shadowOffsetY = 1 * scaleY;
          ctx.fillText(overlay.text, canvasX, canvasY);
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }
        const uri = canvas.toDataURL('image/jpeg', 0.95);
        setAssets(prev => prev.map(a => a.id === currentAsset.id ? { ...a, uri } : a));
      } else {
        const ImageManipulator = await import('expo-image-manipulator');
        const result = await ImageManipulator.manipulateAsync(
          currentAsset.uri,
          [{ resize: { width: currentAsset.width || 2560 } }],
          { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
        );
        setAssets(prev => prev.map(a => a.id === currentAsset.id ? { ...a, uri: result.uri } : a));
      }
      setTextOverlays([]);
      setEditorMode('none');
    } catch (e) {
      setEditorMode('none');
    }
    setProcessing(false);
  }, [currentAsset, textOverlays, SCREEN_W, SCREEN_H]);

  const addTextOverlay = useCallback(() => {
    if (!newTextInput.trim()) return;
    const overlay: TextOverlay = {
      id: `text-${Date.now()}`,
      text: newTextInput.trim(),
      x: SCREEN_W / 2,
      y: SCREEN_H * 0.35,
      color: textColor,
      fontSize: 24,
    };
    setTextOverlays(prev => [...prev, overlay]);
    setNewTextInput('');
  }, [newTextInput, textColor, SCREEN_W, SCREEN_H]);

  const removeTextOverlay = useCallback((id: string) => {
    setTextOverlays(prev => prev.filter(t => t.id !== id));
  }, []);

  const moveTextOverlay = useCallback((id: string, dx: number, dy: number) => {
    setTextOverlays(prev => prev.map(t => t.id === id ? { ...t, x: t.x + dx, y: t.y + dy } : t));
  }, []);

  const resizeTextOverlay = useCallback((id: string, newSize: number) => {
    setTextOverlays(prev => prev.map(t => t.id === id ? { ...t, fontSize: Math.max(12, Math.min(80, newSize)) } : t));
  }, []);

  const updateAssetCaption = useCallback((id: string, text: string) => {
    setAssets(prev => prev.map(a =>
      a.id === id ? { ...a, caption: text } : a
    ));
  }, []);

  const cropPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      cropPanLast.current = { dx: 0, dy: 0 };
    },
    onPanResponderMove: (_, g) => {
      const deltaX = g.dx - cropPanLast.current.dx;
      const deltaY = g.dy - cropPanLast.current.dy;
      cropPanLast.current = { dx: g.dx, dy: g.dy };
      setCropBox(prev => {
        let nx = prev.x + deltaX;
        let ny = prev.y + deltaY;
        nx = Math.max(imageLayout.x, Math.min(nx, imageLayout.x + imageLayout.w - prev.w));
        ny = Math.max(imageLayout.y, Math.min(ny, imageLayout.y + imageLayout.h - prev.h));
        return { ...prev, x: nx, y: ny };
      });
    },
    onPanResponderRelease: () => {},
  })).current;
  const cropPanLast = useRef({ dx: 0, dy: 0 });

  const zoomPanLast = useRef({ dist: 0, panX: 0, panY: 0 });
  const zoomPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches?.length >= 1,
    onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches?.length >= 1,
    onPanResponderGrant: () => { zoomPanLast.current = { dist: 0, panX: 0, panY: 0 }; },
    onPanResponderMove: (evt, g) => {
      const touches = evt.nativeEvent.touches;
      if (touches && touches.length >= 2) {
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (zoomPanLast.current.dist > 0) {
          const scaleFactor = dist / zoomPanLast.current.dist;
          setZoomScale(prev => Math.max(1, Math.min(5, prev * scaleFactor)));
        }
        zoomPanLast.current = { ...zoomPanLast.current, dist };
      } else if (zoomScale > 1) {
        const dx = g.dx - zoomPanLast.current.panX;
        const dy = g.dy - zoomPanLast.current.panY;
        zoomPanLast.current = { ...zoomPanLast.current, panX: g.dx, panY: g.dy };
        setPanOffset(prev => ({
          x: Math.max(-SCREEN_W * 0.5, Math.min(SCREEN_W * 0.5, prev.x + dx)),
          y: Math.max(-SCREEN_H * 0.5, Math.min(SCREEN_H * 0.5, prev.y + dy)),
        }));
      }
    },
    onPanResponderRelease: () => {
      if (zoomScale <= 1) setPanOffset({ x: 0, y: 0 });
      zoomPanLast.current = { dist: 0, panX: 0, panY: 0 };
    },
  }), [zoomScale, SCREEN_W, SCREEN_H]);

  const drawPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => editorMode === 'draw',
    onMoveShouldSetPanResponder: () => editorMode === 'draw',
    onPanResponderGrant: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      setCurrentDrawPath({ points: [{ x: locationX, y: locationY }], color: drawColor, width: drawWidth });
    },
    onPanResponderMove: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      setCurrentDrawPath(prev => {
        if (!prev) return prev;
        return { ...prev, points: [...prev.points, { x: locationX, y: locationY }] };
      });
    },
    onPanResponderRelease: () => {
      setCurrentDrawPath(prev => {
        if (prev && prev.points.length > 1) setDrawPaths(paths => [...paths, prev]);
        return null;
      });
    },
  }), [editorMode, drawColor, drawWidth]);

  const rotationScalePan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { rotationPanLast.current = 0; },
    onPanResponderMove: (_, g) => {
      const delta = g.dx - rotationPanLast.current;
      rotationPanLast.current = g.dx;
      setRotateAngle(prev => Math.max(-45, Math.min(45, prev + delta * 0.3)));
    },
  }), []);
  const rotationPanLast = useRef(0);

  const trimLeftLast = useRef(0);
  const trimLeftPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { trimLeftLast.current = 0; },
    onPanResponderMove: (_, g) => {
      const delta = g.dx - trimLeftLast.current;
      trimLeftLast.current = g.dx;
      setTrimValues(prev => {
        const trackW = SCREEN_W - 40;
        const deltaPct = (delta / trackW) * 100;
        const newStart = Math.max(0, Math.min(prev.end - 5, prev.start + deltaPct));
        return { ...prev, start: newStart };
      });
    },
  }), [SCREEN_W]);

  const trimRightLast = useRef(0);
  const trimRightPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { trimRightLast.current = 0; },
    onPanResponderMove: (_, g) => {
      const delta = g.dx - trimRightLast.current;
      trimRightLast.current = g.dx;
      setTrimValues(prev => {
        const trackW = SCREEN_W - 40;
        const deltaPct = (delta / trackW) * 100;
        const newEnd = Math.max(prev.start + 5, Math.min(100, prev.end + deltaPct));
        return { ...prev, end: newEnd };
      });
    },
  }), [SCREEN_W]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems?.length > 0) {
      const idx = viewableItems[0].index ?? 0;
      setActiveIndex(idx);
      setZoomScale(1);
      setPanOffset({ x: 0, y: 0 });
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const renderPreviewItem = useCallback(({ item }: { item: PreviewAsset }) => {
    const slideStyle = { width: SCREEN_W, height: carouselHeight, justifyContent: 'center' as const, alignItems: 'center' as const };
    const mediaStyle = { width: SCREEN_W, height: carouselHeight, borderRadius: 0 };
    const isActive = item.id === currentAsset?.id;
    const transform: any[] = [];
    if (isActive) {
      transform.push({ scale: zoomScale });
      if (zoomScale > 1) transform.push({ translateX: panOffset.x }, { translateY: panOffset.y });
    }
    return (
      <View style={slideStyle} {...zoomPan.panHandlers}>
        {item.mediaType === 'video' ? (
          Platform.OS === 'web' ? (
            // @ts-ignore
            <video
              src={item.uri}
              controls
              playsInline
              muted
              style={{ width: mediaStyle.width, height: mediaStyle.height, objectFit: 'contain', borderRadius: 16 }}
            />
          ) : (
            <ExpoVideo
              ref={isActive ? videoRef : undefined}
              source={{ uri: item.uri }}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay={false}
              isMuted
              style={mediaStyle}
            />
          )
        ) : (
          <ExpoImage
            source={{ uri: item.uri }}
            style={[mediaStyle, { transform }]}
            contentFit="contain"
            cachePolicy="memory"
            transition={150}
          />
        )}
      </View>
    );
  }, [zoomPan, zoomScale, panOffset, currentAsset, carouselHeight, SCREEN_W]);

  if (!visible || initialAssets.length === 0) return null;

  // ---- Draw Editor ----
  if (editorMode === 'draw' && currentAsset) {
    const allPaths = currentDrawPath ? [...drawPaths, currentDrawPath] : drawPaths;
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setEditorMode('none')}>
        <View style={ps.editorContainer}>
          <View style={[ps.editorHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity onPress={() => { setEditorMode('none'); setDrawPaths([]); }} style={ps.headerBtn} activeOpacity={0.7} accessibilityLabel="Отменить рисование">
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
            <Text style={ps.editorTitle}>Рисование</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {drawPaths.length > 0 && (
                <TouchableOpacity onPress={() => setDrawPaths(prev => prev.slice(0, -1))} style={ps.headerBtn} activeOpacity={0.7} accessibilityLabel="Отменить действие">
                  <RotateCcw color="#FFFFFF" size={20} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => { hapticLight(); setEditorMode('none'); }} style={[ps.headerBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7} accessibilityLabel="Применить рисование">
                <Check color="#FFFFFF" size={22} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={ps.drawArea} {...drawPan.panHandlers}>
            <ExpoImage source={{ uri: currentAsset.uri }} style={ps.drawImage} contentFit="contain" />
            {Platform.OS === 'web' && allPaths.length > 0 && (
              // @ts-ignore
              <svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}>
                {allPaths.map((path, i) => {
                  if (path.points.length < 2) return null;
                  const d = path.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                  // @ts-ignore
                  return <path key={i} d={d} stroke={path.color} strokeWidth={path.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
                })}
              </svg>
            )}
            {Platform.OS !== 'web' && allPaths.length > 0 && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                {allPaths.map((path, i) => (
                  path.points.map((point, j) => {
                    if (j === 0) return null;
                    return (
                      <View key={`${i}-${j}`} style={{ position: 'absolute', left: point.x - path.width / 2, top: point.y - path.width / 2, width: path.width, height: path.width, borderRadius: path.width / 2, backgroundColor: path.color }} />
                    );
                  })
                ))}
              </View>
            )}
          </View>
          <View style={[ps.colorPicker, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={ps.brushSizes}>
              {[2, 4, 8, 12].map(w => (
                <TouchableOpacity key={w} onPress={() => { setDrawWidth(w); hapticKeypress(); }} style={[ps.brushBtn, drawWidth === w && { borderColor: '#FFFFFF', borderWidth: 2 }]} activeOpacity={0.7}>
                  <View style={{ width: w + 4, height: w + 4, borderRadius: (w + 4) / 2, backgroundColor: drawColor }} />
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.colorRow}>
              {DRAW_COLORS.map(c => (
                <TouchableOpacity key={c} onPress={() => { setDrawColor(c); hapticKeypress(); }} style={[ps.colorSwatch, { backgroundColor: c }, drawColor === c && ps.colorSwatchActive]} activeOpacity={0.7} />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  // ---- Text Editor ----
  if (editorMode === 'text' && currentAsset) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setEditorMode('none')}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={ps.editorContainer}>
          <View style={[ps.editorHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity onPress={() => { setEditorMode('none'); setTextOverlays([]); }} style={ps.headerBtn} activeOpacity={0.7} accessibilityLabel="Отменить текст">
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
            <Text style={ps.editorTitle}>Текст</Text>
            {processing ? (
              <ActivityIndicator color="#FFFFFF" style={{ width: 40 }} />
            ) : (
              <TouchableOpacity onPress={bakeTextOverlays} style={[ps.headerBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7} accessibilityLabel="Применить текст">
                <Check color="#FFFFFF" size={22} />
              </TouchableOpacity>
            )}
          </View>
          <View style={ps.drawArea}>
            <ExpoImage source={{ uri: currentAsset.uri }} style={ps.drawImage} contentFit="contain" />
            {textOverlays.map(overlay => (
              <DraggableTextOverlay
                key={overlay.id}
                overlay={overlay}
                onMove={(dx, dy) => moveTextOverlay(overlay.id, dx, dy)}
                onResize={(sz) => resizeTextOverlay(overlay.id, sz)}
                onRemove={() => removeTextOverlay(overlay.id)}
              />
            ))}
          </View>
          <View style={[ps.textInputArea, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[ps.colorRow, { marginBottom: 8 }]}>
              {DRAW_COLORS.map(c => (
                <TouchableOpacity key={c} onPress={() => { setTextColor(c); hapticKeypress(); }} style={[ps.colorSwatch, { backgroundColor: c }, textColor === c && ps.colorSwatchActive]} activeOpacity={0.7} />
              ))}
            </ScrollView>
            <View style={ps.fontSizeRow}>
              <Text style={ps.fontSizeLabel}>A</Text>
              <View style={ps.fontSizeTrack}>
                <Pressable
                  style={ps.fontSizeTrackInner}
                  onPress={(e: any) => {
                    const x = e.nativeEvent.locationX || e.nativeEvent.offsetX || 0;
                    const trackW = SCREEN_W - 120;
                    const ratio = Math.max(0, Math.min(1, x / trackW));
                    const sz = Math.round(12 + ratio * 68);
                    if (textOverlays.length > 0) {
                      const last = textOverlays[textOverlays.length - 1];
                      resizeTextOverlay(last.id, sz);
                    }
                  }}
                >
                  <View style={ps.fontSizeTrackBg}>
                    <View style={[ps.fontSizeTrackFill, { width: `${Math.round(((textOverlays.length > 0 ? textOverlays[textOverlays.length - 1].fontSize : 24) - 12) / 68 * 100)}%` }]} />
                  </View>
                </Pressable>
              </View>
              <Text style={ps.fontSizeLabelLg}>A</Text>
            </View>
            <View style={ps.textInputRow}>
              <TextInput style={ps.textEditorInput} placeholder="Введите текст..." placeholderTextColor="rgba(255,255,255,0.4)" value={newTextInput} onChangeText={setNewTextInput} autoFocus maxLength={200} />
              <TouchableOpacity onPress={() => { addTextOverlay(); hapticKeypress(); }} style={[ps.textAddBtn, { backgroundColor: newTextInput.trim() ? colors.primary : 'rgba(255,255,255,0.15)' }]} activeOpacity={0.7} disabled={!newTextInput.trim()} accessibilityLabel="Добавить текст">
                <Check color="#FFFFFF" size={20} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  // ---- Rotate Editor ----
  if (editorMode === 'rotate' && currentAsset) {
    const scaleMarks = [];
    for (let i = -45; i <= 45; i += 5) scaleMarks.push(i);
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setEditorMode('none')}>
        <View style={ps.editorContainer}>
          <View style={[ps.editorHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity onPress={() => setEditorMode('none')} style={ps.headerBtn} activeOpacity={0.7} accessibilityLabel="Отменить поворот">
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
            <Text style={ps.editorTitle}>Поворот</Text>
            {processing ? (
              <ActivityIndicator color="#FFFFFF" style={{ width: 40 }} />
            ) : (
              <TouchableOpacity onPress={() => { hapticLight(); applyRotation(); }} style={[ps.headerBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7} accessibilityLabel="Применить поворот">
                <Check color="#FFFFFF" size={22} />
              </TouchableOpacity>
            )}
          </View>
          <View style={ps.rotatePreviewArea}>
            <View style={[ps.rotateImageWrapper, { transform: [{ rotate: `${rotateAngle}deg` }] }]}>
              <ExpoImage source={{ uri: currentAsset.uri }} style={ps.rotateImage} contentFit="contain" />
            </View>
            <View style={ps.rotateFrame} pointerEvents="none" />
          </View>
          <Text style={ps.angleText}>{rotateAngle.toFixed(1)}</Text>
          <View style={ps.angleScaleContainer} {...rotationScalePan.panHandlers}>
            <View style={ps.angleScale}>
              {scaleMarks.map(mark => (
                <View key={mark} style={ps.scaleMarkContainer}>
                  <View style={[ps.scaleMark, mark % 15 === 0 && ps.scaleMarkMajor, Math.abs(mark - Math.round(rotateAngle)) < 1 && { backgroundColor: '#FFFFFF' }]} />
                  {mark % 15 === 0 && <Text style={ps.scaleLabel}>{mark}</Text>}
                </View>
              ))}
            </View>
            <View style={ps.scaleIndicator} />
          </View>
          <View style={[ps.rotateToolbar, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <TouchableOpacity onPress={() => { setRotateAngle(prev => prev - 90); hapticKeypress(); }} style={ps.rotateToolBtn} activeOpacity={0.7} accessibilityLabel="Повернуть влево">
              <RotateCcw color="rgba(255,255,255,0.8)" size={22} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setRotateAngle(0); hapticKeypress(); }} style={ps.resetBtn} activeOpacity={0.7}>
              <Text style={ps.resetText}>СБРОС</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { rotateCurrentAsset(); hapticKeypress(); }} style={ps.rotateToolBtn} activeOpacity={0.7} accessibilityLabel="Повернуть вправо">
              <RotateCw color="rgba(255,255,255,0.8)" size={22} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { applyFlipH(); hapticKeypress(); }} style={ps.rotateToolBtn} activeOpacity={0.7} disabled={processing} accessibilityLabel="Отразить">
              {processing ? <ActivityIndicator color="rgba(255,255,255,0.7)" size={20} /> : <FlipHorizontal color="rgba(255,255,255,0.8)" size={22} />}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ---- Filter Editor ----
  if (editorMode === 'filter' && currentAsset) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setEditorMode('none')}>
        <View style={ps.editorContainer}>
          <View style={[ps.editorHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity onPress={() => { setEditorMode('none'); setActiveFilter('original'); }} style={ps.headerBtn} activeOpacity={0.7} accessibilityLabel="Отменить фильтр">
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
            <Text style={ps.editorTitle}>Фильтры</Text>
            {processing ? (
              <ActivityIndicator color="#FFFFFF" style={{ width: 40 }} />
            ) : (
              <TouchableOpacity onPress={() => { hapticLight(); applyFilter(); }} style={[ps.headerBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7} accessibilityLabel="Применить фильтр">
                <Check color="#FFFFFF" size={22} />
              </TouchableOpacity>
            )}
          </View>
          <View style={ps.filterPreviewArea}>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <img src={currentAsset.uri} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: activeFilter !== 'original' ? getWebCssFilter(activeFilter) : 'none' }} />
            ) : (
              <ExpoImage source={{ uri: currentAsset.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
            )}
          </View>
          <View style={[ps.filterStrip, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.filterStripContent}>
              {PHOTO_FILTERS.map(f => (
                <TouchableOpacity key={f.id} onPress={() => { setActiveFilter(f.id); hapticKeypress(); }} style={[ps.filterItem, activeFilter === f.id && { borderColor: colors.primary }]} activeOpacity={0.7}>
                  {Platform.OS === 'web' ? (
                    // @ts-ignore
                    <img src={currentAsset.uri} style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', filter: f.id !== 'original' ? getWebCssFilter(f.id) : 'none' }} />
                  ) : (
                    <ExpoImage source={{ uri: currentAsset.uri }} style={ps.filterThumb} contentFit="cover" />
                  )}
                  <Text style={[ps.filterLabel, activeFilter === f.id && { color: colors.primary }]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  // ---- Sticker Editor ----
  if (editorMode === 'sticker' && currentAsset) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setEditorMode('none')}>
        <View style={ps.editorContainer}>
          <View style={[ps.editorHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity onPress={() => { setEditorMode('none'); setStickerOverlays([]); }} style={ps.headerBtn} activeOpacity={0.7} accessibilityLabel="Отменить стикеры">
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
            <Text style={ps.editorTitle}>Стикеры</Text>
            <TouchableOpacity onPress={() => { hapticLight(); applyStickerOverlays(); }} style={[ps.headerBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7} accessibilityLabel="Применить стикеры">
              <Check color="#FFFFFF" size={22} />
            </TouchableOpacity>
          </View>
          <View style={ps.stickerPreviewArea}>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <img src={currentAsset.uri} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <ExpoImage source={{ uri: currentAsset.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
            )}
            {stickerOverlays.map(sticker => (
              <TouchableOpacity
                key={sticker.id}
                onLongPress={() => removeStickerOverlay(sticker.id)}
                style={[ps.stickerOnCanvas, { left: sticker.x, top: sticker.y }]}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: sticker.size }}>{sticker.emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[ps.stickerPanel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.stickerTabsContent}>
              {STICKER_SETS.map((set, idx) => (
                <TouchableOpacity key={set.id} onPress={() => { setActiveStickerSet(idx); hapticKeypress(); }} style={[ps.stickerTab, activeStickerSet === idx && { borderBottomColor: colors.primary }]} activeOpacity={0.7}>
                  <Text style={[ps.stickerTabText, activeStickerSet === idx && { color: colors.primary }]}>{set.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={ps.stickerGrid}>
              {STICKER_SETS[activeStickerSet]?.stickers.map((emoji, i) => (
                <TouchableOpacity key={`${emoji}-${i}`} onPress={() => { addStickerOverlay(emoji); hapticKeypress(); }} style={ps.stickerGridItem} activeOpacity={0.6}>
                  <Text style={ps.stickerGridEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // ---- Crop Editor ----
  if (editorMode === 'crop' && currentAsset) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setEditorMode('none')}>
        <View style={ps.editorContainer}>
          <View style={[ps.editorHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity onPress={() => setEditorMode('none')} style={ps.headerBtn} activeOpacity={0.7} accessibilityLabel="Отменить обрезку">
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
            <Text style={ps.editorTitle}>Обрезка</Text>
            {processing ? (
              <ActivityIndicator color="#FFFFFF" style={{ width: 40 }} />
            ) : (
              <TouchableOpacity onPress={() => { hapticLight(); applyCrop(); }} style={[ps.headerBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7} accessibilityLabel="Применить обрезку">
                <Check color="#FFFFFF" size={22} />
              </TouchableOpacity>
            )}
          </View>
          <View style={ps.cropArea}>
            <ExpoImage source={{ uri: currentAsset.uri }} style={{ position: 'absolute', left: imageLayout.x, top: imageLayout.y, width: imageLayout.w, height: imageLayout.h }} contentFit="contain" />
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={[ps.cropDim, { top: 0, left: 0, right: 0, height: cropBox.y }]} />
              <View style={[ps.cropDim, { top: cropBox.y, left: 0, width: cropBox.x, height: cropBox.h }]} />
              <View style={[ps.cropDim, { top: cropBox.y, left: cropBox.x + cropBox.w, right: 0, height: cropBox.h }]} />
              <View style={[ps.cropDim, { top: cropBox.y + cropBox.h, left: 0, right: 0, bottom: 0 }]} />
            </View>
            <View {...cropPan.panHandlers} style={[ps.cropFrame, { left: cropBox.x, top: cropBox.y, width: cropBox.w, height: cropBox.h }]}>
              <View style={[ps.cropGridH, { top: '33.3%' }]} />
              <View style={[ps.cropGridH, { top: '66.6%' }]} />
              <View style={[ps.cropGridV, { left: '33.3%' }]} />
              <View style={[ps.cropGridV, { left: '66.6%' }]} />
              <View style={[ps.cropCorner, { top: -2, left: -2, borderTopWidth: 3, borderLeftWidth: 3 }]} />
              <View style={[ps.cropCorner, { top: -2, right: -2, borderTopWidth: 3, borderRightWidth: 3 }]} />
              <View style={[ps.cropCorner, { bottom: -2, left: -2, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
              <View style={[ps.cropCorner, { bottom: -2, right: -2, borderBottomWidth: 3, borderRightWidth: 3 }]} />
            </View>
          </View>
          <View style={[ps.ratioBar, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {CROP_RATIOS.map((r, i) => {
              const Icon = r.icon;
              const active = i === cropRatioIdx;
              return (
                <TouchableOpacity key={r.label} style={[ps.ratioBtn, active && { backgroundColor: 'rgba(255,255,255,0.15)' }]} onPress={() => { applyCropRatio(i); hapticKeypress(); }} activeOpacity={0.7}>
                  <Icon color={active ? '#FFFFFF' : 'rgba(255,255,255,0.5)'} size={18} />
                  <Text style={[ps.ratioLabel, active && { color: '#FFFFFF' }]}>{r.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    );
  }

  // ---- Trim Editor (video) ----
  if (editorMode === 'trim' && currentAsset) {
    const trimRange = trimValues.end - trimValues.start;
    const dur = videoDuration || (currentAsset.trimEnd ? 100 : 0);
    const formatTime = (pct: number) => {
      if (!videoDuration) return `${pct.toFixed(0)}%`;
      const secs = Math.round((pct / 100) * videoDuration);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
    };
    const selectedDuration = videoDuration ? ((trimRange / 100) * videoDuration) : 0;
    const formatDuration = (totalSecs: number) => {
      const m = Math.floor(totalSecs / 60);
      const s = Math.round(totalSecs % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const TRACK_MARGIN = 20;

    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => { setEditorMode('none'); setTrimPlaying(false); }}>
        <View style={ps.editorContainer}>
          <View style={[ps.editorHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity onPress={() => { setEditorMode('none'); setTrimPlaying(false); }} style={ps.headerBtn} activeOpacity={0.7}>
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={ps.editorTitle}>Обрезка видео</Text>
              {videoDuration > 0 && (
                <Text style={ps.trimDurationLabel}>{formatDuration(selectedDuration)} из {formatDuration(videoDuration)}</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => { applyTrim(); setTrimPlaying(false); }} style={[ps.headerBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7}>
              <Check color="#FFFFFF" size={22} />
            </TouchableOpacity>
          </View>

          <View style={ps.trimVideoArea}>
            {Platform.OS === 'web' ? (
              <View style={{ width: '100%', height: '100%', position: 'relative' }}>
                {/* @ts-ignore */}
                <video
                  ref={trimVideoRef}
                  src={currentAsset.uri}
                  playsInline
                  muted={trimMuted}
                  onLoadedMetadata={(e: any) => {
                    if (e.target?.duration) setVideoDuration(e.target.duration);
                  }}
                  onTimeUpdate={(e: any) => {
                    if (e.target?.duration) {
                      setTrimProgress((e.target.currentTime / e.target.duration) * 100);
                    }
                  }}
                  onEnded={() => setTrimPlaying(false)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 20 }}
                />
                {!trimPlaying && (
                  <TouchableOpacity
                    style={ps.videoPlayOverlay}
                    onPress={() => {
                      setTrimPlaying(true);
                      trimVideoRef.current?.play?.();
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={ps.videoPlayBtn}>
                      <Play color="#FFFFFF" size={32} fill="#FFFFFF" />
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <ExpoVideo
                ref={videoRef}
                source={{ uri: currentAsset.uri }}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
                shouldPlay={false}
                isMuted={trimMuted}
                onPlaybackStatusUpdate={(status: any) => {
                  if (status.isLoaded) {
                    if (status.durationMillis) setVideoDuration(status.durationMillis / 1000);
                    if (status.positionMillis && status.durationMillis) {
                      setTrimProgress((status.positionMillis / status.durationMillis) * 100);
                    }
                  }
                }}
                style={{ width: '100%', height: '100%', borderRadius: 20 }}
              />
            )}
          </View>

          <View style={ps.trimPlaybackRow}>
            <TouchableOpacity
              onPress={() => { setTrimMuted(!trimMuted); hapticKeypress(); }}
              style={ps.trimControlBtn}
              activeOpacity={0.7}
            >
              {trimMuted ?
                <VolumeX color="rgba(255,255,255,0.6)" size={20} /> :
                <Volume2 color="rgba(255,255,255,0.6)" size={20} />
              }
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                const newPct = Math.max(trimValues.start, trimProgress - 5);
                setTrimProgress(newPct);
                if (Platform.OS === 'web' && trimVideoRef.current && videoDuration) {
                  trimVideoRef.current.currentTime = (newPct / 100) * videoDuration;
                }
              }}
              style={ps.trimControlBtn}
              activeOpacity={0.7}
            >
              <SkipBack color="rgba(255,255,255,0.8)" size={20} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                if (trimPlaying) {
                  setTrimPlaying(false);
                  if (Platform.OS === 'web') trimVideoRef.current?.pause?.();
                } else {
                  setTrimPlaying(true);
                  if (Platform.OS === 'web') trimVideoRef.current?.play?.();
                }
              }}
              style={[ps.trimPlayPauseBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.7}
            >
              {trimPlaying ?
                <Pause color="#FFFFFF" size={22} fill="#FFFFFF" /> :
                <Play color="#FFFFFF" size={22} fill="#FFFFFF" style={{ marginLeft: 2 }} />
              }
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                const newPct = Math.min(trimValues.end, trimProgress + 5);
                setTrimProgress(newPct);
                if (Platform.OS === 'web' && trimVideoRef.current && videoDuration) {
                  trimVideoRef.current.currentTime = (newPct / 100) * videoDuration;
                }
              }}
              style={ps.trimControlBtn}
              activeOpacity={0.7}
            >
              <SkipForward color="rgba(255,255,255,0.8)" size={20} />
            </TouchableOpacity>

            <View style={ps.trimControlBtn} />
          </View>

          <View style={ps.trimTimeRow}>
            <Text style={[ps.trimTimeText, { color: colors.primary }]}>{formatTime(trimValues.start)}</Text>
            <View style={ps.trimSelectedBadge}>
              <Scissors color="rgba(255,255,255,0.7)" size={12} />
              <Text style={ps.trimSelectedText}>
                {videoDuration > 0 ? formatDuration(selectedDuration) : `${trimRange.toFixed(0)}%`}
              </Text>
            </View>
            <Text style={[ps.trimTimeText, { color: colors.primary }]}>{formatTime(trimValues.end)}</Text>
          </View>

          <View style={[ps.trimTimelineContainer, { marginHorizontal: TRACK_MARGIN }]}>
            <View style={ps.trimFrameRow}>
              {Array.from({ length: 12 }).map((_, i) => (
                <View key={i} style={[ps.trimFrameBlock, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
                  {trimFrames[i] ? (
                    Platform.OS === 'web' ? (
                      // @ts-ignore
                      <img src={trimFrames[i]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                    ) : (
                      <ExpoImage source={{ uri: trimFrames[i] }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    )
                  ) : (
                    <View style={[ps.trimFrameInner, { opacity: 0.08 + (i % 2) * 0.04 }]} />
                  )}
                </View>
              ))}
            </View>

            <View style={[ps.trimTimelineInactive, { left: 0, width: `${trimValues.start}%` }]} />
            <View style={[ps.trimTimelineInactive, { right: 0, width: `${100 - trimValues.end}%` }]} />

            <View style={[ps.trimActiveRegion, {
              left: `${trimValues.start}%`,
              width: `${trimRange}%`,
              borderColor: colors.primary,
            }]}>
              <View style={[ps.trimActiveTopBar, { backgroundColor: colors.primary }]} />
              <View style={[ps.trimActiveBottomBar, { backgroundColor: colors.primary }]} />
            </View>

            <View
              style={[ps.trimHandleNew, { left: `${trimValues.start}%`, backgroundColor: colors.primary }]}
              {...trimLeftPan.panHandlers}
            >
              <View style={ps.trimHandleGrip} />
            </View>

            <View
              style={[ps.trimHandleNew, { left: `${trimValues.end}%`, backgroundColor: colors.primary }]}
              {...trimRightPan.panHandlers}
            >
              <View style={ps.trimHandleGrip} />
            </View>

            {trimProgress >= trimValues.start && trimProgress <= trimValues.end && (
              <View style={[ps.trimPlayhead, { left: `${trimProgress}%` }]}>
                <View style={ps.trimPlayheadLine} />
                <View style={ps.trimPlayheadDot} />
              </View>
            )}
          </View>

          <View style={[ps.trimFooter, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <TouchableOpacity
              onPress={() => { setTrimValues({ start: 0, end: 100 }); hapticKeypress(); }}
              style={ps.trimResetBtn}
              activeOpacity={0.7}
            >
              <RotateCcw color="rgba(255,255,255,0.5)" size={16} />
              <Text style={ps.trimResetText}>Сбросить</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ---- Main Preview ----
  const currentCaption = currentAsset?.caption || '';

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleClose}>
      <SwipeToClose onClose={handleClose} style={ps.container}>
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <Animated.View style={[ps.content, { transform: [{ scale: scaleAnim }] }]}>
            <View style={[ps.header, { paddingTop: Math.max(insets.top, 8) }]}>
              <TouchableOpacity onPress={handleClose} style={ps.headerBtn} activeOpacity={0.7} accessibilityLabel="Закрыть">
                <X color="#FFFFFF" size={20} />
              </TouchableOpacity>
              <View style={ps.headerCenter}>
                <Text style={ps.headerTitle}>Предпросмотр</Text>
                {assets.length > 1 && (
                  <View style={ps.counterPill}>
                    <Text style={ps.counterText}>{activeIndex + 1} из {assets.length}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                onPress={() => { setHdMode(!hdMode); hapticKeypress(); }}
                style={[ps.hdBtn, hdMode && { backgroundColor: colors.primary }]}
                activeOpacity={0.7}
              >
                <Sparkles color={hdMode ? '#FFFFFF' : 'rgba(255,255,255,0.5)'} size={14} />
                <Text style={[ps.hdText, hdMode && { color: '#FFFFFF' }]}>HD</Text>
              </TouchableOpacity>
            </View>

            <View style={ps.carouselContainer} onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) setCarouselHeight(h); }}>
              <FlatList
                ref={flatListRef}
                data={assets}
                renderItem={renderPreviewItem}
                keyExtractor={item => item.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
                initialScrollIndex={0}
                style={{ flex: 1 }}
              />

              {assets.length > 1 && activeIndex > 0 && (
                <TouchableOpacity style={[ps.navArrow, ps.navLeft]} onPress={() => scrollToIndex(activeIndex - 1)} activeOpacity={0.7}>
                  <ChevronLeft color="#FFFFFF" size={24} />
                </TouchableOpacity>
              )}
              {assets.length > 1 && activeIndex < assets.length - 1 && (
                <TouchableOpacity style={[ps.navArrow, ps.navRight]} onPress={() => scrollToIndex(activeIndex + 1)} activeOpacity={0.7}>
                  <ChevronRight color="#FFFFFF" size={24} />
                </TouchableOpacity>
              )}
            </View>

            {assets.length > 1 && assets.length <= 10 && (
              <View style={ps.dotsRow}>
                {assets.map((_, i) => (
                  <View key={i} style={[ps.dot, i === activeIndex && { backgroundColor: '#FFFFFF', width: 8, height: 8 }]} />
                ))}
              </View>
            )}

            {currentAsset && (
              <View style={ps.editBar}>
                {currentAsset.mediaType === 'photo' ? (
                  <>
                    <TouchableOpacity style={ps.editBtn} onPress={openCropEditor} activeOpacity={0.7}>
                      <View style={ps.editBtnIcon}>
                        <Crop color="#FFFFFF" size={18} />
                      </View>
                      <Text style={ps.editBtnLabel}>Обрезать</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={ps.editBtn} onPress={openRotateEditor} activeOpacity={0.7}>
                      <View style={ps.editBtnIcon}>
                        <RotateCw color="#FFFFFF" size={18} />
                      </View>
                      <Text style={ps.editBtnLabel}>Повернуть</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={ps.editBtn} onPress={openDrawEditor} activeOpacity={0.7}>
                      <View style={ps.editBtnIcon}>
                        <Pencil color="#FFFFFF" size={18} />
                      </View>
                      <Text style={ps.editBtnLabel}>Рисовать</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={ps.editBtn} onPress={openTextEditor} activeOpacity={0.7}>
                      <View style={ps.editBtnIcon}>
                        <Type color="#FFFFFF" size={18} />
                      </View>
                      <Text style={ps.editBtnLabel}>Текст</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={ps.editBtn} onPress={openFilterEditor} activeOpacity={0.7}>
                      <View style={ps.editBtnIcon}>
                        <SunDim color="#FFFFFF" size={18} />
                      </View>
                      <Text style={ps.editBtnLabel}>Фильтры</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={ps.editBtn} onPress={openStickerEditor} activeOpacity={0.7}>
                      <View style={ps.editBtnIcon}>
                        <Smile color="#FFFFFF" size={18} />
                      </View>
                      <Text style={ps.editBtnLabel}>Стикеры</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity style={ps.editBtn} onPress={openTrimEditor} activeOpacity={0.7}>
                    <View style={ps.editBtnIcon}>
                      <Scissors color="#FFFFFF" size={18} />
                    </View>
                    <Text style={ps.editBtnLabel}>Обрезать видео</Text>
                  </TouchableOpacity>
                )}
                {assets.length > 1 && (
                  <TouchableOpacity style={ps.editBtn} onPress={() => removeAsset(currentAsset.id)} activeOpacity={0.7}>
                    <View style={[ps.editBtnIcon, { backgroundColor: 'rgba(255,59,48,0.2)' }]}>
                      <Trash2 color="#FF3B30" size={18} />
                    </View>
                    <Text style={[ps.editBtnLabel, { color: '#FF3B30' }]}>Удалить</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {assets.length > 1 && (
              <View style={ps.thumbStrip}>
                <ScrollView ref={thumbListRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.thumbContent}>
                  {assets.map((asset, i) => (
                    <TouchableOpacity key={asset.id} onPress={() => scrollToIndex(i)} onLongPress={() => assets.length > 1 && removeAsset(asset.id)} activeOpacity={0.8}>
                      <View style={[ps.thumbWrapper, i === activeIndex && { borderColor: colors.primary }]}>
                        <ExpoImage source={{ uri: asset.uri }} style={ps.thumbImage} contentFit="cover" />
                        {asset.mediaType === 'video' && (
                          <View style={ps.thumbVideoIcon}>
                            <Play color="#FFFFFF" size={12} fill="#FFFFFF" />
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={onAddMore} style={ps.thumbAdd} activeOpacity={0.7}>
                    <ImagePlus color="rgba(255,255,255,0.6)" size={20} />
                  </TouchableOpacity>
                </ScrollView>
              </View>
            )}

            {assets.length === 1 && (
              <TouchableOpacity style={ps.addMoreSingle} onPress={onAddMore} activeOpacity={0.7}>
                <ImagePlus color="rgba(255,255,255,0.7)" size={18} />
                <Text style={ps.addMoreText}>Добавить ещё</Text>
              </TouchableOpacity>
            )}

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[ps.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={ps.captionRow}>
                <TextInput
                  style={ps.captionInput}
                  placeholder="Добавить подпись..."
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  value={assets.length > 1 ? currentCaption : caption}
                  onChangeText={text => {
                    if (assets.length > 1 && currentAsset) {
                      updateAssetCaption(currentAsset.id, text);
                    } else {
                      setCaption(text);
                    }
                  }}
                  multiline
                  maxLength={4096}
                />
                <TouchableOpacity onPress={handleSend} onLongPress={handleScheduleLongPress} delayLongPress={400} style={[ps.sendBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8} accessibilityLabel="Отправить">
                  <Send color="#FFFFFF" size={18} style={{ marginLeft: 2 }} />
                  {assets.length > 1 && (
                    <View style={ps.sendBadge}>
                      <Text style={ps.sendBadgeText}>{assets.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
            </KeyboardAvoidingView>
          </Animated.View>
        </Animated.View>
      </SwipeToClose>
    </Modal>
  );
}

function getWebCssFilter(filterId: string): string {
  switch (filterId) {
    case 'vivid': return 'saturate(1.4) contrast(1.1) brightness(1.05)';
    case 'warm': return 'sepia(0.2) saturate(1.3) brightness(1.05)';
    case 'cool': return 'saturate(0.9) brightness(1.05) hue-rotate(15deg)';
    case 'bw': return 'grayscale(1)';
    case 'sepia': return 'sepia(0.8)';
    case 'vintage': return 'sepia(0.3) contrast(0.9) brightness(0.95) saturate(0.8)';
    case 'drama': return 'contrast(1.4) saturate(1.2) brightness(0.9)';
    case 'fade': return 'contrast(0.85) brightness(1.15) saturate(0.8)';
    case 'noir': return 'grayscale(0.8) contrast(1.3) brightness(0.85)';
    case 'chrome': return 'contrast(1.2) saturate(1.1) brightness(1.1)';
    case 'sunset': return 'sepia(0.15) saturate(1.4) brightness(1.05) hue-rotate(-5deg)';
    default: return 'none';
  }
}

const ps = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 8,
    zIndex: 10,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  counterPill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  counterText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  hdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  hdText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '700',
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  navArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } as any : {}),
  },
  navLeft: { left: 16 },
  navRight: { right: 16 },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  editBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  editBtn: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  editBtnIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  editBtnLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '500',
  },
  thumbStrip: {
    paddingVertical: 6,
  },
  thumbContent: {
    paddingHorizontal: 16,
    gap: THUMB_GAP,
    alignItems: 'center',
  },
  thumbWrapper: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbVideoIcon: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbAdd: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addMoreSingle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 4,
  },
  addMoreText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 26,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
    minHeight: 54,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  captionInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    maxHeight: 100,
    paddingVertical: 0,
    lineHeight: 20,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
  sendBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: '#FF3B30',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.95)',
  },
  sendBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },

  // Editor common
  editorContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  editorTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },

  // Crop
  cropArea: { flex: 1, position: 'relative' },
  cropDim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  cropFrame: { position: 'absolute', borderWidth: 1.5, borderColor: '#FFFFFF' },
  cropGridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.3)' },
  cropGridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.3)' },
  cropCorner: { position: 'absolute', width: 22, height: 22, borderColor: '#FFFFFF' },
  ratioBar: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 16, paddingHorizontal: 12 },
  ratioBtn: { alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  ratioLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '500' },

  // Trim
  trimVideoArea: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  trimDurationLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500', marginTop: 2 },
  videoPlayOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  videoPlayBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}) },
  trimPlaybackRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, paddingVertical: 12 },
  trimControlBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  trimPlayPauseBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  trimTimeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 },
  trimTimeText: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  trimSelectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  trimSelectedText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
  trimTimelineContainer: { height: 56, borderRadius: 10, overflow: 'visible', position: 'relative', marginBottom: 16 },
  trimFrameRow: { flexDirection: 'row', height: '100%', borderRadius: 10, overflow: 'hidden' },
  trimFrameBlock: { flex: 1, height: '100%', justifyContent: 'center', alignItems: 'center' },
  trimFrameInner: { width: '60%', height: '60%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  trimTimelineInactive: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 2 },
  trimActiveRegion: { position: 'absolute', top: 0, bottom: 0, borderWidth: 0, borderLeftWidth: 0, borderRightWidth: 0, zIndex: 3 },
  trimActiveTopBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  trimActiveBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  trimHandleNew: { position: 'absolute', top: -4, width: 18, height: 64, marginLeft: -9, borderRadius: 5, justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  trimHandleGrip: { width: 4, height: 20, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  trimPlayhead: { position: 'absolute', top: -6, bottom: -6, width: 2, marginLeft: -1, zIndex: 4, alignItems: 'center' },
  trimPlayheadLine: { flex: 1, width: 2, backgroundColor: '#FFFFFF', borderRadius: 1 },
  trimPlayheadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF', marginTop: -2 },
  trimFooter: { alignItems: 'center', paddingTop: 4 },
  trimResetBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)' },
  trimResetText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '500' },

  // Draw
  drawArea: { flex: 1, position: 'relative' },
  drawImage: { width: '100%', height: '100%', borderRadius: 16 },
  colorPicker: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  brushSizes: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  brushBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 2, borderColor: 'transparent' },
  colorRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 4, justifyContent: 'center' },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)' },
  colorSwatchActive: { borderColor: '#FFFFFF', borderWidth: 3, transform: [{ scale: 1.15 }] },

  // Text
  textOverlayItem: { position: 'absolute', padding: 8, zIndex: 100 },
  fontSizeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  fontSizeLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600', width: 16, textAlign: 'center' },
  fontSizeLabelLg: { color: 'rgba(255,255,255,0.6)', fontSize: 22, fontWeight: '700', width: 20, textAlign: 'center' },
  fontSizeTrack: { flex: 1 },
  fontSizeTrackInner: { height: 36, justifyContent: 'center' },
  fontSizeTrackBg: { height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  fontSizeTrackFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 2 },
  textInputArea: { paddingHorizontal: 16, paddingTop: 12 },
  textInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 8 },
  textEditorInput: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 4 },
  textAddBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },

  // Rotate
  rotatePreviewArea: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  rotateImageWrapper: { width: '88%', height: '45%', justifyContent: 'center', alignItems: 'center' },
  rotateImage: { width: '100%', height: '100%' },
  rotateFrame: { position: 'absolute', top: 24, left: 24, right: 24, bottom: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  angleText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  angleScaleContainer: { height: 60, marginHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
  angleScale: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  scaleMarkContainer: { alignItems: 'center', width: 12 },
  scaleMark: { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.3)' },
  scaleMarkMajor: { height: 20, backgroundColor: 'rgba(255,255,255,0.6)' },
  scaleLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9, marginTop: 2 },
  scaleIndicator: { position: 'absolute', width: 2, height: 28, backgroundColor: '#2AABEE', borderRadius: 1 },
  rotateToolbar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20, paddingVertical: 16 },
  rotateToolBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  resetBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' },
  resetText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },

  // Filters
  filterPreviewArea: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  filterStrip: { backgroundColor: '#111', paddingTop: 12 },
  filterStripContent: { paddingHorizontal: 12, gap: 10 },
  filterItem: { alignItems: 'center', borderWidth: 2, borderColor: 'transparent', borderRadius: 12, padding: 3 },
  filterThumb: { width: 64, height: 64, borderRadius: 8 },
  filterLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500', marginTop: 4 },

  // Stickers
  stickerPreviewArea: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  stickerOnCanvas: { position: 'absolute', zIndex: 100 },
  stickerPanel: { backgroundColor: '#111', paddingTop: 8 },
  stickerTabsContent: { paddingHorizontal: 12, gap: 16 },
  stickerTab: { paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  stickerTabText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  stickerGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingTop: 10, gap: 4 },
  stickerGridItem: { width: 64, height: 56, justifyContent: 'center', alignItems: 'center' },
  stickerGridEmoji: { fontSize: 32 },
});

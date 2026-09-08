import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Animated, Platform, Image } from 'react-native';
import { Play } from 'lucide-react-native';
import CachedImage from './CachedImage';
import Svg, { Circle } from 'react-native-svg';
import { usePerformance } from '@/lib/performance-context';
import { Video as ExpoVideo, ResizeMode } from 'expo-av';

const MAX_W = 280;
const MAX_H = 380;
const MIN_H = 100;
const GAP = 2;

function useSingleMediaHeight(item: MediaItem): number {
  const [h, setH] = useState(item.message_type === 'video' ? Math.round(MAX_W * 0.65) : Math.round(MAX_W * 0.75));

  useEffect(() => {
    if (!item.media_url) return;
    if (item.message_type === 'image') {
      if (Platform.OS === 'web') {
        const img = new (window as any).Image();
        img.onload = () => {
          if (img.naturalWidth && img.naturalHeight) {
            const ratio = img.naturalWidth / img.naturalHeight;
            setH(Math.round(Math.min(MAX_H, Math.max(MIN_H, MAX_W / ratio))));
          }
        };
        img.src = item.media_url;
      } else {
        Image.getSize(item.media_url, (w, imgH) => {
          if (w && imgH) {
            const ratio = w / imgH;
            setH(Math.round(Math.min(MAX_H, Math.max(MIN_H, MAX_W / ratio))));
          }
        }, () => {});
      }
    }
  }, [item.media_url, item.message_type]);

  return h;
}

export interface MediaItem {
  id: string;
  media_url: string | null;
  message_type: 'image' | 'video';
  isUploading?: boolean;
  uploadProgress?: number;
}

interface MediaCollageProps {
  items: MediaItem[];
  onPress: (index: number) => void;
  onLongPress?: () => void;
  maxWidth?: number;
  respectAutoDownload?: boolean;
  borderRadius?: number;
  fixedAspectRatio?: number;
  autoPlayVideo?: boolean;
}

function getLayout(count: number): { rows: number[][]; aspectRatio: number } {
  switch (count) {
    case 2: return { rows: [[0, 1]], aspectRatio: 2.0 };
    case 3: return { rows: [[0], [1, 2]], aspectRatio: 1.0 };
    case 4: return { rows: [[0, 1], [2, 3]], aspectRatio: 1.0 };
    case 5: return { rows: [[0, 1], [2, 3, 4]], aspectRatio: 1.0 };
    case 6: return { rows: [[0, 1, 2], [3, 4, 5]], aspectRatio: 1.0 };
    case 7: return { rows: [[0, 1], [2, 3, 4], [5, 6]], aspectRatio: 0.8 };
    case 8: return { rows: [[0, 1, 2], [3, 4], [5, 6, 7]], aspectRatio: 0.8 };
    case 9: return { rows: [[0, 1, 2], [3, 4, 5], [6, 7, 8]], aspectRatio: 0.75 };
    case 10: return { rows: [[0, 1], [2, 3, 4], [5, 6], [7, 8, 9]], aspectRatio: 0.6 };
    default: return { rows: [[0]], aspectRatio: 1.4 };
  }
}

const VideoThumbnail = memo(function VideoThumbnail({ url, width, height, autoPlay }: { url: string; width: number; height: number; autoPlay?: boolean }) {
  const perf = usePerformance();
  if (Platform.OS === 'web') {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0F1923' }]}>
        {/* @ts-ignore */}
        <video
          src={autoPlay ? url : `${url}#t=0.1`}
          muted
          playsInline
          autoPlay={autoPlay}
          loop={autoPlay}
          preload={autoPlay ? 'auto' : perf.videoPreload}
          style={{
            position: 'absolute', top: 0, left: 0, width, height,
            objectFit: 'cover', backgroundColor: '#0F1923',
          } as any}
        />
      </View>
    );
  }

  if (autoPlay) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0F1923' }]}>
        <ExpoVideo
          source={{ uri: url }}
          style={{ position: 'absolute', top: 0, left: 0, width, height }}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping
          isMuted
          useNativeControls={false}
        />
      </View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0F1923' }]}>
      <CachedImage
        uri={url}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
    </View>
  );
});

function SkeletonPlaceholder() {
  const perf = usePerformance();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (perf.reducedMotion || !perf.enableShimmer) {
      anim.setValue(0.45);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [perf.reducedMotion, perf.enableShimmer]);
  return (
    <Animated.View style={[s.skeleton, { opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] }) }]} />
  );
}

function UploadOverlay({ progress }: { progress: number }) {
  const circumference = 2 * Math.PI * 20;
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <View style={s.uploadOverlay}>
      {Platform.OS === 'web' ? (
        // @ts-ignore
        <svg width={48} height={48}>
          {/* @ts-ignore */}
          <circle cx={24} cy={24} r={20} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={2.5} />
          {/* @ts-ignore */}
          <circle
            cx={24} cy={24} r={20} fill="none" stroke="#FFFFFF" strokeWidth={2.5}
            strokeDasharray={circumference} strokeDashoffset={dashOffset}
            strokeLinecap="round" transform="rotate(-90 24 24)"
            style={{ transition: 'stroke-dashoffset 0.4s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
      ) : (
        <Svg width={48} height={48}>
          <Circle cx={24} cy={24} r={20} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={2.5} />
          <Circle cx={24} cy={24} r={20} fill="none" stroke="#FFFFFF" strokeWidth={2.5}
            strokeDasharray={`${circumference}`} strokeDashoffset={dashOffset}
            strokeLinecap="round" rotation={-90} origin="24,24"
          />
        </Svg>
      )}
      <Text style={s.uploadText}>{Math.round(progress)}%</Text>
    </View>
  );
}

function MediaCellContent({ item, cellWidth, cellHeight, showBadge = true, autoPlay }: { item: MediaItem; cellWidth: number; cellHeight: number; showBadge?: boolean; autoPlay?: boolean }) {
  if (!item.media_url) return <SkeletonPlaceholder />;

  if (item.message_type === 'video') {
    return (
      <>
        <VideoThumbnail url={item.media_url} width={cellWidth} height={cellHeight} autoPlay={autoPlay} />
        {showBadge && !autoPlay && (
          <View style={s.videoIconBadge}>
            <Play color="#FFFFFF" size={9} fill="#FFFFFF" />
          </View>
        )}
      </>
    );
  }

  return <CachedImage uri={item.media_url} style={StyleSheet.absoluteFill} contentFit="cover" respectAutoDownload mediaType="photo" />;
}

const PressableCell = memo(function PressableCell({
  item, cellWidth, cellHeight, index, onPress, onLongPress, showBadge = true, autoPlay,
}: { item: MediaItem; cellWidth: number; cellHeight: number; index: number; onPress: (i: number) => void; onLongPress?: () => void; showBadge?: boolean; autoPlay?: boolean }) {
  const perf = usePerformance();
  const [scaleAnim] = useState(() => new Animated.Value(1));

  const onPressIn = useCallback(() => {
    if (perf.reducedMotion) return;
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, friction: 8, tension: 120 }).start();
  }, [scaleAnim, perf.reducedMotion]);

  const onPressOut = useCallback(() => {
    if (perf.reducedMotion) return;
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }).start();
  }, [scaleAnim, perf.reducedMotion]);

  const handlePress = useCallback(() => { onPress(index); }, [onPress, index]);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={handlePress}
      onLongPress={onLongPress}
      delayLongPress={300}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityLabel={"Медиа " + (index + 1)}
    >
      <Animated.View style={{ width: cellWidth, height: cellHeight, overflow: 'hidden', transform: [{ scale: scaleAnim }] }}>
        <MediaCellContent item={item} cellWidth={cellWidth} cellHeight={cellHeight} showBadge={showBadge} autoPlay={autoPlay} />
        {item.isUploading && <UploadOverlay progress={item.uploadProgress || 0} />}
      </Animated.View>
    </TouchableOpacity>
  );
});

const SingleMediaCollage = memo(function SingleMediaCollage({ item, maxWidth, onPress, onLongPress, borderRadius, fixedAspectRatio, autoPlay }: { item: MediaItem; maxWidth: number; onPress: (i: number) => void; onLongPress?: () => void; borderRadius?: number; fixedAspectRatio?: number; autoPlay?: boolean }) {
  const dynamicH = useSingleMediaHeight(item);
  const cellHeight = fixedAspectRatio ? Math.round(maxWidth / fixedAspectRatio) : dynamicH;
  const [measuredW, setMeasuredW] = useState(0);
  const effectiveW = measuredW > 0 ? measuredW : maxWidth;
  const scaledH = fixedAspectRatio ? Math.round(effectiveW / fixedAspectRatio) : Math.round(cellHeight * (effectiveW / maxWidth));
  const radius = borderRadius !== undefined ? borderRadius : 16;
  return (
    <View
      style={[s.single, { width: '100%', maxWidth, borderRadius: radius }]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== measuredW) setMeasuredW(w);
      }}
    >
      <PressableCell
        item={item}
        cellWidth={effectiveW}
        cellHeight={scaledH}
        index={0}
        onPress={onPress}
        onLongPress={onLongPress}
        showBadge={false}
        autoPlay={autoPlay}
      />
      {item.message_type === 'video' && item.media_url && !autoPlay && (
        <View style={s.videoOverlaySingle} pointerEvents="none">
          <View style={s.playIconSingle}>
            <Play color="#FFFFFF" size={20} fill="#FFFFFF" style={{ marginLeft: 2 }} />
          </View>
        </View>
      )}
    </View>
  );
});

export default memo(function MediaCollage({ items, onPress, onLongPress, maxWidth = 280, borderRadius, fixedAspectRatio, autoPlayVideo }: MediaCollageProps) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  if (items.length === 0) return null;

  if (items.length === 1) {
    return <SingleMediaCollage item={items[0]} maxWidth={maxWidth} onPress={onPress} onLongPress={onLongPress} borderRadius={borderRadius} fixedAspectRatio={fixedAspectRatio} autoPlay={autoPlayVideo} />;
  }
  const radius = borderRadius !== undefined ? borderRadius : 16;

  const effectiveW = measuredWidth > 0 ? measuredWidth : maxWidth;
  const { rows, aspectRatio } = getLayout(items.length);
  const totalHeight = effectiveW / aspectRatio;
  const rowHeight = (totalHeight - GAP * (rows.length - 1)) / rows.length;

  return (
    <View
      style={[s.container, { width: '100%', maxWidth, borderRadius: radius }]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== measuredWidth) setMeasuredWidth(w);
      }}
    >
      {rows.map((row, ri) => (
        <View key={ri} style={[s.row, { height: rowHeight, marginTop: ri > 0 ? GAP : 0 }]}>
          {row.map((idx, ci) => {
            const item = items[idx];
            if (!item) return null;
            const cellWidth = (effectiveW - GAP * (row.length - 1)) / row.length;
            return (
              <View key={item.id} style={{ marginLeft: ci > 0 ? GAP : 0 }}>
                <PressableCell
                  item={item}
                  cellWidth={cellWidth}
                  cellHeight={rowHeight}
                  index={idx}
                  onPress={onPress}
                  onLongPress={onLongPress}
                  autoPlay={autoPlayVideo}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const s = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 6px rgba(0,0,0,0.08)' },
      default: { elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } },
    }),
  },
  row: { flexDirection: 'row' },
  single: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 6px rgba(0,0,0,0.08)' },
      default: { elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } },
    }),
  },
  skeleton: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1C2C3A',
  },
  videoOverlaySingle: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIconSingle: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({
      web: {
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
      },
      default: { elevation: 4 },
    }),
  },
  videoIconBadge: {
    position: 'absolute',
    bottom: 5, left: 5,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({
      web: { backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' },
      default: {},
    }),
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },

  uploadText: {
    color: '#FFFFFF', fontSize: 11, fontWeight: '700',
    position: 'absolute',
    fontVariant: ['tabular-nums'],
  },
});

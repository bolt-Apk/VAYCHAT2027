import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Image } from 'expo-image';
import { StyleProp, ImageStyle, TouchableOpacity, View, Text, StyleSheet, Platform, Animated } from 'react-native';
import { Download, Play, FileDown } from 'lucide-react-native';
import { getStorageSettings } from '@/lib/storage-settings';
import { usePerformance } from '@/lib/performance-context';

interface CachedImageProps {
  uri: string;
  style: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain' | 'fill';
  respectAutoDownload?: boolean;
  mediaType?: 'photo' | 'video' | 'file';
  fileSizeBytes?: number;
}

const cfgKeyForMediaType = { photo: 'photos', video: 'videos', file: 'files' } as const;

function useAutoDownloadAllowed(enabled: boolean, mediaType: 'photo' | 'video' | 'file') {
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    getStorageSettings().then((s) => {
      const cfg = s.autoDownloadWifi;
      setAllowed(cfg[cfgKeyForMediaType[mediaType]]);
    });
  }, [enabled, mediaType]);

  return allowed;
}

function useIsInViewport() {
  const [isVisible, setIsVisible] = useState(Platform.OS !== 'web');
  const ref = useRef<View>(null);

  const setRef = useCallback((node: View | null) => {
    (ref as any).current = node;
    if (Platform.OS !== 'web' || !node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const domNode = (node as any)._nativeTag || node;
    if (!(domNode instanceof Element)) {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px', threshold: 0 }
    );
    observer.observe(domNode);
  }, []);

  return { ref: setRef, isVisible };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

const PlaceholderIcon = { photo: Download, video: Play, file: FileDown };

export default memo(function CachedImage({
  uri, style, contentFit = 'cover', respectAutoDownload = false,
  mediaType = 'photo', fileSizeBytes,
}: CachedImageProps) {
  const perf = usePerformance();
  const autoDownloadAllowed = useAutoDownloadAllowed(respectAutoDownload, mediaType);
  const [manualLoad, setManualLoad] = useState(false);
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const { ref: viewportRef, isVisible } = useIsInViewport();

  const shouldLoad = (!respectAutoDownload || autoDownloadAllowed || manualLoad) && isVisible;
  const useShimmer = perf.enableShimmer && !perf.reducedMotion;

  useEffect(() => {
    if (!shouldLoad || loaded || !useShimmer) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shouldLoad, loaded, useShimmer]);

  if (!shouldLoad && !isVisible) {
    return (
      <View ref={viewportRef as any} style={[style as any, ss.shimmer, { opacity: 0.5 }]} />
    );
  }

  if (!shouldLoad) {
    const Icon = PlaceholderIcon[mediaType];
    return (
      <TouchableOpacity
        ref={viewportRef as any}
        style={[style as any, ss.placeholder]}
        onPress={() => setManualLoad(true)}
        activeOpacity={0.8}
      >
        <View style={ss.downloadBtn}>
          <Icon size={20} color="#FFFFFF" />
        </View>
        {fileSizeBytes != null && fileSizeBytes > 0 && (
          <Text style={ss.sizeText}>{formatSize(fileSizeBytes)}</Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View ref={viewportRef as any} style={[style as any, { overflow: 'hidden' }]}>
      {!loaded && useShimmer && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            ss.shimmer,
            { opacity: shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.65] }) },
          ]}
        />
      )}
      {!loaded && !useShimmer && <View style={[StyleSheet.absoluteFill, ss.shimmer, { opacity: 0.5 }]} />}
      {errored && Platform.OS === 'web' ? (
        <img src={uri} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: contentFit === 'contain' ? 'contain' : 'cover' }} onLoad={() => setLoaded(true)} />
      ) : (
        <Image
          source={{ uri, width: perf.tier === 'low' ? 320 : undefined }}
          style={[StyleSheet.absoluteFill]}
          contentFit={contentFit}
          cachePolicy="memory-disk"
          transition={perf.reducedMotion ? 0 : 200}
          recyclingKey={uri}
          fadeDuration={perf.reducedMotion ? 0 : 200}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
    </View>
  );
});

const ss = StyleSheet.create({
  placeholder: {
    backgroundColor: '#131B24',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  downloadBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      web: { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' },
      default: {},
    }),
  },
  sizeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 6,
  },
  shimmer: {
    backgroundColor: '#1C2C3A',
    borderRadius: 16,
    zIndex: 1,
  },
});

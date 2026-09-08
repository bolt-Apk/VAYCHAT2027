import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import {
  View, Text, Modal, FlatList, TouchableOpacity, StyleSheet,
  Platform, Animated, PanResponder, StatusBar,
  ViewToken, ListRenderItemInfo, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { X, Play, Pause, Volume2, VolumeX } from 'lucide-react-native';
import { Image } from 'expo-image';
import { Video as ExpoVideo, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwipeToClose from './SwipeToClose';

const CONTROLS_TIMEOUT = 3500;
const DOUBLE_TAP_DELAY = 300;
const IS_WEB = Platform.OS === 'web';
const MAX_ZOOM = 4;

function formatGalleryDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Сегодня, ${time}`;
    if (isYesterday) return `Вчера, ${time}`;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + `, ${time}`;
  } catch {
    return dateStr;
  }
}

interface MediaItem {
  id: string; url: string; type: 'image' | 'video';
  senderName?: string; date?: string; caption?: string; duration?: number;
}

interface MediaGalleryViewerProps {
  visible: boolean;
  items: MediaItem[];
  initialIndex: number;
  onClose: () => void;
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
};

/* ─── ZoomableImage ───────────────────────────────────────── */

const ZoomableImage = memo(function ZoomableImage({ url, isActive, SW, SH, onTap }: { url: string; isActive: boolean; SW: number; SH: number; onTap: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const tX = useRef(new Animated.Value(0)).current;
  const tY = useRef(new Animated.Value(0)).current;
  const base = useRef({ scale: 1, x: 0, y: 0 });
  const pinch = useRef({ dist: 0, startScale: 1 });
  const lastTap = useRef(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!isActive) {
      base.current = { scale: 1, x: 0, y: 0 };
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
        Animated.spring(tX, { toValue: 0, useNativeDriver: true }),
        Animated.spring(tY, { toValue: 0, useNativeDriver: true }),
      ]).start();
    }
  }, [isActive, scale, tX, tY]);

  const dist = (t: any[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const doubleTap = useCallback(() => {
    const target = base.current.scale > 1 ? 1 : 2;
    base.current = { scale: target, x: 0, y: 0 };
    Animated.parallel([
      Animated.spring(scale, { toValue: target, useNativeDriver: true }),
      Animated.spring(tX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(tY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }, [scale, tX, tY]);

  const pr = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => base.current.scale > 1,
    onMoveShouldSetPanResponder: (_, g) => base.current.scale > 1 || g.numberActiveTouches === 2,
    onPanResponderGrant: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length === 2) { pinch.current = { dist: dist(t as any), startScale: base.current.scale }; }
    },
    onPanResponderMove: (e, g) => {
      const t = e.nativeEvent.touches;
      if (t.length === 2 && pinch.current.dist > 0) {
        const ns = clamp(pinch.current.startScale * (dist(t as any) / pinch.current.dist), 1, MAX_ZOOM);
        scale.setValue(ns);
        base.current.scale = ns;
      } else if (base.current.scale > 1) {
        const mx = ((base.current.scale - 1) * SW) / 2;
        const my = ((base.current.scale - 1) * SH) / 2;
        tX.setValue(clamp(base.current.x + g.dx, -mx, mx));
        tY.setValue(clamp(base.current.y + g.dy, -my, my));
      }
    },
    onPanResponderRelease: (_, g) => {
      if (base.current.scale <= 1) {
        base.current = { scale: 1, x: 0, y: 0 };
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
          Animated.spring(tX, { toValue: 0, useNativeDriver: true }),
          Animated.spring(tY, { toValue: 0, useNativeDriver: true }),
        ]).start();
      } else {
        const mx = ((base.current.scale - 1) * SW) / 2;
        const my = ((base.current.scale - 1) * SH) / 2;
        base.current.x = clamp(base.current.x + g.dx, -mx, mx);
        base.current.y = clamp(base.current.y + g.dy, -my, my);
      }
      pinch.current.dist = 0;
    },
  }), [scale, tX, tY, SW, SH]);

  const onPress = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_DELAY) {
      doubleTap();
    } else {
      onTap();
    }
    lastTap.current = now;
  }, [doubleTap, onTap]);

  return (
    <Animated.View style={[sty.media, { width: SW, height: SH, transform: [{ scale }, { translateX: tX }, { translateY: tY }] }]} {...pr.panHandlers}>
      <TouchableOpacity activeOpacity={1} onPress={onPress} style={sty.fill}>
        <Image
          source={{ uri: url }}
          style={{ width: SW, height: SH }}
          contentFit="contain"
          transition={250}
          cachePolicy="memory-disk"
          onError={() => setLoadError(true)}
        />
        {loadError && (
          <View style={sty.errorState}>
            <Text style={sty.errorText}>Не удалось загрузить</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

/* ─── GalleryVideoPlayer ──────────────────────────────────── */

const GalleryVideoPlayer = memo(function GalleryVideoPlayer({
  url, isActive, controlsVisible, SW, SH, onTap, bottomOffset, onScrubbing,
}: { url: string; isActive: boolean; controlsVisible: boolean; SW: number; SH: number; onTap: () => void; bottomOffset: number; onScrubbing?: (active: boolean) => void }) {
  const videoRef = useRef<ExpoVideo>(null);
  const webRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPos, setScrubPos] = useState(0);
  const barW = useRef(0);
  const barX = useRef(0);
  const lastPosUpdate = useRef(0);

  useEffect(() => {
    if (!isActive) {
      setPlaying(false);
      if (IS_WEB) webRef.current?.pause();
      else videoRef.current?.pauseAsync?.().catch(() => {});
    } else {
      const timer = setTimeout(() => {
        if (IS_WEB && webRef.current) {
          webRef.current.play().then(() => setPlaying(true)).catch(() => {});
        } else {
          videoRef.current?.playAsync?.().then(() => setPlaying(true)).catch(() => {});
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  useEffect(() => {
    if (!IS_WEB || !isActive) return;
    const onToggle = () => { togglePlayRef.current?.(); };
    document.addEventListener('gallery-toggle-play', onToggle);
    return () => document.removeEventListener('gallery-toggle-play', onToggle);
  }, [isActive]);
  const togglePlayRef = useRef<(() => void) | null>(null);

  const togglePlay = useCallback(async () => {
    if (IS_WEB) {
      const v = webRef.current;
      if (!v) return;
      if (v.paused) {
        try { await v.play(); setPlaying(true); } catch {}
      } else {
        v.pause();
        setPlaying(false);
      }
    } else {
      if (playing) {
        await videoRef.current?.pauseAsync?.();
        setPlaying(false);
      } else {
        await videoRef.current?.playAsync?.();
        setPlaying(true);
      }
    }
  }, [playing]);

  useEffect(() => { togglePlayRef.current = togglePlay; }, [togglePlay]);

  const toggleMute = useCallback(() => {
    if (IS_WEB && webRef.current) webRef.current.muted = !muted;
    else videoRef.current?.setIsMutedAsync?.(!muted);
    setMuted((m) => !m);
  }, [muted]);

  const seekToPosition = useCallback((pageX: number) => {
    if (!barW.current || barW.current <= 0 || !dur || dur <= 0) return;
    const pct = Math.max(0, Math.min(1, (pageX - barX.current) / barW.current));
    const to = pct * dur;
    if (!isFinite(to)) return;
    setScrubPos(to);
    scrubPosRef.current = to;
    if (IS_WEB && webRef.current) {
      webRef.current.currentTime = to / 1000;
    } else {
      videoRef.current?.setPositionAsync?.(to, { toleranceMillisBefore: 100, toleranceMillisAfter: 100 });
    }
  }, [dur]);

  const scrubPosRef = useRef(0);
  const seekToPositionRef = useRef(seekToPosition);
  useEffect(() => { seekToPositionRef.current = seekToPosition; }, [seekToPosition]);


  const onScrubbingRef = useRef(onScrubbing);
  useEffect(() => { onScrubbingRef.current = onScrubbing; }, [onScrubbing]);

  const scrubPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      setScrubbing(true);
      onScrubbingRef.current?.(true);
      if (IS_WEB && webRef.current) webRef.current.pause();
      else videoRef.current?.pauseAsync?.().catch(() => {});
      setPlaying(false);
      seekToPositionRef.current(e.nativeEvent.pageX);
    },
    onPanResponderMove: (e) => {
      seekToPositionRef.current(e.nativeEvent.pageX);
    },
    onPanResponderRelease: () => {
      setScrubbing(false);
      onScrubbingRef.current?.(false);
      setPos(scrubPosRef.current);
      if (IS_WEB && webRef.current) {
        webRef.current.play().then(() => setPlaying(true)).catch(() => {});
      } else {
        videoRef.current?.playAsync?.().then(() => setPlaying(true)).catch(() => {});
      }
    },
    onPanResponderTerminate: () => {
      setScrubbing(false);
      onScrubbingRef.current?.(false);
      setPos(scrubPosRef.current);
    },
  }), []);


  const onTimeUpdateThrottled = useCallback(() => {
    if (scrubbing) return;
    const now = Date.now();
    if (now - lastPosUpdate.current < 250) return;
    lastPosUpdate.current = now;
    const v = webRef.current;
    if (v) { setPos(v.currentTime * 1000); setDur((v.duration || 0) * 1000); }
  }, [scrubbing]);

  const onStatus = useCallback((st: AVPlaybackStatus) => {
    if (!st.isLoaded || scrubbing) return;
    const now = Date.now();
    if (now - lastPosUpdate.current < 250 && !st.didJustFinish) return;
    lastPosUpdate.current = now;
    setPos(st.positionMillis);
    setDur(st.durationMillis ?? 0);
    setPlaying(st.isPlaying);
    setBuffering(st.isBuffering);
  }, [scrubbing]);

  const displayPos = scrubbing ? scrubPos : pos;
  const pct = dur > 0 ? displayPos / dur : 0;

  return (
    <TouchableOpacity activeOpacity={1} onPress={onTap} style={[sty.media, { width: SW, height: SH }]}>
      {IS_WEB ? (
        <video
          ref={(el: HTMLVideoElement | null) => { webRef.current = el; }}
          src={url}
          style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: 'transparent' } as any}
          playsInline
          autoPlay
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => { if (!scrubbing) setPlaying(false); }}
          onTimeUpdate={onTimeUpdateThrottled}
          onLoadedMetadata={() => { const v = webRef.current; if (v) setDur((v.duration || 0) * 1000); }}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onSeeked={() => { if (scrubbing) setBuffering(false); }}
        />
      ) : (
        <ExpoVideo ref={videoRef} source={{ uri: url }} style={sty.fill}
          resizeMode={ResizeMode.CONTAIN} shouldPlay={false} isLooping={false}
          progressUpdateIntervalMillis={200}
          onPlaybackStatusUpdate={onStatus} />
      )}
      {controlsVisible && (
        <View style={sty.vidOverlay} pointerEvents="box-none">
          <TouchableOpacity style={sty.playCircle} onPress={togglePlay} accessibilityLabel={playing ? "Пауза" : "Воспроизведение"}>
            {buffering ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : playing ? (
              <Pause size={48} color="#fff" fill="#fff" />
            ) : (
              <Play size={48} color="#fff" fill="#fff" />
            )}
          </TouchableOpacity>
          <View style={[sty.vidBar, { bottom: 120 + bottomOffset }]}>
            <Text style={sty.time}>{fmt(displayPos / 1000)}</Text>
            <View
              style={sty.seekOuter}
              onLayout={(e) => {
                barW.current = e.nativeEvent.layout.width;
                if (IS_WEB) {
                  const node = e.target as unknown as HTMLElement;
                  if (node?.getBoundingClientRect) {
                    barX.current = node.getBoundingClientRect().left;
                  }
                } else {
                  (e.target as any)?.measureInWindow?.((x: number) => { barX.current = x; });
                }
              }}
            >
              <View style={sty.seekTouchScrub} {...scrubPan.panHandlers}>
                <View style={sty.seekTrack}>
                  <View style={[sty.seekFill, { width: `${pct * 100}%` }]} />
                  <View style={[sty.seekThumb, { left: `${pct * 100}%` }, scrubbing && sty.seekThumbActive]} />
                </View>
              </View>
            </View>
            <Text style={sty.time}>{fmt(dur / 1000)}</Text>
            <TouchableOpacity onPress={toggleMute} style={sty.muteBtn} accessibilityLabel={muted ? "Включить звук" : "Выключить звук"}>
              {muted ? <VolumeX size={20} color="#fff" /> : <Volume2 size={20} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
});

/* ─── GallerySlide (decouples active/controls state from parent) ── */

const GallerySlide = memo(function GallerySlide({
  item, index, activeIdxRef, showUIRef, SW, SH, toggleUI, bottomOffset, onScrubbing,
}: {
  item: MediaItem; index: number;
  activeIdxRef: React.MutableRefObject<number>;
  showUIRef: React.MutableRefObject<boolean>;
  SW: number; SH: number; toggleUI: () => void; bottomOffset: number;
  onScrubbing?: (active: boolean) => void;
}) {
  const [isActive, setIsActive] = useState(index === activeIdxRef.current);
  const [controlsVisible, setControlsVisible] = useState(index === activeIdxRef.current && showUIRef.current);

  useEffect(() => {
    const interval = setInterval(() => {
      const active = index === activeIdxRef.current;
      const controls = active && showUIRef.current;
      setIsActive(prev => prev !== active ? active : prev);
      setControlsVisible(prev => prev !== controls ? controls : prev);
    }, 150);
    return () => clearInterval(interval);
  }, [index, activeIdxRef, showUIRef]);

  if (item.type === 'video') {
    return (
      <View style={[sty.slide, { width: SW, height: SH }]}>
        <GalleryVideoPlayer url={item.url} isActive={isActive} controlsVisible={controlsVisible} SW={SW} SH={SH} onTap={toggleUI} bottomOffset={bottomOffset} onScrubbing={onScrubbing} />
      </View>
    );
  }
  return (
    <View style={[sty.slide, { width: SW, height: SH }]}>
      <ZoomableImage url={item.url} isActive={isActive} SW={SW} SH={SH} onTap={toggleUI} />
    </View>
  );
}, (prev, next) => prev.item.id === next.item.id && prev.SW === next.SW && prev.SH === next.SH && prev.bottomOffset === next.bottomOffset);

/* ─── MediaGalleryViewer ──────────────────────────────────── */

export default function MediaGalleryViewer({
  visible, items, initialIndex, onClose,
}: MediaGalleryViewerProps) {
  const { width: SW, height: SH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(initialIndex);
  const [showUI, setShowUI] = useState(true);
  const idxRef = useRef(initialIndex);
  const showUIRef = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList>(null);
  const rootFade = useRef(new Animated.Value(0)).current;
  const uiFade = useRef(new Animated.Value(1)).current;

  useEffect(() => { idxRef.current = idx; }, [idx]);
  useEffect(() => { showUIRef.current = showUI; }, [showUI]);

  const close = useCallback(() => {
    Animated.timing(rootFade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => onClose());
  }, [rootFade, onClose]);

  useEffect(() => {
    if (visible) {
      setIdx(initialIndex);
      idxRef.current = initialIndex;
      setShowUI(true);
      showUIRef.current = true;
      uiFade.setValue(1);
      Animated.timing(rootFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      setTimeout(() => listRef.current?.scrollToIndex({ index: initialIndex, animated: false }), 50);
    } else {
      rootFade.setValue(0);
    }
  }, [visible, initialIndex, rootFade, uiFade]);

  useEffect(() => {
    if (!visible || !IS_WEB) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIdx((prev) => {
          const next = Math.max(prev - 1, 0);
          listRef.current?.scrollToIndex({ index: next, animated: true });
          return next;
        });
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIdx((prev) => {
          const next = Math.min(prev + 1, items.length - 1);
          listRef.current?.scrollToIndex({ index: next, animated: true });
          return next;
        });
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const cur = items[idxRef.current];
        if (cur?.type === 'video') {
          document.dispatchEvent(new CustomEvent('gallery-toggle-play'));
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, items, close]);

  const scrubbingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const resetTimer = useCallback(() => {
    clearTimer();
    if (scrubbingRef.current) return;
    timer.current = setTimeout(() => {
      if (scrubbingRef.current) return;
      setShowUI(false);
      Animated.timing(uiFade, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    }, CONTROLS_TIMEOUT);
  }, [clearTimer, uiFade]);

  const onScrubbing = useCallback((active: boolean) => {
    scrubbingRef.current = active;
    if (active) {
      clearTimer();
    } else {
      resetTimer();
    }
  }, [clearTimer, resetTimer]);

  useEffect(() => {
    if (showUI) resetTimer();
    return clearTimer;
  }, [showUI, resetTimer, clearTimer]);

  const toggleUI = useCallback(() => {
    setShowUI(prev => {
      if (prev) {
        clearTimer();
        Animated.timing(uiFade, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        return false;
      } else {
        Animated.timing(uiFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        return true;
      }
    });
  }, [clearTimer, uiFade]);

  const cur = items[idx] ?? items[0];

  const onView = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length && viewableItems[0].index != null) setIdx(viewableItems[0].index);
  }).current;
  const viewCfg = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const renderItem = useCallback(({ item, index: i }: ListRenderItemInfo<MediaItem>) => (
    <GallerySlide
      item={item}
      index={i}
      activeIdxRef={idxRef}
      showUIRef={showUIRef}
      SW={SW}
      SH={SH}
      toggleUI={toggleUI}
      bottomOffset={insets.bottom}
      onScrubbing={onScrubbing}
    />
  ), [SW, SH, toggleUI, onScrubbing]);

  const keyEx = useCallback((it: MediaItem) => it.id, []);
  const layout = useCallback((_: any, i: number) => ({ length: SW, offset: SW * i, index: i }), [SW]);

  if (!visible || !items.length) return null;

  const galleryContent = (
    <View style={sty.container}>
      <FlatList ref={listRef} data={items} renderItem={renderItem} keyExtractor={keyEx}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false} getItemLayout={layout}
        initialScrollIndex={initialIndex} onViewableItemsChanged={onView}
        viewabilityConfig={viewCfg} windowSize={3} maxToRenderPerBatch={2}
        removeClippedSubviews={!IS_WEB}
        initialNumToRender={1}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index: info.index, animated: false });
          }, 100);
        }}
      />

      <Animated.View style={[sty.topBar, { paddingTop: insets.top + 8, opacity: uiFade }]} pointerEvents={showUI ? 'auto' : 'none'}>
        <TouchableOpacity onPress={close} style={sty.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel="Закрыть">
          <X size={22} color="#fff" />
        </TouchableOpacity>
        <View style={sty.topCenter}>
          {cur?.senderName ? <Text style={sty.sender} numberOfLines={1}>{cur.senderName}</Text> : null}
          {cur?.date ? <Text style={sty.date} numberOfLines={1}>{formatGalleryDate(cur.date)}</Text> : null}
        </View>
        <Text style={sty.counter}>{idx + 1} / {items.length}</Text>
      </Animated.View>

      <Animated.View style={[sty.bottomBar, { paddingBottom: insets.bottom + 12, opacity: uiFade }]} pointerEvents={showUI ? 'auto' : 'none'}>
        {cur?.caption ? <Text style={sty.caption} numberOfLines={2}>{cur.caption}</Text> : null}
      </Animated.View>

      {items.length > 1 && items.length <= 10 && (
        <Animated.View style={[sty.dots, { bottom: insets.bottom + 70, opacity: uiFade }]} pointerEvents="none">
          {items.map((_, i) => <View key={i} style={[sty.dot, i === idx && sty.dotActive]} />)}
        </Animated.View>
      )}

      {IS_WEB && !showUI && (
        <TouchableOpacity
          onPress={close}
          style={[sty.webCloseAlways, { top: insets.top + 12 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Закрыть"
        >
          <X size={20} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <Animated.View style={[sty.root, { opacity: rootFade }]}>
        {IS_WEB ? galleryContent : (
          <SwipeToClose onClose={close}>
            {galleryContent}
          </SwipeToClose>
        )}
      </Animated.View>
    </Modal>
  );
}

/* ─── Styles ──────────────────────────────────────────────── */

const sty = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1 },
  fill: { width: '100%', height: '100%' },
  slide: { justifyContent: 'center', alignItems: 'center' },
  media: { justifyContent: 'center', alignItems: 'center' },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    ...Platform.select({
      web: { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
      default: {},
    }) as any,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  topCenter: { flex: 1, marginHorizontal: 12 },
  sender: { color: '#fff', fontSize: 15, fontWeight: '600' },
  date: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1 },
  counter: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500' },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    ...Platform.select({
      web: { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
      default: {},
    }) as any,
  },
  caption: { color: '#fff', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: '#fff', width: 8, height: 8, borderRadius: 4 },

  vidOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  playCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  vidBar: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, gap: 8,
  },
  time: { color: '#fff', fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 36 },
  seekOuter: { flex: 1, height: 32, justifyContent: 'center' },
  seekTouchScrub: { flex: 1, justifyContent: 'center', paddingVertical: 12 },
  seekTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 1.5, overflow: 'visible', position: 'relative' as const },
  seekFill: { height: '100%', backgroundColor: '#fff', borderRadius: 1.5 },
  seekThumb: { position: 'absolute' as const, top: -5, width: 13, height: 13, borderRadius: 7, backgroundColor: '#fff', marginLeft: -6.5, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 3 },
  seekThumbActive: { width: 17, height: 17, borderRadius: 9, marginLeft: -8.5, top: -7, backgroundColor: '#4FC3F7' },
  muteBtn: { padding: 4 },
  errorState: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '500',
  },
  webCloseAlways: {
    position: 'absolute',
    right: 16,
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    ...Platform.select({
      web: {
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        cursor: 'pointer',
        transition: 'opacity 0.2s ease',
      },
      default: {},
    }) as any,
  },
});

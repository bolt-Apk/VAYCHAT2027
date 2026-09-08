import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, Animated, Text, Easing } from 'react-native';
import { Play, Pause, Volume2, VolumeX, AlertCircle } from 'lucide-react-native';
import { Video as ExpoVideo, ResizeMode, AVPlaybackStatus } from 'expo-av';

const SIZE = 220;
const RING_SIZE = SIZE + 10;
const STROKE_WIDTH = 3;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// ── Fix 1: Removed dead `messageId` prop ──
interface VideoNotePlayerProps {
  url: string;
  duration: number;
}

// ── Fix 5: Visibility hook (auto-pause when scrolled off-screen) ──
function useIsVisible() {
  const [isVisible, setIsVisible] = useState(Platform.OS !== 'web');
  const ref = useRef<View>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) {
      setIsVisible(true);
      return;
    }
    const node = ref.current as any;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '200px', threshold: 0.1 }
    );
    const domNode = node._nativeTag || node;
    if (domNode instanceof Element) {
      observer.observe(domNode);
    } else {
      setIsVisible(true);
      return;
    }
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

// ── Fix 3: Native progress ring component ──
function NativeProgressRing({
  progress,
  playing,
  ringOpacity,
}: {
  progress: number;
  playing: boolean;
  ringOpacity: Animated.AnimatedInterpolation<number>;
}) {
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 150,
      useNativeDriver: true,
      easing: Easing.linear,
    }).start();
  }, [progress, progressAnim]);

  const color = playing ? '#25D366' : '#2AABEE';

  // Right half rotation: for progress 0→0.5, rotate from -180deg to 0deg
  const rightRotate = progressAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-180deg', '0deg', '0deg'],
    extrapolate: 'clamp',
  });

  // Left half rotation: for progress 0.5→1, rotate from -180deg to 0deg
  const leftRotate = progressAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-180deg', '-180deg', '0deg'],
    extrapolate: 'clamp',
  });

  const halfSize = RING_SIZE / 2;

  return (
    <Animated.View style={[styles.nativeRingOuter, { opacity: ringOpacity }]}>
      {/* Background ring */}
      <View style={styles.nativeRingBg} />

      {/* Right half (0-50% progress) */}
      <View style={[styles.halfContainer, styles.halfRight]}>
        <Animated.View
          style={{
            width: RING_SIZE,
            height: RING_SIZE,
            borderRadius: halfSize,
            borderWidth: STROKE_WIDTH,
            borderTopColor: 'transparent',
            borderRightColor: color,
            borderBottomColor: color,
            borderLeftColor: 'transparent',
            position: 'absolute',
            left: 0,
            transform: [{ rotate: rightRotate }],
          }}
        />
      </View>

      {/* Left half (50-100% progress) */}
      <View style={[styles.halfContainer, styles.halfLeft]}>
        <Animated.View
          style={{
            width: RING_SIZE,
            height: RING_SIZE,
            borderRadius: halfSize,
            borderWidth: STROKE_WIDTH,
            borderTopColor: color,
            borderRightColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: color,
            position: 'absolute',
            right: 0,
            transform: [{ rotate: leftRotate }],
          }}
        />
      </View>
    </Animated.View>
  );
}

// ── Fix 1: Removed `messageId` from destructuring ──
export default memo(function VideoNotePlayer({ url, duration }: VideoNotePlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  // ── Fix 6: Error state ──
  const [error, setError] = useState(false);

  // ── Fix 5: Visibility detection ──
  const { ref: visibilityRef, isVisible } = useIsVisible();

  const playIconOpacity = useRef(new Animated.Value(1)).current;
  const playIconScale = useRef(new Animated.Value(1)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const muteScale = useRef(new Animated.Value(1)).current;
  const ringGlow = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const videoRef = useRef<any>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const animFrameRef = useRef<number>(0);

  const animatePlayPause = useCallback((toPlaying: boolean) => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(playIconScale, { toValue: 0.6, duration: 80, useNativeDriver: true }),
        Animated.spring(playIconScale, { toValue: 1, tension: 200, friction: 10, useNativeDriver: true }),
      ]),
      Animated.timing(overlayOpacity, {
        toValue: toPlaying ? 0 : 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [playIconScale, overlayOpacity]);

  const showOverlayBriefly = useCallback(() => {
    overlayOpacity.setValue(1);
    Animated.timing(overlayOpacity, { toValue: 0, duration: 600, delay: 400, useNativeDriver: true }).start();
  }, [overlayOpacity]);

  // Ring glow pulse while playing
  useEffect(() => {
    if (playing) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(ringGlow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(ringGlow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      ringGlow.stopAnimation();
      ringGlow.setValue(0);
    }
  }, [playing, ringGlow]);

  // Subtle scale pulse on first render to draw attention
  useEffect(() => {
    if (!hasInteracted) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.02, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [hasInteracted, pulseAnim]);

  // ── Fix 5: Auto-pause when scrolled off-screen ──
  useEffect(() => {
    if (!isVisible && playing) {
      if (Platform.OS === 'web') {
        const v = webVideoRef.current;
        if (v) v.pause();
      } else {
        const v = videoRef.current;
        if (v) v.pauseAsync();
      }
      setPlaying(false);
      animatePlayPause(false);
    }
  }, [isVisible, playing, animatePlayPause]);

  const togglePlay = useCallback(async () => {
    if (!hasInteracted) setHasInteracted(true);

    if (Platform.OS === 'web') {
      const v = webVideoRef.current;
      if (!v) return;
      if (playing) {
        v.pause();
        setPlaying(false);
        animatePlayPause(false);
      } else {
        try {
          await v.play();
          setPlaying(true);
          animatePlayPause(true);
        } catch {}
      }
    } else {
      const v = videoRef.current;
      if (!v) return;
      if (playing) {
        await v.pauseAsync();
        setPlaying(false);
        animatePlayPause(false);
      } else {
        await v.playAsync();
        setPlaying(true);
        animatePlayPause(true);
      }
    }
  }, [playing, animatePlayPause, hasInteracted]);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    showOverlayBriefly();
    Animated.sequence([
      Animated.timing(muteScale, { toValue: 0.7, duration: 80, useNativeDriver: true }),
      Animated.spring(muteScale, { toValue: 1, tension: 200, friction: 10, useNativeDriver: true }),
    ]).start();
    if (Platform.OS === 'web') {
      if (webVideoRef.current) webVideoRef.current.muted = next;
    } else {
      if (videoRef.current) await videoRef.current.setIsMutedAsync(next);
    }
  }, [muted, showOverlayBriefly, muteScale]);

  // Web progress tracking via rAF
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const update = () => {
      const v = webVideoRef.current;
      if (v && v.duration && !isNaN(v.duration)) {
        const p = v.currentTime / v.duration;
        setProgress(p);
        setCurrentTime(v.currentTime);
      }
      animFrameRef.current = requestAnimationFrame(update);
    };
    if (playing) {
      animFrameRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [playing]);

  // ── Fix 4: Removed dead `onEnded` listener (loop=true means 'ended' never fires) ──
  // ── Fix 6: Added 'error' event listener ──
  const vnListenersRef = useRef<{
    el: HTMLVideoElement;
    loaded: () => void;
    seeked: () => void;
    error: () => void;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (vnListenersRef.current) {
        const { el, loaded: onLoad, seeked, error: onError } = vnListenersRef.current;
        el.removeEventListener('loadeddata', onLoad);
        el.removeEventListener('seeked', seeked);
        el.removeEventListener('error', onError);
      }
    };
  }, []);

  const handleWebVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (vnListenersRef.current) {
      const prev = vnListenersRef.current;
      prev.el.removeEventListener('loadeddata', prev.loaded);
      prev.el.removeEventListener('seeked', prev.seeked);
      prev.el.removeEventListener('error', prev.error);
      vnListenersRef.current = null;
    }
    webVideoRef.current = el;
    if (el) {
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.preload = 'auto';
      const onLoaded = () => {
        setLoaded(true);
        // ── Fix 2: `el.paused` instead of `!el.paused === false` ──
        // Seek to tiny offset to force browser to render first frame (only when paused)
        if (el.currentTime === 0 && el.paused) {
          el.currentTime = 0.001;
        }
      };
      const onSeeked = () => {
        // First frame is now visible
        setLoaded(true);
      };
      // ── Fix 6: Error listener ──
      const onError = () => {
        setError(true);
      };
      el.addEventListener('loadeddata', onLoaded);
      el.addEventListener('seeked', onSeeked);
      el.addEventListener('error', onError);
      vnListenersRef.current = { el, loaded: onLoaded, seeked: onSeeked, error: onError };
    }
  }, []);

  const handleNativeStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      // ── Fix 6: Native error check ──
      if (status.error) {
        setError(true);
      }
      return;
    }
    if (!loaded) setLoaded(true);
    const dur = status.durationMillis || (duration * 1000);
    if (dur > 0) {
      setProgress((status.positionMillis || 0) / dur);
      setCurrentTime((status.positionMillis || 0) / 1000);
    }
    if (status.didJustFinish) {
      setPlaying(false);
      setProgress(0);
      setCurrentTime(0);
      animatePlayPause(false);
    }
  }, [loaded, duration, animatePlayPause]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  const displayTime = playing || currentTime > 0
    ? formatTime(currentTime)
    : formatTime(duration || 0);

  const ringOpacity = ringGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });

  // Video source with #t=0.001 fragment to force first-frame poster on web
  const videoSrc = Platform.OS === 'web' && url ? `${url}#t=0.001` : url;

  return (
    <Animated.View
      ref={visibilityRef}
      style={[styles.wrapper, { transform: [{ scale: pulseAnim }] }]}
    >
      {/* Progress ring */}
      <View style={styles.ringContainer}>
        {Platform.OS === 'web' ? (
          // @ts-ignore
          <svg width={RING_SIZE} height={RING_SIZE} style={{ position: 'absolute', top: 0, left: 0 }}>
            {/* Background ring */}
            {/* @ts-ignore */}
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={STROKE_WIDTH}
            />
            {/* Progress arc */}
            {/* @ts-ignore */}
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={playing ? '#25D366' : '#2AABEE'}
              strokeWidth={STROKE_WIDTH}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              style={{ transition: 'stroke-dashoffset 0.15s linear, stroke 0.3s ease' }}
            />
          </svg>
        ) : (
          // ── Fix 3: Animated native progress ring ──
          <NativeProgressRing
            progress={progress}
            playing={playing}
            ringOpacity={ringOpacity}
          />
        )}
      </View>

      {/* Video circle */}
      <View style={styles.videoCircle}>
        {/* Gradient placeholder while loading */}
        {!loaded && !error && (
          <View style={styles.loadingPlaceholder}>
            <View style={styles.loadingShimmer} />
          </View>
        )}

        {/* ── Fix 6: Error state ── */}
        {error ? (
          <View style={styles.errorContainer}>
            <AlertCircle color="#FF6B6B" size={32} />
            <Text style={styles.errorText}>Failed to load</Text>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={togglePlay}
            style={styles.touchArea}
            accessibilityLabel={playing ? 'Pause video' : 'Play video'}
          >
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <video
                ref={handleWebVideoRef}
                src={videoSrc}
                loop
                muted
                playsInline
                preload="auto"
                style={{
                  width: SIZE,
                  height: SIZE,
                  objectFit: 'cover',
                  borderRadius: SIZE / 2,
                  pointerEvents: 'none',
                  display: 'block',
                  backgroundColor: 'transparent',
                }}
              />
            ) : (
              <ExpoVideo
                ref={videoRef}
                source={{ uri: url }}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
                isLooping
                isMuted={muted}
                onPlaybackStatusUpdate={handleNativeStatus}
                style={styles.nativeVideo}
              />
            )}

            {/* Play/Pause overlay */}
            <Animated.View style={[styles.playOverlay, { opacity: overlayOpacity }]}>
              <Animated.View style={[styles.playBtn, { transform: [{ scale: playIconScale }] }]}>
                {playing ? (
                  <Pause color="#FFFFFF" size={22} fill="#FFFFFF" />
                ) : (
                  <Play color="#FFFFFF" size={24} fill="#FFFFFF" style={{ marginLeft: 2 }} />
                )}
              </Animated.View>
            </Animated.View>
          </TouchableOpacity>
        )}

        {/* ── Fix 7: accessibilityLabel on mute button ── */}
        {hasInteracted && !error && (
          <TouchableOpacity
            style={styles.muteBtn}
            onPress={toggleMute}
            activeOpacity={0.7}
            accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
          >
            <Animated.View style={{ transform: [{ scale: muteScale }] }}>
              {muted ? (
                <VolumeX color="#FFFFFF" size={12} />
              ) : (
                <Volume2 color="#FFFFFF" size={12} />
              )}
            </Animated.View>
          </TouchableOpacity>
        )}

        {/* Duration badge */}
        {!error && (
          <View style={styles.durationBadge}>
            <View style={[styles.durationPill, playing && styles.durationPillActive]}>
              {playing && <View style={styles.durationDot} />}
              <Text style={styles.durationText}>{displayTime}</Text>
            </View>
          </View>
        )}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RING_SIZE,
    height: RING_SIZE,
  },
  // ── Fix 3: Native progress ring styles ──
  nativeRingOuter: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeRingBg: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: STROKE_WIDTH,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  halfContainer: {
    position: 'absolute',
    width: RING_SIZE / 2,
    height: RING_SIZE,
    overflow: 'hidden',
  },
  halfRight: {
    right: 0,
  },
  halfLeft: {
    left: 0,
  },

  videoCircle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#1A1D23',
  },
  loadingPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#1A2332',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingShimmer: {
    width: SIZE * 0.6,
    height: SIZE * 0.6,
    borderRadius: SIZE * 0.3,
    backgroundColor: 'rgba(42, 171, 238, 0.08)',
  },
  touchArea: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
  },
  nativeVideo: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: SIZE / 2,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  muteBtn: {
    position: 'absolute',
    bottom: 28,
    right: 14,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  durationPillActive: {
    backgroundColor: 'rgba(37, 211, 102, 0.25)',
  },
  durationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#25D366',
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  // ── Fix 6: Error state styles ──
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1D23',
    borderRadius: SIZE / 2,
    gap: 8,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 12,
    fontWeight: '600',
  },
});

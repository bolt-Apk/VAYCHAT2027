import { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  View, TouchableOpacity, StyleSheet, Platform, Text,
  Animated, Modal, Pressable, Dimensions, ActivityIndicator,
} from 'react-native';
import { Play, Pause, Maximize2, Minimize2, X, Volume2, VolumeX, Square, RotateCcw, RotateCw, RefreshCw, PictureInPicture2 } from 'lucide-react-native';
import { Video as ExpoVideo, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwipeToClose from './SwipeToClose';
import NativeSvg, { Circle as NativeCircle } from 'react-native-svg';

const THUMB_W = 280;
const MAX_THUMB_H = 380;
const MIN_THUMB_H = 120;
const DEFAULT_THUMB_H = 200;

const PROGRESS_INTERVAL = 250;
const SKIP_SECONDS = 10;
const PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2] as const;

const savedPositions = new Map<string, number>();

interface ChatVideoPlayerProps {
  url: string;
  duration?: number;
  isUploading?: boolean;
  uploadProgress?: number;
  isDownloading?: boolean;
  downloadProgress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  onCancelDownload?: () => void;
  onLongPress?: () => void;
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

function useScreenDimensions() {
  const [dims, setDims] = useState(() => Dimensions.get('window'));
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDims(window));
    return () => sub.remove();
  }, []);
  return dims;
}

function useIsVisible() {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<View>(null);
  const observerRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) {
      setIsVisible(true);
      return;
    }
    const node = (ref.current as any);
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
    observerRef.current = observer;
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

export default memo(function ChatVideoPlayer({
  url, duration = 0, isUploading, uploadProgress = 0,
  isDownloading, downloadProgress = 0, downloadedBytes = 0, totalBytes = 0,
  onCancelDownload, onLongPress,
}: ChatVideoPlayerProps) {
  const insets = useSafeAreaInsets();
  const { ref: visibilityRef, isVisible } = useIsVisible();
  const visibleRef = useRef(isVisible);
  visibleRef.current = isVisible;
  const { width: screenW } = useScreenDimensions();
  const [thumbH, setThumbH] = useState(DEFAULT_THUMB_H);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const [progress, setProgress] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsPlaying, setFsPlaying] = useState(false);
  const [fsMuted, setFsMuted] = useState(false);
  const [fsProgress, setFsProgress] = useState(0);
  const [fsBuffered, setFsBuffered] = useState(0);
  const [fsCurrentTime, setFsCurrentTime] = useState(0);
  const [fsTotalDuration, setFsTotalDuration] = useState(duration);
  const [seeking, setSeeking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [fsBuffering, setFsBuffering] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);
  const [skipIndicator, setSkipIndicator] = useState<'forward' | 'backward' | null>(null);
  const [longPressSpeed, setLongPressSpeed] = useState(false);
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [inlineControlsVisible, setInlineControlsVisible] = useState(true);
  const overlayAnim = useRef(new Animated.Value(1)).current;
  const inlineControlsAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const skipAnim = useRef(new Animated.Value(0)).current;
  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const nativeVideoRef = useRef<any>(null);
  const fsWebVideoRef = useRef<HTMLVideoElement | null>(null);
  const seekBarLayoutRef = useRef<{ x: number; width: number }>({ x: 0, width: 0 });
  const fsNativeRef = useRef<any>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fsProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inlineHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' | null }>({ time: 0, side: null });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedSpeedRef = useRef<number>(1);

  // Restore saved position on mount
  useEffect(() => {
    const saved = savedPositions.get(url);
    if (saved && saved > 0) {
      setCurrentTime(saved);
      setProgress(totalDuration ? saved / totalDuration : 0);
      if (Platform.OS === 'web') {
        const v = webVideoRef.current;
        if (v && v.readyState >= 1) v.currentTime = saved;
      }
    }
  }, [url]);

  // Save position on unmount
  useEffect(() => {
    return () => {
      if (currentTime > 1) {
        savedPositions.set(url, currentTime);
        if (savedPositions.size > 50) {
          const oldestKey = savedPositions.keys().next().value;
          if (oldestKey !== undefined) savedPositions.delete(oldestKey);
        }
      }
    };
  }, [url, currentTime]);

  // Auto-play (muted) when scrolled into view, auto-pause when scrolled off
  useEffect(() => {
    if (!isVisible && playing) {
      if (Platform.OS === 'web') {
        webVideoRef.current?.pause();
      } else {
        nativeVideoRef.current?.pauseAsync();
      }
      setPlaying(false);
      animatePlayState(false);
    } else if (isVisible && !playing && !fullscreen && !isUploading && !isDownloading) {
      if (Platform.OS === 'web') {
        const v = webVideoRef.current;
        if (v && v.readyState >= 2) {
          v.muted = true;
          setMuted(true);
          v.play().then(() => {
            setPlaying(true);
            animatePlayState(true);
          }).catch(() => {});
        } else if (v) {
          const onCanPlay = () => {
            v.removeEventListener('canplay', onCanPlay);
            if (!visibleRef.current) return;
            v.muted = true;
            setMuted(true);
            v.play().then(() => {
              setPlaying(true);
              animatePlayState(true);
            }).catch(() => {});
          };
          v.addEventListener('canplay', onCanPlay);
          return () => v.removeEventListener('canplay', onCanPlay);
        }
      } else {
        const v = nativeVideoRef.current;
        if (v) {
          v.setIsMutedAsync(true).then(() => {
            setMuted(true);
            return v.playAsync();
          }).then(() => {
            setPlaying(true);
            animatePlayState(true);
          }).catch(() => {});
        }
      }
    }
  }, [isVisible]);

  useEffect(() => {
    if (loaded) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [loaded]);

  const animatePlayState = useCallback((toPlaying: boolean) => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.75, duration: 60, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 4, tension: 100 }),
    ]).start();
    Animated.timing(overlayAnim, {
      toValue: toPlaying ? 0 : 1,
      duration: toPlaying ? 300 : 150,
      delay: toPlaying ? 200 : 0,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim, overlayAnim]);

  const showInlineControls = useCallback(() => {
    if (inlineHideTimerRef.current) clearTimeout(inlineHideTimerRef.current);
    setInlineControlsVisible(true);
    Animated.timing(inlineControlsAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    inlineHideTimerRef.current = setTimeout(() => {
      Animated.timing(inlineControlsAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setInlineControlsVisible(false));
    }, 3000);
  }, [inlineControlsAnim]);

  const getWebBuffered = useCallback((v: HTMLVideoElement): number => {
    if (!v.duration || !isFinite(v.duration) || v.buffered.length === 0) return 0;
    let maxEnd = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime) {
        maxEnd = Math.max(maxEnd, v.buffered.end(i));
      }
    }
    return maxEnd / v.duration;
  }, []);

  const togglePlay = useCallback(async () => {
    if (isDownloading) return;
    showInlineControls();
    if (Platform.OS === 'web') {
      const v = webVideoRef.current;
      if (!v) return;
      if (playing) { v.pause(); setPlaying(false); setBuffering(false); animatePlayState(false); }
      else { setBuffering(true); setPlaying(true); animatePlayState(true); try { await v.play(); } catch { setPlaying(false); setBuffering(false); animatePlayState(false); } }
    } else {
      const v = nativeVideoRef.current;
      if (!v) return;
      if (playing) { await v.pauseAsync(); setPlaying(false); animatePlayState(false); }
      else { await v.playAsync(); setPlaying(true); animatePlayState(true); }
    }
  }, [playing, animatePlayState, isDownloading, showInlineControls]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (playing) {
      progressIntervalRef.current = setInterval(() => {
        const v = webVideoRef.current;
        if (v && v.duration && !isNaN(v.duration)) {
          setProgress(v.currentTime / v.duration);
          setCurrentTime(v.currentTime);
          setBuffered(getWebBuffered(v));
          if (!totalDuration) setTotalDuration(v.duration);
        }
      }, PROGRESS_INTERVAL);
    }
    return () => { if (progressIntervalRef.current) clearInterval(progressIntervalRef.current); };
  }, [playing, getWebBuffered]);

  const webListenersRef = useRef<{ el: HTMLVideoElement; cleanup: () => void } | null>(null);

  useEffect(() => {
    return () => {
      if (webListenersRef.current) webListenersRef.current.cleanup();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (inlineHideTimerRef.current) clearTimeout(inlineHideTimerRef.current);
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const handleWebRef = useCallback((el: HTMLVideoElement | null) => {
    if (webListenersRef.current) {
      webListenersRef.current.cleanup();
      webListenersRef.current = null;
    }
    webVideoRef.current = el;
    if (el) {
      el.muted = mutedRef.current;
      el.playsInline = true;
      el.preload = 'auto';
      const onEnded = () => { setPlaying(false); setProgress(0); animatePlayState(false); };
      const onMeta = () => {
        setLoaded(true);
        if (el.duration && isFinite(el.duration)) setTotalDuration(el.duration);
        if (el.videoWidth && el.videoHeight) {
          const ratio = el.videoWidth / el.videoHeight;
          setThumbH(Math.round(Math.min(MAX_THUMB_H, Math.max(MIN_THUMB_H, THUMB_W / ratio))));
        }
      };
      const onWaiting = () => setBuffering(true);
      const onPlaying = () => { setBuffering(false); setPlaying(true); animatePlayState(true); };
      const onCanPlay = () => setBuffering(false);
      const onProgress = () => { setBuffered(getWebBuffered(el)); };
      el.addEventListener('ended', onEnded);
      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('waiting', onWaiting);
      el.addEventListener('playing', onPlaying);
      el.addEventListener('canplay', onCanPlay);
      const onError = () => setError('Video failed to load');
      el.addEventListener('progress', onProgress);
      el.addEventListener('error', onError);
      webListenersRef.current = {
        el,
        cleanup: () => {
          el.removeEventListener('ended', onEnded);
          el.removeEventListener('loadedmetadata', onMeta);
          el.removeEventListener('waiting', onWaiting);
          el.removeEventListener('playing', onPlaying);
          el.removeEventListener('canplay', onCanPlay);
          el.removeEventListener('progress', onProgress);
          el.removeEventListener('error', onError);
        },
      };
    }
  }, [animatePlayState, getWebBuffered]);

  const handleNativeStatus = useCallback((s: AVPlaybackStatus) => {
    if (!s.isLoaded) {
      if ((s as any).error) setError((s as any).error?.message || 'Video failed to load');
      return;
    }
    if (!loaded) setLoaded(true);
    setBuffering(s.isBuffering);
    const dur = s.durationMillis || (duration * 1000);
    if (dur > 0) {
      setProgress((s.positionMillis || 0) / dur);
      setCurrentTime((s.positionMillis || 0) / 1000);
      if (!totalDuration) setTotalDuration(dur / 1000);
      if (s.playableDurationMillis) {
        setBuffered(s.playableDurationMillis / dur);
      }
    }
    if ((s as any).naturalSize) {
      const ns = (s as any).naturalSize;
      if (ns.width && ns.height) {
        const ratio = ns.width / ns.height;
        setThumbH(h => {
          const newH = Math.round(Math.min(MAX_THUMB_H, Math.max(MIN_THUMB_H, THUMB_W / ratio)));
          return newH !== h ? newH : h;
        });
      }
    }
    if (s.didJustFinish) { setPlaying(false); setProgress(0); animatePlayState(false); }
  }, [duration, animatePlayState, loaded]);

  const openFullscreen = useCallback(() => {
    if (isDownloading) return;
    if (Platform.OS === 'web') webVideoRef.current?.pause();
    else nativeVideoRef.current?.pauseAsync();
    setPlaying(false);
    setFsPlaying(false);
    setFsMuted(muted);
    setFsProgress(progress);
    setFsBuffered(buffered);
    setFsCurrentTime(currentTime);
    setFsTotalDuration(totalDuration);
    setPlaybackSpeed(1);
    setShowSpeedPicker(false);
    setFullscreen(true);
  }, [playing, muted, progress, buffered, currentTime, totalDuration, isDownloading]);

  const closeFullscreen = useCallback(() => {
    if (fsPlaying && Platform.OS === 'web') fsWebVideoRef.current?.pause();
    if (fsPlaying && Platform.OS !== 'web') fsNativeRef.current?.pauseAsync();
    setFullscreen(false);
    setFsPlaying(false);
    setShowSpeedPicker(false);
  }, [fsPlaying]);

  const toggleFsPlay = useCallback(async () => {
    if (Platform.OS === 'web') {
      const v = fsWebVideoRef.current;
      if (!v) return;
      if (fsPlaying) { v.pause(); setFsPlaying(false); }
      else { try { await v.play(); setFsPlaying(true); } catch {} }
    } else {
      const v = fsNativeRef.current;
      if (!v) return;
      if (fsPlaying) { await v.pauseAsync(); setFsPlaying(false); }
      else { await v.playAsync(); setFsPlaying(true); }
    }
    resetHideTimer();
  }, [fsPlaying]);

  const handleSkip = useCallback(async (direction: 'forward' | 'backward') => {
    const delta = direction === 'forward' ? SKIP_SECONDS : -SKIP_SECONDS;
    if (Platform.OS === 'web') {
      const v = fsWebVideoRef.current;
      if (v && v.duration && isFinite(v.duration)) {
        v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
        setFsCurrentTime(v.currentTime);
        setFsProgress(v.currentTime / v.duration);
      }
    } else {
      const v = fsNativeRef.current;
      if (v && fsTotalDuration) {
        const newPos = Math.max(0, Math.min(fsTotalDuration, fsCurrentTime + delta));
        await v.setPositionAsync(newPos * 1000);
        setFsCurrentTime(newPos);
        setFsProgress(newPos / fsTotalDuration);
      }
    }
    setSkipIndicator(direction);
    Animated.sequence([
      Animated.timing(skipAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(skipAnim, { toValue: 0, duration: 400, delay: 300, useNativeDriver: true }),
    ]).start();
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => setSkipIndicator(null), 900);
    resetHideTimer();
  }, [fsTotalDuration, fsCurrentTime, skipAnim]);

  const handleFsDoubleTap = useCallback((side: 'left' | 'right') => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (now - last.time < 350 && last.side === side) {
      handleSkip(side === 'right' ? 'forward' : 'backward');
      lastTapRef.current = { time: 0, side: null };
    } else {
      lastTapRef.current = { time: now, side };
    }
  }, [handleSkip]);

  const changePlaybackSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    setShowSpeedPicker(false);
    if (Platform.OS === 'web') {
      const v = fsWebVideoRef.current;
      if (v) v.playbackRate = speed;
    } else {
      const v = fsNativeRef.current;
      if (v) v.setRateAsync(speed, true);
    }
    resetHideTimer();
  }, []);

  const startLongPressSpeed = useCallback(() => {
    savedSpeedRef.current = playbackSpeed;
    setLongPressSpeed(true);
    const speed = 2;
    if (Platform.OS === 'web') {
      const v = fsWebVideoRef.current;
      if (v) v.playbackRate = speed;
    } else {
      const v = fsNativeRef.current;
      if (v) v.setRateAsync(speed, true);
    }
  }, [playbackSpeed]);

  const stopLongPressSpeed = useCallback(() => {
    setLongPressSpeed(false);
    const speed = savedSpeedRef.current;
    if (Platform.OS === 'web') {
      const v = fsWebVideoRef.current;
      if (v) v.playbackRate = speed;
    } else {
      const v = fsNativeRef.current;
      if (v) v.setRateAsync(speed, true);
    }
  }, []);

  const togglePiP = useCallback(async () => {
    if (Platform.OS !== 'web') return;
    const v = fsWebVideoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (v.requestPictureInPicture) {
        await v.requestPictureInPicture();
        v.addEventListener('leavepictureinpicture', () => {}, { once: true });
      }
    } catch {}
    resetHideTimer();
  }, []);


  useEffect(() => {
    if (Platform.OS !== 'web' || !fullscreen) return;
    if (fsPlaying) {
      fsProgressIntervalRef.current = setInterval(() => {
        const v = fsWebVideoRef.current;
        if (v && v.duration && !isNaN(v.duration) && !seeking) {
          setFsProgress(v.currentTime / v.duration);
          setFsCurrentTime(v.currentTime);
          setFsBuffered(getWebBuffered(v));
        }
      }, PROGRESS_INTERVAL);
    }
    return () => { if (fsProgressIntervalRef.current) clearInterval(fsProgressIntervalRef.current); };
  }, [fsPlaying, fullscreen, seeking, getWebBuffered]);

  const fsListenersRef = useRef<{ el: HTMLVideoElement; cleanup: () => void } | null>(null);

  useEffect(() => {
    if (!fullscreen) return;
    const seekAndPlay = async () => {
      if (Platform.OS === 'web') {
        const v = fsWebVideoRef.current;
        if (!v) return;
        const trySeek = () => {
          if (v.readyState >= 1 && currentTime > 0) v.currentTime = currentTime;
          v.playbackRate = playbackSpeed;
          if (playing) v.play().then(() => setFsPlaying(true)).catch(() => {});
        };
        if (v.readyState >= 1) trySeek();
        else v.addEventListener('loadedmetadata', trySeek, { once: true });
      } else {
        const v = fsNativeRef.current;
        if (!v) return;
        if (currentTime > 0) await v.setPositionAsync(currentTime * 1000).catch(() => {});
        if (playing) { await v.playAsync().catch(() => {}); setFsPlaying(true); }
      }
    };
    const t = setTimeout(seekAndPlay, 80);
    showControls();
    return () => clearTimeout(t);
  }, [fullscreen]);

  useEffect(() => {
    return () => {
      if (fsListenersRef.current) fsListenersRef.current.cleanup();
    };
  }, []);

  const handleFsWebRef = useCallback((el: HTMLVideoElement | null) => {
    if (fsListenersRef.current) {
      fsListenersRef.current.cleanup();
      fsListenersRef.current = null;
    }
    fsWebVideoRef.current = el;
    if (el) {
      el.playsInline = true;
      el.preload = 'auto';
      const onEnded = () => { setFsPlaying(false); setFsProgress(0); };
      const onMeta = () => { if (el.duration && isFinite(el.duration)) setFsTotalDuration(el.duration); };
      const onWaiting = () => setFsBuffering(true);
      const onPlaying = () => setFsBuffering(false);
      const onCanPlay = () => setFsBuffering(false);
      const onProgress = () => { setFsBuffered(getWebBuffered(el)); };
      el.addEventListener('ended', onEnded);
      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('waiting', onWaiting);
      el.addEventListener('playing', onPlaying);
      el.addEventListener('canplay', onCanPlay);
      const onError = () => setError('Video failed to load');
      el.addEventListener('progress', onProgress);
      el.addEventListener('error', onError);
      fsListenersRef.current = {
        el,
        cleanup: () => {
          el.removeEventListener('ended', onEnded);
          el.removeEventListener('loadedmetadata', onMeta);
          el.removeEventListener('waiting', onWaiting);
          el.removeEventListener('playing', onPlaying);
          el.removeEventListener('canplay', onCanPlay);
          el.removeEventListener('progress', onProgress);
          el.removeEventListener('error', onError);
        },
      };
    }
  }, [getWebBuffered]);

  const handleFsNativeStatus = useCallback((s: AVPlaybackStatus) => {
    if (!s.isLoaded) {
      if ((s as any).error) setError((s as any).error?.message || 'Video failed to load');
      return;
    }
    setFsBuffering(s.isBuffering);
    const dur = s.durationMillis || 1;
    if (!seeking) {
      setFsProgress((s.positionMillis || 0) / dur);
      setFsCurrentTime((s.positionMillis || 0) / 1000);
    }
    if (s.playableDurationMillis) {
      setFsBuffered(s.playableDurationMillis / dur);
    }
    if (!fsTotalDuration) setFsTotalDuration(dur / 1000);
    if (s.didJustFinish) { setFsPlaying(false); setFsProgress(0); }
  }, [seeking, fsTotalDuration]);

  const [fsControlsVisible, setFsControlsVisible] = useState(true);
  const fsControlsAnim = useRef(new Animated.Value(1)).current;

  const showControls = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setFsControlsVisible(true);
    Animated.timing(fsControlsAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    hideTimerRef.current = setTimeout(() => {
      Animated.timing(fsControlsAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setFsControlsVisible(false));
    }, 3000);
  }, [fsControlsAnim]);

  const resetHideTimer = showControls;

  const handleFsTap = useCallback(() => {
    setShowSpeedPicker(false);
    if (fsControlsVisible) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      Animated.timing(fsControlsAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setFsControlsVisible(false));
    } else {
      showControls();
    }
  }, [fsControlsVisible, fsControlsAnim, showControls]);

  // Keyboard shortcuts in fullscreen
  useEffect(() => {
    if (Platform.OS !== 'web' || !fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          toggleFsPlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSkip('backward');
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSkip('forward');
          break;
        case 'm':
          e.preventDefault();
          setFsMuted(prev => !prev);
          break;
        case 'Escape':
          e.preventDefault();
          closeFullscreen();
          break;
        case 'f':
          e.preventDefault();
          togglePiP();
          break;
      }
      showControls();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen, toggleFsPlay, handleSkip, closeFullscreen, togglePiP, showControls]);

  const handleFsSeek = useCallback(async (ratio: number, preview = false) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    if (preview) {
      setSeekPreviewTime(clamped * (fsTotalDuration || 0));
      setFsProgress(clamped);
      return;
    }
    setSeekPreviewTime(null);
    setFsProgress(clamped);
    setFsCurrentTime(clamped * (fsTotalDuration || 0));
    if (Platform.OS === 'web') {
      const v = fsWebVideoRef.current;
      if (v && v.duration && isFinite(v.duration)) v.currentTime = clamped * v.duration;
    } else {
      const v = fsNativeRef.current;
      if (v && fsTotalDuration) await v.setPositionAsync(clamped * fsTotalDuration * 1000);
    }
  }, [fsTotalDuration]);

  const handleInlineSeek = useCallback(async (ratio: number) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    setProgress(clamped);
    const newTime = clamped * (totalDuration || 0);
    setCurrentTime(newTime);
    if (Platform.OS === 'web') {
      const v = webVideoRef.current;
      if (v && v.duration && isFinite(v.duration)) v.currentTime = clamped * v.duration;
    } else {
      const v = nativeVideoRef.current;
      if (v && totalDuration) await v.setPositionAsync(newTime * 1000);
    }
    showInlineControls();
  }, [totalDuration, showInlineControls]);

  const displayTime = playing || currentTime > 0 ? formatTime(currentTime) : formatTime(totalDuration || 0);
  const showDownloadOverlay = isDownloading && !isUploading;
  const uploadPct = Math.round(uploadProgress || 0);
  const progressWidth = `${Math.round(progress * 100)}%`;
  const bufferedWidth = `${Math.round(Math.min(1, buffered) * 100)}%`;
  const fsBufferedWidth = `${Math.round(Math.min(1, fsBuffered) * 100)}%`;

  return (
    <View ref={visibilityRef} style={vs.container}>
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={showDownloadOverlay ? onCancelDownload : togglePlay}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[vs.touchArea, { height: thumbH }]}
        hitSlop={0}
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        accessibilityRole="button"
      >
        {!loaded && (
          <Animated.View style={[vs.shimmerBg, { opacity: shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] }) }]} />
        )}

        {isVisible ? (
          Platform.OS === 'web' ? (
            // @ts-ignore
            <video
              ref={handleWebRef}
              src={url}
              muted
              autoPlay
              playsInline
              preload="auto"
              style={{
                width: '100%', height: thumbH,
                objectFit: 'cover',
                borderRadius: 16,
                pointerEvents: 'none',
                backgroundColor: '#0F1923',
              }}
            />
          ) : (
            <ExpoVideo
              ref={nativeVideoRef}
              source={{ uri: url }}
              resizeMode={ResizeMode.COVER}
              shouldPlay={false}
              isMuted={muted}
              onPlaybackStatusUpdate={handleNativeStatus}
              progressUpdateIntervalMillis={PROGRESS_INTERVAL}
              style={[vs.nativeVideo, { height: thumbH }]}
            />
          )
        ) : (
          <View style={[vs.placeholder, { height: thumbH }]}>
            <Play color="rgba(255,255,255,0.4)" size={32} fill="rgba(255,255,255,0.4)" />
          </View>
        )}

        {!isUploading && !showDownloadOverlay && (
          <View style={vs.bottomGradient} pointerEvents="none" />
        )}

        {((buffering && playing) || (!loaded && playing)) && !showDownloadOverlay && !isUploading && (
          <View style={vs.bufferingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}

        {error && !isUploading && !showDownloadOverlay && (
          <View style={vs.errorOverlay}>
            <TouchableOpacity
              style={vs.errorRetryBtn}
              onPress={() => {
                setError(null);
                if (Platform.OS === 'web') {
                  const v = webVideoRef.current;
                  if (v) { v.load(); }
                } else {
                  nativeVideoRef.current?.loadAsync?.({ uri: url }, {}, false);
                }
              }}
              activeOpacity={0.7}
              accessibilityLabel="Retry"
              accessibilityRole="button"
            >
              <RefreshCw color="#FFFFFF" size={24} />
              <Text style={vs.errorText}>Tap to retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!showDownloadOverlay && !isUploading && !buffering && (
          <Animated.View style={[vs.overlay, { opacity: overlayAnim }]}>
            <Animated.View style={[vs.playBtn, { transform: [{ scale: scaleAnim }] }]}>
              {playing ? (
                <Pause color="#FFFFFF" size={20} fill="#FFFFFF" />
              ) : (
                <Play color="#FFFFFF" size={20} fill="#FFFFFF" style={{ marginLeft: 2 }} />
              )}
            </Animated.View>
          </Animated.View>
        )}

        {isUploading && (
          <View style={vs.uploadOverlay}>
            <View style={vs.uploadCenter}>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <svg width={56} height={56} style={{ position: 'absolute' }}>
                  {/* @ts-ignore */}
                  <circle cx={28} cy={28} r={24} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={3} />
                  {/* @ts-ignore */}
                  <circle
                    cx={28} cy={28} r={24} fill="none" stroke="#FFFFFF" strokeWidth={3}
                    strokeDasharray={150.8} strokeDashoffset={150.8 * (1 - uploadPct / 100)}
                    strokeLinecap="round" transform="rotate(-90 28 28)"
                    style={{ transition: 'stroke-dashoffset 0.4s cubic-bezier(0.4,0,0.2,1)' }}
                  />
                </svg>
              ) : (
                <NativeSvg width={56} height={56} style={{ position: 'absolute' }}>
                  <NativeCircle cx={28} cy={28} r={24} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={3} />
                  <NativeCircle cx={28} cy={28} r={24} fill="none" stroke="#FFFFFF" strokeWidth={3}
                    strokeDasharray={`${150.8}`} strokeDashoffset={150.8 * (1 - uploadPct / 100)}
                    strokeLinecap="round" rotation={-90} origin="28,28"
                  />
                </NativeSvg>
              )}
              <View style={vs.uploadStopBtn}>
                <Square color="#FFFFFF" size={12} fill="#FFFFFF" />
              </View>
            </View>
            <View style={vs.uploadInfoRow}>
              <Text style={vs.uploadPctText}>{uploadPct}%</Text>
              <Text style={vs.uploadDurText}>{formatTime(totalDuration || 0)}</Text>
            </View>
            <View style={vs.uploadProgressBar}>
              <View style={[vs.uploadProgressFill, { width: `${uploadPct}%` }]} />
            </View>
          </View>
        )}

        {showDownloadOverlay && (
          <View style={vs.downloadOverlay}>
            <View style={vs.downloadCenter}>
              <View style={vs.cancelBtn}>
                <Square color="#FFFFFF" size={14} fill="#FFFFFF" />
              </View>
            </View>
            <View style={vs.downloadInfo}>
              <Text style={vs.downloadSizeText}>
                {downloadedBytes > 0 && totalBytes > 0
                  ? `${formatFileSize(downloadedBytes)} / ${formatFileSize(totalBytes)}`
                  : `${Math.round(downloadProgress)}%`}
              </Text>
            </View>
            <View style={vs.downloadProgressBg}>
              <View style={[vs.downloadProgressFill, { width: `${Math.min(100, Math.round(downloadProgress))}%` }]} />
            </View>
          </View>
        )}

        {!isUploading && !showDownloadOverlay && (
          <View style={vs.durationBadge}>
            <Play color="#FFFFFF" size={9} fill="#FFFFFF" style={{ marginRight: 3 }} />
            <Text style={vs.durationBadgeText}>{formatTime(totalDuration || 0)}</Text>
          </View>
        )}

        {!showDownloadOverlay && !isUploading && (
          <Animated.View style={[vs.bottomBar, { opacity: inlineControlsAnim }]} pointerEvents={inlineControlsVisible ? 'auto' : 'none'}>
            <Pressable
              style={vs.progressBarBg}
              onPress={(e: any) => {
                const nativeEvent = e.nativeEvent;
                const x = nativeEvent.locationX || nativeEvent.offsetX || 0;
                const targetW = (e.currentTarget as any)?.offsetWidth || THUMB_W;
                handleInlineSeek(x / targetW);
              }}
            >
              <View style={[vs.bufferBarFill, { width: bufferedWidth }]} />
              <View style={[vs.progressBarFill, { width: progressWidth }]} />
            </Pressable>
            <View style={vs.bottomInfo}>
              <Text style={vs.timeText}>{displayTime}</Text>
              <View style={vs.bottomActions}>
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    showInlineControls();
                    if (Platform.OS === 'web') {
                      const v = webVideoRef.current;
                      if (v) { v.muted = !muted; setMuted(!muted); }
                    } else {
                      const v = nativeVideoRef.current;
                      if (v) { v.setIsMutedAsync(!muted); setMuted(!muted); }
                    }
                  }}
                  style={vs.actionBtn}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                  accessibilityRole="button"
                >
                  {muted ? <VolumeX color="#FFFFFF" size={12} /> : <Volume2 color="#FFFFFF" size={12} />}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); openFullscreen(); }}
                  style={vs.actionBtn}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityLabel="Fullscreen"
                  accessibilityRole="button"
                >
                  <Maximize2 color="#FFFFFF" size={12} />
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        )}
      </TouchableOpacity>

      {fullscreen && (
        <Modal visible transparent animationType="fade" onRequestClose={closeFullscreen}>
          <SwipeToClose onClose={closeFullscreen} style={vs.fsContainer}>
            <View style={StyleSheet.absoluteFill}>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <video
                  ref={handleFsWebRef}
                  src={url}
                  playsInline
                  preload="auto"
                  muted={fsMuted}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
                />
              ) : (
                <ExpoVideo
                  ref={fsNativeRef}
                  source={{ uri: url }}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  isMuted={fsMuted}
                  onPlaybackStatusUpdate={handleFsNativeStatus}
                  progressUpdateIntervalMillis={PROGRESS_INTERVAL}
                  style={StyleSheet.absoluteFill}
                />
              )}

              {/* Double-tap zones */}
              <View style={vs.doubleTapContainer} pointerEvents="box-none">
                <Pressable
                  style={vs.doubleTapLeft}
                  onPress={() => {
                    handleFsDoubleTap('left');
                    const now = Date.now();
                    if (now - lastTapRef.current.time > 350) {
                      setTimeout(() => {
                        if (Date.now() - lastTapRef.current.time > 300) handleFsTap();
                      }, 360);
                    }
                  }}
                />
                <Pressable
                  style={vs.doubleTapCenter}
                  onPress={handleFsTap}
                  onLongPress={startLongPressSpeed}
                  onPressOut={longPressSpeed ? stopLongPressSpeed : undefined}
                  delayLongPress={500}
                />
                <Pressable
                  style={vs.doubleTapRight}
                  onPress={() => {
                    handleFsDoubleTap('right');
                    const now = Date.now();
                    if (now - lastTapRef.current.time > 350) {
                      setTimeout(() => {
                        if (Date.now() - lastTapRef.current.time > 300) handleFsTap();
                      }, 360);
                    }
                  }}
                />
              </View>
            </View>

            {/* Skip indicator */}
            {skipIndicator && (
              <Animated.View
                pointerEvents="none"
                style={[
                  vs.skipIndicator,
                  skipIndicator === 'forward' ? vs.skipRight : vs.skipLeft,
                  { opacity: skipAnim },
                ]}
              >
                <View style={vs.skipBubble}>
                  {skipIndicator === 'backward' ? (
                    <RotateCcw color="#FFFFFF" size={22} />
                  ) : (
                    <RotateCw color="#FFFFFF" size={22} />
                  )}
                  <Text style={vs.skipText}>{SKIP_SECONDS}s</Text>
                </View>
              </Animated.View>
            )}

            {/* Long-press speed indicator */}
            {longPressSpeed && (
              <View style={vs.longPressIndicator} pointerEvents="none">
                <View style={vs.longPressBubble}>
                  <Text style={vs.longPressText}>2x</Text>
                </View>
              </View>
            )}

            {/* Seek preview tooltip */}
            {seekPreviewTime !== null && (
              <View style={vs.seekPreview} pointerEvents="none">
                <View style={vs.seekPreviewBubble}>
                  <Text style={vs.seekPreviewText}>{formatTime(seekPreviewTime)}</Text>
                </View>
              </View>
            )}

            {fsBuffering && fsPlaying && (
              <View style={vs.fsCenterBuffering} pointerEvents="none">
                <ActivityIndicator size="large" color="#FFFFFF" />
              </View>
            )}

            <Animated.View style={[vs.fsControls, { opacity: fsControlsAnim }]} pointerEvents={fsControlsVisible ? 'auto' : 'none'}>
              <View style={[vs.fsTopBar, { paddingTop: Math.max(insets.top, 16) }]}>
                <TouchableOpacity onPress={closeFullscreen} style={vs.fsGlassBtn} activeOpacity={0.7} accessibilityLabel="Close" accessibilityRole="button">
                  <X color="#FFFFFF" size={20} />
                </TouchableOpacity>
                <View style={vs.fsTopRight}>
                  <TouchableOpacity
                    onPress={() => { setShowSpeedPicker(!showSpeedPicker); resetHideTimer(); }}
                    style={vs.speedBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={vs.speedBtnText}>{playbackSpeed}x</Text>
                  </TouchableOpacity>
                  {Platform.OS === 'web' && typeof document !== 'undefined' && document.pictureInPictureEnabled && (
                    <TouchableOpacity onPress={togglePiP} style={vs.fsGlassBtn} activeOpacity={0.7}>
                      <PictureInPicture2 color="#FFFFFF" size={18} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => { setFsMuted(!fsMuted); resetHideTimer(); }} style={vs.fsGlassBtn} activeOpacity={0.7} accessibilityLabel={fsMuted ? "Unmute" : "Mute"} accessibilityRole="button">
                    {fsMuted ? <VolumeX color="#FFFFFF" size={18} /> : <Volume2 color="#FFFFFF" size={18} />}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Speed picker dropdown */}
              {showSpeedPicker && (
                <View style={[vs.speedPicker, { top: Math.max(insets.top, 16) + 48 }]}>
                  {PLAYBACK_SPEEDS.map(speed => (
                    <TouchableOpacity
                      key={speed}
                      style={[vs.speedOption, playbackSpeed === speed && vs.speedOptionActive]}
                      onPress={() => changePlaybackSpeed(speed)}
                      activeOpacity={0.7}
                    >
                      <Text style={[vs.speedOptionText, playbackSpeed === speed && vs.speedOptionTextActive]}>
                        {speed}x
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {!fsBuffering && (
                <TouchableOpacity onPress={() => { toggleFsPlay(); resetHideTimer(); }} style={vs.fsCenterPlay} activeOpacity={0.8} accessibilityLabel={fsPlaying ? 'Pause' : 'Play'} accessibilityRole="button">
                  <View style={vs.fsBigPlayBtn}>
                    {fsPlaying ? <Pause color="#FFFFFF" size={28} fill="#FFFFFF" /> : <Play color="#FFFFFF" size={28} fill="#FFFFFF" style={{ marginLeft: 3 }} />}
                  </View>
                </TouchableOpacity>
              )}
              {fsBuffering && <View style={vs.fsCenterPlay} />}

              <View style={[vs.fsBottomBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                <Text style={vs.fsTimeText}>{formatTime(fsCurrentTime)}</Text>
                <View
                  style={vs.fsSeekBarContainer}
                  onLayout={(e) => {
                    (e.target as any).measure?.((x: number, y: number, width: number, height: number, pageX: number, pageY: number) => {
                      seekBarLayoutRef.current = { x: pageX, width };
                    });
                  }}
                >
                  <Pressable
                    style={vs.fsSeekBar}
                    onPress={(e: any) => {
                      const nativeEvent = e.nativeEvent;
                      const x = nativeEvent.locationX || nativeEvent.offsetX || 0;
                      const barW = seekBarLayoutRef.current.width || (screenW - 130);
                      handleFsSeek(x / barW);
                      resetHideTimer();
                    }}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={(e) => {
                      setSeeking(true);
                      const pageX = e.nativeEvent.pageX;
                      const layout = seekBarLayoutRef.current;
                      const barW = layout.width || (screenW - 130);
                      const x = pageX - (layout.x || 65);
                      handleFsSeek(Math.max(0, Math.min(1, x / barW)), true);
                    }}
                    onResponderMove={(e) => {
                      const pageX = e.nativeEvent.pageX;
                      const layout = seekBarLayoutRef.current;
                      const barW = layout.width || (screenW - 130);
                      const x = pageX - (layout.x || 65);
                      handleFsSeek(Math.max(0, Math.min(1, x / barW)), true);
                    }}
                    onResponderRelease={(e) => {
                      setSeeking(false);
                      setSeekPreviewTime(null);
                      const pageX = e.nativeEvent.pageX;
                      const layout = seekBarLayoutRef.current;
                      const barW = layout.width || (screenW - 130);
                      const x = pageX - (layout.x || 65);
                      handleFsSeek(Math.max(0, Math.min(1, x / barW)));
                      resetHideTimer();
                    }}
                    onResponderTerminate={() => { setSeeking(false); setSeekPreviewTime(null); }}
                  >
                    <View style={vs.fsSeekBg}>
                      <View style={[vs.fsBufferFill, { width: fsBufferedWidth }]} />
                      <View style={[vs.fsSeekFill, { width: `${Math.round(fsProgress * 100)}%` }]} />
                      <View style={[vs.fsSeekThumb, { left: `${Math.round(fsProgress * 100)}%` }]} />
                    </View>
                  </Pressable>
                </View>
                <Text style={vs.fsTimeText}>{formatTime(fsTotalDuration || 0)}</Text>
              </View>
            </Animated.View>
          </SwipeToClose>
        </Modal>
      )}
    </View>
  );
});

const vs = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    width: '100%',
    maxWidth: THUMB_W,
  },
  touchArea: {
    position: 'relative',
    width: '100%',
    height: DEFAULT_THUMB_H,
    backgroundColor: '#0F1923',
    borderRadius: 16,
    overflow: 'hidden',
  },
  shimmerBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1C2C3A',
    borderRadius: 16,
    zIndex: 0,
  },
  placeholder: {
    width: '100%',
    backgroundColor: '#0F1923',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nativeVideo: {
    width: '100%',
    height: DEFAULT_THUMB_H,
    borderRadius: 16,
    backgroundColor: '#0F1923',
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 80,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    ...Platform.select({
      web: { backgroundImage: 'linear-gradient(transparent, rgba(0,0,0,0.5))' },
      default: { backgroundColor: 'rgba(0,0,0,0.25)' },
    }) as any,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  playBtn: {
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
    }) as any,
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  uploadCenter: {
    width: 56, height: 56,
    justifyContent: 'center', alignItems: 'center',
  },
  uploadStopBtn: {
    width: 20, height: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  uploadInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  uploadPctText: {
    color: '#FFFFFF', fontSize: 14, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  uploadDurText: {
    color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '500',
  },
  uploadProgressBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 3, backgroundColor: 'rgba(255,255,255,0.12)',
  },
  uploadProgressFill: {
    height: '100%', backgroundColor: '#2AABEE', borderRadius: 1.5,
    ...Platform.select({
      web: { transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)' },
      default: {},
    }) as any,
  },
  downloadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
    borderRadius: 16,
  },
  downloadCenter: {
    alignItems: 'center',
    gap: 8,
  },
  cancelBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
  },
  downloadInfo: {
    position: 'absolute',
    top: 10, left: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    ...Platform.select({
      web: { backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' },
      default: {},
    }) as any,
  },
  downloadSizeText: {
    color: '#FFFFFF', fontSize: 11, fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  downloadProgressBg: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 3, backgroundColor: 'rgba(255,255,255,0.12)',
  },
  downloadProgressFill: {
    height: '100%', backgroundColor: '#2AABEE', borderRadius: 1.5,
  },
  durationBadge: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      web: { backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' },
      default: {},
    }) as any,
  },
  durationBadgeText: {
    color: '#FFFFFF', fontSize: 11, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  progressBarBg: {
    height: 14,
    paddingTop: 5,
    paddingBottom: 6,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  bufferBarFill: {
    position: 'absolute', top: 5, left: 0, height: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 1.5,
    ...Platform.select({
      web: { transition: 'width 0.3s linear' },
      default: {},
    }) as any,
  },
  progressBarFill: {
    position: 'absolute', top: 5, left: 0, height: 3,
    backgroundColor: '#2AABEE', borderRadius: 1.5,
    ...Platform.select({
      web: { transition: 'width 0.15s linear' },
      default: {},
    }) as any,
  },
  bottomInfo: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.4)',
    ...Platform.select({
      web: { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' },
      default: {},
    }) as any,
  },
  timeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bottomActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  fsContainer: { flex: 1, backgroundColor: '#000' },
  fsControls: { ...StyleSheet.absoluteFillObject, pointerEvents: 'box-none' as any },
  fsTopBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  fsTopRight: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  fsGlassBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({
      web: { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
      default: {},
    }) as any,
  },
  speedBtn: {
    height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 14,
    ...Platform.select({
      web: { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
      default: {},
    }) as any,
  },
  speedBtnText: {
    color: '#FFFFFF', fontSize: 14, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  speedPicker: {
    position: 'absolute',
    right: 60,
    backgroundColor: 'rgba(30,30,30,0.92)',
    borderRadius: 12,
    paddingVertical: 4,
    zIndex: 100,
    minWidth: 70,
    ...Platform.select({
      web: { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' },
      default: { elevation: 10 },
    }) as any,
  },
  speedOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  speedOptionActive: {
    backgroundColor: 'rgba(42,171,238,0.2)',
  },
  speedOptionText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  speedOptionTextActive: {
    color: '#2AABEE',
  },
  doubleTapContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  doubleTapLeft: {
    flex: 1,
  },
  doubleTapCenter: {
    flex: 1.5,
  },
  doubleTapRight: {
    flex: 1,
  },
  skipIndicator: {
    position: 'absolute',
    top: '35%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLeft: {
    left: 40,
  },
  skipRight: {
    right: 40,
  },
  skipBubble: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 40,
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      web: { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' },
      default: {},
    }) as any,
  },
  skipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  fsCenterPlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
  },
  fsCenterBuffering: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
  },
  longPressIndicator: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    left: 0, right: 0,
    alignItems: 'center',
  },
  longPressBubble: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...Platform.select({
      web: { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' },
      default: {},
    }) as any,
  },
  longPressText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  seekPreview: {
    position: 'absolute',
    bottom: 100,
    left: 0, right: 0,
    alignItems: 'center',
  },
  seekPreviewBubble: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...Platform.select({
      web: { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' },
      default: {},
    }) as any,
  },
  seekPreviewText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  fsBigPlayBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({
      web: {
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      },
      default: { elevation: 6 },
    }) as any,
  },
  fsBottomBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingTop: 14,
    ...Platform.select({
      web: { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
      default: {},
    }) as any,
  },
  fsTimeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', minWidth: 38, fontVariant: ['tabular-nums'] },
  fsSeekBarContainer: { flex: 1 },
  fsSeekBar: { height: 40, justifyContent: 'center' },
  fsSeekBg: { height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, position: 'relative' },
  fsBufferFill: {
    position: 'absolute', top: 0, left: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 2,
    ...Platform.select({
      web: { transition: 'width 0.3s linear' },
      default: {},
    }) as any,
  },
  fsSeekFill: {
    position: 'absolute', top: 0, left: 0, bottom: 0,
    backgroundColor: '#2AABEE', borderRadius: 2,
    ...Platform.select({
      web: { transition: 'width 0.1s linear' },
      default: {},
    }) as any,
  },
  fsSeekThumb: {
    position: 'absolute', top: -6, width: 16, height: 16,
    borderRadius: 8, backgroundColor: '#FFFFFF',
    marginLeft: -8,
    ...Platform.select({
      web: { boxShadow: '0 2px 6px rgba(0,0,0,0.35)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 },
    }) as any,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 16,
  },
  errorRetryBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

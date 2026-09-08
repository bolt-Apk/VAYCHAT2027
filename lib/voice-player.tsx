import React, { createContext, useContext, useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';

type PlaybackSpeed = 1 | 1.5 | 2;

interface VoiceTrack {
  id: string;
  url: string;
  duration: number;
  senderName: string;
  conversationId: string;
}

interface VoicePlayerSnapshot {
  track: VoiceTrack | null;
  playing: boolean;
  speed: PlaybackSpeed;
  error: string | null;
}

interface VoicePlayerContextValue {
  state: VoicePlayerSnapshot;
  play: (track: VoiceTrack) => void;
  pause: () => void;
  stop: () => Promise<void>;
  toggleSpeed: () => void;
  isPlaying: (id: string) => boolean;
  setOnFinished: (cb: ((trackId: string) => void) | null) => void;
  clearError: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => VoicePlayerSnapshot;
  getProgress: () => number;
  subscribeProgress: (listener: () => void) => () => void;
}

const VoicePlayerContext = createContext<VoicePlayerContextValue | null>(null);

export function useVoicePlayer() {
  const ctx = useContext(VoicePlayerContext);
  if (!ctx) throw new Error('useVoicePlayer must be used inside VoicePlayerProvider');
  const state = useSyncExternalStore(ctx.subscribe, ctx.getSnapshot, ctx.getSnapshot);
  return { state, play: ctx.play, pause: ctx.pause, stop: ctx.stop, toggleSpeed: ctx.toggleSpeed, isPlaying: ctx.isPlaying, setOnFinished: ctx.setOnFinished, clearError: ctx.clearError };
}

export function useVoiceProgress() {
  const ctx = useContext(VoicePlayerContext);
  if (!ctx) throw new Error('useVoiceProgress must be used inside VoicePlayerProvider');
  return useSyncExternalStore(ctx.subscribeProgress, ctx.getProgress, ctx.getProgress);
}

export function useVoicePlayerContext() {
  const ctx = useContext(VoicePlayerContext);
  if (!ctx) throw new Error('useVoicePlayerContext must be used inside VoicePlayerProvider');
  return ctx;
}

export function VoicePlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef<PlaybackSpeed>(1);
  const blobUrlRef = useRef<string | null>(null);
  const onFinishedRef = useRef<((trackId: string) => void) | null>(null);

  const snapshotRef = useRef<VoicePlayerSnapshot>({
    track: null,
    playing: false,
    speed: 1,
    error: null,
  });

  const listenersRef = useRef(new Set<() => void>());
  const progressListenersRef = useRef(new Set<() => void>());
  const progressRef = useRef(0);

  const emit = useCallback(() => {
    listenersRef.current.forEach(l => l());
  }, []);

  const emitProgress = useCallback(() => {
    progressListenersRef.current.forEach(l => l());
  }, []);

  const setSnapshot = useCallback((next: Partial<VoicePlayerSnapshot>) => {
    const prev = snapshotRef.current;
    snapshotRef.current = { ...prev, ...next };
    emit();
  }, [emit]);

  const setProgressOnly = useCallback((p: number) => {
    progressRef.current = p;
    emitProgress();
  }, [emitProgress]);

  const cleanup = useCallback(async () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (Platform.OS === 'web') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    } else {
      const sound = audioRef.current as Audio.Sound | null;
      audioRef.current = null;
      if (sound) {
        try { await sound.stopAsync(); } catch {}
        try { await sound.unloadAsync(); } catch {}
      }
    }
  }, []);

  const stop = useCallback(async () => {
    await cleanup();
    setSnapshot({ track: null, playing: false, error: null });
    progressRef.current = 0;
    emitProgress();
  }, [cleanup, setSnapshot, emitProgress]);

  const clearError = useCallback(() => {
    setSnapshot({ error: null });
  }, [setSnapshot]);

  const pause = useCallback(() => {
    if (Platform.OS === 'web') {
      if (audioRef.current) audioRef.current.pause();
    } else {
      if (audioRef.current) (audioRef.current as Audio.Sound).pauseAsync().catch(() => {});
    }
    setSnapshot({ playing: false });
  }, [setSnapshot]);

  const play = useCallback((track: VoiceTrack) => {
    const snap = snapshotRef.current;

    if (snap.track?.id === track.id && snap.playing) {
      pause();
      return;
    }

    if (snap.track?.id === track.id && !snap.playing && audioRef.current) {
      if (Platform.OS === 'web') {
        (audioRef.current as HTMLAudioElement).play().catch(() => {});
      } else {
        Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        }).catch(() => {});
        (audioRef.current as Audio.Sound).playAsync().catch(() => {
          setSnapshot({ playing: false, error: 'Не удалось воспроизвести' });
        });
      }
      setSnapshot({ playing: true, error: null });
      return;
    }

    setSnapshot({ track, playing: true, error: null });
    progressRef.current = 0;
    emitProgress();

    if (Platform.OS === 'web') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }

      const audio = new window.Audio();
      audio.preload = 'auto';
      audio.playbackRate = speedRef.current;
      audioRef.current = audio;

      const startRaf = () => {
        const tick = () => {
          if (!snapshotRef.current.playing) return;
          if (audio.duration > 0 && !isNaN(audio.duration)) {
            const p = audio.currentTime / audio.duration;
            if (Math.abs(p - progressRef.current) > 0.003) {
              setProgressOnly(p);
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      };

      audio.onplaying = () => {
        if (!snapshotRef.current.playing) {
          setSnapshot({ playing: true, error: null });
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        startRaf();
      };

      audio.onpause = () => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      };

      audio.onerror = () => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        setSnapshot({ track: null, playing: false, error: 'Не удалось загрузить аудио' });
        progressRef.current = 0;
        emitProgress();
        audioRef.current = null;
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      };

      audio.onended = () => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        const finishedId = snapshotRef.current.track?.id || null;
        setSnapshot({ track: null, playing: false });
        progressRef.current = 0;
        emitProgress();
        audioRef.current = null;
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        if (finishedId && onFinishedRef.current) onFinishedRef.current(finishedId);
      };

      audio.src = track.url;
      audio.load();
      audio.play().catch(() => {
        audio.oncanplaythrough = () => {
          audio.oncanplaythrough = null;
          audio.play().catch(() => {
            setSnapshot({ playing: false, error: 'Не удалось воспроизвести' });
          });
        };
      });
    } else {
      const isWebm = /\.webm(\?|$)/i.test(track.url);
      const isIOS = Platform.OS === 'ios';

      if (isWebm && isIOS) {
        setSnapshot({ track: null, playing: false, error: 'Формат WebM не поддерживается на iOS' });
        progressRef.current = 0;
        emitProgress();
        return;
      }

      if (audioRef.current) {
        const old = audioRef.current as Audio.Sound;
        audioRef.current = null;
        old.stopAsync().catch(() => {});
        old.unloadAsync().catch(() => {});
      }

      (async () => {
        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: true,
            interruptionModeIOS: InterruptionModeIOS.DoNotMix,
            interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          });
        } catch {}

        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: track.url },
            {
              shouldPlay: true,
              progressUpdateIntervalMillis: 150,
              rate: speedRef.current,
              shouldCorrectPitch: true,
              volume: 1.0,
              isMuted: false,
            },
          );
          audioRef.current = sound;

          sound.setOnPlaybackStatusUpdate((status) => {
            if (!status.isLoaded) {
              if (status.error) {
                setSnapshot({ playing: false, error: 'Ошибка загрузки аудио' });
              }
              return;
            }
            if (status.durationMillis && status.durationMillis > 0) {
              const p = status.positionMillis / status.durationMillis;
              if (Math.abs(p - progressRef.current) > 0.005) {
                setProgressOnly(p);
              }
            }
            if (status.isPlaying && !snapshotRef.current.playing) {
              setSnapshot({ playing: true, error: null });
            }
            if (status.didJustFinish) {
              const finishedId = snapshotRef.current.track?.id || null;
              setSnapshot({ track: null, playing: false });
              progressRef.current = 0;
              emitProgress();
              sound.unloadAsync().catch(() => {});
              audioRef.current = null;
              if (finishedId && onFinishedRef.current) onFinishedRef.current(finishedId);
            }
          });
        } catch (err: any) {
          const msg = err?.message?.includes('not supported') || err?.message?.includes('format')
            ? 'Формат аудио не поддерживается'
            : err?.message?.includes('network') || err?.message?.includes('fetch')
              ? 'Ошибка сети при загрузке аудио'
              : 'Не удалось воспроизвести голосовое';
          setSnapshot({ track: null, playing: false, error: msg });
          progressRef.current = 0;
          emitProgress();
          if (audioRef.current) {
            try { await (audioRef.current as Audio.Sound).unloadAsync(); } catch {}
            audioRef.current = null;
          }
        }
      })();
    }
  }, [pause, setSnapshot, setProgressOnly, emitProgress, cleanup]);

  const toggleSpeed = useCallback(() => {
    const next: PlaybackSpeed = speedRef.current === 1 ? 1.5 : speedRef.current === 1.5 ? 2 : 1;
    speedRef.current = next;
    setSnapshot({ speed: next });
    if (audioRef.current) {
      if (Platform.OS === 'web') {
        audioRef.current.playbackRate = next;
      } else {
        (audioRef.current as Audio.Sound).setRateAsync(next, true).catch(() => {});
      }
    }
  }, [setSnapshot]);

  const setOnFinished = useCallback((cb: ((trackId: string) => void) | null) => {
    onFinishedRef.current = cb;
  }, []);

  const isPlaying = useCallback((id: string) => {
    return snapshotRef.current.track?.id === id && snapshotRef.current.playing;
  }, []);

  useEffect(() => {
    return () => { void cleanup(); };
  }, [cleanup]);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  const getProgress = useCallback(() => progressRef.current, []);

  const subscribeProgress = useCallback((listener: () => void) => {
    progressListenersRef.current.add(listener);
    return () => { progressListenersRef.current.delete(listener); };
  }, []);

  const value = useRef<VoicePlayerContextValue>({
    state: snapshotRef.current,
    play, pause, stop, toggleSpeed, isPlaying, setOnFinished, clearError,
    subscribe, getSnapshot, getProgress, subscribeProgress,
  });
  value.current = {
    state: snapshotRef.current,
    play, pause, stop, toggleSpeed, isPlaying, setOnFinished, clearError,
    subscribe, getSnapshot, getProgress, subscribeProgress,
  };

  return (
    <VoicePlayerContext.Provider value={value.current}>
      {children}
    </VoicePlayerContext.Provider>
  );
}

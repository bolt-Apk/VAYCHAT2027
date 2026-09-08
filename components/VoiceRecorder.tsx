import { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, Platform, Pressable,
  Animated, Easing, Dimensions, TouchableOpacity,
} from 'react-native';
import { Mic, Send, Trash2, Lock, ChevronUp } from 'lucide-react-native';
import { playRecordStartSound, playRecordSendSound, playRecordCancelSound, playRecordLockSound } from '@/lib/chat-feedback';

const HOLD_DELAY = 250;
const MIN_RECORD_MS = 400;
const CANCEL_THRESHOLD = 100;
const LOCK_THRESHOLD = 70;

interface VoiceRecorderProps {
  colors: {
    primary: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    error: string;
    backgroundSecondary: string;
    backgroundTertiary: string;
    border: string;
    background: string;
  };
  onStartRecording: () => Promise<void>;
  onStopRecording: (send: boolean) => Promise<void>;
  onScheduleRecording?: () => void;
  onStartVideoNote: () => void;
  recording: boolean;
  recordingDuration: number;
  formatDuration: (s: number) => string;
}

function VoiceRecorderInner({
  colors, onStartRecording, onStopRecording, onScheduleRecording,
  recording, recordingDuration, formatDuration,
}: VoiceRecorderProps) {
  const [locked, setLocked] = useState(false);

  const barSlideX = useRef(new Animated.Value(Dimensions.get('window').width)).current;
  const indicatorPulse = useRef(new Animated.Value(1)).current;
  const lockIconOpacity = useRef(new Animated.Value(0)).current;
  const lockSlideY = useRef(new Animated.Value(0)).current;
  const cancelSlideX = useRef(new Animated.Value(0)).current;

  const stoppingRef = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldMode = useRef(false);
  const recordStartedAt = useRef(0);
  const startXY = useRef({ x: 0, y: 0 });
  const cancelTriggered = useRef(false);
  const lockTriggered = useRef(false);
  const recordingRef = useRef(false);
  const lockedRef = useRef(false);
  const webMoveListener = useRef<((e: PointerEvent) => void) | null>(null);
  const webUpListener = useRef<((e: PointerEvent) => void) | null>(null);

  const indicatorAnim = useRef<Animated.CompositeAnimation | null>(null);
  const cancelSlideAnim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { lockedRef.current = locked; }, [locked]);

  const removeWebListeners = useCallback(() => {
    if (Platform.OS !== 'web') return;
    if (webMoveListener.current) {
      window.removeEventListener('pointermove', webMoveListener.current);
      webMoveListener.current = null;
    }
    if (webUpListener.current) {
      window.removeEventListener('pointerup', webUpListener.current);
      window.removeEventListener('pointercancel', webUpListener.current);
      webUpListener.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    indicatorAnim.current?.stop(); indicatorAnim.current = null;
    cancelSlideAnim.current?.stop(); cancelSlideAnim.current = null;
    [barSlideX, indicatorPulse, lockIconOpacity, lockSlideY, cancelSlideX].forEach(a => a.stopAnimation());
    barSlideX.setValue(Dimensions.get('window').width);
    indicatorPulse.setValue(1);
    lockIconOpacity.setValue(0);
    lockSlideY.setValue(0);
    cancelSlideX.setValue(0);
    setLocked(false);
    lockTriggered.current = false;
    cancelTriggered.current = false;
    stoppingRef.current = false;
    isHoldMode.current = false;
    lockedRef.current = false;
    recordStartedAt.current = 0;
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    removeWebListeners();
  }, [barSlideX, indicatorPulse, lockIconOpacity, lockSlideY, cancelSlideX, removeWebListeners]);

  const prevRecRef = useRef(false);
  useEffect(() => {
    const was = prevRecRef.current;
    prevRecRef.current = recording;
    if (recording && !was) {
      stoppingRef.current = false;
      barSlideX.setValue(Dimensions.get('window').width);
      Animated.spring(barSlideX, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start();
      indicatorAnim.current = Animated.loop(Animated.sequence([
        Animated.timing(indicatorPulse, { toValue: 0.2, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(indicatorPulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      indicatorAnim.current.start();
      cancelSlideAnim.current = Animated.loop(Animated.sequence([
        Animated.timing(cancelSlideX, { toValue: -6, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(cancelSlideX, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      cancelSlideAnim.current.start();
      if (!lockedRef.current) {
        Animated.timing(lockIconOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      }
    } else if (!recording && was) {
      resetState();
    }
  }, [recording, barSlideX, indicatorPulse, cancelSlideX, lockIconOpacity, resetState]);

  useEffect(() => {
    if (locked) {
      cancelSlideAnim.current?.stop(); cancelSlideAnim.current = null;
      Animated.timing(lockIconOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [locked, lockIconOpacity]);

  const safeStop = useCallback((send: boolean) => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    removeWebListeners();
    onStopRecording(send).catch(() => {}).finally(() => {
      setTimeout(() => { stoppingRef.current = false; }, 3000);
    });
  }, [onStopRecording, removeWebListeners]);
  const safeStopRef = useRef(safeStop);
  useEffect(() => { safeStopRef.current = safeStop; }, [safeStop]);

  const beginRecording = useCallback(async () => {
    if (recordingRef.current || stoppingRef.current) return;
    recordStartedAt.current = Date.now();
    playRecordStartSound();
    try {
      await onStartRecording();
    } catch (err) {
      console.error('[VoiceRecorder] beginRecording failed:', err);
      isHoldMode.current = false;
      stoppingRef.current = false;
      lockTriggered.current = false;
      lockedRef.current = false;
      setLocked(false);
      removeWebListeners();
    }
  }, [onStartRecording, removeWebListeners]);

  // --- Pointer move (web: global window listener, native: not used) ---
  const doPointerMove = useCallback((pageX: number, pageY: number) => {
    if (!isHoldMode.current || lockedRef.current || !recordingRef.current) return;
    const leftX = -(pageX - startXY.current.x);
    const upY = -(pageY - startXY.current.y);
    if (upY > 10) {
      lockSlideY.setValue(-upY * 0.6);
      if (upY >= LOCK_THRESHOLD && !lockTriggered.current) {
        lockTriggered.current = true;
        lockedRef.current = true;
        setLocked(true);
        isHoldMode.current = false;
        playRecordLockSound();
        removeWebListeners();
      }
    }
    if (leftX >= CANCEL_THRESHOLD && !cancelTriggered.current) {
      cancelTriggered.current = true;
      isHoldMode.current = false;
      playRecordCancelSound();
      safeStopRef.current(false);
    }
  }, [lockSlideY, removeWebListeners]);

  const doPointerUp = useCallback(() => {
    removeWebListeners();
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      if (!recordingRef.current && !stoppingRef.current) {
        lockTriggered.current = true;
        lockedRef.current = true;
        setLocked(true);
        beginRecording();
      }
      return;
    }
    if (lockedRef.current) return;
    isHoldMode.current = false;
    if (recordingRef.current && !cancelTriggered.current) {
      const elapsed = Date.now() - recordStartedAt.current;
      if (elapsed < MIN_RECORD_MS) {
        lockTriggered.current = true;
        lockedRef.current = true;
        setLocked(true);
        playRecordLockSound();
      } else {
        playRecordSendSound();
        safeStopRef.current(true);
      }
    }
  }, [beginRecording, removeWebListeners]);

  const doPointerMoveRef = useRef(doPointerMove);
  const doPointerUpRef = useRef(doPointerUp);
  useEffect(() => { doPointerMoveRef.current = doPointerMove; }, [doPointerMove]);
  useEffect(() => { doPointerUpRef.current = doPointerUp; }, [doPointerUp]);

  // --- Press In: finger/pointer down on mic ---
  const handlePressIn = useCallback((e?: any) => {
    if (lockedRef.current || recordingRef.current || stoppingRef.current) return;

    const nativeEvt = e?.nativeEvent;
    startXY.current = {
      x: nativeEvt?.pageX ?? nativeEvt?.locationX ?? 0,
      y: nativeEvt?.pageY ?? nativeEvt?.locationY ?? 0,
    };
    cancelTriggered.current = false;
    lockTriggered.current = false;
    isHoldMode.current = false;

    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      isHoldMode.current = true;
      beginRecording();
    }, HOLD_DELAY);

    if (Platform.OS === 'web') {
      removeWebListeners();
      const onMove = (ev: PointerEvent) => doPointerMoveRef.current(ev.pageX, ev.pageY);
      const onUp = () => doPointerUpRef.current();
      webMoveListener.current = onMove;
      webUpListener.current = onUp;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }
  }, [beginRecording, removeWebListeners]);

  // --- Press Out: finger/pointer up on mic (native only, web uses window listener) ---
  const handlePressOut = useCallback(() => {
    if (Platform.OS === 'web') return;
    doPointerUpRef.current();
  }, []);

  // --- Touch Move: native finger tracking for slide-to-cancel/lock ---
  const handleTouchMove = useCallback((e: any) => {
    if (Platform.OS === 'web') return;
    const touch = e.nativeEvent;
    if (touch) {
      doPointerMoveRef.current(touch.pageX, touch.pageY);
    }
  }, []);

  // ===== Locked-mode handlers =====
  const handleLockedSend = useCallback(() => {
    if (lockedRef.current && recordingRef.current) {
      playRecordSendSound();
      safeStopRef.current(true);
    }
  }, []);

  const handleLockedCancel = useCallback(() => {
    if (lockedRef.current && recordingRef.current) {
      playRecordCancelSound();
      safeStopRef.current(false);
    }
  }, []);

  const handleSendPress = useCallback(() => {
    if (!recordingRef.current || stoppingRef.current) return;
    playRecordSendSound();
    safeStopRef.current(true);
  }, []);

  useEffect(() => {
    return () => { removeWebListeners(); };
  }, [removeWebListeners]);

  // ===== NOT RECORDING =====
  if (!recording) {
    return (
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onTouchMove={Platform.OS !== 'web' ? handleTouchMove : undefined}
        style={st.micWrap}
        accessibilityLabel="Записать голосовое сообщение"
        accessibilityRole="button"
      >
        <Mic color={colors.primary} size={22} />
      </Pressable>
    );
  }

  // ===== RECORDING =====

  const sendButton = (
    <TouchableOpacity
      onPress={handleSendPress}
      onLongPress={locked ? onScheduleRecording : undefined}
      delayLongPress={400}
      activeOpacity={0.7}
      style={st.micWrap}
      accessibilityLabel="Отправить голосовое"
    >
      <View style={[st.sendCircle, { backgroundColor: colors.primary }]}>
        <Send color="#FFFFFF" size={18} style={{ marginLeft: 2 }} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={st.recorderContainer}>
      {/* Lock hint above the mic */}
      {!locked && (
        <Animated.View style={[st.lockHint, {
          backgroundColor: colors.backgroundTertiary,
          borderColor: colors.border,
          opacity: lockIconOpacity,
          transform: [{ translateY: lockSlideY }],
        }]}>
          <ChevronUp color={colors.textTertiary} size={12} />
          <Lock color={colors.textSecondary} size={14} />
        </Animated.View>
      )}

      {/* Recording bar */}
      <Animated.View style={[st.recBar, { transform: [{ translateX: barSlideX }] }]}>
        {locked ? (
          <View style={st.lockedBar}>
            <TouchableOpacity
              style={[st.lockedCancelBtn, { backgroundColor: `${colors.error}15` }]}
              onPress={handleLockedCancel}
              activeOpacity={0.6}
              accessibilityLabel="Отменить запись"
            >
              <Trash2 color={colors.error} size={18} />
            </TouchableOpacity>
            <View style={st.recBarCenter}>
              <Animated.View style={[st.recDot, { backgroundColor: colors.error, opacity: indicatorPulse }]} />
              <Text style={[st.recTime, { color: colors.text }]}>{formatDuration(recordingDuration)}</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={st.recBarLeft}>
              <Animated.View style={[st.recDot, { backgroundColor: colors.error, opacity: indicatorPulse }]} />
              <Text style={[st.recTime, { color: colors.text }]}>{formatDuration(recordingDuration)}</Text>
            </View>
            <Animated.View style={[st.slideHint, { transform: [{ translateX: cancelSlideX }] }]}>
              <ChevronUp color={colors.textTertiary} size={14} style={{ transform: [{ rotate: '-90deg' }] }} />
              <Text style={[st.slideText, { color: colors.textTertiary }]}>Сдвиньте влево</Text>
            </Animated.View>
          </>
        )}
      </Animated.View>

      {/* Send button — always visible during recording */}
      {sendButton}
    </View>
  );
}

export const VoiceRecorder = memo(VoiceRecorderInner);

const st = StyleSheet.create({
  micWrap: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  sendCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recorderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  lockHint: {
    position: 'absolute',
    right: 9,
    bottom: 52,
    width: 36,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    zIndex: 20,
  },
  recBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 8,
    height: 44,
  },
  recBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recBarCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'center',
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recTime: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  slideHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  slideText: {
    fontSize: 13,
    fontWeight: '500',
  },
  lockedBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockedCancelBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

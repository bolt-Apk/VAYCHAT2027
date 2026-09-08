import { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated } from 'react-native';
import { X, Pause, Play, Mic, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { useVoicePlayer, useVoiceProgress } from '@/lib/voice-player';
import { useAppearance } from '@/lib/appearance-context';

export default function VoiceMiniPlayer() {
  const { state, play, pause, stop, toggleSpeed } = useVoicePlayer();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const slideAnim = useRef(new Animated.Value(-60)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const hasTrack = !!state.track;

  useEffect(() => {
    if (hasTrack) {
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: -60, duration: 200, useNativeDriver: true }).start();
    }
  }, [hasTrack, slideAnim]);

  useEffect(() => {
    if (state.playing) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state.playing, pulseAnim]);

  if (!state.track) return null;

  const isInsideTrackChat = pathname === `/chat/${state.track.conversationId}`;
  if (isInsideTrackChat) return null;

  return <VoiceMiniPlayerInner state={state} colors={colors} insets={insets} pulseAnim={pulseAnim} slideAnim={slideAnim} />;
}

function VoiceMiniPlayerInner({ state, colors, insets, pulseAnim, slideAnim }: { state: any; colors: any; insets: any; pulseAnim: any; slideAnim: any }) {
  const { pause, play, stop, toggleSpeed } = useVoicePlayer();
  const progress = useVoiceProgress();
  const elapsed = Math.round(state.track.duration * progress);
  const total = state.track.duration;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  const progressPct = `${Math.round(progress * 100)}%` as `${number}%`;

  const topPad = Platform.OS !== 'web' ? insets.top : 0;

  return (
    <Animated.View style={[styles.wrapper, {
      paddingTop: topPad,
      backgroundColor: colors.backgroundSecondary,
      transform: [{ translateY: slideAnim }],
    }]}>
      <View style={[styles.container, { borderBottomColor: colors.border }]}>
        <View style={styles.row}>
          <Animated.View style={[styles.micDot, {
            backgroundColor: `${colors.primary}18`,
            transform: [{ scale: pulseAnim }],
          }]}>
            <Mic color={colors.primary} size={14} />
          </Animated.View>

          <View style={styles.info}>
            <Text style={[styles.sender, { color: colors.text }]} numberOfLines={1}>
              {state.track.senderName}
            </Text>
            <Text style={[styles.time, { color: colors.textSecondary }]}>
              {fmt(elapsed)} / {fmt(total)}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.speedBtn, { backgroundColor: `${colors.primary}12` }]}
            onPress={toggleSpeed}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityLabel={"Скорость " + state.speed + "x"}
          >
            <Text style={[styles.speedText, { color: colors.primary }]}>{state.speed}x</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlBtn, { backgroundColor: `${colors.primary}12` }]}
            onPress={state.playing ? pause : () => { if (state.track) play(state.track); }}
            activeOpacity={0.6}
            hitSlop={8}
            accessibilityLabel={state.playing ? "Пауза" : "Воспроизведение"}
          >
            {state.playing ? (
              <Pause color={colors.primary} size={16} fill={colors.primary} />
            ) : (
              <Play color={colors.primary} size={16} fill={colors.primary} />
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.closeBtn} onPress={stop} activeOpacity={0.6} hitSlop={8} accessibilityLabel="Закрыть плеер">
            <X color={colors.textTertiary} size={15} />
          </TouchableOpacity>
        </View>

        <View style={[styles.progressTrack, { backgroundColor: `${colors.primary}10` }]}>
          <View style={[styles.progressFill, { width: progressPct, backgroundColor: colors.primary }]} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 44,
    gap: 10,
  },
  micDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    gap: 1,
  },
  sender: {
    fontSize: 13,
    fontWeight: '600',
  },
  time: {
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  speedBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    minWidth: 40,
    alignItems: 'center' as const,
  },
  speedText: {
    fontSize: 12,
    fontWeight: '700',
  },
  controlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    padding: 4,
  },
  progressTrack: {
    height: 3,
  },
  progressFill: {
    height: 3,
    borderRadius: 1.5,
  },
});

import { memo } from 'react';
import { StyleSheet, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Reply } from 'lucide-react-native';

interface Props {
  children: React.ReactNode;
  onSwipeReply: () => void;
  isMine: boolean;
  accentColor: string;
  enabled?: boolean;
}

const SWIPE_THRESHOLD = 60;

let Haptics: typeof import('expo-haptics') | null = null;
if (Platform.OS !== 'web') {
  try { Haptics = require('expo-haptics'); } catch {}
}

function triggerHaptic() {
  if (Haptics) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

export default memo(function SwipeableMessage({ children, onSwipeReply, isMine, accentColor, enabled = true }: Props) {
  const translateX = useSharedValue(0);
  const triggered = useSharedValue(false);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(isMine ? -10 : 10)
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      const dx = isMine
        ? Math.min(0, Math.max(e.translationX, -80))
        : Math.max(0, Math.min(e.translationX, 80));
      translateX.value = dx;
      if (Math.abs(dx) >= SWIPE_THRESHOLD && !triggered.value) {
        triggered.value = true;
        runOnJS(triggerHaptic)();
      }
    })
    .onEnd(() => {
      if (triggered.value) {
        runOnJS(onSwipeReply)();
      }
      triggered.value = false;
      translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
    });

  const messageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    return {
      opacity: interpolate(absX, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(absX, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP) }],
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
          style={styles.wrapper}
          accessible
          accessibilityActions={[{ name: 'reply', label: 'Ответить' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'reply') {
              onSwipeReply();
            }
          }}
        >
        <Animated.View style={[
          styles.replyHint,
          isMine ? styles.replyHintLeft : styles.replyHintRight,
          iconStyle,
        ]}>
          <Reply color={accentColor} size={18} />
        </Animated.View>
        <Animated.View style={messageStyle}>
          {children}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  replyHint: {
    position: 'absolute',
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyHintLeft: {
    left: 8,
  },
  replyHintRight: {
    right: 8,
  },
});

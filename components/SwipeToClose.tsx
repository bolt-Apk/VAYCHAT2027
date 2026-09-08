import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';

interface SwipeToCloseProps {
  onClose: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Minimum translation (px) to trigger close. Default 120. */
  threshold?: number;
  /** Minimum velocity (px/s) to trigger close. Default 700. */
  velocityThreshold?: number;
}

/**
 * Wraps fullscreen content with a downward-swipe-to-close gesture.
 * The content slides down following the finger and springs back if
 * the threshold is not reached.
 */
export default function SwipeToClose({
  onClose,
  children,
  style,
  threshold = 120,
  velocityThreshold = 700,
}: SwipeToCloseProps) {
  const translateY = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetY([0, 12])
    .failOffsetX([-30, 30])
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (e.translationY > threshold || e.velocityY > velocityThreshold) {
        runOnJS(onClose)();
        translateY.value = 0;
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1 }, style, animStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

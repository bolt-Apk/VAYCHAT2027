import { memo, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

interface TypingDotsProps {
  color: string;
  size?: number;
}

function Dot({ color, size, delay }: { color: string; size: number; delay: number }) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(translateY, { toValue: -size * 0.6, duration: 250, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  const dotStyle = useMemo(() => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
    transform: [{ translateY }],
  }), [size, color, translateY]);

  return <Animated.View style={dotStyle} />;
}

export default memo(function TypingDots({ color, size = 5 }: TypingDotsProps) {
  const containerStyle = useMemo(() => [styles.container, { gap: size * 0.6 }], [size]);
  return (
    <View style={containerStyle}>
      <Dot color={color} size={size} delay={0} />
      <Dot color={color} size={size} delay={150} />
      <Dot color={color} size={size} delay={300} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 16,
  },
});

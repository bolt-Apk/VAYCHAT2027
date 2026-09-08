import { memo, useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Platform } from 'react-native';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export const SkeletonBlock = memo(function SkeletonBlock({
  width = '100%',
  height = 12,
  borderRadius = 6,
  style,
}: SkeletonProps) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius, opacity },
        ss.block,
        style,
      ]}
    />
  );
});

export const ChatListSkeleton = memo(function ChatListSkeleton({ count = 8, color }: { count?: number; color: string }) {
  return (
    <View style={ss.container}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={ss.chatRow}>
          <SkeletonBlock width={52} height={52} borderRadius={26} style={{ backgroundColor: color }} />
          <View style={ss.chatLines}>
            <SkeletonBlock width={100 + (i % 3) * 40} height={12} style={{ backgroundColor: color, marginBottom: 10 }} />
            <SkeletonBlock width={160 + (i % 2) * 50} height={10} style={{ backgroundColor: color }} />
          </View>
          <SkeletonBlock width={32} height={10} borderRadius={4} style={{ backgroundColor: color, position: 'absolute', right: 16, top: 18 }} />
        </View>
      ))}
    </View>
  );
});

export const CallsListSkeleton = memo(function CallsListSkeleton({ count = 6, color }: { count?: number; color: string }) {
  return (
    <View style={ss.container}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={ss.chatRow}>
          <SkeletonBlock width={46} height={46} borderRadius={23} style={{ backgroundColor: color }} />
          <View style={ss.chatLines}>
            <SkeletonBlock width={90 + (i % 4) * 25} height={12} style={{ backgroundColor: color, marginBottom: 10 }} />
            <SkeletonBlock width={60 + (i % 3) * 20} height={9} style={{ backgroundColor: color }} />
          </View>
          <SkeletonBlock width={24} height={24} borderRadius={12} style={{ backgroundColor: color, position: 'absolute', right: 16, top: 14 }} />
        </View>
      ))}
    </View>
  );
});

export const MessagesSkeleton = memo(function MessagesSkeleton({ count = 5, color }: { count?: number; color: string }) {
  return (
    <View style={ss.messagesContainer}>
      {Array.from({ length: count }).map((_, i) => {
        const isRight = i % 3 !== 0;
        const bubbleWidth = 140 + (i % 4) * 40;
        const bubbleHeight = 32 + (i % 3) * 14;
        return (
          <View key={i} style={[ss.msgRow, isRight ? ss.msgRight : ss.msgLeft]}>
            <SkeletonBlock
              width={bubbleWidth}
              height={bubbleHeight}
              borderRadius={16}
              style={{ backgroundColor: color }}
            />
          </View>
        );
      })}
    </View>
  );
});

export const ChannelPostSkeleton = memo(function ChannelPostSkeleton({ count = 3, color }: { count?: number; color: string }) {
  return (
    <View style={ss.container}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={ss.postCard}>
          <View style={ss.postHeader}>
            <SkeletonBlock width={36} height={36} borderRadius={18} style={{ backgroundColor: color }} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <SkeletonBlock width={100} height={11} style={{ backgroundColor: color, marginBottom: 6 }} />
              <SkeletonBlock width={60} height={9} style={{ backgroundColor: color }} />
            </View>
          </View>
          <SkeletonBlock width="100%" height={10} style={{ backgroundColor: color, marginTop: 14, marginBottom: 8 }} />
          <SkeletonBlock width="75%" height={10} style={{ backgroundColor: color, marginBottom: 12 }} />
          {i % 2 === 0 && (
            <SkeletonBlock width="100%" height={160} borderRadius={12} style={{ backgroundColor: color, marginTop: 4 }} />
          )}
        </View>
      ))}
    </View>
  );
});

const ss = StyleSheet.create({
  container: { paddingVertical: 8 },
  block: { backgroundColor: '#1C2C3A' },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chatLines: { marginLeft: 12, flex: 1 },
  messagesContainer: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 12,
  },
  msgRow: { width: '100%' },
  msgLeft: { alignItems: 'flex-start' },
  msgRight: { alignItems: 'flex-end' },
  postCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  postHeader: { flexDirection: 'row', alignItems: 'center' },
});

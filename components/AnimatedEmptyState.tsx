import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { MessageCircle, Users, Megaphone, MessagesSquare } from 'lucide-react-native';
import { useAppearance } from '@/lib/appearance-context';

type SectionType = 'all' | 'direct' | 'channels' | 'groups';

interface AnimatedEmptyStateProps {
  section: SectionType;
}

const sectionConfig: Record<SectionType, { title: string; subtitle: string; color: string }> = {
  all: {
    title: 'Нет сообщений',
    subtitle: 'Начните общение, нажав "+" в правом верхнем углу',
    color: '#3B82F6',
  },
  direct: {
    title: 'Нет личных чатов',
    subtitle: 'Напишите кому-нибудь, чтобы начать переписку',
    color: '#10B981',
  },
  channels: {
    title: 'Нет каналов',
    subtitle: 'Подпишитесь на канал или создайте свой',
    color: '#F59E0B',
  },
  groups: {
    title: 'Нет групп',
    subtitle: 'Создайте группу для общения с друзьями',
    color: '#6366F1',
  },
};

function AnimatedIcon({ section, color }: { section: SectionType; color: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const bounce1 = useRef(new Animated.Value(0)).current;
  const bounce2 = useRef(new Animated.Value(0)).current;
  const bounce3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();

    if (section === 'channels') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(rotate, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(rotate, { toValue: -1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(rotate, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay(2400),
        ])
      ).start();
    }

    if (section === 'groups') {
      const animateBounce = (val: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(val, { toValue: 1, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(val, { toValue: 0, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.delay(2200 - delay),
          ])
        );
      animateBounce(bounce1, 0).start();
      animateBounce(bounce2, 200).start();
      animateBounce(bounce3, 400).start();
    }
  }, [section]);

  const floatTranslate = float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  if (section === 'all') {
    return (
      <View style={iconStyles.container}>
        <Animated.View style={[iconStyles.mainIcon, { transform: [{ translateY: floatTranslate }, { scale: pulseScale }] }]}>
          <MessagesSquare color={color} size={44} strokeWidth={1.5} />
        </Animated.View>
        <Animated.View style={[iconStyles.dot, iconStyles.dot1, { backgroundColor: color, opacity: pulse }]} />
        <Animated.View style={[iconStyles.dot, iconStyles.dot2, { backgroundColor: color, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }]} />
        <Animated.View style={[iconStyles.dot, iconStyles.dot3, { backgroundColor: color, opacity: pulse }]} />
      </View>
    );
  }

  if (section === 'direct') {
    const scale1 = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1, 0.4] });
    const scale2 = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.4, 1] });
    return (
      <View style={iconStyles.container}>
        <Animated.View style={[iconStyles.mainIcon, { transform: [{ translateY: floatTranslate }] }]}>
          <MessageCircle color={color} size={44} strokeWidth={1.5} />
        </Animated.View>
        <Animated.View style={[iconStyles.wave, iconStyles.wave1, { borderColor: color, transform: [{ scale: scale1 }], opacity: scale1 }]} />
        <Animated.View style={[iconStyles.wave, iconStyles.wave2, { borderColor: color, transform: [{ scale: scale2 }], opacity: scale2 }]} />
      </View>
    );
  }

  if (section === 'channels') {
    const rotateVal = rotate.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-8deg', '0deg', '8deg'] });
    return (
      <View style={iconStyles.container}>
        <Animated.View style={[iconStyles.mainIcon, { transform: [{ translateY: floatTranslate }, { rotate: rotateVal }] }]}>
          <Megaphone color={color} size={44} strokeWidth={1.5} />
        </Animated.View>
        <Animated.View style={[iconStyles.soundLine, iconStyles.soundLine1, { backgroundColor: color, opacity: pulse }]} />
        <Animated.View style={[iconStyles.soundLine, iconStyles.soundLine2, { backgroundColor: color, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }]} />
        <Animated.View style={[iconStyles.soundLine, iconStyles.soundLine3, { backgroundColor: color, opacity: pulse }]} />
      </View>
    );
  }

  // groups
  const b1Y = bounce1.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const b2Y = bounce2.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const b3Y = bounce3.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  return (
    <View style={iconStyles.container}>
      <Animated.View style={[iconStyles.mainIcon, { transform: [{ translateY: floatTranslate }] }]}>
        <Users color={color} size={44} strokeWidth={1.5} />
      </Animated.View>
      <View style={iconStyles.dotsRow}>
        <Animated.View style={[iconStyles.personDot, { backgroundColor: color, transform: [{ translateY: b1Y }] }]} />
        <Animated.View style={[iconStyles.personDot, { backgroundColor: color, transform: [{ translateY: b2Y }], marginHorizontal: 6 }]} />
        <Animated.View style={[iconStyles.personDot, { backgroundColor: color, transform: [{ translateY: b3Y }] }]} />
      </View>
    </View>
  );
}

export default function AnimatedEmptyState({ section }: AnimatedEmptyStateProps) {
  const { colors } = useAppearance();
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(20)).current;
  const config = sectionConfig[section];

  useEffect(() => {
    fadeIn.setValue(0);
    slideUp.setValue(20);
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [section]);

  return (
    <Animated.View style={[styles.container, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>
      <View style={[styles.iconCircle, { backgroundColor: config.color + '14' }]}>
        <AnimatedIcon section={section} color={config.color} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{config.title}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{config.subtitle}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 48,
    paddingBottom: 60,
  },
  iconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0.1,
    maxWidth: 260,
  },
});

const iconStyles = StyleSheet.create({
  container: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainIcon: {
    zIndex: 2,
  },
  dot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dot1: { top: 8, right: 12 },
  dot2: { bottom: 10, left: 10 },
  dot3: { top: 14, left: 16 },
  wave: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
  },
  wave1: {},
  wave2: {},
  soundLine: {
    position: 'absolute',
    width: 3,
    height: 12,
    borderRadius: 1.5,
    right: 6,
  },
  soundLine1: { top: 18 },
  soundLine2: { top: 30 },
  soundLine3: { top: 42 },
  dotsRow: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: 6,
  },
  personDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

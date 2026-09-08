import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Camera,
  Mic,
  Bell,
  Image as ImageIcon,
  Phone,
  Check,
  ChevronRight,
  Shield,
  MessageCircle,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useAppearance } from '@/lib/appearance-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_INVITE_KEY } from '@/lib/pending-invite';

const PERMISSIONS_COMPLETED_KEY = '@vaychat_permissions_completed';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PermissionItem {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  granted: boolean | null;
}

export default function PermissionsScreen() {
  const router = useRouter();
  const { colors } = useAppearance();
  const [currentStep, setCurrentStep] = useState(0);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const permissionSteps = [
    {
      id: 'camera',
      icon: (color: string) => <Camera size={48} color={color} strokeWidth={1.5} />,
      title: 'Камера',
      description: 'Для видеозвонков и отправки фото в чатах',
    },
    {
      id: 'microphone',
      icon: (color: string) => <Mic size={48} color={color} strokeWidth={1.5} />,
      title: 'Микрофон',
      description: 'Для голосовых звонков и записи голосовых сообщений',
    },
    {
      id: 'photos',
      icon: (color: string) => <ImageIcon size={48} color={color} strokeWidth={1.5} />,
      title: 'Фотографии',
      description: 'Для отправки изображений и видео из галереи',
    },
    {
      id: 'notifications',
      icon: (color: string) => <Bell size={48} color={color} strokeWidth={1.5} />,
      title: 'Уведомления',
      description: 'Для оповещений о новых сообщениях и звонках',
    },
  ];

  useEffect(() => {
    setPermissions(
      permissionSteps.map((s) => ({
        id: s.id,
        icon: s.icon(colors.primary),
        title: s.title,
        description: s.description,
        granted: null,
      }))
    );

    const entryAnim = Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    entryAnim.start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, {
          toValue: 1.08,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconPulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    return () => {
      entryAnim.stop();
      pulseLoop.stop();
    };
  }, []);

  const animateTransition = (callback: () => void) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      callback();
      slideAnim.setValue(40);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const requestPermission = async () => {
    const step = permissionSteps[currentStep];
    let granted = false;

    if (Platform.OS === 'web') {
      granted = true;
    } else {
      switch (step.id) {
        case 'camera': {
          const result = await ImagePicker.requestCameraPermissionsAsync();
          granted = result.granted;
          break;
        }
        case 'microphone': {
          const { Audio } = await import('expo-av');
          const result = await Audio.requestPermissionsAsync();
          granted = result.granted;
          break;
        }
        case 'photos': {
          const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
          granted = result.granted;
          break;
        }
        case 'notifications': {
          const result = await Notifications.requestPermissionsAsync();
          granted = result.status === 'granted';
          break;
        }
      }
    }

    updatePermissionStatus(currentStep, granted);
    goToNext();
  };



  const updatePermissionStatus = (index: number, granted: boolean) => {
    setPermissions((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], granted };
      }
      return updated;
    });
  };

  const goToNext = () => {
    if (currentStep < permissionSteps.length - 1) {
      const nextStep = currentStep + 1;
      Animated.timing(progressAnim, {
        toValue: nextStep / permissionSteps.length,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
      animateTransition(() => setCurrentStep(nextStep));
    } else {
      finishOnboarding();
    }
  };

  const finishOnboarding = async () => {
    await AsyncStorage.setItem(PERMISSIONS_COMPLETED_KEY, 'true');
    const pendingInvite = await AsyncStorage.getItem(PENDING_INVITE_KEY);

    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      if (pendingInvite) {
        AsyncStorage.removeItem(PENDING_INVITE_KEY);
        router.replace(`/u/${pendingInvite}` as any);
      } else {
        router.replace('/(tabs)');
      }
    });
  };

  const step = permissionSteps[currentStep];
  const isLastStep = currentStep === permissionSteps.length - 1;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <View style={[styles.logoContainer, { backgroundColor: colors.primary + '15' }]}>
            <MessageCircle size={22} color={colors.primary} strokeWidth={2} />
          </View>
          <Text style={[styles.logoText, { color: colors.text }]}>VayChat</Text>
        </View>

        <View style={styles.progressContainer}>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <Animated.View
              style={[
                styles.progressBar,
                {
                  backgroundColor: colors.primary,
                  width: progressWidth,
                },
              ]}
            />
          </View>
          <Text style={[styles.stepCounter, { color: colors.textSecondary }]}>
            {currentStep + 1} / {permissionSteps.length}
          </Text>
        </View>
      </View>

      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
          },
        ]}
      >
        <View style={styles.iconSection}>
          <Animated.View
            style={[
              styles.iconCircle,
              {
                backgroundColor: colors.primary + '10',
                borderColor: colors.primary + '20',
                transform: [{ scale: iconPulse }],
              },
            ]}
          >
            <View
              style={[
                styles.iconInner,
                {
                  backgroundColor: colors.primary + '18',
                },
              ]}
            >
              {step.icon(colors.primary)}
            </View>
          </Animated.View>

          <View style={styles.statusDots}>
            {permissionSteps.map((_, i) => {
              const p = permissions[i];
              const isActive = i === currentStep;
              const isGranted = p?.granted === true;
              const isDenied = p?.granted === false;
              return (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: isActive
                        ? colors.primary
                        : isGranted
                        ? colors.success
                        : isDenied
                        ? colors.textTertiary
                        : colors.border,
                      width: isActive ? 24 : 8,
                    },
                  ]}
                />
              );
            })}
          </View>
        </View>

        <View style={styles.textSection}>
          <Text style={[styles.title, { color: colors.text }]}>
            {step.title}
          </Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {step.description}
          </Text>
        </View>

        <View style={styles.securityNote}>
          <Shield size={16} color={colors.textTertiary} strokeWidth={1.5} />
          <Text style={[styles.securityText, { color: colors.textTertiary }]}>
            Вы можете изменить разрешения в настройках устройства
          </Text>
        </View>
      </Animated.View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.allowButton, { backgroundColor: colors.primary }]}
          onPress={requestPermission}
          activeOpacity={0.8}
        >
          <Text style={styles.allowButtonText}>Продолжить</Text>
          {isLastStep ? (
            <Check size={20} color="#FFFFFF" strokeWidth={2.5} />
          ) : (
            <ChevronRight size={20} color="#FFFFFF" strokeWidth={2.5} />
          )}
        </TouchableOpacity>


      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  logoContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  logoText: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  stepCounter: {
    fontSize: 13,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'right',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  iconCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 32,
  },
  iconInner: {
    width: 110,
    height: 110,
    borderRadius: 55,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  textSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 300,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  securityText: {
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 24,
    gap: 12,
  },
  allowButton: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  allowButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },

});

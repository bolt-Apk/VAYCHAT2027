import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Animated, Easing,
  Dimensions, PanResponder, Modal, Pressable, TextInput, FlatList, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  PhoneOff, Phone, Video, VideoOff, Volume2, MicOff, Mic,
  Wifi, WifiOff, SwitchCamera, Maximize, Minimize,
  Monitor, Users, Star, X, MessageSquare, Lock,
  Pause, Play, Clock, Circle, MoreHorizontal,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import { WebRTCCall, ConnectionStats } from '@/lib/webrtc';
import { createRingtone } from '@/lib/ringtone';
import CachedImage from '@/components/CachedImage';
import { useActiveCall } from '@/app/_layout';
import { useKeepAwake } from 'expo-keep-awake';

let AudioModule: any = null;
if (Platform.OS !== 'web') {
  try { AudioModule = require('expo-av').Audio; } catch {}
}

let RTCView: any = null;
if (Platform.OS !== 'web') {
  try { RTCView = require('react-native-webrtc').RTCView; } catch {}
}

const PIP_W = 110;
const PIP_H = 150;
const PIP_MARGIN = 12;
const HIDE_DELAY = 4000;
const { width: SW, height: SH } = Dimensions.get('window');

const ISSUE_TAGS = [
  { key: 'audio_quality', label: 'Качество звука' },
  { key: 'video_freeze', label: 'Зависание видео' },
  { key: 'delay', label: 'Задержка' },
  { key: 'echo', label: 'Эхо' },
  { key: 'disconnect', label: 'Обрыв связи' },
  { key: 'one_way_audio', label: 'Односторонний звук' },
];

function useCallTones() {
  const outgoing = useMemo(() => createRingtone('outgoing'), []);
  const busy = useMemo(() => createRingtone('busy'), []);
  const end = useMemo(() => createRingtone('end'), []);
  return { outgoing, busy, end };
}

export default function CallScreen() {
  const { type, userId, name, callId, role, groupCall, conversationId } = useLocalSearchParams<{
    type: string; userId: string; name: string; callId?: string; role?: string;
    groupCall?: string; conversationId?: string;
  }>();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const { setActiveCall } = useActiveCall();

  const [callState, setCallState] = useState<'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'ended' | 'declined'>('ringing');
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(type === 'video');
  const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'fair' | 'poor' | null>(null);
  const [rtt, setRtt] = useState<number | null>(null);
  const [facingFront, setFacingFront] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreenSharing, setRemoteScreenSharing] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [remoteOnHold, setRemoteOnHold] = useState(false);
  const [groupParticipants, setGroupParticipants] = useState<{ user_id: string; display_name: string; status: string }[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Feedback state
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackIssues, setFeedbackIssues] = useState<string[]>([]);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  // Call recording state
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<any>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Voice/Video switch state
  const [callMediaType, setCallMediaType] = useState<'voice' | 'video'>(type === 'video' ? 'video' : 'voice');

  // Silence auto-end
  const [silenceTimerEnabled, setSilenceTimerEnabled] = useState(false);
  const [silenceTimeout, setSilenceTimeout] = useState(60);
  const [silenceCountdown, setSilenceCountdown] = useState(0);
  const silenceStartRef = useRef<number | null>(null);
  const silenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const lastAudioLevelRef = useRef<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webrtcRef = useRef<WebRTCCall | null>(null);
  const durationRef = useRef(0);
  const localVideoRef = useRef<any>(null);
  const remoteVideoRef = useRef<any>(null);
  const remoteAudioRef = useRef<any>(null);
  const [localStreamURL, setLocalStreamURL] = useState<string | null>(null);
  const [remoteStreamURL, setRemoteStreamURL] = useState<string | null>(null);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  // Pending streams saved when video elements don't exist yet (callState='ringing')
  const pendingLocalStreamRef = useRef<any>(null);
  const pendingRemoteStreamRef = useRef<any>(null);
  const callEndedRef = useRef(false);
  const mountedRef = useRef(true);
  const callStateRef = useRef(callState);
  callStateRef.current = callState;

  useKeepAwake();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Sync call state to global context for floating PIP widget
  useEffect(() => {
    if (callState === 'ended' || callState === 'declined' || callState === 'failed') {
      setActiveCall(null);
    } else if (callId) {
      setActiveCall({
        callId,
        callType: callMediaType,
        peerName: name || '',
        peerId: userId || '',
        peerAvatarUrl: avatarUrl,
        duration,
        muted,
        state: callState as any,
        conversationId: conversationId || undefined,
      });
    }
  }, [callState, callMediaType, name, userId, callId, duration, muted, conversationId, avatarUrl, setActiveCall]);

  useEffect(() => {
    return () => { setActiveCall(null); };
  }, [setActiveCall]);

  const tones = useCallTones();
  const isInitiator = role !== 'receiver';
  const isVideo = callMediaType === 'video';
  const isGroupCall = groupCall === 'true';
  const showVideoUI = isVideo && (callState === 'connected' || callState === 'connecting' || callState === 'reconnecting');

  // When video elements become visible, reattach any streams that arrived before the DOM elements existed
  useEffect(() => {
    if (!showVideoUI || Platform.OS !== 'web') return;
    const safePlay = (el: HTMLVideoElement | HTMLAudioElement) => {
      el.play().catch(() => {
        const resume = () => {
          el.play().catch(() => {});
          document.removeEventListener('click', resume);
          document.removeEventListener('touchstart', resume);
        };
        document.addEventListener('click', resume, { once: true });
        document.addEventListener('touchstart', resume, { once: true });
      });
    };
    const attachPending = () => {
      if (pendingLocalStreamRef.current) {
        const el = document.getElementById('local-video') as HTMLVideoElement | null;
        if (el && el.srcObject !== pendingLocalStreamRef.current) {
          el.srcObject = pendingLocalStreamRef.current;
          el.muted = true;
          safePlay(el);
          localVideoRef.current = el;
        }
      }
      if (pendingRemoteStreamRef.current) {
        if (isVideo) {
          const el = document.getElementById('remote-video') as HTMLVideoElement | null;
          if (el && el.srcObject !== pendingRemoteStreamRef.current) {
            el.srcObject = pendingRemoteStreamRef.current;
            safePlay(el);
            remoteVideoRef.current = el;
          }
        }
        const a = document.getElementById('remote-audio') as HTMLAudioElement | null;
        if (a && a.srcObject !== pendingRemoteStreamRef.current) {
          a.srcObject = pendingRemoteStreamRef.current;
          safePlay(a);
          remoteAudioRef.current = a;
        }
      }
    };
    const t1 = setTimeout(attachPending, 100);
    const t2 = setTimeout(attachPending, 500);
    const t3 = setTimeout(attachPending, 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [showVideoUI, isVideo]);

  useEffect(() => {
    if (Platform.OS === 'web' || !AudioModule) return;
    AudioModule.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: !speakerOn && !isVideo,
      defaultToSpeakerIOS: speakerOn,
    }).catch(() => {});
  }, [isVideo, speakerOn]);

  // Load avatar
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('profiles').select('avatar_url').eq('id', userId).maybeSingle();
      if (data?.avatar_url && !cancelled) setAvatarUrl(data.avatar_url);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Transition animations
  const screenFade = useRef(new Animated.Value(0)).current;
  const contentScale = useRef(new Animated.Value(0.9)).current;
  const stateTransition = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(screenFade, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(contentScale, { toValue: 1, tension: 60, friction: 12, useNativeDriver: true }),
    ]).start();
  }, []);

  // Animate state transitions
  const prevCallState = useRef(callState);
  useEffect(() => {
    if (prevCallState.current !== callState) {
      Animated.sequence([
        Animated.timing(stateTransition, { toValue: 0.7, duration: 100, useNativeDriver: true }),
        Animated.timing(stateTransition, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
      prevCallState.current = callState;
    }
  }, [callState]);

  // Connecting dots animation
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (callState === 'connecting' || callState === 'ringing') {
      const anim = Animated.loop(
        Animated.stagger(200, [
          Animated.sequence([
            Animated.timing(dot1, { toValue: 1, duration: 400, useNativeDriver: true }),
            Animated.timing(dot1, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(dot2, { toValue: 1, duration: 400, useNativeDriver: true }),
            Animated.timing(dot2, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(dot3, { toValue: 1, duration: 400, useNativeDriver: true }),
            Animated.timing(dot3, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          ]),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [callState]);

  // Group participants
  useEffect(() => {
    if (!isGroupCall || !callId) return;
    let cancelled = false;
    const loadParticipants = async () => {
      const { data: parts } = await supabase.from('call_participants').select('user_id, status').eq('call_id', callId);
      if (!parts || cancelled) return;
      const userIds = parts.map(p => p.user_id);
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', userIds);
      if (cancelled) return;
      const profileMap = new Map((profiles || []).map(p => [p.id, p.display_name]));
      setGroupParticipants(parts.map(p => ({
        user_id: p.user_id, display_name: profileMap.get(p.user_id) || 'Участник', status: p.status,
      })));
    };
    loadParticipants();
    const channel = supabase.channel(`call-participants-${callId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_participants', filter: `call_id=eq.${callId}` }, () => loadParticipants())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [isGroupCall, callId]);

  // Controls auto-hide
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  const showControls = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [controlsOpacity]);

  const scheduleHideControls = useCallback(() => {
    if (!fullscreen) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 400, useNativeDriver: true })
        .start(() => setControlsVisible(false));
    }, HIDE_DELAY);
  }, [fullscreen, controlsOpacity]);

  useEffect(() => {
    if (fullscreen && callState === 'connected') scheduleHideControls();
    else showControls();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [fullscreen, callState, scheduleHideControls, showControls]);

  const lastTapRef = useRef(0);
  const handleScreenTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      switchCamera();
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;

    if (!fullscreen) return;
    if (controlsVisible) {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 300, useNativeDriver: true })
        .start(() => setControlsVisible(false));
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      showControls();
      scheduleHideControls();
    }
  }, [fullscreen, controlsVisible, controlsOpacity, showControls, scheduleHideControls]);

  // PIP drag — state-based tracking (no extractOffset/flattenOffset)
  const pipRestX = useRef(SW - PIP_W - PIP_MARGIN);
  const pipRestY = useRef(insets.top + 56);
  const pipPosition = useRef(new Animated.ValueXY({ x: pipRestX.current, y: pipRestY.current })).current;

  const pipPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderMove: (_, gesture) => {
        pipPosition.setValue({
          x: pipRestX.current + gesture.dx,
          y: pipRestY.current + gesture.dy,
        });
      },
      onPanResponderRelease: (_, gesture) => {
        const finalX = pipRestX.current + gesture.dx;
        const finalY = pipRestY.current + gesture.dy;
        const snapX = finalX < (SW - PIP_W) / 2 ? PIP_MARGIN : SW - PIP_W - PIP_MARGIN;
        const clampY = Math.max(PIP_MARGIN + insets.top, Math.min(finalY, SH - PIP_H - PIP_MARGIN - 140));
        Animated.spring(pipPosition, { toValue: { x: snapX, y: clampY }, useNativeDriver: false, tension: 80, friction: 10 }).start(() => {
          pipRestX.current = snapX;
          pipRestY.current = clampY;
        });
      },
    })
  ).current;

  // Ringing pulse
  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse1Op = useRef(new Animated.Value(0.35)).current;
  const pulse2Op = useRef(new Animated.Value(0.15)).current;

  useEffect(() => {
    if (callState === 'ringing') {
      const a1 = Animated.loop(Animated.sequence([
        Animated.timing(pulse1, { toValue: 1.5, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse1, { toValue: 1, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: false }),
      ]));
      const a2 = Animated.loop(Animated.sequence([
        Animated.timing(pulse1Op, { toValue: 0.5, duration: 1400, useNativeDriver: false }),
        Animated.timing(pulse1Op, { toValue: 0.05, duration: 900, useNativeDriver: false }),
      ]));
      const a3 = Animated.loop(Animated.sequence([
        Animated.delay(350),
        Animated.timing(pulse2, { toValue: 1.8, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse2, { toValue: 1, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: false }),
      ]));
      const a4 = Animated.loop(Animated.sequence([
        Animated.delay(350),
        Animated.timing(pulse2Op, { toValue: 0.3, duration: 1400, useNativeDriver: false }),
        Animated.timing(pulse2Op, { toValue: 0.02, duration: 900, useNativeDriver: false }),
      ]));
      a1.start(); a2.start(); a3.start(); a4.start();
      return () => { a1.stop(); a2.stop(); a3.stop(); a4.stop(); };
    }
    const fadeAnims = [
      Animated.timing(pulse1, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.timing(pulse2, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.timing(pulse1Op, { toValue: 0, duration: 300, useNativeDriver: false }),
      Animated.timing(pulse2Op, { toValue: 0, duration: 300, useNativeDriver: false }),
    ];
    fadeAnims.forEach(a => a.start());
    return () => { fadeAnims.forEach(a => a.stop()); };
  }, [callState]);

  // Voice call connected breathing animation
  const voiceBreathing = useRef(new Animated.Value(1)).current;
  const voiceGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (callState === 'connected' && !showVideoUI && !onHold) {
      const breathe = Animated.loop(Animated.sequence([
        Animated.timing(voiceBreathing, { toValue: 1.04, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(voiceBreathing, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      const glow = Animated.loop(Animated.sequence([
        Animated.timing(voiceGlow, { toValue: 0.25, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(voiceGlow, { toValue: 0.05, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      breathe.start(); glow.start();
      return () => { breathe.stop(); glow.stop(); };
    }
    voiceBreathing.setValue(1);
    voiceGlow.setValue(0);
  }, [callState, showVideoUI, onHold]);

  // Video connecting overlay animations
  const vidOverlayOpacity = useRef(new Animated.Value(1)).current;
  const vidPulse1 = useRef(new Animated.Value(1)).current;
  const vidPulse2 = useRef(new Animated.Value(1)).current;
  const vidPulse1Op = useRef(new Animated.Value(0.4)).current;
  const vidPulse2Op = useRef(new Animated.Value(0.2)).current;
  const vidAvatarGlow = useRef(new Animated.Value(0)).current;
  const [vidOverlayVisible, setVidOverlayVisible] = useState(true);

  const needsVideoOverlay = showVideoUI && (
    callState === 'connecting' || callState === 'reconnecting' ||
    (Platform.OS !== 'web' && (!remoteStreamURL || !RTCView))
  );

  useEffect(() => {
    if (needsVideoOverlay) {
      setVidOverlayVisible(true);
      vidOverlayOpacity.setValue(1);

      const p1 = Animated.loop(Animated.sequence([
        Animated.timing(vidPulse1, { toValue: 1.6, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(vidPulse1, { toValue: 1, duration: 1000, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]));
      const p1o = Animated.loop(Animated.sequence([
        Animated.timing(vidPulse1Op, { toValue: 0.5, duration: 1600, useNativeDriver: true }),
        Animated.timing(vidPulse1Op, { toValue: 0.05, duration: 1000, useNativeDriver: true }),
      ]));
      const p2 = Animated.loop(Animated.sequence([
        Animated.delay(400),
        Animated.timing(vidPulse2, { toValue: 2, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(vidPulse2, { toValue: 1, duration: 1000, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]));
      const p2o = Animated.loop(Animated.sequence([
        Animated.delay(400),
        Animated.timing(vidPulse2Op, { toValue: 0.3, duration: 1600, useNativeDriver: true }),
        Animated.timing(vidPulse2Op, { toValue: 0.02, duration: 1000, useNativeDriver: true }),
      ]));
      const glow = Animated.loop(Animated.sequence([
        Animated.timing(vidAvatarGlow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(vidAvatarGlow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));

      p1.start(); p1o.start(); p2.start(); p2o.start(); glow.start();
      return () => { p1.stop(); p1o.stop(); p2.stop(); p2o.stop(); glow.stop(); };
    } else if (vidOverlayVisible) {
      Animated.timing(vidOverlayOpacity, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
        setVidOverlayVisible(false);
      });
    }
  }, [needsVideoOverlay]);

  // WebRTC
  const attachStream = useCallback((stream: any, kind: 'local' | 'remote') => {
    if (Platform.OS === 'web') {
      if (kind === 'local') pendingLocalStreamRef.current = stream;
      if (kind === 'remote') pendingRemoteStreamRef.current = stream;

      const attachToElement = (el: HTMLVideoElement | HTMLAudioElement, muted?: boolean) => {
        if (el.srcObject === stream) return;
        el.srcObject = stream;
        if (muted) el.muted = true;
        const tryPlay = () => {
          el.play().catch(() => {
            const resumeOnInteraction = () => {
              el.play().catch(() => {});
              document.removeEventListener('click', resumeOnInteraction);
              document.removeEventListener('touchstart', resumeOnInteraction);
            };
            document.addEventListener('click', resumeOnInteraction, { once: true });
            document.addEventListener('touchstart', resumeOnInteraction, { once: true });
          });
        };
        if (el.readyState >= 2) {
          tryPlay();
        } else {
          el.addEventListener('loadedmetadata', tryPlay, { once: true });
        }
      };

      const attach = (attempt = 0) => {
        if (attempt > 30) return;
        if (kind === 'local' && isVideo) {
          const el = document.getElementById('local-video') as HTMLVideoElement | null;
          if (el) { attachToElement(el, true); localVideoRef.current = el; }
          else { setTimeout(() => attach(attempt + 1), 200); }
        }
        if (kind === 'remote') {
          let attached = false;
          if (isVideo) {
            const el = document.getElementById('remote-video') as HTMLVideoElement | null;
            if (el) { attachToElement(el); remoteVideoRef.current = el; attached = true; }
          }
          const a = document.getElementById('remote-audio') as HTMLAudioElement | null;
          if (a) { attachToElement(a); remoteAudioRef.current = a; attached = true; }
          if (!attached) { setTimeout(() => attach(attempt + 1), 200); }
        }
      };
      setTimeout(() => attach(), 50);
    } else {
      if (kind === 'local') {
        localStreamRef.current = stream;
        if (stream?.toURL) {
          setLocalStreamURL(stream.toURL());
        } else if (stream?.id) {
          setLocalStreamURL(stream.id);
        }
      }
      if (kind === 'remote') {
        remoteStreamRef.current = stream;
        if (stream?.toURL) {
          setRemoteStreamURL(stream.toURL());
        } else if (stream?.id) {
          setRemoteStreamURL(stream.id);
        }
      }
    }
  }, [isVideo]);

  const feedbackShownRef = useRef(false);
  const showCallFeedback = useCallback(() => {
    if (feedbackShownRef.current) return;
    feedbackShownRef.current = true;
    if (durationRef.current >= 5) {
      if (mountedRef.current) setShowFeedback(true);
      else router.back();
    } else {
      setTimeout(() => { if (mountedRef.current) router.back(); }, 600);
    }
  }, [router]);

  const trackParticipant = useCallback(async (status: 'active' | 'left') => {
    if (!callId || !user?.id) return;
    if (status === 'active') {
      await supabase.from('call_participants').upsert({
        call_id: callId, user_id: user.id, status: 'active', joined_at: new Date().toISOString(),
      }, { onConflict: 'call_id,user_id' });
    } else {
      await supabase.from('call_participants')
        .update({ status: 'left', left_at: new Date().toISOString() })
        .eq('call_id', callId).eq('user_id', user.id);
    }
  }, [callId, user?.id]);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setDuration(p => { durationRef.current = p + 1; return p + 1; });
    }, 1000);
  }, []);

  const tonesRef = useRef(tones);
  tonesRef.current = tones;
  const attachStreamRef = useRef(attachStream);
  attachStreamRef.current = attachStream;
  const showCallFeedbackRef = useRef(showCallFeedback);
  showCallFeedbackRef.current = showCallFeedback;
  const trackParticipantRef = useRef(trackParticipant);
  trackParticipantRef.current = trackParticipant;
  const startTimerRef = useRef(startTimer);
  startTimerRef.current = startTimer;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const endCallRef = useRef<() => void>(() => {});
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const stopSilenceDetectionRef = useRef<() => void>(() => {});
  const insertCallSystemMessageRef = useRef<(status: string, dur: number) => Promise<void>>(async () => {});

  useEffect(() => {
    if (!callId || !user?.id) return;
    let channel: any = null;
    let destroyed = false;

    const initWebRTC = async () => {
      if (webrtcRef.current || destroyed) return;
      const uid = user.id;
      const rtc = new WebRTCCall(callId, uid, isInitiator);
      webrtcRef.current = rtc;

      rtc.onLocalStream = (s) => attachStreamRef.current(s, 'local');
      rtc.onRemoteStream = (s) => attachStreamRef.current(s, 'remote');
      rtc.onConnectionStateChange = (state) => {
        if (state === 'connected') {
          if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
          if (callStateRef.current !== 'connected') {
            tonesRef.current.outgoing.stop();
            setCallState('connected');
            setConnectionQuality('good');
            trackParticipantRef.current('active');
            startTimerRef.current();
          }
        } else if (state === 'connecting') {
          if (callStateRef.current === 'ringing' || callStateRef.current === 'connecting') {
            setCallState('connecting');
          }
        } else if (state === 'reconnecting') {
          setCallState('reconnecting');
          setConnectionQuality('poor');
        } else if (state === 'failed') {
          if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          setCallState('failed');
          setConnectionQuality('poor');
          const dur = durationRef.current;
          supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString(), duration: dur }).eq('id', callId);
          trackParticipantRef.current('left');
          insertCallSystemMessageRef.current('ended', dur);
          setTimeout(() => showCallFeedbackRef.current(), 2000);
        }
      };
      rtc.onStatsUpdate = (stats: ConnectionStats) => {
        setConnectionQuality(stats.quality);
        setRtt(stats.roundTripTime);
        if (stats.audioLevel !== null) lastAudioLevelRef.current = stats.audioLevel;
      };
      rtc.onHangup = () => {
        if (callEndedRef.current) return;
        callEndedRef.current = true;
        tonesRef.current.outgoing.stop();
        tonesRef.current.end.start();
        setCallState('ended');
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        stopRecordingRef.current();
        stopSilenceDetectionRef.current();
        const dur = durationRef.current;
        const status = dur > 0 ? 'ended' : 'missed';
        supabase.from('calls').update({ status, ended_at: new Date().toISOString(), duration: dur }).eq('id', callId);
        trackParticipantRef.current('left');
        insertCallSystemMessageRef.current(status, dur);
        setTimeout(() => showCallFeedbackRef.current(), 800);
      };
      rtc.onScreenShareChanged = (sharing, fromUserId) => {
        if (fromUserId !== userIdRef.current) setRemoteScreenSharing(sharing);
      };
      rtc.onRemoteHold = (held) => { setRemoteOnHold(held); };
      await rtc.start(isVideo ? 'video' : 'voice');
    };

    initWebRTC();

    if (isInitiator) {
      tones.outgoing.start();
      timeoutRef.current = setTimeout(() => {
        supabase.from('calls').update({ status: 'missed' }).eq('id', callId);
        tonesRef.current.outgoing.stop(); tonesRef.current.busy.start(); setCallState('ended');
        busyTimerRef.current = setTimeout(() => { tonesRef.current.busy.stop(); if (mountedRef.current) router.back(); }, 2000);
      }, 45000);

      channel = supabase.channel(`call-${callId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` }, (payload) => {
          const u = payload.new as { status: string };
          if (u.status === 'active') {
            tonesRef.current.outgoing.stop();
            setCallState('connecting');
          } else if (u.status === 'declined' || u.status === 'missed') {
            tonesRef.current.outgoing.stop(); tonesRef.current.busy.start(); setCallState('declined');
            setTimeout(() => { tonesRef.current.busy.stop(); if (mountedRef.current) router.back(); }, 2000);
          } else if (u.status === 'ended') {
            tonesRef.current.outgoing.stop(); tonesRef.current.end.start(); setCallState('ended');
            setTimeout(() => showCallFeedbackRef.current(), 800);
          }
        }).subscribe();
    } else {
      setCallState('connecting');
      timeoutRef.current = setTimeout(async () => {
        if (callStateRef.current === 'connecting') {
          setCallState('failed');
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          if (webrtcRef.current) { webrtcRef.current.cleanup(); webrtcRef.current = null; }
          if (callId) {
            supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString(), duration: 0 }).eq('id', callId);
          }
          setTimeout(() => showCallFeedbackRef.current(), 2000);
        }
      }, 30000);

      channel = supabase.channel(`call-receiver-${callId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` }, (payload) => {
          const u = payload.new as { status: string };
          if (u.status === 'ended' || u.status === 'missed') {
            tonesRef.current.end.start(); setCallState('ended');
            if (webrtcRef.current) { webrtcRef.current.cleanup(); webrtcRef.current = null; }
            setTimeout(() => showCallFeedbackRef.current(), 800);
          }
        }).subscribe();
    }

    return () => {
      destroyed = true;
      tonesRef.current.outgoing.stop(); tonesRef.current.busy.stop(); tonesRef.current.end.stop();
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (silenceCheckRef.current) { clearInterval(silenceCheckRef.current); silenceCheckRef.current = null; }
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} audioContextRef.current = null; }
      if (nativeRecordingRef.current) {
        try { nativeRecordingRef.current.stopAndUnloadAsync(); } catch {}
        nativeRecordingRef.current = null;
      }
      analyserRef.current = null;
      if (webrtcRef.current) { webrtcRef.current.cleanup(); webrtcRef.current = null; }
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      pendingLocalStreamRef.current = null;
      pendingRemoteStreamRef.current = null;
      if (busyTimerRef.current) { clearTimeout(busyTimerRef.current); busyTimerRef.current = null; }
      if (channel) supabase.removeChannel(channel);
      if (Platform.OS !== 'web' && AudioModule) {
        AudioModule.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        }).catch(() => {});
      }
    };
  }, [callId, user?.id, isInitiator, isVideo]);

  // Actions
  const toggleMute = () => { if (webrtcRef.current) { webrtcRef.current.toggleMute(); setMuted(webrtcRef.current.isMuted()); } scheduleHideControls(); };

  const toggleSpeaker = useCallback(() => {
    const next = !speakerOn;
    setSpeakerOn(next);
    if (Platform.OS !== 'web' && AudioModule) {
      AudioModule.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: !next && !isVideo,
        defaultToSpeakerIOS: next,
      }).catch(() => {});
    }
    scheduleHideControls();
  }, [speakerOn, isVideo]);
  const toggleVideo = () => { if (webrtcRef.current) { webrtcRef.current.toggleVideo(); setVideoEnabled(webrtcRef.current.isVideoEnabled()); } scheduleHideControls(); };
  const switchCamera = async () => {
    if (webrtcRef.current) {
      const f = await webrtcRef.current.switchCamera();
      setFacingFront(f === 'user');
      if (Platform.OS === 'web') {
        setTimeout(() => {
          const el = document.getElementById('local-video') as HTMLVideoElement | null;
          if (el) { el.srcObject = webrtcRef.current?.getLocalStream(); el.play().catch(() => {}); }
        }, 100);
      }
    }
    scheduleHideControls();
  };
  const toggleScreenShare = async () => {
    if (!webrtcRef.current) return;
    if (screenSharing) {
      await webrtcRef.current.stopScreenShare(); setScreenSharing(false);
      if (callId && user) supabase.from('call_participants').update({ is_screen_sharing: false }).eq('call_id', callId).eq('user_id', user.id);
    } else {
      const ok = await webrtcRef.current.startScreenShare(); setScreenSharing(ok);
      if (ok && callId && user) supabase.from('call_participants').update({ is_screen_sharing: true }).eq('call_id', callId).eq('user_id', user.id);
    }
    scheduleHideControls();
  };
  const toggleFullscreen = () => setFullscreen(p => !p);

  const wasMutedBeforeHold = useRef(false);
  const wasVideoOffBeforeHold = useRef(false);

  const toggleHold = () => {
    if (!webrtcRef.current) return;
    const next = !onHold;
    setOnHold(next);
    if (next) {
      wasMutedBeforeHold.current = muted;
      wasVideoOffBeforeHold.current = !videoEnabled;
      if (!muted) { webrtcRef.current.toggleMute(); setMuted(true); }
      if (isVideo && videoEnabled) { webrtcRef.current.toggleVideo(); setVideoEnabled(false); }
      webrtcRef.current.sendHold();
    } else {
      if (!wasMutedBeforeHold.current && webrtcRef.current.isMuted()) { webrtcRef.current.toggleMute(); setMuted(false); }
      if (isVideo && !wasVideoOffBeforeHold.current && !webrtcRef.current.isVideoEnabled()) { webrtcRef.current.toggleVideo(); setVideoEnabled(true); }
      webrtcRef.current.sendUnhold();
    }
    scheduleHideControls();
  };

  const callBack = async () => {
    if (!userId || !name || !user?.id) return;
    const { data, error } = await supabase.from('calls')
      .insert({ caller_id: user.id, receiver_id: userId, call_type: type || 'voice', status: 'ringing' })
      .select('id').single();
    if (error || !data?.id) return;
    router.replace({ pathname: '/call', params: { type: type || 'voice', userId, name, callId: data.id, role: 'caller' } });
  };

  const openChat = () => {
    if (conversationId) {
      router.replace({ pathname: '/chat/[id]', params: { id: conversationId } });
    } else {
      router.back();
    }
  };

  const resolvedConvIdRef = useRef<string | null>(conversationId || null);

  // ===== Voice/Video Switch =====
  const switchCallMedia = async () => {
    if (!webrtcRef.current || callState !== 'connected') return;
    const rtc = webrtcRef.current;
    if (callMediaType === 'voice') {
      const ok = await rtc.enableVideo();
      if (ok) {
        setCallMediaType('video');
        setVideoEnabled(true);
      }
    } else {
      rtc.disableVideo();
      setCallMediaType('voice');
      setVideoEnabled(false);
    }
  };

  // ===== Call Recording =====
  const nativeRecordingRef = useRef<any>(null);

  const startRecording = useCallback(async () => {
    if (!webrtcRef.current) return;
    try {
      if (Platform.OS === 'web') {
        const remote = webrtcRef.current.getRemoteStream();
        const local = webrtcRef.current.getLocalStream();
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        if (remote) { ctx.createMediaStreamSource(remote).connect(dest); }
        if (local) { ctx.createMediaStreamSource(local).connect(dest); }
        audioContextRef.current = ctx;
        recordedChunksRef.current = [];
        const preferMp4 = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4');
        const mimeType = preferMp4 ? 'audio/mp4' : 'audio/webm;codecs=opus';
        const recorder = new MediaRecorder(dest.stream, { mimeType });
        recorder.ondataavailable = (e: any) => {
          if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;
      } else if (AudioModule) {
        await AudioModule.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
        });
        const rec = new AudioModule.Recording();
        await rec.prepareToRecordAsync(AudioModule.RecordingOptionsPresets.HIGH_QUALITY);
        await rec.startAsync();
        nativeRecordingRef.current = rec;
      }
      setRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch {}
  }, []);

  const stopRecording = useCallback(async () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setRecording(false);

    const convId = resolvedConvIdRef.current;
    const uid = user?.id;

    const uploadAndSave = async (body: Blob | string, contentType: string, ext: string, duration: number) => {
      if (!convId || !uid) return;
      const fileName = `recording_${Date.now()}.${ext}`;
      const filePath = `${uid}/${fileName}`;
      let uploadBody: any = body;
      if (typeof body === 'string') {
        uploadBody = { uri: body, type: contentType, name: fileName };
      }
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(filePath, uploadBody, { contentType, cacheControl: '3600' });
      if (uploadError) return;
      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(filePath);
      if (urlData?.publicUrl) {
        await supabase.from('messages').insert({
          conversation_id: convId,
          sender_id: uid,
          content: 'Запись звонка',
          message_type: 'voice',
          media_url: urlData.publicUrl,
          media_duration: duration,
          is_read: false,
        });
      }
    };

    const webmToWav = async (webmBlob: Blob): Promise<Blob> => {
      const arrayBuffer = await webmBlob.arrayBuffer();
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      const numChannels = 1;
      const sampleRate = 16000;
      const offlineCtx = new OfflineAudioContext(numChannels, decoded.duration * sampleRate, sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start();
      const rendered = await offlineCtx.startRendering();
      const pcm = rendered.getChannelData(0);
      const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
      const view = new DataView(wavBuffer);
      const writeStr = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + pcm.length * 2, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * 2, true);
      view.setUint16(32, numChannels * 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, 'data');
      view.setUint32(40, pcm.length * 2, true);
      let offset = 44;
      for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
      audioCtx.close();
      return new Blob([wavBuffer], { type: 'audio/wav' });
    };

    if (Platform.OS === 'web') {
      if (!mediaRecorderRef.current) return;
      return new Promise<void>((resolve) => {
        const recorder = mediaRecorderRef.current;
        const recorderMime = recorder.mimeType || 'audio/webm';
        recorder.onstop = async () => {
          if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
          const rawBlob = new Blob(recordedChunksRef.current, { type: recorderMime });
          if (rawBlob.size < 100) { resolve(); return; }

          const isWebm = recorderMime.includes('webm');
          if (isWebm) {
            try {
              const wavBlob = await webmToWav(rawBlob);
              await uploadAndSave(wavBlob, 'audio/wav', 'wav', recordingTime);
            } catch {
              await uploadAndSave(rawBlob, 'audio/webm', 'webm', recordingTime);
            }
          } else {
            await uploadAndSave(rawBlob, 'audio/mp4', 'm4a', recordingTime);
          }
          mediaRecorderRef.current = null;
          resolve();
        };
        recorder.stop();
      });
    } else if (nativeRecordingRef.current) {
      try {
        await nativeRecordingRef.current.stopAndUnloadAsync();
        const uri = nativeRecordingRef.current.getURI();
        nativeRecordingRef.current = null;
        if (uri) await uploadAndSave(uri, 'audio/m4a', 'm4a', recordingTime);
      } catch {}
    }
  }, [user?.id, recordingTime]);

  // ===== Silence Auto-End =====
  const startSilenceDetection = useCallback(() => {
    if (!webrtcRef.current) return;
    silenceStartRef.current = null;
    setSilenceCountdown(0);

    if (Platform.OS === 'web') {
      try {
        const remote = webrtcRef.current.getRemoteStream();
        if (!remote) return;
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        const source = ctx.createMediaStreamSource(remote);
        source.connect(analyser);
        if (audioContextRef.current && audioContextRef.current !== ctx) {
          try { audioContextRef.current.close(); } catch {}
        }
        audioContextRef.current = ctx;
        analyserRef.current = analyser;

        silenceCheckRef.current = setInterval(() => {
          if (!analyserRef.current) return;
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a: number, b: number) => a + b, 0) / dataArray.length;
          const SILENCE_THRESHOLD = 5;
          if (avg < SILENCE_THRESHOLD) {
            if (!silenceStartRef.current) silenceStartRef.current = Date.now();
            const elapsed = Math.floor((Date.now() - silenceStartRef.current) / 1000);
            const remaining = silenceTimeout - elapsed;
            setSilenceCountdown(remaining > 0 ? remaining : 0);
            if (remaining <= 0) endCallRef.current();
          } else {
            silenceStartRef.current = null;
            setSilenceCountdown(0);
          }
        }, 1000);
      } catch {}
    } else {
      silenceCheckRef.current = setInterval(() => {
        const level = lastAudioLevelRef.current;
        if (level !== null && level < 0.02) {
          if (!silenceStartRef.current) silenceStartRef.current = Date.now();
          const elapsed = Math.floor((Date.now() - silenceStartRef.current) / 1000);
          const remaining = silenceTimeout - elapsed;
          setSilenceCountdown(remaining > 0 ? remaining : 0);
          if (remaining <= 0) endCallRef.current();
        } else {
          silenceStartRef.current = null;
          setSilenceCountdown(0);
        }
      }, 1000);
    }
  }, [silenceTimeout]);

  const stopSilenceDetection = useCallback(() => {
    if (silenceCheckRef.current) { clearInterval(silenceCheckRef.current); silenceCheckRef.current = null; }
    silenceStartRef.current = null;
    setSilenceCountdown(0);
    analyserRef.current = null;
    if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} audioContextRef.current = null; }
  }, []);

  stopRecordingRef.current = stopRecording;
  stopSilenceDetectionRef.current = stopSilenceDetection;

  useEffect(() => {
    if (silenceTimerEnabled && callState === 'connected') {
      startSilenceDetection();
    } else {
      stopSilenceDetection();
    }
    return () => stopSilenceDetection();
  }, [silenceTimerEnabled, callState, startSilenceDetection, stopSilenceDetection]);

  const systemMessageInsertedRef = useRef(false);

  const insertCallSystemMessage = async (callStatus: string, dur: number) => {
    if (systemMessageInsertedRef.current) return;
    systemMessageInsertedRef.current = true;
    if (!user?.id || !userId) return;
    if (!isInitiator) return;
    let convId = conversationId;
    if (!convId) {
      const { data: myConvs } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', user.id);
      if (myConvs) {
        const { data: shared } = await supabase.from('conversation_members')
          .select('conversation_id').eq('user_id', userId)
          .in('conversation_id', myConvs.map(c => c.conversation_id));
        if (shared && shared.length > 0) convId = shared[0].conversation_id;
      }
    }
    if (!convId) return;
    const callData = JSON.stringify({
      call_type: type || 'voice',
      status: callStatus,
      duration: dur,
      call_id: callId || null,
      caller_id: isInitiator ? user.id : userId,
    });
    await supabase.from('messages').insert({
      conversation_id: convId,
      sender_id: user.id,
      content: callData,
      message_type: 'call',
      is_read: false,
    });
  };

  insertCallSystemMessageRef.current = insertCallSystemMessage;

  const endCall = async () => {
    if (callEndedRef.current) return;
    callEndedRef.current = true;
    tones.outgoing.stop(); tones.busy.stop();
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recording) await stopRecording();
    stopSilenceDetection();
    if (webrtcRef.current) { webrtcRef.current.hangup(); webrtcRef.current = null; }
    if (durationRef.current > 0) tones.end.start();
    setCallState('ended');
    if (callId && user) {
      const status = durationRef.current > 0 ? 'ended' : 'missed';
      await supabase.from('calls').update({ status, ended_at: new Date().toISOString(), duration: durationRef.current }).eq('id', callId);
      await trackParticipant('left');
      await insertCallSystemMessage(status, durationRef.current);
    }
    setTimeout(() => showCallFeedback(), 600);
  };
  endCallRef.current = endCall;

  // Feedback
  const submitFeedback = async () => {
    if (!callId || !user || feedbackRating === 0) return;
    setFeedbackSubmitting(true);
    await supabase.from('call_feedback').insert({
      call_id: callId, rating: feedbackRating, issues: feedbackIssues,
    });
    setFeedbackSubmitted(true);
    setFeedbackSubmitting(false);
    setTimeout(() => { if (mountedRef.current) { setShowFeedback(false); router.back(); } }, 1200);
  };

  const skipFeedback = () => { setShowFeedback(false); if (mountedRef.current) router.back(); };

  const toggleIssue = (key: string) => {
    setFeedbackIssues(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const fmtDur = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const letter = (name || '?').charAt(0).toUpperCase();
  const connectedLabel = remoteOnHold ? 'На удержании' : fmtDur(duration);
  const statusLabel: Record<string, string> = {
    ringing: 'Вызов', connecting: 'Подключение', connected: connectedLabel,
    reconnecting: 'Переподключение', failed: 'Не удалось подключиться',
    ended: 'Звонок завершён', declined: 'Нет ответа',
  };

  const showDots = callState === 'ringing' || callState === 'connecting' || callState === 'reconnecting';

  // Overflow menu for secondary controls
  const [showOverflow, setShowOverflow] = useState(false);

  const ControlBtn = ({ icon, label, active, onPress, danger }: {
    icon: React.ReactNode; label: string; active?: boolean; onPress: () => void; danger?: boolean;
  }) => {
    const bg = danger ? '#E53935'
      : active ? (showVideoUI ? 'rgba(255,255,255,0.95)' : colors.primary)
      : (showVideoUI ? 'rgba(255,255,255,0.15)' : `${colors.text}0F`);
    const borderStyle = !danger && !active && showVideoUI
      ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }
      : undefined;
    return (
      <TouchableOpacity style={st.ctrlItem} onPress={onPress} activeOpacity={0.7} accessibilityLabel={label} accessibilityRole="button">
        <View style={[st.ctrlCircle, { backgroundColor: bg }, borderStyle]}>{icon}</View>
        <Text style={[st.ctrlLabel, { color: showVideoUI ? 'rgba(255,255,255,0.85)' : colors.textSecondary }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Animated.View style={[st.root, { backgroundColor: showVideoUI ? '#000' : colors.background, opacity: screenFade }]}>
      {Platform.OS === 'web' && (
        <View style={st.hidden}>
          {/* @ts-ignore */}
          <audio id="remote-audio" autoPlay playsInline />
        </View>
      )}

      {/* VIDEO: Remote + Local PIP */}
      {showVideoUI && Platform.OS === 'web' && (
        <>
          <TouchableOpacity style={st.remoteFill} onPress={handleScreenTap} activeOpacity={1}>
            {/* @ts-ignore */}
            <video id="remote-video" autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000' }} />
          </TouchableOpacity>
          <Animated.View style={[st.pip, { transform: pipPosition.getTranslateTransform() }, { top: 0, left: 0, right: undefined }]} {...pipPanResponder.panHandlers}>
            {/* @ts-ignore */}
            <video id="local-video" autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14, transform: facingFront ? 'scaleX(-1)' : 'none', backgroundColor: '#000' }} />
          </Animated.View>
        </>
      )}
      {showVideoUI && Platform.OS !== 'web' && RTCView && (
        <>
          <TouchableOpacity style={st.remoteFill} onPress={handleScreenTap} activeOpacity={1}>
            {remoteStreamURL && <RTCView streamURL={remoteStreamURL} style={{ flex: 1 }} objectFit="cover" zOrder={0} />}
          </TouchableOpacity>
          <Animated.View style={[st.pip, { transform: pipPosition.getTranslateTransform() }, { top: 0, left: 0, right: undefined }]} {...pipPanResponder.panHandlers}>
            {localStreamURL && <RTCView streamURL={localStreamURL} style={{ flex: 1 }} objectFit="cover" mirror={facingFront} zOrder={1} />}
          </Animated.View>
        </>
      )}

      {/* Video connecting/reconnecting overlay */}
      {showVideoUI && vidOverlayVisible && (
        <Animated.View style={[st.vidConnectingOverlay, { opacity: vidOverlayOpacity }]}>
          <View style={st.vidConnectingBg}>
            <View style={st.vidConnectingBgTop} />
            <View style={st.vidConnectingBgBottom} />
          </View>

          <View style={st.vidConnectingContent}>
            <View style={[st.callTypeBadge, { backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 28 }]}>
              {callState === 'reconnecting' ? (
                <WifiOff color="#FBBF24" size={14} />
              ) : (
                <Video color="rgba(255,255,255,0.8)" size={14} />
              )}
              <Text style={[st.callTypeBadgeText, { color: callState === 'reconnecting' ? '#FBBF24' : 'rgba(255,255,255,0.8)' }]}>
                {callState === 'reconnecting' ? 'Переподключение' : 'Видеозвонок'}
              </Text>
            </View>

            <View style={st.vidConnectingAvatarWrap}>
              <Animated.View style={[st.vidConnectingRing, { transform: [{ scale: vidPulse1 }], opacity: vidPulse1Op }]} />
              <Animated.View style={[st.vidConnectingRingOuter, { transform: [{ scale: vidPulse2 }], opacity: vidPulse2Op }]} />
              <Animated.View style={[st.vidConnectingAvatarBorder, { opacity: vidAvatarGlow.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }) }]} />
              <View style={st.vidConnectingAvatar}>
                {avatarUrl ? (
                  <CachedImage uri={avatarUrl} style={st.vidConnectingAvatarImg} />
                ) : isGroupCall ? (
                  <Users color="#FFF" size={42} />
                ) : (
                  <Text style={st.vidConnectingAvatarLetter}>{letter}</Text>
                )}
              </View>
            </View>

            <Text style={st.vidConnectingName}>{name || 'Пользователь'}</Text>

            <View style={st.vidConnectingStatusRow}>
              <Text style={[st.vidConnectingStatus, callState === 'reconnecting' && { color: '#FBBF24' }]}>
                {statusLabel[callState]}
              </Text>
              {showDots && (
                <View style={st.dotsRow}>
                  <Animated.View style={[st.dot, { backgroundColor: callState === 'reconnecting' ? '#FBBF24' : 'rgba(255,255,255,0.8)', opacity: dot1 }]} />
                  <Animated.View style={[st.dot, { backgroundColor: callState === 'reconnecting' ? '#FBBF24' : 'rgba(255,255,255,0.8)', opacity: dot2 }]} />
                  <Animated.View style={[st.dot, { backgroundColor: callState === 'reconnecting' ? '#FBBF24' : 'rgba(255,255,255,0.8)', opacity: dot3 }]} />
                </View>
              )}
            </View>

            <View style={st.vidConnectingEncryption}>
              <Lock color="rgba(255,255,255,0.35)" size={11} />
              <Text style={st.vidConnectingEncryptionText}>Шифрование E2E</Text>
            </View>
          </View>
        </Animated.View>
      )}

      {/* VOICE: avatar + info */}
      {!showVideoUI && (
        <Animated.View style={[st.voiceTop, { paddingTop: Math.max(insets.top, 20) + 32, transform: [{ scale: contentScale }] }]}>
          {/* Call type badge */}
          <View style={[st.callTypeBadge, { backgroundColor: `${colors.primary}18` }]}>
            {isVideo ? <Video color={colors.primary} size={14} /> : <PhoneOff color={colors.primary} size={14} style={{ transform: [{ rotate: '135deg' }] }} />}
            <Text style={[st.callTypeBadgeText, { color: colors.primary }]}>{isVideo ? 'Видеозвонок' : 'Голосовой звонок'}</Text>
          </View>

          <Animated.View style={[st.avatarWrap, callState === 'connected' && !onHold && { transform: [{ scale: voiceBreathing }] }]}>
            {callState === 'ringing' && (
              <>
                <Animated.View style={[st.ring, { borderColor: colors.primary, transform: [{ scale: pulse1 }], opacity: pulse1Op }]} />
                <Animated.View style={[st.ringOuter, { borderColor: colors.primary, transform: [{ scale: pulse2 }], opacity: pulse2Op }]} />
              </>
            )}
            {callState === 'connected' && !onHold && (
              <Animated.View style={[st.voiceGlowRing, { borderColor: colors.primary, opacity: voiceGlow }]} />
            )}
            <View style={[st.avatar, { backgroundColor: colors.surfaceTertiary }]}>
              {avatarUrl ? (
                <CachedImage uri={avatarUrl} style={st.avatarImg} />
              ) : isGroupCall ? (
                <Users color={colors.text} size={38} />
              ) : (
                <Text style={[st.avatarLetter, { color: colors.text }]}>{letter}</Text>
              )}
              {onHold && (
                <View style={st.holdOverlay}>
                  <Pause color="#FFF" size={32} />
                </View>
              )}
            </View>
            {callState === 'connected' && connectionQuality && !onHold && (
              <View style={[st.qualityBadge, {
                backgroundColor: connectionQuality === 'excellent' || connectionQuality === 'good' ? '#22C55E'
                  : connectionQuality === 'fair' ? '#F59E0B' : '#EF4444',
              }]}>
                <Wifi color="#FFF" size={10} />
              </View>
            )}
          </Animated.View>

          <Text style={[st.callerName, { color: colors.text }]}>{name || 'Пользователь'}</Text>

          {isGroupCall && groupParticipants.length > 0 && callState === 'connected' && (
            <View style={st.participantsList}>
              {groupParticipants.map(p => (
                <View key={p.user_id} style={[st.participantChip, { backgroundColor: `${colors.text}0D` }]}>
                  <View style={[st.participantDot, {
                    backgroundColor: p.status === 'active' ? colors.success : p.status === 'ringing' ? (colors.warning || '#F59E0B') : colors.textTertiary,
                  }]} />
                  <Text style={[st.participantName, { color: colors.textSecondary }]} numberOfLines={1}>
                    {p.user_id === user?.id ? 'Вы' : p.display_name}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Animated.View style={[st.statusRow, { opacity: stateTransition }]}>
            <Text style={[st.statusText, {
              color: callState === 'reconnecting' ? (colors.warning || '#F59E0B')
                : callState === 'connected' ? colors.textSecondary
                : callState === 'ringing' ? colors.primary
                : callState === 'failed' || callState === 'declined' ? colors.error
                : colors.textSecondary,
            }]}>
              {statusLabel[callState]}
            </Text>
            {showDots && (
              <View style={st.dotsRow}>
                <Animated.View style={[st.dot, { backgroundColor: colors.primary, opacity: dot1 }]} />
                <Animated.View style={[st.dot, { backgroundColor: colors.primary, opacity: dot2 }]} />
                <Animated.View style={[st.dot, { backgroundColor: colors.primary, opacity: dot3 }]} />
              </View>
            )}
          </Animated.View>

          {(callState === 'connected' || callState === 'reconnecting') && connectionQuality && (
            <View style={[st.qualityPill, { backgroundColor: `${colors.background}CC` }]}>
              {(() => {
                const qColor = connectionQuality === 'excellent' || connectionQuality === 'good' ? (colors.success || '#22C55E')
                  : connectionQuality === 'fair' ? (colors.warning || '#F59E0B') : colors.error;
                const qLabel = callState === 'reconnecting' ? 'Переподключение'
                  : connectionQuality === 'excellent' ? 'Отлично' : connectionQuality === 'good' ? 'Хорошо'
                  : connectionQuality === 'fair' ? 'Среднее' : 'Слабое';
                const Icon = (connectionQuality === 'poor' || callState === 'reconnecting') ? WifiOff : Wifi;
                return <>
                  <Icon color={qColor} size={13} />
                  <Text style={[st.qualityLabel, { color: qColor }]}>{qLabel}</Text>
                  {rtt !== null && callState !== 'reconnecting' && <Text style={[st.qualityLabel, { color: qColor }]}>{Math.round(rtt * 1000)}ms</Text>}
                </>;
              })()}
            </View>
          )}

          {callState === 'connected' && (
            <View style={st.encryptionRow}>
              <Lock color={colors.textTertiary} size={12} />
              <Text style={[st.encryptionHint, { color: colors.textTertiary }]}>Шифрование E2E</Text>
            </View>
          )}

          {(callState === 'ended' || callState === 'failed' || callState === 'declined') && durationRef.current > 0 && (
            <View style={[st.callSummaryCard, { backgroundColor: `${colors.text}06`, borderColor: `${colors.text}0A` }]}>
              <View style={st.callSummaryRow}>
                <Clock color={colors.textTertiary} size={14} />
                <Text style={[st.callSummaryLabel, { color: colors.textTertiary }]}>Длительность</Text>
                <Text style={[st.callSummaryValue, { color: colors.text }]}>{fmtDur(durationRef.current)}</Text>
              </View>
              {connectionQuality && (
                <View style={st.callSummaryRow}>
                  <Wifi color={colors.textTertiary} size={14} />
                  <Text style={[st.callSummaryLabel, { color: colors.textTertiary }]}>Качество</Text>
                  <Text style={[st.callSummaryValue, { color: colors.text }]}>
                    {connectionQuality === 'excellent' ? 'Отлично' : connectionQuality === 'good' ? 'Хорошо' : connectionQuality === 'fair' ? 'Среднее' : 'Слабое'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </Animated.View>
      )}

      {/* Screen share banner */}
      {showVideoUI && (remoteScreenSharing || screenSharing) && (
        <View style={st.screenShareBanner}>
          <Monitor color="#FFF" size={14} />
          <Text style={st.screenShareText}>{screenSharing ? 'Вы демонстрируете экран' : 'Демонстрация экрана'}</Text>
        </View>
      )}

      {showVideoUI && isGroupCall && groupParticipants.length > 0 && callState === 'connected' && (
        <View style={st.vidParticipantsOverlay}>
          <Users color="rgba(255,255,255,0.7)" size={14} />
          <Text style={st.vidParticipantsText}>{groupParticipants.filter(p => p.status === 'active').length} / {groupParticipants.length}</Text>
        </View>
      )}

      {/* VIDEO: Top overlay */}
      {showVideoUI && (
        <Animated.View style={[st.vidTopOverlay, { opacity: controlsOpacity, paddingTop: Math.max(insets.top, 12) + 8 }]} pointerEvents={controlsVisible ? 'auto' : 'none'}>
          <View style={st.vidTopInfo}>
            <View style={st.vidTopRow}>
              {avatarUrl && <CachedImage uri={avatarUrl} style={st.vidTopAvatar} />}
              <View>
                <Text style={st.vidName}>{name || 'Пользователь'}</Text>
                <View style={st.vidStatusRow}>
                  <Text style={st.vidStatus}>{statusLabel[callState]}</Text>
                  {connectionQuality && (
                    <View style={st.vidQualityDot}>
                      <Wifi color={connectionQuality === 'excellent' || connectionQuality === 'good' ? '#4ADE80' : connectionQuality === 'fair' ? '#FBBF24' : '#EF4444'} size={11} />
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
          <TouchableOpacity style={st.vidTopBtn} onPress={toggleFullscreen} activeOpacity={0.7} accessibilityLabel="Полный экран">
            {fullscreen ? <Minimize color="#FFF" size={18} /> : <Maximize color="#FFF" size={18} />}
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Bottom controls */}
      <Animated.View
        style={[st.bottom, { paddingBottom: Math.max(insets.bottom, 16) + 16 }, showVideoUI && st.bottomVideo, showVideoUI ? { opacity: controlsOpacity } : undefined]}
        pointerEvents={showVideoUI && !controlsVisible ? 'none' : 'auto'}
      >
        {(callState === 'connected' || callState === 'connecting' || callState === 'reconnecting') && (
          <>
            {showVideoUI && callState === 'connected' && (
              <View style={st.vidBottomTimer}>
                <View style={st.vidTimerDot} />
                <Text style={st.vidTimerText}>{fmtDur(duration)}</Text>
                {connectionQuality && (
                  <View style={st.vidTimerQuality}>
                    <Wifi color={connectionQuality === 'excellent' || connectionQuality === 'good' ? '#4ADE80' : connectionQuality === 'fair' ? '#FBBF24' : '#EF4444'} size={11} />
                  </View>
                )}
              </View>
            )}
            {/* Mute / Hold / Remote Hold banners */}
            {callState === 'connected' && remoteOnHold && (
              <View style={[st.statusBanner, {
                backgroundColor: showVideoUI ? 'rgba(59,130,246,0.15)' : '#3B82F618',
              }]}>
                <Pause color="#3B82F6" size={14} />
                <Text style={[st.statusBannerText, { color: '#3B82F6' }]}>Собеседник поставил на удержание</Text>
              </View>
            )}
            {callState === 'connected' && (muted || onHold) && (
              <View style={[st.statusBanner, {
                backgroundColor: onHold
                  ? (showVideoUI ? 'rgba(245,158,11,0.15)' : '#F59E0B18')
                  : (showVideoUI ? 'rgba(239,68,68,0.15)' : `${colors.error || '#EF4444'}15`),
              }]}>
                {onHold ? (
                  <>
                    <Pause color="#F59E0B" size={14} />
                    <Text style={[st.statusBannerText, { color: '#F59E0B' }]}>Звонок на удержании</Text>
                  </>
                ) : (
                  <>
                    <MicOff color={showVideoUI ? '#EF4444' : (colors.error || '#EF4444')} size={14} />
                    <Text style={[st.statusBannerText, { color: showVideoUI ? '#EF4444' : (colors.error || '#EF4444') }]}>Микрофон выключен</Text>
                  </>
                )}
              </View>
            )}

            {/* Overflow menu for secondary actions */}
            {showOverflow && callState === 'connected' && (
              <Animated.View style={[st.overflowTray, {
                backgroundColor: showVideoUI ? 'rgba(0,0,0,0.5)' : `${colors.text}0A`,
              }]}>
                <View style={st.overflowGrid}>
                  {!isVideo && (
                    <ControlBtn
                      icon={<Video color={showVideoUI ? '#FFF' : colors.text} size={22} />}
                      label="Видео" onPress={() => { setShowOverflow(false); switchCallMedia(); }}
                    />
                  )}
                  {isVideo && (
                    <ControlBtn
                      icon={<Phone color={showVideoUI ? '#FFF' : colors.text} size={22} />}
                      label="Голос" onPress={() => { setShowOverflow(false); switchCallMedia(); }}
                    />
                  )}
                  {isVideo && (
                    <ControlBtn
                      icon={onHold ? <Play color={showVideoUI ? '#222' : '#FFF'} size={22} /> : <Pause color={showVideoUI ? '#FFF' : colors.text} size={22} />}
                      label={onHold ? 'Продолжить' : 'Удержание'} active={onHold}
                      onPress={() => { toggleHold(); }}
                    />
                  )}
                  <ControlBtn
                    icon={<Circle color={recording ? '#FFF' : (showVideoUI ? '#FFF' : colors.text)} size={22}
                      fill={recording ? '#EF4444' : 'transparent'} />}
                    label={recording ? 'Стоп' : 'Запись'} active={recording}
                    onPress={() => recording ? stopRecording() : startRecording()}
                    danger={recording}
                  />
                </View>
              </Animated.View>
            )}

            {/* Primary control row — max 4 buttons */}
            <View style={st.ctrlRow}>
              <ControlBtn
                icon={muted
                  ? <MicOff color={showVideoUI ? '#222' : '#FFF'} size={22} />
                  : <Mic color={showVideoUI ? '#FFF' : colors.text} size={22} />}
                label={muted ? 'Вкл. мик' : 'Микрофон'} active={muted} onPress={toggleMute}
              />
              {isVideo ? (
                <ControlBtn
                  icon={videoEnabled ? <Video color={showVideoUI ? '#FFF' : colors.text} size={22} /> : <VideoOff color={showVideoUI ? '#222' : '#FFF'} size={22} />}
                  label={videoEnabled ? 'Камера' : 'Вкл.'} active={!videoEnabled} onPress={toggleVideo}
                />
              ) : (
                <ControlBtn
                  icon={<Volume2 color={speakerOn ? (showVideoUI ? '#222' : '#FFF') : (showVideoUI ? '#FFF' : colors.text)} size={22} />}
                  label="Динамик" active={speakerOn} onPress={toggleSpeaker}
                />
              )}
              {isVideo && showVideoUI ? (
                <ControlBtn icon={<SwitchCamera color="#FFF" size={22} />} label="Повернуть" onPress={switchCamera} />
              ) : !isVideo && callState === 'connected' ? (
                <ControlBtn
                  icon={onHold ? <Play color={showVideoUI ? '#222' : '#FFF'} size={22} /> : <Pause color={showVideoUI ? '#FFF' : colors.text} size={22} />}
                  label={onHold ? 'Продолжить' : 'Удержание'} active={onHold} onPress={toggleHold}
                />
              ) : (
                <ControlBtn
                  icon={<Volume2 color={speakerOn ? (showVideoUI ? '#222' : '#FFF') : (showVideoUI ? '#FFF' : colors.text)} size={22} />}
                  label="Динамик" active={speakerOn} onPress={toggleSpeaker}
                />
              )}
              {callState === 'connected' && (
                <ControlBtn
                  icon={<MoreHorizontal color={showVideoUI ? '#FFF' : colors.text} size={22} />}
                  label="Ещё" active={showOverflow} onPress={() => setShowOverflow(p => !p)}
                />
              )}
            </View>

            {showVideoUI ? (
              <TouchableOpacity style={st.endBtnVideo} onPress={endCall} activeOpacity={0.8} accessibilityLabel="Завершить звонок">
                <PhoneOff color="#FFF" size={22} />
                <Text style={st.endBtnVideoLabel}>Завершить</Text>
              </TouchableOpacity>
            ) : (
              <View style={st.ringCtrl}>
                <TouchableOpacity style={[st.endBtn, { marginTop: 10 }]} onPress={endCall} activeOpacity={0.8} accessibilityLabel="Завершить звонок">
                  <PhoneOff color="#FFF" size={26} />
                </TouchableOpacity>
                <Text style={[st.endLabel, { color: colors.textSecondary }]}>Завершить</Text>
              </View>
            )}
          </>
        )}

        {callState === 'ringing' && (
          <View style={st.ringCtrl}>
            <TouchableOpacity style={st.endBtn} onPress={endCall} activeOpacity={0.8} accessibilityLabel="Отменить звонок">
              <PhoneOff color="#FFF" size={26} />
            </TouchableOpacity>
            <Text style={[st.endLabel, { color: showVideoUI ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>Отменить</Text>
          </View>
        )}

        {(callState === 'ended' || callState === 'declined' || callState === 'failed') && (
          <View style={st.endedSection}>
            <View style={[st.endedSummary, { backgroundColor: showVideoUI ? 'rgba(255,255,255,0.08)' : `${colors.text}08` }]}>
              <PhoneOff color={callState === 'failed' ? (colors.error || '#EF4444') : showVideoUI ? 'rgba(255,255,255,0.4)' : colors.textTertiary} size={16} />
              <Text style={[st.endedSummaryText, { color: showVideoUI ? 'rgba(255,255,255,0.6)' : colors.textSecondary }]}>
                {statusLabel[callState]}{durationRef.current > 0 ? ` -- ${fmtDur(durationRef.current)}` : ''}
              </Text>
            </View>
            <View style={st.endedActions}>
              <TouchableOpacity
                style={[st.endedActionBtn, { backgroundColor: showVideoUI ? 'rgba(255,255,255,0.12)' : `${colors.primary}12` }]}
                onPress={callBack} activeOpacity={0.7}
              >
                <Phone color={showVideoUI ? '#FFF' : colors.primary} size={20} />
                <Text style={[st.endedActionLabel, { color: showVideoUI ? '#FFF' : colors.primary }]}>Перезвонить</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.endedActionBtn, { backgroundColor: showVideoUI ? 'rgba(255,255,255,0.12)' : `${colors.text}08` }]}
                onPress={openChat} activeOpacity={0.7}
              >
                <MessageSquare color={showVideoUI ? 'rgba(255,255,255,0.85)' : colors.textSecondary} size={20} />
                <Text style={[st.endedActionLabel, { color: showVideoUI ? 'rgba(255,255,255,0.85)' : colors.textSecondary }]}>Сообщение</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>

      {/* Recording banner */}
      {recording && callState === 'connected' && (
        <View style={[st.recordingBanner, { top: insets.top + 60 }]}>
          <View style={st.recordingDot} />
          <Text style={st.recordingText}>REC {fmtDur(recordingTime)}</Text>
        </View>
      )}

      {/* Call quality feedback modal */}
      <Modal visible={showFeedback} transparent animationType="fade" onRequestClose={skipFeedback}>
        <Pressable style={st.feedbackBackdrop} onPress={skipFeedback}>
          <Pressable style={[st.feedbackModal, { backgroundColor: colors.backgroundSecondary }]} onPress={() => {}}>
            {feedbackSubmitted ? (
              <View style={st.feedbackSuccess}>
                <View style={[st.feedbackSuccessIcon, { backgroundColor: `${colors.success || '#22C55E'}15` }]}>
                  <Star color={colors.success || '#22C55E'} size={28} fill={colors.success || '#22C55E'} />
                </View>
                <Text style={[st.feedbackSuccessTitle, { color: colors.text }]}>Спасибо!</Text>
                <Text style={[st.feedbackSuccessDesc, { color: colors.textSecondary }]}>Ваш отзыв помогает улучшить качество связи</Text>
              </View>
            ) : (
              <>
                <View style={st.feedbackHeader}>
                  <Text style={[st.feedbackTitle, { color: colors.text }]}>Качество звонка</Text>
                  <TouchableOpacity onPress={skipFeedback} hitSlop={8} accessibilityLabel="Закрыть">
                    <X color={colors.textTertiary} size={20} />
                  </TouchableOpacity>
                </View>

                <Text style={[st.feedbackInfo, { color: colors.textSecondary }]}>
                  {name || 'Пользователь'} -- {fmtDur(durationRef.current)}
                </Text>

                {/* Star rating */}
                <View style={st.starsRow}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <TouchableOpacity key={i} onPress={() => setFeedbackRating(i)} activeOpacity={0.7} style={st.starBtn} accessibilityLabel={`${i} из 5`}>
                      <Star
                        color={i <= feedbackRating ? '#F59E0B' : colors.textTertiary}
                        size={36}
                        fill={i <= feedbackRating ? '#F59E0B' : 'transparent'}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[st.ratingLabel, { color: colors.textSecondary }]}>
                  {feedbackRating === 0 ? 'Оцените качество'
                    : feedbackRating === 1 ? 'Очень плохо'
                    : feedbackRating === 2 ? 'Плохо'
                    : feedbackRating === 3 ? 'Нормально'
                    : feedbackRating === 4 ? 'Хорошо'
                    : 'Отлично'}
                </Text>

                {/* Issue tags */}
                {feedbackRating > 0 && feedbackRating <= 3 && (
                  <View style={st.issuesSection}>
                    <Text style={[st.issuesTitle, { color: colors.textSecondary }]}>Что было не так?</Text>
                    <View style={st.issuesGrid}>
                      {ISSUE_TAGS.map(tag => {
                        const selected = feedbackIssues.includes(tag.key);
                        return (
                          <TouchableOpacity
                            key={tag.key}
                            style={[st.issueTag, { backgroundColor: selected ? `${colors.primary}18` : colors.backgroundTertiary, borderColor: selected ? colors.primary : 'transparent', borderWidth: 1 }]}
                            onPress={() => toggleIssue(tag.key)}
                            activeOpacity={0.7}
                          >
                            <Text style={[st.issueTagText, { color: selected ? colors.primary : colors.textSecondary }]}>{tag.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Submit button */}
                <View style={st.feedbackActions}>
                  <TouchableOpacity style={[st.feedbackSkip, { backgroundColor: colors.backgroundTertiary }]} onPress={skipFeedback} accessibilityLabel="Пропустить">
                    <Text style={[st.feedbackSkipText, { color: colors.textSecondary }]}>Пропустить</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.feedbackSubmit, { backgroundColor: feedbackRating > 0 ? colors.primary : colors.backgroundTertiary, opacity: feedbackRating > 0 ? 1 : 0.5 }]}
                    onPress={submitFeedback}
                    disabled={feedbackRating === 0 || feedbackSubmitting}
                    accessibilityLabel="Отправить отзыв"
                  >
                    <Text style={[st.feedbackSubmitText, { color: feedbackRating > 0 ? '#FFF' : colors.textTertiary }]}>
                      {feedbackSubmitting ? 'Отправка...' : 'Отправить'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  hidden: { position: 'absolute', width: 0, height: 0, overflow: 'hidden' },

  remoteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#111118' },
  pip: {
    position: 'absolute', width: PIP_W, height: PIP_H, borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#1E1E2E', zIndex: 20, elevation: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 12,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
  },

  voiceTop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  callTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginBottom: 24,
  },
  callTypeBadgeText: { fontSize: 13, fontWeight: '600' },

  avatarWrap: { width: 190, height: 190, justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
  voiceGlowRing: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 3,
  },
  holdOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center',
    borderRadius: 50,
  },
  ring: { position: 'absolute', width: 154, height: 154, borderRadius: 77, borderWidth: 2 },
  ringOuter: { position: 'absolute', width: 184, height: 184, borderRadius: 92, borderWidth: 1.5 },
  avatar: { width: 120, height: 120, borderRadius: 60, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg: { width: 120, height: 120, borderRadius: 60 },
  avatarLetter: { fontSize: 42, fontWeight: '700' },
  qualityBadge: {
    position: 'absolute', bottom: 2, right: 20,
    width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#FFF',
  },

  callerName: { fontSize: 28, fontWeight: '700', letterSpacing: -0.3, marginBottom: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 16, fontWeight: '500', fontVariant: ['tabular-nums'] as any },
  dotsRow: { flexDirection: 'row', gap: 3, marginLeft: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },

  qualityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 16,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  qualityLabel: { fontSize: 12, fontWeight: '600' },

  encryptionRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  encryptionHint: { fontSize: 11, fontWeight: '500', letterSpacing: 0.5 },

  callSummaryCard: {
    marginTop: 20, width: '80%', maxWidth: 260, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, gap: 10,
    borderWidth: 1,
  },
  callSummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  callSummaryLabel: { fontSize: 13, fontWeight: '500', flex: 1 },
  callSummaryValue: { fontSize: 14, fontWeight: '600' },

  // Video top overlay
  vidTopOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, zIndex: 15,
    backgroundColor: Platform.OS === 'web' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.6)',
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(20px) saturate(180%)' } as any : {}),
  },
  vidTopInfo: { flex: 1 },
  vidTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vidTopAvatar: { width: 32, height: 32, borderRadius: 16 },
  vidName: {
    color: '#FFF', fontSize: 17, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  vidStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  vidStatus: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '500' },
  vidQualityDot: { backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 3 },
  vidTopBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },

  // Bottom
  bottom: { alignItems: 'center', paddingTop: 8 },
  bottomVideo: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Platform.OS === 'web' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.75)',
    paddingTop: 18,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(24px) saturate(150%)' } as any : {}),
  },

  vidBottomTimer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginBottom: 16,
  },
  vidTimerDot: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80',
  },
  vidTimerText: {
    color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600',
    fontVariant: ['tabular-nums'] as any,
  },
  vidTimerQuality: {
    marginLeft: 2,
  },

  overflowTray: {
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 12, marginBottom: 12, marginHorizontal: 16,
  },
  overflowGrid: { flexDirection: 'row', justifyContent: 'space-evenly' },
  ctrlRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 4 },
  ctrlItem: { alignItems: 'center', width: 72, marginBottom: 4 },
  ctrlCircle: {
    width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
  },
  ctrlLabel: { fontSize: 11, fontWeight: '600', marginTop: 6, textAlign: 'center', letterSpacing: 0.2 },

  endBtnVideo: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#E53935', borderRadius: 28,
    width: '80%', maxWidth: 280, height: 56, alignSelf: 'center',
    marginTop: 14,
    shadowColor: '#E53935', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14,
    elevation: 8,
  },
  endBtnVideoLabel: {
    color: '#FFF', fontSize: 16, fontWeight: '700',
  },

  statusBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, marginBottom: 14,
  },
  statusBannerText: { fontSize: 13, fontWeight: '600' },

  ringCtrl: { alignItems: 'center' },
  endBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#E53935', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#E53935', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  endLabel: { fontSize: 13, fontWeight: '500', marginTop: 8 },

  endedSection: { alignItems: 'center', width: '100%', paddingHorizontal: 24 },
  endedSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, marginBottom: 16,
  },
  endedSummaryText: { fontSize: 14, fontWeight: '500' },
  endedActions: { flexDirection: 'row', gap: 10 },
  endedActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 22, paddingVertical: 13, borderRadius: 16,
  },
  endedActionLabel: { fontSize: 15, fontWeight: '600' },

  participantsList: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginBottom: 12, paddingHorizontal: 24, maxWidth: 340 },
  participantChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  participantDot: { width: 7, height: 7, borderRadius: 4 },
  participantName: { fontSize: 13, fontWeight: '500', maxWidth: 100 },

  screenShareBanner: {
    position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#2196F3',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6, zIndex: 25,
  },
  screenShareText: { color: '#FFF', fontSize: 13, fontWeight: '600' },

  vidConnectingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  vidConnectingBg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  vidConnectingBgTop: {
    flex: 1, backgroundColor: '#0D0D14',
  },
  vidConnectingBgBottom: {
    flex: 1, backgroundColor: '#141420',
  },
  vidConnectingContent: {
    alignItems: 'center', justifyContent: 'center',
  },
  vidConnectingAvatarWrap: {
    width: 180, height: 180, justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  vidConnectingRing: {
    position: 'absolute', width: 140, height: 140, borderRadius: 70,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
  },
  vidConnectingRingOuter: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  vidConnectingAvatarBorder: {
    position: 'absolute', width: 116, height: 116, borderRadius: 58,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.5)',
  },
  vidConnectingAvatar: {
    width: 110, height: 110, borderRadius: 55,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  vidConnectingAvatarImg: { width: 110, height: 110, borderRadius: 55 },
  vidConnectingAvatarLetter: { fontSize: 44, fontWeight: '700', color: '#FFF' },
  vidConnectingName: {
    color: '#FFF', fontSize: 24, fontWeight: '700', letterSpacing: 0.3, marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  vidConnectingStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16,
  },
  vidConnectingStatus: {
    color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '500',
  },
  vidConnectingEncryption: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
  },
  vidConnectingEncryptionText: {
    color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '500', letterSpacing: 0.5,
  },

  vidParticipantsOverlay: {
    position: 'absolute', top: 90, right: 12, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, zIndex: 15,
  },
  vidParticipantsText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },

  // Feedback modal
  feedbackBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' },
  feedbackModal: {
    width: '88%', maxWidth: 380, borderRadius: 20, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28,
  },
  feedbackHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  feedbackTitle: { fontSize: 20, fontWeight: '700' },
  feedbackInfo: { fontSize: 14, marginBottom: 20 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginBottom: 8 },
  starBtn: { padding: 4 },
  ratingLabel: { textAlign: 'center', fontSize: 14, fontWeight: '500', marginBottom: 16 },

  issuesSection: { marginBottom: 16 },
  issuesTitle: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  issuesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  issueTag: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  issueTagText: { fontSize: 13, fontWeight: '500' },

  feedbackActions: { flexDirection: 'row', gap: 10 },
  feedbackSkip: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  feedbackSkipText: { fontSize: 15, fontWeight: '600' },
  feedbackSubmit: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  feedbackSubmitText: { fontSize: 15, fontWeight: '600' },

  feedbackSuccess: { alignItems: 'center', paddingVertical: 20 },
  feedbackSuccessIcon: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  feedbackSuccessTitle: { fontSize: 20, fontWeight: '700', marginBottom: 6 },
  feedbackSuccessDesc: { fontSize: 14, textAlign: 'center' },

  // Recording banner
  recordingBanner: {
    position: 'absolute', left: '50%', transform: [{ translateX: -48 }],
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(239,68,68,0.18)', paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, zIndex: 20,
  },
  recordingDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444',
  },
  recordingText: {
    color: '#EF4444', fontSize: 13, fontWeight: '700', letterSpacing: 0.5,
  },

});

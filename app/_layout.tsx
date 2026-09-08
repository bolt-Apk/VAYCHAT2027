import { useEffect, useState, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform, Animated, Easing, AppState, Vibration, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, usePathname, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Phone, PhoneOff, Video, MessageSquare, ChevronUp, Mic, MicOff } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { AppearanceProvider, useAppearance } from '@/lib/appearance-context';
import { supabase } from '@/lib/supabase';
import { createRingtone } from '@/lib/ringtone';
import { registerForPushNotifications, getActiveChatId, updateBadgeCount, setCallHandledInApp, dismissChatNotifications } from '@/lib/notifications';
import { playReceiveSound, setVibrationEnabled, setSoundEnabled } from '@/lib/chat-feedback';
import { dataCache } from '@/lib/data-cache';
import { useNetwork } from '@/lib/use-network';
import CachedImage from '@/components/CachedImage';
import MobileFrame from '@/components/MobileFrame';
import DesktopShell from '@/components/desktop/DesktopShell';
import { DesktopChatProvider } from '@/lib/desktop-chat-context';
import VoiceMiniPlayer from '@/components/VoiceMiniPlayer';
import AudioProximityHandler from '@/components/AudioProximityHandler';
import LockScreen from '@/components/LockScreen';
import { VoicePlayerProvider } from '@/lib/voice-player';
import { SecurityProvider, useSecurity } from '@/lib/security-context';
import { PerformanceProvider } from '@/lib/performance-context';
import { useFonts } from 'expo-font';
import { Roboto_700Bold } from '@expo-google-fonts/roboto';
import { Nunito_700Bold } from '@expo-google-fonts/nunito';
import { Pacifico_400Regular } from '@expo-google-fonts/pacifico';
import { Lobster_400Regular } from '@expo-google-fonts/lobster';
import { Raleway_700Bold } from '@expo-google-fonts/raleway';
import { Oswald_600SemiBold } from '@expo-google-fonts/oswald';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import { Comfortaa_700Bold } from '@expo-google-fonts/comfortaa';
import { PressStart2P_400Regular } from '@expo-google-fonts/press-start-2p';
import { Caveat_700Bold } from '@expo-google-fonts/caveat';

// Active call context for floating PIP widget
interface ActiveCallInfo {
  callId: string;
  callType: 'voice' | 'video';
  peerName: string;
  peerAvatarUrl?: string | null;
  peerId: string;
  duration: number;
  muted: boolean;
  state: 'ringing' | 'connecting' | 'connected' | 'reconnecting';
  conversationId?: string;
}

const ActiveCallContext = createContext<{
  activeCall: ActiveCallInfo | null;
  setActiveCall: (c: ActiveCallInfo | null) => void;
}>({ activeCall: null, setActiveCall: () => {} });

export function useActiveCall() {
  return useContext(ActiveCallContext);
}

interface IncomingCall {
  id: string;
  caller_id: string;
  call_type: 'voice' | 'video';
  caller_name: string;
  caller_avatar_url?: string | null;
  is_group_call?: boolean;
  group_name?: string;
}

function IncomingCallOverlay() {
  const { user } = useAuth();
  const { colors } = useAppearance();
  const router = useRouter();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const incomingRef = useRef<IncomingCall | null>(null);
  const mountedRef = useRef(true);
  const ringtoneController = useMemo(() => createRingtone('incoming'), []);
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  const ring1 = useRef(new Animated.Value(1)).current;
  const ring1Op = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const opAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ringtoneController.stop();
    };
  }, [ringtoneController]);

  useEffect(() => {
    if (animationRef.current) {
      animationRef.current.stop();
    }
    if (opAnimationRef.current) {
      opAnimationRef.current.stop();
    }

    if (incoming) {
      animationRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(ring1, { toValue: 1.5, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(ring1, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      animationRef.current.start();

      opAnimationRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(ring1Op, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
          Animated.timing(ring1Op, { toValue: 0.1, duration: 600, useNativeDriver: true }),
        ])
      );
      opAnimationRef.current.start();

      if (Platform.OS !== 'web') {
        Vibration.vibrate([0, 500, 300, 500, 300, 500], true);
      }
    } else {
      ring1.setValue(1);
      ring1Op.setValue(0);
      if (Platform.OS !== 'web') {
        Vibration.cancel();
      }
    }

    return () => {
      if (animationRef.current) {
        animationRef.current.stop();
      }
      if (opAnimationRef.current) {
        opAnimationRef.current.stop();
      }
      if (Platform.OS !== 'web') {
        Vibration.cancel();
      }
    };
  }, [incoming]);

  const startRingtone = useCallback(() => {
    ringtoneController.start();
  }, [ringtoneController]);

  const stopRingtone = useCallback(() => {
    ringtoneController.stop();
  }, [ringtoneController]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`incoming-calls-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
        filter: `receiver_id=eq.${user.id}`,
      }, async (payload) => {
        const call = payload.new as { id: string; caller_id: string; call_type: 'voice' | 'video'; status: string; is_group_call?: boolean; group_name?: string };
        if (call.status !== 'ringing') return;
        if (!mountedRef.current) return;

        const { data: callerProfile } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', call.caller_id)
          .maybeSingle();

        if (!mountedRef.current) return;

        const incomingData: IncomingCall = {
          id: call.id,
          caller_id: call.caller_id,
          call_type: call.call_type,
          caller_name: callerProfile?.display_name || 'Пользователь',
          caller_avatar_url: callerProfile?.avatar_url || null,
          is_group_call: call.is_group_call || false,
          group_name: call.group_name || undefined,
        };
        incomingRef.current = incomingData;
        setIncoming(incomingData);
        setCallHandledInApp(true);
        startRingtone();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'call_participants',
        filter: `user_id=eq.${user.id}`,
      }, async (payload) => {
        const participant = payload.new as { call_id: string; user_id: string; status: string };
        if (participant.status !== 'ringing') return;
        if (incomingRef.current) return;
        if (!mountedRef.current) return;

        const { data: callData } = await supabase
          .from('calls')
          .select('id, caller_id, call_type, status, is_group_call, group_name')
          .eq('id', participant.call_id)
          .maybeSingle();
        if (!callData || callData.status !== 'ringing') return;
        if (callData.caller_id === user.id) return;
        if (!mountedRef.current) return;

        const { data: callerProfile2 } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', callData.caller_id)
          .maybeSingle();

        if (!mountedRef.current) return;

        const incomingData: IncomingCall = {
          id: callData.id,
          caller_id: callData.caller_id,
          call_type: callData.call_type,
          caller_name: callerProfile2?.display_name || 'Пользователь',
          caller_avatar_url: callerProfile2?.avatar_url || null,
          is_group_call: callData.is_group_call || false,
          group_name: callData.group_name || undefined,
        };
        incomingRef.current = incomingData;
        setIncoming(incomingData);
        setCallHandledInApp(true);
        startRingtone();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `receiver_id=eq.${user.id}`,
      }, (payload) => {
        const updated = payload.new as { id: string; status: string };
        const cur = incomingRef.current;
        if (cur && updated.id === cur.id && (updated.status === 'ended' || updated.status === 'missed' || updated.status === 'declined' || updated.status === 'active')) {
          stopRingtone();
          setCallHandledInApp(false);
          incomingRef.current = null;
          setShowQuickReplies(false);
          setIncoming(null);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopRingtone();
      setCallHandledInApp(false);
    };
  }, [user?.id]);

  const acceptCall = async () => {
    if (!incoming || !user) return;
    stopRingtone();
    setCallHandledInApp(false);

    await supabase.from('calls').update({ status: 'active' }).eq('id', incoming.id);

    if (incoming.is_group_call) {
      await supabase.from('call_participants')
        .update({ status: 'active', joined_at: new Date().toISOString() })
        .eq('call_id', incoming.id).eq('user_id', user.id);
    }

    let conversationId = '';
    const { data: myConvs } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', user.id);
    if (myConvs) {
      const { data: shared } = await supabase.from('conversation_members')
        .select('conversation_id').eq('user_id', incoming.caller_id)
        .in('conversation_id', myConvs.map(c => c.conversation_id));
      if (shared && shared.length > 0) conversationId = shared[0].conversation_id;
    }

    const callData = { ...incoming };
    incomingRef.current = null;
    setShowQuickReplies(false);
    setIncoming(null);

    router.push({
      pathname: '/call',
      params: {
        type: callData.call_type,
        userId: callData.caller_id,
        name: callData.is_group_call ? (callData.group_name || callData.caller_name) : callData.caller_name,
        callId: callData.id,
        role: 'receiver',
        conversationId,
        ...(callData.is_group_call ? { groupCall: 'true' } : {}),
      },
    });
  };

  const declineCall = async () => {
    if (!incoming || !user) return;
    stopRingtone();
    setCallHandledInApp(false);
    if (incoming.is_group_call) {
      await supabase.from('call_participants')
        .update({ status: 'declined' })
        .eq('call_id', incoming.id).eq('user_id', user.id);
    } else {
      await supabase.from('calls').update({ status: 'declined' }).eq('id', incoming.id);
    }
    setShowQuickReplies(false);
    setIncoming(null);
  };

  const QUICK_REPLIES = [
    'Перезвоню позже',
    'Занят на совещании',
    'Не могу говорить, напиши',
    'Через 10 минут',
  ];

  const declineWithMessage = async (message: string) => {
    if (!incoming || !user) return;
    // Find conversation with caller
    const { data: myConvs } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', user.id);
    if (myConvs) {
      const { data: shared } = await supabase.from('conversation_members')
        .select('conversation_id').eq('user_id', incoming.caller_id)
        .in('conversation_id', myConvs.map(c => c.conversation_id));
      if (shared && shared.length > 0) {
        await supabase.from('messages').insert({
          conversation_id: shared[0].conversation_id,
          sender_id: user.id,
          content: message,
          message_type: 'text',
          is_read: false,
        });
      }
    }
    declineCall();
  };

  if (!incoming) return null;

  const letter = incoming.caller_name.charAt(0).toUpperCase();

  return (
    <Modal visible transparent animationType="fade">
      <View style={[styles.incomingOverlay, { backgroundColor: colors.background }]}>
        <View style={styles.incomingContent}>
          <Text style={[styles.incomingLabel, { color: colors.textSecondary }]}>
            {incoming.is_group_call ? 'Групповой' : 'Входящий'} {incoming.call_type === 'video' ? 'видеозвонок' : 'звонок'}
          </Text>

          <View style={styles.incomingAvatarContainer}>
            <Animated.View style={[styles.incomingRing, { borderColor: colors.primary }, { transform: [{ scale: ring1 }], opacity: ring1Op }]} />
            <View style={[styles.incomingAvatar, { backgroundColor: colors.surfaceTertiary }]}>
              {incoming.caller_avatar_url ? (
                <CachedImage uri={incoming.caller_avatar_url} style={styles.incomingAvatarImg} />
              ) : (
                <Text style={[styles.incomingAvatarText, { color: colors.text }]}>{letter}</Text>
              )}
            </View>
          </View>

          <Text style={[styles.incomingName, { color: colors.text }]}>
            {incoming.is_group_call ? (incoming.group_name || incoming.caller_name) : incoming.caller_name}
          </Text>
          {incoming.is_group_call && (
            <Text style={[styles.incomingLabel, { color: colors.textSecondary, marginTop: 4 }]}>
              от {incoming.caller_name}
            </Text>
          )}

          {showQuickReplies && (
            <View style={styles.quickRepliesPanel}>
              {QUICK_REPLIES.map((msg, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.quickReplyBtn, { backgroundColor: `${colors.text}08`, borderColor: `${colors.text}0A` }]}
                  onPress={() => declineWithMessage(msg)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickReplyText, { color: colors.text }]}>{msg}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.quickReplyToggle, { backgroundColor: `${colors.text}08` }]}
            onPress={() => setShowQuickReplies(p => !p)}
            activeOpacity={0.7}
          >
            <MessageSquare color={colors.textSecondary} size={16} />
            <Text style={[styles.quickReplyToggleText, { color: colors.textSecondary }]}>
              {showQuickReplies ? 'Скрыть' : 'Быстрый ответ'}
            </Text>
            <ChevronUp color={colors.textTertiary} size={14} style={showQuickReplies ? { transform: [{ rotate: '180deg' }] } : undefined} />
          </TouchableOpacity>

          <View style={styles.incomingActions}>
            <TouchableOpacity style={styles.declineButton} onPress={declineCall}>
              <PhoneOff color="#FFFFFF" size={28} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.acceptButton} onPress={acceptCall}>
              <Phone color="#FFFFFF" size={28} />
            </TouchableOpacity>
          </View>

          <View style={styles.incomingLabels}>
            <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>Отклонить</Text>
            <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>Принять</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function WebNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const permissionRef = useRef<string>('default');
  const mountedRef = useRef(true);
  const unreadCountMap = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { permissionRef.current = p; });
    } else {
      permissionRef.current = Notification.permission;
    }

    const channel = supabase
      .channel(`web-notif-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, async (payload) => {
        if (!mountedRef.current) return;
        const msg = payload.new as { id: string; sender_id: string; content: string; conversation_id: string; message_type: string; status_id?: string | null };
        if (msg.sender_id === user.id) return;
        if (permissionRef.current !== 'granted') return;

        const currentPath = window.location.pathname;
        if (document.hasFocus() && currentPath.includes(msg.conversation_id)) {
          unreadCountMap.current.delete(msg.conversation_id);
          return;
        }

        const { data: membership } = await supabase
          .from('conversation_members')
          .select('is_muted')
          .eq('conversation_id', msg.conversation_id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (membership?.is_muted) return;
        if (!mountedRef.current) return;

        const { data: myProfile } = await supabase
          .from('profiles')
          .select('notification_settings, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone')
          .eq('id', user.id)
          .maybeSingle();
        if (!mountedRef.current) return;

        const notifSettings = myProfile?.notification_settings as Record<string, any> | null;
        if (notifSettings && notifSettings.messages === false) return;

        if (myProfile?.quiet_hours_enabled) {
          const tz = myProfile.quiet_hours_timezone || 'Europe/Moscow';
          const nowStr = new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
          const start = (myProfile.quiet_hours_start || '23:00').slice(0, 5);
          const end = (myProfile.quiet_hours_end || '07:00').slice(0, 5);
          const inQuiet = start > end
            ? (nowStr >= start || nowStr < end)
            : (nowStr >= start && nowStr < end);
          if (inQuiet) return;
        }

        const { data: senderProfile } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', msg.sender_id)
          .maybeSingle();
        if (!mountedRef.current) return;

        const senderName = senderProfile?.display_name || 'Новое сообщение';
        const senderAvatar = senderProfile?.avatar_url;
        const preview = notifSettings?.preview !== false;
        const isStoryReply = !!msg.status_id;
        let body = 'Новое сообщение';
        if (preview) {
          if (isStoryReply) {
            switch (msg.message_type) {
              case 'text': body = 'Ответ на статус: ' + (msg.content || '').slice(0, 180); break;
              case 'image': body = 'Ответ на статус: Фото'; break;
              case 'video': body = 'Ответ на статус: Видео'; break;
              case 'voice': body = 'Ответ на статус: Голосовое сообщение'; break;
              default: body = 'Ответ на ваш статус'; break;
            }
          } else {
            switch (msg.message_type) {
              case 'text': body = msg.content || 'Сообщение'; break;
              case 'image': body = 'Фото'; break;
              case 'video': body = 'Видео'; break;
              case 'voice': body = 'Голосовое сообщение'; break;
              case 'video_note': body = 'Видеосообщение'; break;
              case 'document': case 'file': body = 'Файл'; break;
              case 'contact': body = 'Контакт'; break;
              case 'location': body = 'Геопозиция'; break;
              case 'sticker': body = msg.content || 'Стикер'; break;
              case 'forwarded': body = 'Пересланное сообщение'; break;
            }
          }
        }

        // Check if group chat and get group name
        const { data: convData } = await supabase.from('conversations').select('type, name').eq('id', msg.conversation_id).maybeSingle();
        let title = senderName;
        if (convData?.type === 'group') {
          if (notifSettings && notifSettings.groups === false) return;
          title = convData.name || 'Группа';
          body = `${senderName}: ${body}`;
        }

        if (notifSettings?.sounds !== false) {
          try { playReceiveSound(); } catch {}
        }

        const prevCount = unreadCountMap.current.get(msg.conversation_id) || 0;
        const newCount = prevCount + 1;
        unreadCountMap.current.set(msg.conversation_id, newCount);

        let displayBody = body;
        if (newCount > 1) {
          displayBody = `[${newCount} сообщений] ${body}`;
        }

        const notifOptions: NotificationOptions & { renotify?: boolean; image?: string } = {
          body: displayBody,
          icon: senderAvatar || '/favicon.ico',
          tag: msg.conversation_id,
          silent: notifSettings?.sounds === false,
          renotify: true,
        };
        if (msg.message_type === 'image' && msg.content && preview) {
          notifOptions.image = msg.content;
        }
        const notif = new Notification(title, notifOptions);
        notif.onclick = () => {
          window.focus();
          unreadCountMap.current.delete(msg.conversation_id);
          const isInChat = window.location.pathname.startsWith('/chat/');
          const method = isInChat ? 'replace' : 'push';
          router[method]({ pathname: '/chat/[id]', params: { id: msg.conversation_id, messageId: msg.id } });
          notif.close();
        };
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
        filter: `receiver_id=eq.${user.id}`,
      }, async (payload) => {
        if (!mountedRef.current) return;
        const call = payload.new as { id: string; caller_id: string; call_type: string; status: string };
        if (call.status !== 'ringing') return;
        if (permissionRef.current !== 'granted') return;

        const { data: callProfile } = await supabase
          .from('profiles')
          .select('notification_settings')
          .eq('id', user.id)
          .maybeSingle();
        if (!mountedRef.current) return;
        const callNotifSettings = callProfile?.notification_settings as Record<string, any> | null;
        if (callNotifSettings?.calls === false) return;

        const { data: callerProfile } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', call.caller_id)
          .maybeSingle();
        if (!mountedRef.current) return;

        const callerName = callerProfile?.display_name || 'Пользователь';
        const callLabel = call.call_type === 'video' ? 'Входящий видеозвонок' : 'Входящий звонок';

        const notif = new Notification(callerName, {
          body: callLabel,
          icon: callerProfile?.avatar_url || '/favicon.ico',
          tag: `call-${call.id}`,
          requireInteraction: true,
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };

        const callEndChannel = supabase
          .channel(`web-call-end-${call.id}`)
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'calls',
            filter: `id=eq.${call.id}`,
          }, (updatePayload) => {
            const updated = updatePayload.new as { status: string };
            if (updated.status !== 'ringing') {
              notif.close();
              supabase.removeChannel(callEndChannel);
            }
          })
          .subscribe();

        setTimeout(() => {
          notif.close();
          supabase.removeChannel(callEndChannel);
        }, 45000);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'message_reactions',
      }, async (payload) => {
        if (!mountedRef.current) return;
        const reaction = payload.new as { id: string; message_id: string; user_id: string; emoji: string };
        if (reaction.user_id === user.id) return;
        if (permissionRef.current !== 'granted') return;

        const { data: msg } = await supabase
          .from('messages')
          .select('sender_id, content, message_type, conversation_id')
          .eq('id', reaction.message_id)
          .maybeSingle();
        if (!mountedRef.current || !msg || msg.sender_id !== user.id) return;

        const currentPath = window.location.pathname;
        if (document.hasFocus() && currentPath.includes(msg.conversation_id)) return;

        const { data: reactorProfile } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', reaction.user_id)
          .maybeSingle();
        if (!mountedRef.current) return;

        const reactorName = reactorProfile?.display_name || 'Пользователь';
        let preview = 'сообщение';
        switch (msg.message_type) {
          case 'text': preview = (msg.content || '').slice(0, 50) || 'сообщение'; break;
          case 'image': preview = 'фото'; break;
          case 'video': preview = 'видео'; break;
          case 'voice': preview = 'голосовое сообщение'; break;
        }

        const notif = new Notification(reactorName, {
          body: `${reaction.emoji} реакция на: ${preview}`,
          icon: reactorProfile?.avatar_url || '/favicon.ico',
          tag: `reaction-${reaction.id}`,
        });
        notif.onclick = () => {
          window.focus();
          const isInChat = window.location.pathname.startsWith('/chat/');
          const method = isInChat ? 'replace' : 'push';
          router[method]({ pathname: '/chat/[id]', params: { id: msg.conversation_id, messageId: reaction.message_id } });
          notif.close();
        };
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  return null;
}

function DataPrefetcher() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      dataCache.clear();
      return;
    }
    dataCache.prefetch(user.id);
    const interval = setInterval(() => {
      dataCache.prefetch(user.id);
    }, 60000);
    return () => clearInterval(interval);
  }, [user?.id]);

  return null;
}

function PresenceTracker() {
  const { user } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatusRef = useRef<boolean | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!user) return;

    const updatePresence = (online: boolean) => {
      if (lastStatusRef.current === online) return;
      lastStatusRef.current = online;
      supabase
        .from('profiles')
        .update({ is_online: online, last_seen: new Date().toISOString() })
        .eq('id', user.id)
        .then(() => {});
    };

    const debouncedUpdate = (online: boolean) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (mountedRef.current) updatePresence(online);
      }, online ? 300 : 2000);
    };

    updatePresence(true);
    intervalRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      lastStatusRef.current = null;
      updatePresence(true);
    }, 60000);

    if (Platform.OS === 'web') {
      const handleVisChange = () => {
        if (mountedRef.current) debouncedUpdate(!document.hidden);
      };
      const handleBeforeUnload = () => {
        lastStatusRef.current = null;
        if (typeof navigator.sendBeacon === 'function') {
          updatePresence(false);
        }
      };
      document.addEventListener('visibilitychange', handleVisChange);
      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        document.removeEventListener('visibilitychange', handleVisChange);
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (!mountedRef.current) return;
      if (nextState === 'active') {
        debouncedUpdate(true);
      } else if (nextState === 'background' || nextState === 'inactive') {
        lastStatusRef.current = null;
        updatePresence(false);
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      appStateSub.remove();
    };
  }, [user?.id]);

  return null;
}

function PushNotificationHandler() {
  const { user } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  useEffect(() => {
    if (Platform.OS === 'web' || !user) return;

    registerForPushNotifications(user.id);
    updateBadgeCount(user.id);

    (async () => {
      const { data: prof } = await supabase
        .from('profiles')
        .select('notification_settings')
        .eq('id', user.id)
        .maybeSingle();
      if (prof?.notification_settings) {
        const ns = prof.notification_settings as Record<string, any>;
        if (ns.vibration === false) setVibrationEnabled(false);
        else setVibrationEnabled(true);
        if (ns.sounds === false) setSoundEnabled(false);
        else setSoundEnabled(true);
      }
    })();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        updateBadgeCount(user.id);
      }
    });

    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.conversation_id && data.conversation_id === getActiveChatId()) {
        Notifications.dismissNotificationAsync(notification.request.identifier);
      }
    });

    const navigateToChat = (conversationId: string, messageId?: string) => {
      const activeChatId = getActiveChatId();
      const isInChat = segmentsRef.current.includes('chat');
      const params = {
        id: conversationId,
        ...(messageId ? { messageId } : {}),
      };

      if (isInChat && activeChatId === conversationId && messageId) {
        router.setParams({ messageId });
        return;
      }

      if (isInChat) {
        router.replace({ pathname: '/chat/[id]', params });
      } else {
        router.push({ pathname: '/chat/[id]', params });
      }

      dismissChatNotifications(conversationId);
      updateBadgeCount(user.id);
    };

    const handleNotificationResponse = async (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      const actionId = response.actionIdentifier;
      const userText = response.userText;

      if (data?.type === 'call' && data?.call_id) {
        if (actionId === 'decline') {
          await supabase.from('calls').update({ status: 'declined' }).eq('id', data.call_id as string);
          return;
        }

        const { data: callRow } = await supabase.from('calls').select('status').eq('id', data.call_id as string).maybeSingle();
        if (!callRow || callRow.status !== 'ringing') return;

        await supabase.from('calls').update({ status: 'active' }).eq('id', data.call_id as string);
        router.push({
          pathname: '/call',
          params: {
            type: (data.call_type as string) || 'voice',
            userId: data.caller_id as string,
            name: response.notification.request.content.title || 'Пользователь',
            callId: data.call_id as string,
            role: 'receiver',
          },
        });
        return;
      }

      if (actionId === 'reply' && userText && data?.conversation_id && user) {
        await supabase.from('messages').insert({
          conversation_id: data.conversation_id as string,
          sender_id: user.id,
          content: userText,
          message_type: 'text',
          is_read: false,
          ...(data.status_id ? { status_id: data.status_id as string } : {}),
        });
        updateBadgeCount(user.id);
        return;
      }

      if (data?.type === 'contact_joined') {
        router.push('/new-contacts');
      } else if (data?.type === 'story' && data?.author_id) {
        router.push({ pathname: '/(tabs)/contacts' });
      } else if (data?.conversation_id) {
        navigateToChat(
          data.conversation_id as string,
          data.message_id as string | undefined,
        );
      }
    };

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const respondedAt = response.notification.date;
        const ageMs = Date.now() - respondedAt;
        if (ageMs < 30000) {
          handleNotificationResponse(response);
        }
      }
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    return () => {
      appStateSub.remove();
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [user?.id]);

  return null;
}

function AppLockOverlay() {
  const { isLocked } = useSecurity();
  if (!isLocked) return null;
  return <LockScreen />;
}

function NetworkBanner() {
  const isConnected = useNetwork();
  const [show, setShow] = useState(false);
  const slideAnim = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    if (!isConnected) {
      setShow(true);
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    } else if (show) {
      const t = setTimeout(() => {
        Animated.timing(slideAnim, { toValue: -40, duration: 300, useNativeDriver: true }).start(() => setShow(false));
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [isConnected]);

  if (!show) return null;
  return (
    <Animated.View style={[styles.networkBanner, { transform: [{ translateY: slideAnim }], backgroundColor: isConnected ? '#2CC76B' : '#FF5252' }]}>
      <Text style={styles.networkBannerText}>{isConnected ? 'Подключено' : 'Нет подключения к сети'}</Text>
    </Animated.View>
  );
}

function FloatingCallWidget() {
  const { activeCall } = useActiveCall();
  const { colors } = useAppearance();
  const router = useRouter();
  const pathname = usePathname();
  const pulse = useRef(new Animated.Value(1)).current;

  const isOnCallScreen = pathname === '/call';

  useEffect(() => {
    if (!activeCall || isOnCallScreen) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [activeCall, isOnCallScreen, pulse]);

  if (!activeCall || isOnCallScreen) return null;

  const fmtDur = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <Animated.View style={[styles.floatingCall, { transform: [{ scale: pulse }] }]}>
      <TouchableOpacity
        style={[styles.floatingCallInner, { backgroundColor: activeCall.state === 'connected' ? '#22C55E' : colors.primary }]}
        activeOpacity={0.85}
        onPress={() => {
          router.push({
            pathname: '/call',
            params: {
              type: activeCall.callType,
              userId: activeCall.peerId,
              name: activeCall.peerName,
              callId: activeCall.callId,
              role: 'caller',
              conversationId: activeCall.conversationId || '',
            },
          });
        }}
      >
        <View style={styles.floatingCallIcon}>
          {activeCall.callType === 'video' ? (
            <Video color="#FFF" size={16} />
          ) : (
            <Phone color="#FFF" size={16} />
          )}
        </View>
        <View style={styles.floatingCallInfo}>
          <Text style={styles.floatingCallName} numberOfLines={1}>{activeCall.peerName}</Text>
          <View style={styles.floatingCallMeta}>
            <View style={[styles.floatingCallDot, activeCall.state === 'connected' ? styles.floatingCallDotGreen : styles.floatingCallDotYellow]} />
            <Text style={styles.floatingCallTime}>
              {activeCall.state === 'connected' ? fmtDur(activeCall.duration) : 'Соединение...'}
            </Text>
          </View>
        </View>
        {activeCall.muted && (
          <MicOff color="rgba(255,255,255,0.7)" size={14} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

function AppContent() {
  const { resolvedTheme, colors } = useAppearance();
  const { switchingAccount } = useAuth();

  const stackContent = (
    <>
      <VoiceMiniPlayer />
      <FloatingCallWidget />
      <NetworkBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="setup-profile" />
        <Stack.Screen name="permissions" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings/notifications" />
        <Stack.Screen name="settings/privacy" />
        <Stack.Screen name="settings/security" />
        <Stack.Screen name="settings/appearance" />
        <Stack.Screen name="settings/help" />
        <Stack.Screen name="settings/starred" />
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
        <Stack.Screen name="new-chat" options={{ presentation: 'modal' }} />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="u/[userId]" options={{ headerShown: false }} />
        <Stack.Screen name="support" options={{ headerShown: false }} />
        <Stack.Screen name="terms" options={{ headerShown: false }} />
        <Stack.Screen name="privacy" options={{ headerShown: false }} />
        <Stack.Screen name="qr-code" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="call" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="@[username]" options={{ headerShown: false }} />
        <Stack.Screen name="[username]" options={{ headerShown: false }} />
        <Stack.Screen name="channel/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <IncomingCallOverlay />
      <PushNotificationHandler />
      <DataPrefetcher />
      <PresenceTracker />
      {Platform.OS === 'web' && <WebNotifications />}
      <AppLockOverlay />
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
    </>
  );

  return (
    <DesktopShell>
      {stackContent}
      {switchingAccount && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </DesktopShell>
  );
}

function SecurityWrapper({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  return (
    <SecurityProvider isAuthenticated={!!session}>
      {children}
    </SecurityProvider>
  );
}

export default function RootLayout() {
  useFrameworkReady();
  useFonts({
    'Roboto-Bold': Roboto_700Bold,
    'Nunito-Bold': Nunito_700Bold,
    'Pacifico': Pacifico_400Regular,
    'Lobster': Lobster_400Regular,
    'Raleway-Bold': Raleway_700Bold,
    'Oswald-SemiBold': Oswald_600SemiBold,
    'PlayfairDisplay-Bold': PlayfairDisplay_700Bold,
    'Comfortaa-Bold': Comfortaa_700Bold,
    'PressStart2P': PressStart2P_400Regular,
    'Caveat-Bold': Caveat_700Bold,
  });
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);

  return (
    <PerformanceProvider>
      <ActiveCallContext.Provider value={useMemo(() => ({ activeCall, setActiveCall }), [activeCall, setActiveCall])}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <MobileFrame>
            <AuthProvider>
              <SecurityWrapper>
                <AppearanceProvider>
                  <DesktopChatProvider>
                    <VoicePlayerProvider>
                      <AppContent />
                      <AudioProximityHandler />
                    </VoicePlayerProvider>
                  </DesktopChatProvider>
                </AppearanceProvider>
              </SecurityWrapper>
            </AuthProvider>
          </MobileFrame>
        </GestureHandlerRootView>
      </ActiveCallContext.Provider>
    </PerformanceProvider>
  );
}

const styles = StyleSheet.create({
  incomingOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  incomingContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  incomingLabel: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 36,
    letterSpacing: 0.2,
  },
  incomingAvatarContainer: {
    position: 'relative',
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  incomingRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
  },
  incomingAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  incomingAvatarText: {
    fontSize: 38,
    fontWeight: '700',
  },
  incomingAvatarImg: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  incomingName: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
    letterSpacing: -0.3,
  },
  quickRepliesPanel: {
    width: '100%',
    paddingHorizontal: 24,
    gap: 6,
    marginBottom: 12,
  },
  quickReplyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  quickReplyText: {
    fontSize: 14,
    fontWeight: '500',
  },
  quickReplyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 24,
  },
  quickReplyToggleText: {
    fontSize: 13,
    fontWeight: '500',
  },
  incomingActions: {
    flexDirection: 'row',
    gap: 56,
    marginBottom: 10,
  },
  declineButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F44336',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2CC76B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  incomingLabels: {
    flexDirection: 'row',
    gap: 56,
  },
  actionLabel: {
    fontSize: 12,
    width: 64,
    textAlign: 'center',
  },
  networkBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  networkBannerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  floatingCall: {
    position: 'absolute',
    top: 52,
    left: 12,
    right: 12,
    zIndex: 5000,
  },
  floatingCallInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  floatingCallIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingCallInfo: {
    flex: 1,
  },
  floatingCallName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  floatingCallMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  floatingCallDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  floatingCallDotGreen: {
    backgroundColor: '#86EFAC',
  },
  floatingCallDotYellow: {
    backgroundColor: '#FDE68A',
  },
  floatingCallTime: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '500',
  },
});

import { useState, useEffect, useCallback, useRef, useMemo, memo, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Modal,
  Pressable,
  TextInput,
  Dimensions,
  ActivityIndicator,
  Platform,
  Animated as RNAnimated,
  PanResponder,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Plus, X, Eye, EyeOff, Trash2, Camera, ImageIcon, Type, Play, Pause, Volume2, VolumeX, Mic, Square,
  AlignLeft, AlignCenter, AlignRight, ChevronDown, Scissors, RotateCcw, Sun, Contrast, Droplets,
  Sparkles, Move, MessageCircle, Heart, Send, ChevronRight, MoreVertical, Download, Share2, Flag, Clock, Check,
} from 'lucide-react-native';
import Svg, { Circle } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { Audio, Video, ResizeMode } from 'expo-av';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';

const REACTION_EMOJIS = ['\u2764\uFE0F', '\uD83D\uDD25', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE22', '\uD83D\uDE4F'];

interface PendingUpload {
  id: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
}

const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u;
const isEmojiOnly = (text: string | null) => !!text && EMOJI_ONLY_RE.test(text.trim());

const MAX_STORIES_PER_DAY = 30;
const STORY_DURATION_MS = 6000;
const VIDEO_MAX_DURATION_SEC = 90;

let SCREEN_WIDTH = Dimensions.get('window').width;
let SCREEN_HEIGHT = Dimensions.get('window').height;
Dimensions.addEventListener('change', ({ window }) => {
  SCREEN_WIDTH = window.width;
  SCREEN_HEIGHT = window.height;
});

async function uploadToStorageWithProgress(
  filePath: string,
  body: ArrayBuffer | Blob | File,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ error: any }> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token || anonKey;
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `${supabaseUrl}/storage/v1/object/stories-media/${encodedPath}`;

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', anonKey!);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ error: null });
      } else {
        let err: any;
        try { err = JSON.parse(xhr.responseText); } catch { err = { message: `HTTP ${xhr.status}` }; }
        resolve({ error: err });
      }
    };
    xhr.onerror = () => resolve({ error: { message: 'Сетевая ошибка загрузки' } });
    xhr.send(body as any);
  });
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

export interface Status {
  id: string;
  user_id: string;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  background_color: string;
  text_color: string;
  created_at: string;
  expires_at: string;
  trim_start_pct: number;
  trim_end_pct: number;
  visibility?: string;
  thumbnail_url?: string | null;
}

export interface UserWithStatuses {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  statuses: Status[];
  viewed_all: boolean;
  viewedCount: number;
}

const STATUS_COLORS: { bg: string; text: string; gradient: [string, string, string] }[] = [
  { bg: '#1E88E5', text: '#FFFFFF', gradient: ['#1565C0', '#1E88E5', '#42A5F5'] },
  { bg: '#43A047', text: '#FFFFFF', gradient: ['#2E7D32', '#43A047', '#66BB6A'] },
  { bg: '#E53935', text: '#FFFFFF', gradient: ['#C62828', '#E53935', '#EF5350'] },
  { bg: '#FB8C00', text: '#FFFFFF', gradient: ['#E65100', '#FB8C00', '#FFA726'] },
  { bg: '#8E24AA', text: '#FFFFFF', gradient: ['#6A1B9A', '#8E24AA', '#AB47BC'] },
  { bg: '#00ACC1', text: '#FFFFFF', gradient: ['#00838F', '#00ACC1', '#26C6DA'] },
  { bg: '#3949AB', text: '#FFFFFF', gradient: ['#283593', '#3949AB', '#5C6BC0'] },
  { bg: '#1B5E20', text: '#FFFFFF', gradient: ['#0D3311', '#1B5E20', '#2E7D32'] },
  { bg: '#D84315', text: '#FFFFFF', gradient: ['#BF360C', '#D84315', '#F4511E'] },
  { bg: '#37474F', text: '#FFFFFF', gradient: ['#263238', '#37474F', '#546E7A'] },
];

const FONT_OPTIONS: { label: string; family: string; style: any }[] = [
  { label: 'Sans', family: 'System', style: {} },
  { label: 'Serif', family: 'serif', style: { fontFamily: 'serif' } },
  { label: 'Mono', family: 'monospace', style: { fontFamily: 'monospace' } },
  { label: 'Roboto', family: 'Roboto-Bold', style: { fontFamily: 'Roboto-Bold' } },
  { label: 'Nunito', family: 'Nunito-Bold', style: { fontFamily: 'Nunito-Bold' } },
  { label: 'Pacifico', family: 'Pacifico', style: { fontFamily: 'Pacifico', fontWeight: '400' as const } },
  { label: 'Lobster', family: 'Lobster', style: { fontFamily: 'Lobster', fontWeight: '400' as const } },
  { label: 'Raleway', family: 'Raleway-Bold', style: { fontFamily: 'Raleway-Bold' } },
  { label: 'Oswald', family: 'Oswald-SemiBold', style: { fontFamily: 'Oswald-SemiBold' } },
  { label: 'Playfair', family: 'PlayfairDisplay-Bold', style: { fontFamily: 'PlayfairDisplay-Bold' } },
  { label: 'Comfortaa', family: 'Comfortaa-Bold', style: { fontFamily: 'Comfortaa-Bold' } },
  { label: 'Pixel', family: 'PressStart2P', style: { fontFamily: 'PressStart2P', fontWeight: '400' as const } },
  { label: 'Caveat', family: 'Caveat-Bold', style: { fontFamily: 'Caveat-Bold' } },
];

const FONT_SIZES = [18, 22, 28, 36, 44];

const FILTERS = [
  { label: 'Без фильтра', key: 'none', css: 'none' },
  { label: 'Теплый', key: 'warm', css: 'sepia(0.35) saturate(1.3) brightness(1.05)' },
  { label: 'Холодный', key: 'cool', css: 'saturate(0.8) hue-rotate(15deg) brightness(1.05)' },
  { label: 'Ч/Б', key: 'bw', css: 'grayscale(1)' },
  { label: 'Винтаж', key: 'vintage', css: 'sepia(0.5) contrast(1.1) brightness(0.95)' },
  { label: 'Яркий', key: 'vivid', css: 'saturate(1.6) contrast(1.1)' },
  { label: 'Мягкий', key: 'soft', css: 'brightness(1.1) contrast(0.9) saturate(0.9)' },
  { label: 'Драма', key: 'drama', css: 'contrast(1.4) brightness(0.9) saturate(1.2)' },
];

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') { resolve(null); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0] || null;
      resolve(file);
    };
    input.click();
  });
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function PulsingGlow({ active, color, size, children }: { active: boolean; color: string; size: number; children: React.ReactNode }) {
  const pulseAnim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    if (!active) { pulseAnim.setValue(0); return; }
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: Platform.OS !== 'web' }),
        RNAnimated.timing(pulseAnim, { toValue: 0, duration: 1200, useNativeDriver: Platform.OS !== 'web' }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  if (!active) return <>{children}</>;

  const scale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const opacity = pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.2, 0.6] });

  return (
    <View style={{ width: size + 12, height: size + 12, justifyContent: 'center', alignItems: 'center' }}>
      <RNAnimated.View style={{
        position: 'absolute', width: size + 8, height: size + 8, borderRadius: (size + 8) / 2,
        borderWidth: 2, borderColor: color, opacity, transform: [{ scale }],
      }} />
      {children}
    </View>
  );
}

function StoryProgressRing({
  total,
  viewed,
  size,
  strokeWidth,
  activeColor,
  viewedColor,
}: {
  total: number;
  viewed: number;
  size: number;
  strokeWidth: number;
  activeColor: string;
  viewedColor: string;
}) {
  if (total === 0) return null;
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gapDeg = total === 1 ? 0 : 4;
  const totalGapDeg = gapDeg * total;
  const segmentDeg = (360 - totalGapDeg) / total;
  const startOffsetDeg = -90;

  const segments = [];
  for (let i = 0; i < total; i++) {
    const startDeg = startOffsetDeg + i * (segmentDeg + gapDeg);
    const segmentFraction = segmentDeg / 360;
    const dashLength = circumference * segmentFraction;
    const gapLength = circumference - dashLength;
    const rotation = startDeg;
    const isViewed = i < viewed;

    segments.push(
      <Circle
        key={i}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={isViewed ? viewedColor : activeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={`${dashLength} ${gapLength}`}
        strokeLinecap="round"
        transform={`rotate(${rotation} ${center} ${center})`}
      />
    );
  }

  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      {segments}
    </Svg>
  );
}


export interface StatusBarRef {
  openCreate: () => void;
  openViewer: () => void;
}

interface StatusBarProps {
  compact?: boolean;
  onStoriesCountChange?: (count: number) => void;
}

const StatusBar = forwardRef<StatusBarRef, StatusBarProps>(function StatusBar({ compact, onStoriesCountChange }, ref) {
  const { user } = useAuth();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const [usersWithStatuses, setUsersWithStatuses] = useState<UserWithStatuses[]>([]);
  const [myStatuses, setMyStatuses] = useState<Status[]>([]);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [myTodayCount, setMyTodayCount] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewerModal, setShowViewerModal] = useState(false);
  const [viewingUser, setViewingUser] = useState<UserWithStatuses | null>(null);
  const [videoThumbCache, setVideoThumbCache] = useState<Record<string, string>>({});
  const [viewingIndex, setViewingIndex] = useState(0);
  const [viewersList, setViewersList] = useState<{ viewer_id: string; name: string; avatar_url: string | null; time: string }[]>([]);
  const router = useRouter();
  const [showViewers, setShowViewers] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);

  const uploadProgressAnim = useRef(new RNAnimated.Value(0)).current;

  useImperativeHandle(ref, () => ({
    openCreate: () => setShowCreateModal(true),
    openViewer: () => {
      if (usersWithStatuses.length > 0) {
        const firstUser = usersWithStatuses[0];
        setViewingUser(firstUser);
        setViewingIndex(0);
        setShowViewerModal(true);
        setShowViewers(false);
      }
    },
  }));

  useEffect(() => {
    if (pendingUpload) {
      RNAnimated.timing(uploadProgressAnim, {
        toValue: pendingUpload.progress,
        duration: 200,
        useNativeDriver: true,
      }).start();
      if (pendingUpload.status === 'done') {
        setTimeout(() => setPendingUpload(null), 1500);
      } else if (pendingUpload.status === 'error') {
        setTimeout(() => setPendingUpload(null), 3000);
      }
    } else {
      uploadProgressAnim.setValue(0);
    }
  }, [pendingUpload?.progress, pendingUpload?.status]);

  const loadStatuses = useCallback(async () => {
    if (!user) return;

    const now = new Date().toISOString();
    const { data: allStatuses } = await supabase
      .from('user_statuses')
      .select('*')
      .gt('expires_at', now)
      .order('created_at', { ascending: true });

    if (!allStatuses?.length) {
      setMyStatuses([]);
      setUsersWithStatuses([]);
      return;
    }

    const mine = allStatuses.filter(s => s.user_id === user.id);
    setMyStatuses(mine);

    if (mine.length > 0) {
      const { data: myProfile } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      setMyAvatarUrl(myProfile?.avatar_url || null);
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('user_statuses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', todayStart.toISOString());
    setMyTodayCount(count || 0);

    const { data: hiddenRows } = await supabase
      .from('hidden_statuses')
      .select('hidden_user_id')
      .eq('user_id', user.id);
    const hiddenSet = new Set((hiddenRows || []).map(h => h.hidden_user_id));

    const others = allStatuses.filter(s => s.user_id !== user.id && !hiddenSet.has(s.user_id));
    const userIds = [...new Set(others.map(s => s.user_id))];

    if (userIds.length === 0) {
      setUsersWithStatuses([]);
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', userIds);

    // Filter by visibility: check contacts and close_friends
    const { data: myContacts } = await supabase
      .from('contacts')
      .select('contact_id')
      .eq('user_id', user.id);
    const contactIds = new Set((myContacts || []).map(c => c.contact_id));

    const { data: closeFriendRows } = await supabase
      .from('close_friends')
      .select('user_id')
      .eq('friend_id', user.id);
    const closeFriendOfSet = new Set((closeFriendRows || []).map(r => r.user_id));

    const visibleStatuses = others.filter(s => {
      const vis = s.visibility || 'everyone';
      if (vis === 'nobody') return false;
      if (vis === 'contacts') return contactIds.has(s.user_id);
      if (vis === 'close_friends') return closeFriendOfSet.has(s.user_id);
      return true;
    });

    const { data: myViews } = await supabase
      .from('status_views')
      .select('status_id')
      .eq('viewer_id', user.id);

    const viewedIds = new Set((myViews || []).map(v => v.status_id));
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const visibleUserIds = [...new Set(visibleStatuses.map(s => s.user_id))];
    const grouped: UserWithStatuses[] = visibleUserIds.map(uid => {
      const profile = profileMap.get(uid);
      const userStatuses = visibleStatuses.filter(s => s.user_id === uid);
      const viewed = userStatuses.filter(s => viewedIds.has(s.id)).length;
      const allViewed = viewed === userStatuses.length;
      return {
        user_id: uid,
        display_name: profile?.display_name || '',
        avatar_url: profile?.avatar_url || null,
        statuses: userStatuses,
        viewed_all: allViewed,
        viewedCount: viewed,
      };
    });

    grouped.sort((a, b) => {
      if (a.viewed_all !== b.viewed_all) return a.viewed_all ? 1 : -1;
      const aLatest = a.statuses[a.statuses.length - 1]?.created_at || '';
      const bLatest = b.statuses[b.statuses.length - 1]?.created_at || '';
      return bLatest.localeCompare(aLatest);
    });

    setUsersWithStatuses(grouped);
  }, [user]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  useEffect(() => {
    onStoriesCountChange?.(usersWithStatuses.length + myStatuses.length);
  }, [usersWithStatuses.length, myStatuses.length, onStoriesCountChange]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`user_statuses_realtime_${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_statuses' },
        () => { loadStatuses(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, loadStatuses]);

  const handleBackgroundPublish = useCallback(async (publishFn: () => Promise<boolean>) => {
    const uploadId = Date.now().toString();
    setPendingUpload({ id: uploadId, progress: 0.1, status: 'uploading' });
    setShowCreateModal(false);

    const progressInterval = setInterval(() => {
      setPendingUpload(prev => {
        if (!prev || prev.id !== uploadId || prev.status !== 'uploading') return prev;
        const next = Math.min(prev.progress + 0.08, 0.9);
        return { ...prev, progress: next };
      });
    }, 500);

    try {
      const success = await publishFn();
      clearInterval(progressInterval);
      if (success) {
        setPendingUpload({ id: uploadId, progress: 1, status: 'done' });
        loadStatuses();
      } else {
        setPendingUpload({ id: uploadId, progress: 0, status: 'error' });
      }
    } catch {
      clearInterval(progressInterval);
      setPendingUpload({ id: uploadId, progress: 0, status: 'error' });
    }
  }, [loadStatuses]);

  const handleViewStatus = async (userWithStatuses: UserWithStatuses) => {
    setViewingUser(userWithStatuses);
    setViewingIndex(0);
    setShowViewerModal(true);
    setShowViewers(false);

    if (user && userWithStatuses.statuses[0]) {
      await supabase.from('status_views').upsert({
        status_id: userWithStatuses.statuses[0].id,
        viewer_id: user.id,
      }, { onConflict: 'status_id,viewer_id' });
    }
  };

  const handleViewMyStatus = () => {
    if (myStatuses.length === 0) {
      setShowCreateModal(true);
      return;
    }
    const myUser: UserWithStatuses = {
      user_id: user!.id,
      display_name: 'Мой статус',
      avatar_url: myAvatarUrl,
      statuses: myStatuses,
      viewed_all: true,
      viewedCount: myStatuses.length,
    };
    setViewingUser(myUser);
    setViewingIndex(0);
    setShowViewerModal(true);
    setShowViewers(false);
  };

  const handleNextStatus = async () => {
    if (!viewingUser) return;
    const next = viewingIndex + 1;
    if (next >= viewingUser.statuses.length) {
      const idx = usersWithStatuses.findIndex(u => u.user_id === viewingUser.user_id);
      const nextUser = idx >= 0 && idx < usersWithStatuses.length - 1 ? usersWithStatuses[idx + 1] : null;
      if (nextUser) {
        setViewingUser(nextUser);
        setViewingIndex(0);
        setShowViewers(false);
        if (user && nextUser.user_id !== user.id && nextUser.statuses[0]) {
          await supabase.from('status_views').upsert({
            status_id: nextUser.statuses[0].id, viewer_id: user.id,
          }, { onConflict: 'status_id,viewer_id' });
        }
      } else {
        setShowViewerModal(false);
        loadStatuses();
      }
      return;
    }
    setViewingIndex(next);
    setShowViewers(false);

    if (user && viewingUser.user_id !== user.id) {
      await supabase.from('status_views').upsert({
        status_id: viewingUser.statuses[next].id,
        viewer_id: user.id,
      }, { onConflict: 'status_id,viewer_id' });
    }
  };

  const handlePrevStatus = async () => {
    if (viewingIndex > 0) {
      setViewingIndex(viewingIndex - 1);
      setShowViewers(false);
    } else {
      const idx = usersWithStatuses.findIndex(u => u.user_id === viewingUser?.user_id);
      const prevUser = idx > 0 ? usersWithStatuses[idx - 1] : null;
      if (prevUser) {
        setViewingUser(prevUser);
        setViewingIndex(prevUser.statuses.length - 1);
        setShowViewers(false);
        if (user && prevUser.user_id !== user.id) {
          const lastStatus = prevUser.statuses[prevUser.statuses.length - 1];
          if (lastStatus) {
            await supabase.from('status_views').upsert({
              status_id: lastStatus.id, viewer_id: user.id,
            }, { onConflict: 'status_id,viewer_id' });
          }
        }
      }
    }
  };

  const handleDeleteStatus = async (statusId: string) => {
    await supabase.from('user_statuses').delete().eq('id', statusId);
    if (viewingUser) {
      const remaining = viewingUser.statuses.filter(s => s.id !== statusId);
      if (remaining.length === 0) {
        setShowViewerModal(false);
        loadStatuses();
      } else {
        setViewingUser({ ...viewingUser, statuses: remaining });
        setViewingIndex(Math.min(viewingIndex, remaining.length - 1));
        loadStatuses();
      }
    } else {
      setShowViewerModal(false);
      loadStatuses();
    }
  };

  const loadViewers = async (statusId: string) => {
    const { data } = await supabase
      .from('status_views')
      .select('viewer_id, viewed_at')
      .eq('status_id', statusId);

    if (!data?.length) {
      setViewersList([]);
      setShowViewers(true);
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', data.map(v => v.viewer_id));

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    setViewersList(data.map(v => {
      const p = profileMap.get(v.viewer_id);
      return {
        viewer_id: v.viewer_id,
        name: p?.display_name || '',
        avatar_url: p?.avatar_url || null,
        time: formatTime(v.viewed_at),
      };
    }));
    setShowViewers(true);
  };

  const handleHideUserStories = async (hiddenUserId: string) => {
    if (!user) return;
    await supabase.from('hidden_statuses').upsert({
      user_id: user.id,
      hidden_user_id: hiddenUserId,
    }, { onConflict: 'user_id,hidden_user_id' });
    setShowViewerModal(false);
    loadStatuses();
  };

  const handleStartChatFromStory = async (otherUserId: string) => {
    if (!user) return;

    const { data: myMemberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (myMemberships?.length) {
      const convIds = myMemberships.map(m => m.conversation_id);
      const { data: directConvs } = await supabase
        .from('conversations')
        .select('id')
        .in('id', convIds)
        .eq('type', 'direct');

      if (directConvs?.length) {
        const { data: otherMembers } = await supabase
          .from('conversation_members')
          .select('conversation_id')
          .in('conversation_id', directConvs.map(c => c.id))
          .eq('user_id', otherUserId);

        if (otherMembers?.length) {
          router.push({ pathname: '/chat/[id]', params: { id: otherMembers[0].conversation_id } });
          return;
        }
      }
    }

    const convId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
    const { error: convErr } = await supabase.from('conversations').insert({ id: convId, type: 'direct', created_by: user.id });
    if (convErr) return;
    await supabase.from('conversation_members').insert({ conversation_id: convId, user_id: user.id, role: 'admin' });
    await supabase.from('conversation_members').insert({ conversation_id: convId, user_id: otherUserId, role: 'admin' });
    router.push({ pathname: '/chat/[id]', params: { id: convId } });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins}м назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}ч назад`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  const formatStatusTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const generateVideoThumb = useCallback((videoUrl: string) => {
    if (videoThumbCache[videoUrl] || Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.src = videoUrl;
    v.currentTime = 0.5;
    const onSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(v.videoWidth || 240, 240);
        canvas.height = Math.round(canvas.width * ((v.videoHeight || 240) / (v.videoWidth || 240)));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        setVideoThumbCache(prev => ({ ...prev, [videoUrl]: dataUrl }));
      } catch {}
    };
    v.addEventListener('seeked', onSeeked, { once: true });
    v.addEventListener('error', () => {}, { once: true });
  }, [videoThumbCache]);

  const getStatusThumbnail = (status: Status): { type: 'letter' | 'image' | 'color' | 'video_loading'; value: string } => {
    if (status.thumbnail_url) {
      return { type: 'image', value: status.thumbnail_url };
    }
    if (status.media_url && status.media_type === 'image') {
      return { type: 'image', value: status.media_url };
    }
    if (status.media_url && status.media_type === 'video') {
      if (videoThumbCache[status.media_url]) {
        return { type: 'image', value: videoThumbCache[status.media_url] };
      }
      generateVideoThumb(status.media_url);
      return { type: 'video_loading', value: '#000000' };
    }
    if (status.media_url && status.media_type === 'voice') {
      return { type: 'color', value: status.background_color || '#1a1a2e' };
    }
    return { type: 'letter', value: status.content?.charAt(0)?.toUpperCase() || '+' };
  };

  if (usersWithStatuses.length === 0 && myStatuses.length === 0 && !pendingUpload) {
    if (compact) {
      return (
        <>
          {showCreateModal && (
            <CreateModal
              visible={showCreateModal}
              colors={colors}
              userId={user?.id || ''}
              todayCount={myTodayCount}
              onClose={() => setShowCreateModal(false)}
              onCreated={() => { setShowCreateModal(false); loadStatuses(); }}
            />
          )}
        </>
      );
    }
    return (
      <View style={[styles.container, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity style={styles.statusItem} onPress={() => setShowCreateModal(true)}>
            <View style={[styles.addStatusRing, { borderColor: colors.primary }]}>
              <View style={[styles.statusAvatar, { backgroundColor: colors.backgroundSecondary }]}>
                <Plus color={colors.primary} size={22} />
              </View>
            </View>
            <Text style={[styles.statusName, { color: colors.textSecondary }]} numberOfLines={1}>Статус</Text>
          </TouchableOpacity>
        </ScrollView>

        {showCreateModal && (
          <CreateModal
            visible={showCreateModal}
            colors={colors}
            userId={user?.id || ''}
            todayCount={myTodayCount}
            onClose={() => setShowCreateModal(false)}
            onCreated={() => { setShowCreateModal(false); loadStatuses(); }}
          />
        )}
      </View>
    );
  }

  const currentStatus = viewingUser?.statuses[viewingIndex];

  if (compact) {
    const allCompact: { user_id: string; avatar_url: string | null; latestStatus: Status | null }[] = [];
    if (myStatuses.length > 0) {
      allCompact.push({ user_id: user?.id || 'me', avatar_url: myAvatarUrl, latestStatus: myStatuses[0] });
    }
    usersWithStatuses.forEach(s => allCompact.push({ 
      user_id: s.user_id, 
      avatar_url: s.avatar_url,
      latestStatus: s.statuses.length > 0 ? s.statuses[s.statuses.length - 1] : null,
    }));
    const displayStatuses = allCompact.slice(0, 3);
    if (displayStatuses.length === 0) return (
      <>
        {showCreateModal && (
          <CreateModal
            visible={showCreateModal}
            colors={colors}
            userId={user?.id || ''}
            todayCount={myTodayCount}
            onClose={() => setShowCreateModal(false)}
            onCreated={() => { setShowCreateModal(false); loadStatuses(); }}
            onBackgroundPublish={handleBackgroundPublish}
          />
        )}
      </>
    );
    return (
      <>
        <View style={styles.compactContainer}>
          {displayStatuses.map((s, i) => {
            const status = s.latestStatus;
            const hasImage = status?.media_url && status.media_type === 'image';
            const hasVideo = status?.media_url && status.media_type === 'video';
            const hasVoice = status?.media_url && status.media_type === 'voice';
            const bgColor = status?.background_color || colors.primary;
            return (
              <View key={s.user_id} style={[styles.compactAvatar, { marginLeft: i > 0 ? -8 : 0, zIndex: 10 - i, borderColor: colors.primary }]}>
                {hasImage ? (
                  <Image source={{ uri: status!.media_url! }} style={styles.compactAvatarImg} />
                ) : hasVideo ? (
                  <View style={[styles.compactAvatarImg, { backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: '#fff', fontSize: 11 }}>▶</Text>
                  </View>
                ) : hasVoice ? (
                  <View style={[styles.compactAvatarImg, { backgroundColor: '#0d7377', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: '#fff', fontSize: 10 }}>🎤</Text>
                  </View>
                ) : status?.content ? (
                  <View style={[styles.compactAvatarImg, { backgroundColor: bgColor, alignItems: 'center', justifyContent: 'center', padding: 2 }]}>
                    <Text style={{ color: '#fff', fontSize: 6, textAlign: 'center' }} numberOfLines={2}>{status.content}</Text>
                  </View>
                ) : s.avatar_url ? (
                  <Image source={{ uri: s.avatar_url }} style={styles.compactAvatarImg} />
                ) : (
                  <View style={[styles.compactAvatarImg, { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                      {s.user_id.substring(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
        {showCreateModal && (
          <CreateModal
            visible={showCreateModal}
            colors={colors}
            userId={user?.id || ''}
            todayCount={myTodayCount}
            onClose={() => setShowCreateModal(false)}
            onCreated={() => { setShowCreateModal(false); loadStatuses(); }}
            onBackgroundPublish={handleBackgroundPublish}
          />
        )}
      </>
    );
  }

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity style={styles.statusItem} onPress={handleViewMyStatus}>
          <View style={styles.segmentedRingContainer}>
            {myStatuses.length > 0 ? (
              <StoryProgressRing
                total={myStatuses.length}
                viewed={myStatuses.length}
                size={66}
                strokeWidth={2.5}
                activeColor={colors.primary}
                viewedColor={colors.primary}
              />
            ) : (
              <Svg width={66} height={66} style={StyleSheet.absoluteFill}>
                <Circle
                  cx={33}
                  cy={33}
                  r={30.75}
                  fill="none"
                  stroke={colors.border}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
              </Svg>
            )}
            <View style={styles.segmentedRingInner}>
              {myStatuses.length > 0 ? (() => {
                const thumb = getStatusThumbnail(myStatuses[myStatuses.length - 1]);
                if (thumb.type === 'image') {
                  return <Image source={{ uri: thumb.value }} style={styles.statusAvatar} />;
                }
                if (thumb.type === 'color') {
                  return (
                    <View style={[styles.statusAvatar, { backgroundColor: thumb.value }]}>
                      <Mic color="#FFFFFF" size={16} />
                    </View>
                  );
                }
                if (thumb.type === 'video_loading') {
                  return (
                    <View style={[styles.statusAvatar, { backgroundColor: '#000000' }]}>
                      <Play color="#FFFFFF" size={16} fill="#FFFFFF" />
                    </View>
                  );
                }
                return (
                  <View style={[styles.statusAvatar, { backgroundColor: colors.backgroundSecondary }]}>
                    <Text style={[styles.statusAvatarLetter, { color: colors.text }]}>{thumb.value}</Text>
                  </View>
                );
              })() : (
                <View style={[styles.statusAvatar, { backgroundColor: colors.backgroundSecondary }]}>
                  <Plus color={colors.primary} size={20} />
                </View>
              )}
            </View>
            {pendingUpload && pendingUpload.status === 'uploading' && (
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={StyleSheet.absoluteFill}
              />
            )}
            {myStatuses.length > 0 && (
              <View style={[styles.storyCountBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
                <Text style={styles.storyCountText}>{myStatuses.length}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.statusName, { color: pendingUpload?.status === 'uploading' ? colors.primary : colors.textSecondary }]} numberOfLines={1}>
            {pendingUpload?.status === 'uploading' ? 'Публ...' : pendingUpload?.status === 'error' ? 'Ошибка' : 'Мой'}
          </Text>
          <TouchableOpacity
            style={[styles.miniAddBtn, { backgroundColor: colors.primary, borderColor: colors.background }]}
            onPress={(e) => { e.stopPropagation(); setShowCreateModal(true); }}
          >
            <Plus color="#FFFFFF" size={10} strokeWidth={3} />
          </TouchableOpacity>
        </TouchableOpacity>

        {usersWithStatuses.map((u) => {
          const letter = u.display_name.charAt(0).toUpperCase();
          const total = u.statuses.length;
          const viewed = u.viewedCount;
          const unviewed = total - viewed;
          const isNew = viewed === 0 && total > 0;
          const latestStatus = u.statuses[u.statuses.length - 1];
          const latestThumb = getStatusThumbnail(latestStatus);
          return (
            <TouchableOpacity key={u.user_id} style={styles.statusItem} onPress={() => handleViewStatus(u)}>
              <PulsingGlow active={isNew} color={colors.primary} size={66}>
                <View style={styles.segmentedRingContainer}>
                  <StoryProgressRing
                    total={total}
                    viewed={viewed}
                    size={66}
                    strokeWidth={2.5}
                    activeColor={colors.primary}
                    viewedColor={colors.textTertiary}
                  />
                  <View style={styles.segmentedRingInner}>
                    {latestThumb.type === 'image' ? (
                      <Image source={{ uri: latestThumb.value }} style={styles.statusAvatar} />
                    ) : latestThumb.type === 'color' ? (
                      <View style={[styles.statusAvatar, { backgroundColor: latestThumb.value }]}>
                        <Mic color="#FFFFFF" size={16} />
                      </View>
                    ) : latestThumb.type === 'video_loading' ? (
                      <View style={[styles.statusAvatar, { backgroundColor: '#000000' }]}>
                        <Play color="#FFFFFF" size={16} fill="#FFFFFF" />
                      </View>
                    ) : u.avatar_url ? (
                      <Image source={{ uri: u.avatar_url }} style={styles.statusAvatar} />
                    ) : (
                      <View style={[styles.statusAvatar, { backgroundColor: colors.surfaceTertiary }]}>
                        <Text style={[styles.statusAvatarLetter, { color: colors.text }]}>{letter}</Text>
                      </View>
                    )}
                  </View>
                  {unviewed > 0 && (
                    <View style={[styles.storyCountBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
                      <Text style={styles.storyCountText}>{unviewed}</Text>
                    </View>
                  )}
                </View>
              </PulsingGlow>
              <Text style={[styles.statusName, { color: colors.textSecondary }]} numberOfLines={1}>{u.display_name.split(' ')[0]}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {showCreateModal && (
        <CreateModal
          visible={showCreateModal}
          colors={colors}
          userId={user?.id || ''}
          todayCount={myTodayCount}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); loadStatuses(); }}
          onBackgroundPublish={handleBackgroundPublish}
        />
      )}

      <Modal visible={showViewerModal} transparent animationType="fade" onRequestClose={() => { setShowViewerModal(false); loadStatuses(); }}>
        {currentStatus && viewingUser && (
          <StatusViewer
            viewingUser={viewingUser}
            currentStatus={currentStatus}
            viewingIndex={viewingIndex}
            userId={user?.id || ''}
            onNext={handleNextStatus}
            onPrev={handlePrevStatus}
            onDelete={handleDeleteStatus}
            onClose={() => { setShowViewerModal(false); loadStatuses(); }}
            onLoadViewers={loadViewers}
            viewersList={viewersList}
            showViewers={showViewers}
            setShowViewers={setShowViewers}
            formatStatusTime={formatStatusTime}
            onAddNew={() => { setShowViewerModal(false); setShowCreateModal(true); }}
            onNavigateToChat={(userId) => { setShowViewerModal(false); handleStartChatFromStory(userId); }}
            onHideUser={handleHideUserStories}
            colors={colors}
            allUsers={usersWithStatuses}
            onSwitchUser={(u: UserWithStatuses) => {
              setViewingUser(u);
              setViewingIndex(0);
              setShowViewers(false);
              if (user && u.statuses[0]) {
                supabase.from('status_views').upsert({
                  status_id: u.statuses[0].id, viewer_id: user.id,
                }, { onConflict: 'status_id,viewer_id' });
              }
            }}
          />
        )}
      </Modal>
    </View>
  );
});

export default StatusBar;

/* ===== ANIMATED VOICE WAVE ===== */

const BAR_COUNT = 28;
const BAR_PHASES = Array.from({ length: BAR_COUNT }, (_, i) => ({
  baseHeight: 6 + Math.sin(i * 0.7) * 8,
  amplitude: 10 + Math.sin(i * 1.1) * 16 + Math.cos(i * 0.5) * 8,
  delay: (i % 7) * 80,
  duration: 600 + (i % 5) * 120,
}));

function AnimatedWaveBar({ index, playing }: { index: number; playing: boolean }) {
  const phase = BAR_PHASES[index];
  const anim = useRef(new RNAnimated.Value(phase.baseHeight)).current;

  useEffect(() => {
    if (playing) {
      const timeout = setTimeout(() => {
        const loop = RNAnimated.loop(
          RNAnimated.sequence([
            RNAnimated.timing(anim, {
              toValue: phase.baseHeight + phase.amplitude,
              duration: phase.duration,
              useNativeDriver: false,
            }),
            RNAnimated.timing(anim, {
              toValue: phase.baseHeight + 2,
              duration: phase.duration * 0.8,
              useNativeDriver: false,
            }),
          ])
        );
        loop.start();
        (anim as any).__loopAnim = loop;
      }, phase.delay);
      return () => {
        clearTimeout(timeout);
        anim.stopAnimation();
      };
    } else {
      if ((anim as any).__loopAnim) {
        (anim as any).__loopAnim.stop();
        delete (anim as any).__loopAnim;
      }
      const resetAnim = RNAnimated.timing(anim, {
        toValue: phase.baseHeight,
        duration: 300,
        useNativeDriver: false,
      });
      resetAnim.start();
      return () => resetAnim.stop();
    }
  }, [playing]);

  return (
    <RNAnimated.View
      style={{
        width: 3.5,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.75)',
        height: anim,
      }}
    />
  );
}

function AnimatedVoiceWaves({ playing }: { playing: boolean }) {
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;

  useEffect(() => {
    if (playing) {
      const loop = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(pulseAnim, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
          RNAnimated.timing(pulseAnim, { toValue: 0.95, duration: 1200, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      const resetAnim = RNAnimated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true });
      resetAnim.start();
      return () => resetAnim.stop();
    }
  }, [playing]);

  return (
    <View style={styles.voiceStatusContent}>
      <View style={[styles.voiceWaveContainer, { height: 80, gap: 2.5 }]}>
        {Array.from({ length: BAR_COUNT }).map((_, i) => (
          <AnimatedWaveBar key={i} index={i} playing={playing} />
        ))}
      </View>
      <RNAnimated.View style={[styles.voiceIconCircle, { transform: [{ scale: pulseAnim }] }]}>
        <Mic color="#FFFFFF" size={32} />
      </RNAnimated.View>
      <Text style={styles.voiceLabel}>Голосовое сообщение</Text>
    </View>
  );
}

/* ===== STATUS VIEWER ===== */

export function StatusViewer({
  viewingUser, currentStatus, viewingIndex, userId, onNext, onPrev, onDelete, onClose,
  onLoadViewers, viewersList, showViewers, setShowViewers, formatStatusTime, onAddNew,
  onNavigateToChat, colors, allUsers, onSwitchUser, onHideUser,
}: {
  viewingUser: UserWithStatuses;
  currentStatus: Status;
  viewingIndex: number;
  userId: string;
  onNext: () => void;
  onPrev: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onLoadViewers: (id: string) => void;
  viewersList: { viewer_id: string; name: string; avatar_url: string | null; time: string }[];
  showViewers: boolean;
  setShowViewers: (v: boolean) => void;
  formatStatusTime: (d: string) => string;
  onAddNew?: () => void;
  onNavigateToChat?: (userId: string) => void;
  onHideUser?: (userId: string) => void;
  colors: any;
  allUsers?: UserWithStatuses[];
  onSwitchUser?: (user: UserWithStatuses) => void;
}) {
  const [videoPaused, setVideoPaused] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [holdPaused, setHoldPaused] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const replyFocusedRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActiveRef = useRef(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 0, y: 0 });
  const [isZooming, setIsZooming] = useState(false);
  const lastPinchDistance = useRef<number | null>(null);
  const [myReaction, setMyReaction] = useState<string | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [reactionCounts, setReactionCounts] = useState<{ emoji: string; count: number }[]>([]);
  const [replyText, setReplyText] = useState('');
  const [showStoryMenu, setShowStoryMenu] = useState(false);
  const [canDownload, setCanDownload] = useState(false);
  const reactionScaleAnim = useRef(new RNAnimated.Value(0)).current;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nativeVideoRef = useRef<Video | null>(null);
  const nativeSoundRef = useRef<Audio.Sound | null>(null);
  const nativeProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new RNAnimated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerStartRef = useRef<number>(0);
  const remainingMsRef = useRef<number>(STORY_DURATION_MS);
  const isVideo = currentStatus.media_type === 'video';
  const isVoice = currentStatus.media_type === 'voice';
  const isMedia = !!currentStatus.media_url;
  const isOwn = viewingUser.user_id === userId;
  const isTimedStory = !isVideo && !isVoice;
  const mediaDurationMsRef = useRef<number>(0);
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const currentStatusRef = useRef(currentStatus);
  currentStatusRef.current = currentStatus;

  // Reset duration tracking when switching to a new story
  useEffect(() => {
    remainingMsRef.current = STORY_DURATION_MS;
    mediaDurationMsRef.current = 0;
    clearSafetyTimer();
  }, [currentStatus.id]);
  const swipeTranslateX = useRef(new RNAnimated.Value(0)).current;
  const swipeTranslateY = useRef(new RNAnimated.Value(0)).current;
  const swipeOpacity = useRef(new RNAnimated.Value(1)).current;
  const isZoomingRef = useRef(false);
  const swipeDirectionRef = useRef<'none' | 'horizontal' | 'vertical'>('none');

  const swipePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => {
        if (isZoomingRef.current) return false;
        const absX = Math.abs(gs.dx);
        const absY = Math.abs(gs.dy);
        return absX > 12 || (absY > 12 && gs.dy > 0);
      },
      onPanResponderMove: (_, gs) => {
        if (swipeDirectionRef.current === 'none') {
          if (Math.abs(gs.dx) > Math.abs(gs.dy) * 1.2) {
            swipeDirectionRef.current = 'horizontal';
          } else if (gs.dy > 8) {
            swipeDirectionRef.current = 'vertical';
          }
        }
        if (swipeDirectionRef.current === 'horizontal') {
          swipeTranslateX.setValue(gs.dx * 0.4);
        } else if (swipeDirectionRef.current === 'vertical' && gs.dy > 0) {
          swipeTranslateY.setValue(gs.dy);
          const opacity = Math.max(0.3, 1 - gs.dy / (SCREEN_HEIGHT * 0.5));
          swipeOpacity.setValue(opacity);
        }
      },
      onPanResponderRelease: (_, gs) => {
        const dir = swipeDirectionRef.current;
        swipeDirectionRef.current = 'none';

        if (dir === 'vertical') {
          if (gs.dy > SCREEN_HEIGHT * 0.15 || gs.vy > 0.5) {
            RNAnimated.parallel([
              RNAnimated.timing(swipeTranslateY, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
              RNAnimated.timing(swipeOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
            ]).start(() => {
              onClose();
              swipeTranslateY.setValue(0);
              swipeOpacity.setValue(1);
            });
          } else {
            RNAnimated.parallel([
              RNAnimated.spring(swipeTranslateY, { toValue: 0, useNativeDriver: true, tension: 100, friction: 10 }),
              RNAnimated.spring(swipeOpacity, { toValue: 1, useNativeDriver: true, tension: 100, friction: 10 }),
            ]).start();
          }
          return;
        }

        const threshold = SCREEN_WIDTH * 0.2;
        if (gs.dx < -threshold && allUsers && onSwitchUser) {
          const idx = allUsers.findIndex(u => u.user_id === viewingUser.user_id);
          const nextUser = idx >= 0 && idx < allUsers.length - 1 ? allUsers[idx + 1] : null;
          if (nextUser) {
            RNAnimated.timing(swipeTranslateX, { toValue: -SCREEN_WIDTH, duration: 200, useNativeDriver: true }).start(() => {
              onSwitchUser(nextUser);
              swipeTranslateX.setValue(0);
            });
            return;
          }
        } else if (gs.dx > threshold && allUsers && onSwitchUser) {
          const idx = allUsers.findIndex(u => u.user_id === viewingUser.user_id);
          const prevUser = idx > 0 ? allUsers[idx - 1] : null;
          if (prevUser) {
            RNAnimated.timing(swipeTranslateX, { toValue: SCREEN_WIDTH, duration: 200, useNativeDriver: true }).start(() => {
              onSwitchUser(prevUser);
              swipeTranslateX.setValue(0);
            });
            return;
          }
        }
        RNAnimated.spring(swipeTranslateX, { toValue: 0, useNativeDriver: true, tension: 100, friction: 10 }).start();
      },
    })
  ).current;

  useEffect(() => {
    const loadReactions = async () => {
      const { data: reactions } = await supabase
        .from('status_reactions')
        .select('emoji, user_id')
        .eq('status_id', currentStatus.id);

      if (reactions?.length) {
        const mine = reactions.find(r => r.user_id === userId);
        setMyReaction(mine?.emoji || null);
        const counts = new Map<string, number>();
        reactions.forEach(r => counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1));
        setReactionCounts(Array.from(counts.entries()).map(([emoji, count]) => ({ emoji, count })));
      } else {
        setMyReaction(null);
        setReactionCounts([]);
      }
    };
    loadReactions();
    setShowReactionPicker(false);
    setReplyText('');
    setShowStoryMenu(false);
  }, [currentStatus.id, userId]);

  useEffect(() => {
    if (isOwn) { setCanDownload(true); return; }
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('privacy_settings')
        .eq('id', viewingUser.user_id)
        .maybeSingle();
      const ps = data?.privacy_settings;
      setCanDownload(ps?.allow_story_download !== false);
    })();
  }, [viewingUser.user_id, isOwn]);

  const handleDownloadStory = async () => {
    setShowStoryMenu(false);
    if (!currentStatus.media_url) return;
    const ext = currentStatus.media_type === 'video' ? 'mp4' : 'jpg';
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = currentStatus.media_url;
      a.download = `story_${currentStatus.id}.${ext}`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') return;
        const fileUri = ((FileSystem as any).documentDirectory || (FileSystem as any).cacheDirectory || '') + `story_${currentStatus.id}.${ext}`;
        const download = await (FileSystem as any).downloadAsync(currentStatus.media_url, fileUri);
        await MediaLibrary.saveToLibraryAsync(download.uri);
      } catch {}
    }
  };

  const handleHideUser = () => {
    setShowStoryMenu(false);
    if (onHideUser) onHideUser(viewingUser.user_id);
    onClose();
  };

  const handleShareStory = async () => {
    setShowStoryMenu(false);
    if (!onNavigateToChat) return;
    const convId = await getOrCreateDmConversation(viewingUser.user_id);
    if (!convId) return;
    const snapshot = buildStatusSnapshot();
    const shareText = currentStatus.content
      ? `Делюсь сторис от ${viewingUser.display_name}: "${currentStatus.content}"`
      : `Делюсь сторис от ${viewingUser.display_name}`;
    await supabase.from('messages').insert({
      conversation_id: convId,
      sender_id: userId,
      content: shareText,
      message_type: currentStatus.media_url ? (currentStatus.media_type === 'video' ? 'video' : 'image') : 'text',
      media_url: currentStatus.media_url || null,
      status_id: currentStatus.id,
      status_snapshot: snapshot,
    });
    onNavigateToChat(viewingUser.user_id);
  };

  const getOrCreateDmConversation = async (otherUserId: string): Promise<string | null> => {
    const { data: myMemberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', userId);

    if (myMemberships?.length) {
      const convIds = myMemberships.map((m: any) => m.conversation_id);
      const { data: directConvs } = await supabase
        .from('conversations')
        .select('id')
        .in('id', convIds)
        .eq('type', 'direct');

      if (directConvs?.length) {
        const { data: otherMembers } = await supabase
          .from('conversation_members')
          .select('conversation_id')
          .in('conversation_id', directConvs.map((c: any) => c.id))
          .eq('user_id', otherUserId);

        if (otherMembers?.length) return otherMembers[0].conversation_id;
      }
    }

    const convId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
    const { error: convErr } = await supabase.from('conversations').insert({ id: convId, type: 'direct', created_by: userId });
    if (convErr) return null;
    await supabase.from('conversation_members').insert({ conversation_id: convId, user_id: userId, role: 'admin' });
    await supabase.from('conversation_members').insert({ conversation_id: convId, user_id: otherUserId, role: 'admin' });
    return convId;
  };

  const buildStatusSnapshot = () => ({
    content: currentStatus.content || null,
    background_color: currentStatus.background_color || null,
    text_color: currentStatus.text_color || null,
    media_url: currentStatus.media_url || null,
    media_type: currentStatus.media_type || null,
    author_name: viewingUser.display_name,
    author_id: viewingUser.user_id,
  });

  const handleReaction = async (emoji: string) => {
    if (myReaction === emoji) {
      await supabase.from('status_reactions').delete().eq('status_id', currentStatus.id).eq('user_id', userId);
      setMyReaction(null);
      setReactionCounts(prev =>
        prev.map(r => r.emoji === emoji ? { ...r, count: r.count - 1 } : r).filter(r => r.count > 0)
      );
    } else {
      await supabase.from('status_reactions').upsert({
        status_id: currentStatus.id,
        user_id: userId,
        emoji,
      }, { onConflict: 'status_id,user_id' });
      if (myReaction) {
        setReactionCounts(prev => prev.map(r => r.emoji === myReaction ? { ...r, count: r.count - 1 } : r).filter(r => r.count > 0));
      }
      setMyReaction(emoji);
      setReactionCounts(prev => {
        const existing = prev.find(r => r.emoji === emoji);
        if (existing) return prev.map(r => r.emoji === emoji ? { ...r, count: r.count + 1 } : r);
        return [...prev, { emoji, count: 1 }];
      });

      const convId = await getOrCreateDmConversation(viewingUser.user_id);
      if (convId) {
        await supabase.from('messages').insert({
          conversation_id: convId,
          sender_id: userId,
          content: emoji,
          message_type: 'text',
          status_id: currentStatus.id,
          status_snapshot: buildStatusSnapshot(),
        });
        if (onNavigateToChat) onNavigateToChat(viewingUser.user_id);
      }
    }
    RNAnimated.sequence([
      RNAnimated.timing(reactionScaleAnim, { toValue: 1.3, duration: 150, useNativeDriver: true }),
      RNAnimated.timing(reactionScaleAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    setShowReactionPicker(false);
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !onNavigateToChat) return;
    const convId = await getOrCreateDmConversation(viewingUser.user_id);
    if (!convId) return;

    await supabase.from('messages').insert({
      conversation_id: convId,
      sender_id: userId,
      content: replyText.trim(),
      message_type: 'text',
      status_id: currentStatus.id,
      status_snapshot: buildStatusSnapshot(),
    });

    setReplyText('');
  };

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  const setSafetyTimer = useCallback((durationMs: number) => {
    clearSafetyTimer();
    if (durationMs <= 0) return;
    const bufferMs = 2000;
    safetyTimerRef.current = setTimeout(() => {
      if (!shouldPauseRef.current) onNextRef.current();
    }, durationMs + bufferMs);
  }, [clearSafetyTimer]);

  const handleNativeVideoStatus = useCallback((status: any) => {
    if (!status.isLoaded) return;
    if (status.durationMillis > 0) {
      mediaDurationMsRef.current = status.durationMillis;
      const ts = currentStatusRef.current?.trim_start_pct ?? 0;
      const te = currentStatusRef.current?.trim_end_pct ?? 100;
      const startMs = status.durationMillis * ts / 100;
      const endMs = status.durationMillis * te / 100;
      const hasTrim = ts > 0 || te < 100;
      if (hasTrim && status.positionMillis >= endMs) {
        clearSafetyTimer();
        nativeVideoRef.current?.pauseAsync();
        onNextRef.current();
        return;
      }
      const trimDur = endMs - startMs;
      const elapsed = status.positionMillis - startMs;
      progressAnim.setValue(Math.max(0, Math.min(1, elapsed / trimDur)));
    }
    if (status.didJustFinish) {
      clearSafetyTimer();
      onNextRef.current();
    }
  }, [clearSafetyTimer]);

  useEffect(() => {
    if (isOwn) {
      setViewCount(null);
      supabase
        .from('status_views')
        .select('*', { count: 'exact', head: true })
        .eq('status_id', currentStatus.id)
        .then(({ count }) => setViewCount(count ?? 0));
    }
  }, [currentStatus.id, isOwn]);

  useEffect(() => {
    if (showViewers) {
      setViewCount(viewersList.length);
    }
  }, [viewersList.length, showViewers]);

  useEffect(() => {
    progressAnim.setValue(0);
    setPaused(false);
    setVideoPaused(false);

    if (isVideo && Platform.OS === 'web') {
      let mounted = true;
      const tryAttach = () => {
        const el = document.getElementById('status-video') as HTMLVideoElement | null;
        if (!el || !mounted) return;
        videoRef.current = el;
        const ts = currentStatus.trim_start_pct ?? 0;
        const te = currentStatus.trim_end_pct ?? 100;
        const hasTrim = ts > 0 || te < 100;
        const onMeta = () => {
          if (el.duration > 0 && hasTrim) {
            el.currentTime = el.duration * ts / 100;
          }
          const trimDurSec = el.duration * (te - ts) / 100;
          setSafetyTimer(trimDurSec * 1000);
          el.play().catch(() => {});
        };
        if (el.readyState >= 1) { onMeta(); } else { el.addEventListener('loadedmetadata', onMeta, { once: true }); }
        el.onended = () => { if (mounted && !replyFocusedRef.current) { clearSafetyTimer(); onNextRef.current(); } };
        el.ontimeupdate = () => {
          if (el.duration > 0 && mounted) {
            const startSec = el.duration * ts / 100;
            const endSec = el.duration * te / 100;
            if (hasTrim && el.currentTime >= endSec) {
              el.pause();
              clearSafetyTimer();
              if (!replyFocusedRef.current) onNextRef.current();
              return;
            }
            const trimDur = endSec - startSec;
            const elapsed = el.currentTime - startSec;
            progressAnim.setValue(Math.max(0, Math.min(1, elapsed / trimDur)));
          }
        };
      };
      const observer = new MutationObserver(() => {
        if (document.getElementById('status-video')) {
          observer.disconnect();
          tryAttach();
        }
      });
      if (document.getElementById('status-video')) {
        tryAttach();
      } else {
        observer.observe(document.body, { childList: true, subtree: true });
      }
      (progressAnim as any).__videoCleanup = () => { mounted = false; observer.disconnect(); };
    } else if (isVideo && Platform.OS !== 'web') {
      // Native video: safety timer set in onLoad handler via setSafetyTimer
    } else if (isVoice && currentStatus.media_url) {
      const trimStart = currentStatus.trim_start_pct ?? 0;
      const trimEnd = currentStatus.trim_end_pct ?? 100;
      const hasTrim = trimStart > 0 || trimEnd < 100;
      if (Platform.OS === 'web') {
        const fetchAndPlay = async () => {
          try {
            const response = await fetch(currentStatus.media_url!);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const audio = new window.Audio(blobUrl);
            audioRef.current = audio;
            audio.onloadedmetadata = () => {
              if (hasTrim) {
                audio.currentTime = audio.duration * trimStart / 100;
              }
              const trimDurSec = audio.duration * (trimEnd - trimStart) / 100;
              setSafetyTimer(trimDurSec * 1000);
              audio.play().catch(() => {});
            };
            audio.onended = () => { URL.revokeObjectURL(blobUrl); clearSafetyTimer(); if (!replyFocusedRef.current) onNextRef.current(); };
            audio.ontimeupdate = () => {
              if (audio.duration > 0) {
                const startSec = audio.duration * trimStart / 100;
                const endSec = audio.duration * trimEnd / 100;
                if (hasTrim && audio.currentTime >= endSec) {
                  audio.pause();
                  URL.revokeObjectURL(blobUrl);
                  clearSafetyTimer();
                  if (!replyFocusedRef.current) onNextRef.current();
                  return;
                }
                const trimmedDuration = endSec - startSec;
                const elapsed = audio.currentTime - startSec;
                progressAnim.setValue(Math.max(0, Math.min(1, elapsed / trimmedDuration)));
              }
            };
          } catch {
            if (!replyFocusedRef.current) onNextRef.current();
          }
        };
        fetchAndPlay();
      } else {
        const playNativeAudio = async () => {
          try {
            await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
            const { sound } = await Audio.Sound.createAsync(
              { uri: currentStatus.media_url! },
              { shouldPlay: false },
              (status: any) => {
                if (!status.isLoaded) return;
                if (status.durationMillis > 0) {
                  mediaDurationMsRef.current = status.durationMillis;
                  const startMs = status.durationMillis * trimStart / 100;
                  const endMs = status.durationMillis * trimEnd / 100;
                  if (hasTrim && status.positionMillis >= endMs) {
                    clearSafetyTimer();
                    sound.stopAsync();
                    onNextRef.current();
                    return;
                  }
                  const trimmedDur = endMs - startMs;
                  const elapsed = status.positionMillis - startMs;
                  progressAnim.setValue(Math.max(0, Math.min(1, elapsed / trimmedDur)));
                }
                if (status.didJustFinish) {
                  clearSafetyTimer();
                  onNextRef.current();
                }
              }
            );
            nativeSoundRef.current = sound;
            if (hasTrim) {
              const initStatus = await sound.getStatusAsync();
              if (initStatus.isLoaded && initStatus.durationMillis) {
                const startMs = initStatus.durationMillis * trimStart / 100;
                await sound.setPositionAsync(Math.floor(startMs));
              }
            }
            const initStatus = await sound.getStatusAsync();
            if (initStatus.isLoaded && initStatus.durationMillis) {
              const trimDurMs = initStatus.durationMillis * (trimEnd - trimStart) / 100;
              setSafetyTimer(trimDurMs);
            }
            await sound.playAsync();
          } catch {
            onNextRef.current();
          }
        };
        playNativeAudio();
      }
    } else {
      remainingMsRef.current = STORY_DURATION_MS;
      timerStartRef.current = Date.now();
      RNAnimated.timing(progressAnim, {
        toValue: 1,
        duration: STORY_DURATION_MS,
        useNativeDriver: false,
      }).start();
      timerRef.current = setTimeout(() => { if (!shouldPauseRef.current) onNextRef.current(); }, STORY_DURATION_MS);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      clearSafetyTimer();
      if ((progressAnim as any).__videoCleanup) {
        (progressAnim as any).__videoCleanup();
        delete (progressAnim as any).__videoCleanup;
      }
      if (videoRef.current) {
        videoRef.current.ontimeupdate = null;
        videoRef.current.onended = null;
        videoRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (nativeSoundRef.current) {
        nativeSoundRef.current.unloadAsync().catch(() => {});
        nativeSoundRef.current = null;
      }
      if (nativeProgressRef.current) {
        clearInterval(nativeProgressRef.current);
        nativeProgressRef.current = null;
      }
      progressAnim.stopAnimation();
    };
  }, [currentStatus.id]);

  const shouldPause = showViewers || holdPaused || replyFocused;
  const shouldPauseRef = useRef(shouldPause);
  shouldPauseRef.current = shouldPause;

  useEffect(() => {
    if (shouldPause) {
      if (isVideo) {
        if (Platform.OS === 'web' && videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        } else if (nativeVideoRef.current) {
          nativeVideoRef.current.pauseAsync().catch(() => {});
        }
        clearSafetyTimer();
      } else if (isVoice) {
        if (Platform.OS === 'web' && audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
        } else if (nativeSoundRef.current) {
          nativeSoundRef.current.pauseAsync().catch(() => {});
        }
        clearSafetyTimer();
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        const elapsed = Date.now() - timerStartRef.current;
        remainingMsRef.current = Math.max(0, remainingMsRef.current - elapsed);
        progressAnim.stopAnimation();
      }
    } else {
      if (isVideo) {
        if (Platform.OS === 'web' && videoRef.current && videoRef.current.paused && !videoPaused) {
          videoRef.current.play().catch(() => {});
        } else if (nativeVideoRef.current && !videoPaused) {
          nativeVideoRef.current.playAsync().catch(() => {});
        }
        if (mediaDurationMsRef.current > 0) {
          const ts = currentStatusRef.current?.trim_start_pct ?? 0;
          const te = currentStatusRef.current?.trim_end_pct ?? 100;
          const trimDurMs = mediaDurationMsRef.current * (te - ts) / 100;
          setSafetyTimer(trimDurMs);
        }
      } else if (isVoice) {
        if (Platform.OS === 'web' && audioRef.current && audioRef.current.paused && !paused) {
          audioRef.current.play().catch(() => {});
        } else if (nativeSoundRef.current && !paused) {
          nativeSoundRef.current.playAsync().catch(() => {});
        }
        if (mediaDurationMsRef.current > 0) {
          const trimDurMs = mediaDurationMsRef.current;
          setSafetyTimer(trimDurMs);
        }
      } else if (remainingMsRef.current > 0) {
        timerStartRef.current = Date.now();
        progressAnim.stopAnimation();
        RNAnimated.timing(progressAnim, {
          toValue: 1,
          duration: remainingMsRef.current,
          useNativeDriver: false,
        }).start();
        timerRef.current = setTimeout(() => { if (!shouldPauseRef.current) onNextRef.current(); }, remainingMsRef.current);
      }
    }
  }, [shouldPause]);

  const handleHoldStart = useCallback(() => {
    holdActiveRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      holdActiveRef.current = true;
      setHoldPaused(true);
    }, 200);
  }, []);

  const handleHoldEnd = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      setHoldPaused(false);
    }
  }, []);

  const handlePinchStart = useCallback((e: any) => {
    const touches = e.nativeEvent?.touches || e.touches;
    if (!touches || touches.length < 2) return;
    const dx = touches[1].pageX - touches[0].pageX;
    const dy = touches[1].pageY - touches[0].pageY;
    lastPinchDistance.current = Math.sqrt(dx * dx + dy * dy);
    const cx = (touches[0].pageX + touches[1].pageX) / 2;
    const cy = (touches[0].pageY + touches[1].pageY) / 2;
    setZoomOrigin({ x: cx, y: cy });
    setIsZooming(true);
    isZoomingRef.current = true;
    if (!holdActiveRef.current) {
      holdActiveRef.current = true;
      setHoldPaused(true);
    }
  }, []);

  const handlePinchMove = useCallback((e: any) => {
    const touches = e.nativeEvent?.touches || e.touches;
    if (!touches || touches.length < 2 || lastPinchDistance.current === null) return;
    const dx = touches[1].pageX - touches[0].pageX;
    const dy = touches[1].pageY - touches[0].pageY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = dist / lastPinchDistance.current;
    setZoomScale(prev => Math.max(1, Math.min(5, prev * ratio)));
    lastPinchDistance.current = dist;
    const cx = (touches[0].pageX + touches[1].pageX) / 2;
    const cy = (touches[0].pageY + touches[1].pageY) / 2;
    setZoomOrigin({ x: cx, y: cy });
  }, []);

  const handlePinchEnd = useCallback(() => {
    lastPinchDistance.current = null;
    setIsZooming(false);
    isZoomingRef.current = false;
    setZoomScale(1);
    setZoomOrigin({ x: 0, y: 0 });
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      setHoldPaused(false);
    }
  }, []);

  const togglePlayPause = async () => {
    if (isVideo) {
      if (Platform.OS === 'web' && videoRef.current) {
        if (videoRef.current.paused) { videoRef.current.play(); setVideoPaused(false); }
        else { videoRef.current.pause(); setVideoPaused(true); }
      } else if (nativeVideoRef.current) {
        if (videoPaused) {
          await nativeVideoRef.current.playAsync();
          setVideoPaused(false);
        } else {
          await nativeVideoRef.current.pauseAsync();
          setVideoPaused(true);
        }
      }
    }
    if (isVoice) {
      if (Platform.OS === 'web' && audioRef.current) {
        if (audioRef.current.paused) { audioRef.current.play(); setPaused(false); }
        else { audioRef.current.pause(); setPaused(true); }
      } else if (nativeSoundRef.current) {
        if (paused) {
          await nativeSoundRef.current.playAsync();
          setPaused(false);
        } else {
          await nativeSoundRef.current.pauseAsync();
          setPaused(true);
        }
      }
    }
  };

  const toggleMute = async () => {
    const newMuted = !videoMuted;
    if (isVideo) {
      if (Platform.OS === 'web' && videoRef.current) { videoRef.current.muted = newMuted; }
      else if (nativeVideoRef.current) { await nativeVideoRef.current.setIsMutedAsync(newMuted); }
    }
    if (isVoice) {
      if (Platform.OS === 'web' && audioRef.current) { audioRef.current.muted = newMuted; }
      else if (nativeSoundRef.current) { await nativeSoundRef.current.setIsMutedAsync(newMuted); }
    }
    setVideoMuted(newMuted);
  };

  return (
    <RNAnimated.View style={[styles.viewerModal, { opacity: swipeOpacity, transform: [{ translateX: swipeTranslateX }, { translateY: swipeTranslateY }] }]} {...swipePanResponder.panHandlers}>
      {isVideo ? (
        <View
          style={[styles.statusContentMedia, { overflow: 'hidden' }]}
          onTouchStart={(e: any) => { const t = e.nativeEvent?.touches || e.touches; if (t?.length >= 2) handlePinchStart(e); }}
          onTouchMove={(e: any) => { const t = e.nativeEvent?.touches || e.touches; if (t?.length >= 2) handlePinchMove(e); }}
          onTouchEnd={handlePinchEnd}
        >
          <View style={{ width: '100%', height: '100%', transform: [{ scale: zoomScale }] }}>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <video id="status-video" src={currentStatus.media_url!} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }} />
            ) : (
              <Video
                ref={nativeVideoRef}
                source={{ uri: currentStatus.media_url! }}
                style={{ width: '100%', height: '100%' }}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                onPlaybackStatusUpdate={handleNativeVideoStatus}
                onLoad={(status: any) => {
                  if (status.isLoaded && status.durationMillis > 0) {
                    mediaDurationMsRef.current = status.durationMillis;
                    const ts = currentStatus.trim_start_pct ?? 0;
                    const te = currentStatus.trim_end_pct ?? 100;
                    if (ts > 0) {
                      nativeVideoRef.current?.setPositionAsync(status.durationMillis * ts / 100);
                    }
                    const trimDurMs = status.durationMillis * (te - ts) / 100;
                    setSafetyTimer(trimDurMs);
                  }
                }}
              />
            )}
          </View>
        </View>
      ) : isVoice ? (
        <View style={[styles.statusContent, { backgroundColor: currentStatus.background_color || '#1A1A2E' }]}>
          <AnimatedVoiceWaves playing={!paused} />
        </View>
      ) : isMedia && currentStatus.media_type === 'image' ? (
        <View
          style={[styles.statusContentMedia, { overflow: 'hidden' }]}
          onTouchStart={(e: any) => { const t = e.nativeEvent?.touches || e.touches; if (t?.length >= 2) handlePinchStart(e); }}
          onTouchMove={(e: any) => { const t = e.nativeEvent?.touches || e.touches; if (t?.length >= 2) handlePinchMove(e); }}
          onTouchEnd={handlePinchEnd}
        >
          <View style={{ width: '100%', height: '100%', transform: [{ scale: zoomScale }] }}>
            <Image source={{ uri: currentStatus.media_url! }} style={styles.statusFullImage} resizeMode="contain" />
          </View>
        </View>
      ) : (
        <View style={[styles.statusContent, { backgroundColor: currentStatus.background_color }]}>
          <Text style={[styles.statusContentText, { color: currentStatus.text_color }, isEmojiOnly(currentStatus.content) && { fontSize: 72, lineHeight: 90 }]}>{currentStatus.content}</Text>
        </View>
      )}

      <View style={[styles.viewerTopOverlay, holdPaused && { opacity: 0 }]} pointerEvents={holdPaused ? 'none' : 'box-none'}>
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.3)', 'transparent']}
          style={styles.viewerTopGradient}
          pointerEvents="none"
        />
        <View style={styles.progressRow}>
          {viewingUser.statuses.map((_, i) => (
            <View key={i} style={[styles.progressBarBg, { backgroundColor: 'rgba(255,255,255,0.5)' }]}>
              {i < viewingIndex ? (
                <View style={[styles.progressBarFill, { backgroundColor: '#FFFFFF', width: '100%' }]} />
              ) : i === viewingIndex ? (
                <RNAnimated.View style={[styles.progressBarFill, {
                  backgroundColor: '#FFFFFF',
                  width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                }]} />
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.viewerHeader}>
          <View style={styles.viewerHeaderLeft}>
            {viewingUser.avatar_url ? (
              <Image source={{ uri: viewingUser.avatar_url }} style={styles.viewerAvatar2} />
            ) : (
              <View style={[styles.viewerAvatar2, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700' }}>{viewingUser.display_name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ gap: 1 }}>
              <Text style={styles.viewerName}>{viewingUser.display_name}</Text>
              <Text style={styles.viewerTime}>{formatStatusTime(currentStatus.created_at)}</Text>
            </View>
          </View>
          <View style={styles.viewerHeaderRight}>
            {(isVideo || isVoice) && (
              <>
                <TouchableOpacity onPress={toggleMute} style={styles.viewerBtn}>
                  {videoMuted ? <VolumeX color="#FFFFFF" size={20} /> : <Volume2 color="#FFFFFF" size={20} />}
                </TouchableOpacity>
                <TouchableOpacity onPress={togglePlayPause} style={styles.viewerBtn}>
                  {(videoPaused || paused) ? <Play color="#FFFFFF" size={20} /> : <Pause color="#FFFFFF" size={20} />}
                </TouchableOpacity>
              </>
            )}
            {isOwn && onAddNew && (
              <TouchableOpacity onPress={onAddNew} style={styles.viewerBtn}>
                <Plus color="#FFFFFF" size={22} />
              </TouchableOpacity>
            )}
            {isOwn && (
              <TouchableOpacity onPress={() => onDelete(currentStatus.id)} style={styles.viewerBtn}>
                <Trash2 color="#FFFFFF" size={20} />
              </TouchableOpacity>
            )}
            {!isOwn && (
              <View style={{ position: 'relative' }}>
                <TouchableOpacity onPress={() => setShowStoryMenu(!showStoryMenu)} style={styles.viewerBtn}>
                  <MoreVertical color="#FFFFFF" size={20} />
                </TouchableOpacity>
                {showStoryMenu && (
                  <View style={styles.storyMenuDropdown}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowStoryMenu(false)} />
                    {canDownload && currentStatus.media_url && (
                      <TouchableOpacity style={styles.storyMenuItem} onPress={handleDownloadStory}>
                        <Download color="#FFFFFF" size={18} />
                        <Text style={styles.storyMenuText}>Скачать</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.storyMenuItem} onPress={handleShareStory}>
                      <Share2 color="#FFFFFF" size={18} />
                      <Text style={styles.storyMenuText}>Переслать</Text>
                    </TouchableOpacity>
                    <View style={{ height: 0.5, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 12 }} />
                    <TouchableOpacity style={styles.storyMenuItem} onPress={handleHideUser}>
                      <EyeOff color="#FFFFFF" size={18} />
                      <Text style={styles.storyMenuText}>Скрыть сторис</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
            <TouchableOpacity onPress={onClose} style={styles.viewerBtn}>
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {!isZooming && (
        <>
          <Pressable
            style={styles.navLeft}
            onPressIn={handleHoldStart}
            onPressOut={() => {
              if (holdActiveRef.current) { handleHoldEnd(); } else {
                if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                onPrev();
              }
            }}
          />
          <Pressable
            style={styles.navRight}
            onPressIn={handleHoldStart}
            onPressOut={() => {
              if (holdActiveRef.current) { handleHoldEnd(); } else {
                if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                onNext();
              }
            }}
          />
        </>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        style={[styles.storyBottomWrapper, holdPaused && { opacity: 0 }]}
        pointerEvents={holdPaused ? 'none' : 'auto'}
      >
        {/* Dark gradient overlay for readability */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.75)']}
          locations={[0, 0.4, 1]}
          style={styles.storyBottomGradient}
          pointerEvents="none"
        />

        {/* Caption above buttons — only for media/voice stories (text stories display content as the full slide) */}
        {(isVideo || isVoice || isMedia) && currentStatus.content ? (
          <Text style={styles.storyBottomCaption} numberOfLines={3}>{currentStatus.content}</Text>
        ) : null}

        {isOwn ? (
          <TouchableOpacity style={styles.viewersBtn} onPress={() => onLoadViewers(currentStatus.id)}>
            <Eye color="#FFFFFF" size={18} />
            <Text style={styles.viewersBtnText}>Просмотры{viewCount !== null ? ` ${viewCount}` : ''}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.storyBottomBar}>
            <View style={{ width: '100%' }}>
              <View style={styles.emojiRow}>
                {REACTION_EMOJIS.map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.emojiBtn, myReaction === emoji && styles.emojiBtnActive]}
                    onPress={() => handleReaction(emoji)}
                  >
                    <Text style={styles.emojiBtnText}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.replyInputContainer}>
                <TextInput
                  style={styles.replyInput}
                  value={replyText}
                  onChangeText={setReplyText}
                  placeholder="Ответить..."
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  returnKeyType="send"
                  onSubmitEditing={handleSendReply}
                  onFocus={() => { replyFocusedRef.current = true; setReplyFocused(true); }}
                  onBlur={() => { replyFocusedRef.current = false; setReplyFocused(false); }}
                />
                <TouchableOpacity onPress={handleSendReply} style={styles.replySendBtn}>
                  <Send color="#FFFFFF" size={18} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>


      {showViewers && (
        <View style={[styles.viewersPanel, { backgroundColor: colors.backgroundSecondary }]}>
          <View style={[styles.viewersPanelHandle, { backgroundColor: colors.textTertiary }]} />
          <View style={styles.viewersPanelHeader}>
            <Text style={[styles.viewersPanelTitle, { color: colors.text }]}>Просмотры ({viewersList.length})</Text>
            <TouchableOpacity onPress={() => setShowViewers(false)}><X color={colors.textSecondary} size={20} /></TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.35 }}>
            {viewersList.length === 0 ? (
              <Text style={[styles.noViewers, { color: colors.textTertiary }]}>Пока никто не смотрел</Text>
            ) : (
              viewersList.map((v, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.viewerRow, { borderBottomColor: colors.border }]}
                  onPress={() => { setShowViewers(false); if (onNavigateToChat) onNavigateToChat(v.viewer_id); }}
                  activeOpacity={0.7}
                >
                  <View style={styles.viewerRowLeft}>
                    {v.avatar_url ? (
                      <Image source={{ uri: v.avatar_url }} style={styles.viewerAvatar} />
                    ) : (
                      <View style={[styles.viewerAvatar, { backgroundColor: colors.backgroundTertiary, justifyContent: 'center', alignItems: 'center' }]}>
                        <Text style={[styles.viewerAvatarLetter, { color: colors.textSecondary }]}>{v.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                      </View>
                    )}
                    <View>
                      <Text style={[styles.viewerRowName, { color: colors.text }]}>{v.name}</Text>
                      <Text style={[styles.viewerRowTime, { color: colors.textTertiary }]}>{v.time}</Text>
                    </View>
                  </View>
                  <ChevronRight color={colors.textTertiary} size={16} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      )}
    </RNAnimated.View>
  );
}

/* ===== GESTURE CANVAS ===== */

function useGestureTransform() {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);

  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedRotation = useSharedValue(0);

  const [isTransformed, setIsTransformed] = useState(false);
  const updateTransformed = useCallback((val: boolean) => setIsTransformed(val), []);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(updateTransformed)(true);
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(0.3, Math.min(4, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(updateTransformed)(true);
    });

  const rotateGesture = Gesture.Rotation()
    .onUpdate((e) => {
      rotation.value = savedRotation.value + e.rotation;
    })
    .onEnd(() => {
      savedRotation.value = rotation.value;
      runOnJS(updateTransformed)(true);
    });

  const composed = Gesture.Simultaneous(panGesture, pinchGesture, rotateGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotation.value}rad` },
    ],
  }));

  const reset = useCallback(() => {
    translateX.value = withSpring(0, { damping: 15 });
    translateY.value = withSpring(0, { damping: 15 });
    scale.value = withSpring(1, { damping: 15 });
    rotation.value = withSpring(0, { damping: 15 });
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    savedScale.value = 1;
    savedRotation.value = 0;
    setIsTransformed(false);
  }, [translateX, translateY, scale, rotation, savedTranslateX, savedTranslateY, savedScale, savedRotation]);

  return { composed, animatedStyle, isTransformed, reset };
}

function GestureLayer({
  children,
  gesture,
  animatedStyle,
  style,
}: {
  children: ReactNode;
  gesture: ReturnType<typeof useGestureTransform>['composed'];
  animatedStyle: ReturnType<typeof useGestureTransform>['animatedStyle'];
  style?: any;
}) {
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[gStyles.layer, style]}>
        <Animated.View style={[gStyles.content, animatedStyle]}>
          {children}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const gStyles = StyleSheet.create({
  layer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/* ===== TRIM SLIDER ===== */

// BAR_WIDTH + BAR_GAP per bar in the scrollable waveform
const TRIM_BAR_W = 3;
const TRIM_BAR_GAP = 2;
const TRIM_BAR_STEP = TRIM_BAR_W + TRIM_BAR_GAP;
const TRIM_BAR_COUNT = 120; // total bars for the full recording

function TrimSlider({
  startMs, endMs, durationMs, onStartChange, onEndChange, playbackMs, waveform,
}: {
  startMs: number;
  endMs: number;
  durationMs: number;
  onStartChange: (ms: number) => void;
  onEndChange: (ms: number) => void;
  playbackMs?: number;
  waveform?: number[];
}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const containerWidthRef = useRef(0);
  const totalWidth = TRIM_BAR_COUNT * TRIM_BAR_STEP;

  const bars = useMemo(() => {
    if (waveform && waveform.length > 0) {
      return Array.from({ length: TRIM_BAR_COUNT }, (_, i) => {
        const idx = Math.floor((i / TRIM_BAR_COUNT) * waveform.length);
        return Math.max(0.08, Math.min(1, waveform[idx]));
      });
    }
    return Array.from({ length: TRIM_BAR_COUNT }, (_, i) =>
      0.15 + Math.abs(Math.sin(i * 0.7)) * 0.55 + Math.sin(i * 1.3) * 0.2
    );
  }, [waveform]);

  // Convert ms to pixel offset within full waveform
  const msToX = useCallback((ms: number) => (ms / Math.max(1, durationMs)) * totalWidth, [durationMs, totalWidth]);
  // Convert page-level X to ms, accounting for scroll offset
  const pageXToMs = useCallback((pageX: number) => {
    const relX = pageX - (containerWidthRef.current ? 0 : 0) + scrollOffsetRef.current;
    return Math.max(0, Math.min(durationMs, Math.round((relX / totalWidth) * durationMs)));
  }, [durationMs, totalWidth]);

  // We need to track the container's page-X origin for hit testing
  const containerOriginRef = useRef(0);

  const measureContainer = useCallback((ref: any) => {
    if (ref && ref.measureInWindow) {
      ref.measureInWindow((x: number) => { containerOriginRef.current = x; });
    }
  }, []);

  const pageXToMsFromOrigin = useCallback((pageX: number) => {
    const relX = pageX - containerOriginRef.current + scrollOffsetRef.current;
    return Math.max(0, Math.min(durationMs, Math.round((relX / totalWidth) * durationMs)));
  }, [durationMs, totalWidth]);

  const draggingStart = useRef(false);
  const draggingEnd = useRef(false);

  const startHandleResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, state) => {
        draggingStart.current = true;
      },
      onPanResponderMove: (evt) => {
        const ms = pageXToMsFromOrigin(evt.nativeEvent.pageX);
        onStartChange(Math.min(ms, endMs - 100));
      },
      onPanResponderRelease: () => { draggingStart.current = false; },
      onPanResponderTerminate: () => { draggingStart.current = false; },
    })
  ).current;

  const endHandleResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { draggingEnd.current = true; },
      onPanResponderMove: (evt) => {
        const ms = pageXToMsFromOrigin(evt.nativeEvent.pageX);
        onEndChange(Math.max(ms, startMs + 100));
      },
      onPanResponderRelease: () => { draggingEnd.current = false; },
      onPanResponderTerminate: () => { draggingEnd.current = false; },
    })
  ).current;

  const startX = msToX(startMs);
  const endX = msToX(endMs);
  const playX = playbackMs != null ? msToX(playbackMs) : null;
  const hasPlayback = playX != null && playbackMs! >= 0;

  return (
    <View
      style={trimStyles.scrollWrapper}
      onLayout={(e) => { containerWidthRef.current = e.nativeEvent.layout.width; }}
      ref={(r) => measureContainer(r)}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.x; }}
        scrollEnabled={true}
        bounces={false}
        contentContainerStyle={{ width: totalWidth }}
        style={trimStyles.scroll}
      >
        {/* Waveform bars */}
        <View style={[trimStyles.track, { width: totalWidth }]}>
          <View style={[trimStyles.waveContainer, { width: totalWidth }]}>
            {bars.map((h, i) => {
              const barStartMs = (i / TRIM_BAR_COUNT) * durationMs;
              const inRange = barStartMs >= startMs && barStartMs <= endMs;
              const played = hasPlayback && barStartMs <= (playbackMs ?? 0) && inRange;
              return (
                <View
                  key={i}
                  style={[
                    trimStyles.waveBar,
                    {
                      height: Math.max(4, h * 32),
                      backgroundColor: played
                        ? '#FFFFFF'
                        : inRange
                          ? 'rgba(255,255,255,0.65)'
                          : 'rgba(255,255,255,0.13)',
                    },
                  ]}
                />
              );
            })}
          </View>

          {/* Dimmed regions */}
          <View style={[trimStyles.dimRegion, { left: 0, width: startX }]} />
          <View style={[trimStyles.dimRegion, { left: endX, width: totalWidth - endX }]} />

          {/* Active range border */}
          <View style={[trimStyles.activeRange, { left: startX, width: endX - startX }]} />

          {/* Playback cursor */}
          {hasPlayback && playX != null && (
            <View style={[trimStyles.cursor, { left: playX }]}>
              <View style={trimStyles.cursorDot} />
            </View>
          )}

          {/* Start handle */}
          <View
            style={[trimStyles.handle, trimStyles.handleLeft, { left: startX }]}
            {...startHandleResponder.panHandlers}
          >
            <View style={trimStyles.handleVisual}>
              <View style={trimStyles.handleNotch} />
              <View style={trimStyles.handleNotch} />
            </View>
          </View>

          {/* End handle */}
          <View
            style={[trimStyles.handle, trimStyles.handleRight, { left: endX }]}
            {...endHandleResponder.panHandlers}
          >
            <View style={trimStyles.handleVisual}>
              <View style={trimStyles.handleNotch} />
              <View style={trimStyles.handleNotch} />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Scroll hint arrows */}
      <View style={trimStyles.scrollHintLeft} pointerEvents="none">
        <View style={trimStyles.scrollHintGrad} />
      </View>
      <View style={trimStyles.scrollHintRight} pointerEvents="none">
        <View style={[trimStyles.scrollHintGrad, { transform: [{ scaleX: -1 }] }]} />
      </View>
    </View>
  );
}

function useTrimPreview(blob: Blob | null, startMs: number, endMs: number) {
  const [playing, setPlaying] = useState(false);
  const [cursorMs, setCursorMs] = useState(-1);
  const webAudioRef = useRef<HTMLAudioElement | null>(null);
  const nativeSoundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (Platform.OS === 'web') {
      if (webAudioRef.current) {
        webAudioRef.current.pause();
        webAudioRef.current.src = '';
        webAudioRef.current = null;
      }
    } else {
      if (nativeSoundRef.current) {
        nativeSoundRef.current.stopAsync().catch(() => {});
        nativeSoundRef.current.unloadAsync().catch(() => {});
        nativeSoundRef.current = null;
      }
    }
    playingRef.current = false;
    setPlaying(false);
    setCursorMs(-1);
  }, []);

  const stop = useCallback(() => { cleanup(); }, [cleanup]);

  const play = useCallback(async () => {
    if (!blob || endMs <= startMs) return;
    cleanup();

    const startSec = startMs / 1000;
    const endSec = endMs / 1000;
    if (endSec - startSec < 0.1) return;

    playingRef.current = true;
    setPlaying(true);
    setCursorMs(startMs);

    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(blob);
      const audio = new window.Audio(url);
      webAudioRef.current = audio;
      audio.currentTime = startSec;

      audio.onended = () => { cleanup(); URL.revokeObjectURL(url); };
      audio.onerror = () => { cleanup(); URL.revokeObjectURL(url); };
      audio.play().catch(() => cleanup());

      timerRef.current = setInterval(() => {
        if (!playingRef.current || !webAudioRef.current) return;
        const ct = webAudioRef.current.currentTime;
        if (ct >= endSec) {
          cleanup();
          URL.revokeObjectURL(url);
          return;
        }
        setCursorMs(Math.round(ct * 1000));
      }, 30);
    } else {
      try {
        const reader = new FileReader();
        const dataUri = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        const { sound } = await Audio.Sound.createAsync(
          { uri: dataUri },
          { shouldPlay: true, positionMillis: startMs }
        );
        nativeSoundRef.current = sound;

        timerRef.current = setInterval(async () => {
          if (!playingRef.current || !nativeSoundRef.current) return;
          try {
            const status = await nativeSoundRef.current.getStatusAsync();
            if (!status.isLoaded) { cleanup(); return; }
            if (status.positionMillis >= endMs || !status.isPlaying) {
              cleanup();
              return;
            }
            setCursorMs(status.positionMillis);
          } catch { cleanup(); }
        }, 30);
      } catch { cleanup(); }
    }
  }, [blob, startMs, endMs, cleanup]);

  const toggle = useCallback(() => {
    if (playing) stop(); else play();
  }, [playing, stop, play]);

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  useEffect(() => {
    if (playing) { stop(); }
  }, [startMs, endMs]);

  return { playing, cursorMs, toggle, stop };
}

const trimStyles = StyleSheet.create({
  scrollWrapper: {
    position: 'relative',
    marginVertical: 6,
    borderRadius: 10,
    overflow: 'hidden',
  },
  scroll: {
    // height set by track below
  },
  scrollHintLeft: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 20,
    zIndex: 20,
  },
  scrollHintRight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 20,
    zIndex: 20,
  },
  scrollHintGrad: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  track: {
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.05)',
    position: 'relative',
    overflow: 'visible',
  },
  waveContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: 4,
  },
  waveBar: {
    width: 2.5,
    borderRadius: 2,
    minHeight: 4,
  },
  dimRegion: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    zIndex: 2,
  },
  activeRange: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 8,
    zIndex: 3,
  },
  cursor: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: 2.5,
    marginLeft: -1.25,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    zIndex: 5,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  cursorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    marginBottom: -4,
  },
  handle: {
    position: 'absolute',
    top: -8,
    width: 30,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  handleLeft: {
    marginLeft: -20,
  },
  handleRight: {
    marginLeft: -10,
  },
  handleVisual: {
    width: 12,
    height: 32,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  handleNotch: {
    width: 2,
    height: 6,
    borderRadius: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
});

/* ===== CREATE MODAL ===== */

type CreateTab = 'text' | 'media' | 'voice';

const StatusCaptionInput = memo(function StatusCaptionInput({
  initialValue,
  onChangeValue,
}: {
  initialValue: string;
  onChangeValue: (v: string) => void;
}) {
  const [text, setText] = useState(initialValue);
  const onChangeRef = useRef(onChangeValue);
  onChangeRef.current = onChangeValue;

  const handleChange = useCallback((t: string) => {
    const clamped = t.slice(0, 200);
    setText(clamped);
    onChangeRef.current(clamped);
  }, []);

  return (
    <TextInput
      style={{
        flex: 1,
        color: '#fff',
        fontSize: 15,
        maxHeight: 80,
        paddingVertical: Platform.OS === 'ios' ? 10 : 6,
      }}
      value={text}
      onChangeText={handleChange}
      placeholder="Добавить подпись..."
      placeholderTextColor="rgba(255,255,255,0.35)"
      maxLength={200}
      multiline
    />
  );
});

function CreateModal({
  visible, colors, userId, todayCount, onClose, onCreated, onBackgroundPublish,
}: {
  visible: boolean;
  colors: any;
  userId: string;
  todayCount?: number;
  onClose: () => void;
  onCreated: () => void;
  onBackgroundPublish?: (fn: () => Promise<boolean>) => void;
}) {
  const [tab, setTab] = useState<CreateTab>('media');
  const [statusText, setStatusText] = useState('');
  const [selectedColorIdx, setSelectedColorIdx] = useState(0);
  const [fontIdx, setFontIdx] = useState(0);
  const [fontSizeIdx, setFontSizeIdx] = useState(1);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');

  const nativeMediaPickerLaunched = useRef(false);

  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const captionRef = useRef('');
  const [filterIdx, setFilterIdx] = useState(0);


  const [videoTrimStart, setVideoTrimStart] = useState(0);
  const [videoTrimEnd, setVideoTrimEnd] = useState(100);
  const videoTrimStartRef = useRef(0);
  const videoTrimEndRef = useRef(100);
  videoTrimStartRef.current = videoTrimStart;
  videoTrimEndRef.current = videoTrimEnd;
  const [videoDuration, setVideoDuration] = useState(0);
  const [showTrimPanel, setShowTrimPanel] = useState(false);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const nativeVideoRef = useRef<any>(null);
  const [videoThumbnails, setVideoThumbnails] = useState<string[]>([]);
  const [videoPlaying, setVideoPlaying] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const voiceCaptionRef = useRef('');
  const captionInputKeyRef = useRef(0);
  const [voiceTrimStart, setVoiceTrimStart] = useState(0); // ms
  const [voiceTrimEnd, setVoiceTrimEnd] = useState(0); // ms — set when duration known
  const [showVoiceTrim, setShowVoiceTrim] = useState(false);
  const [voiceWaveform, setVoiceWaveform] = useState<number[]>([]);
  const [visibility, setVisibility] = useState<'everyone' | 'contacts' | 'close_friends' | 'nobody'>('everyone');
  const [showVisibilityPicker, setShowVisibilityPicker] = useState(false);

  useEffect(() => {
    if (!visible || !userId) return;
    supabase.from('profiles').select('privacy_settings').eq('id', userId).maybeSingle().then(({ data }) => {
      const sv = data?.privacy_settings?.story_visibility;
      if (sv && ['everyone', 'contacts', 'close_friends', 'nobody'].includes(sv)) {
        setVisibility(sv);
      }
    });
  }, [visible, userId]);

  const voiceTrimPreview = useTrimPreview(voiceBlob, voiceTrimStart, voiceTrimEnd);

  useEffect(() => {
    if (!voiceBlob) { setVoiceWaveform([]); return; }
    if (Platform.OS !== 'web') {
      const count = TRIM_BAR_COUNT;
      const wave = Array.from({ length: count }, (_, i) =>
        0.2 + Math.abs(Math.sin(i * 0.9 + 1)) * 0.5 + Math.sin(i * 1.4) * 0.15
      );
      setVoiceWaveform(wave);
      const durMs = Math.round(voiceDuration * 1000);
      setVoiceTrimStart(0);
      setVoiceTrimEnd(durMs || 60000);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const ctx = new AudioContext();
        const buffer = await ctx.decodeAudioData(reader.result as ArrayBuffer);
        const data = buffer.getChannelData(0);
        const durMs = Math.round(buffer.duration * 1000);
        setVoiceDuration(buffer.duration);
        setVoiceTrimStart(0);
        setVoiceTrimEnd(durMs);
        const count = TRIM_BAR_COUNT;
        const step = Math.floor(data.length / count);
        const wave: number[] = [];
        for (let i = 0; i < count; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += Math.abs(data[i * step + j]);
          wave.push(sum / step);
        }
        const max = Math.max(...wave, 0.01);
        setVoiceWaveform(wave.map(v => v / max));
        ctx.close();
      } catch {
        setVoiceWaveform([]);
      }
    };
    reader.readAsArrayBuffer(voiceBlob);
  }, [voiceBlob]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;
  const remainingToday = MAX_STORIES_PER_DAY - (todayCount || 0);

  const textGesture = useGestureTransform();
  const mediaGesture = useGestureTransform();

  useEffect(() => {
    if (recording) {
      const loop = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          RNAnimated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [recording]);

  const resetState = () => {
    setStatusText(''); setSelectedColorIdx(0); setFontIdx(0); setFontSizeIdx(1);
    setTextAlign('center');
    setMediaFile(null); setMediaPreview(null); setMediaType(null); captionRef.current = ''; captionInputKeyRef.current++;
    setFilterIdx(0);
    setVideoTrimStart(0); setVideoTrimEnd(100); setVideoDuration(0); setShowTrimPanel(false); setVideoThumbnails([]); setVideoPlaying(true);
    setUploading(false); setUploadProgress(null); setError(null); setTab('media');
    setRecording(false); setVoiceBlob(null); setVoiceDuration(0); voiceCaptionRef.current = ''; captionInputKeyRef.current++;
    setVoiceTrimStart(0); setVoiceTrimEnd(100); setShowVoiceTrim(false); setVoiceWaveform([]);
    setVisibility('everyone'); setShowVisibilityPicker(false);
    voiceTrimPreview.stop();
    textGesture.reset(); mediaGesture.reset();
    if (Platform.OS === 'web' && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (nativeRecordingRef.current) {
      nativeRecordingRef.current.stopAndUnloadAsync().catch(() => {});
      nativeRecordingRef.current = null;
    }
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
  };

  const handleClose = () => { resetState(); onClose(); };

  const nativeRecordingRef = useRef<Audio.Recording | null>(null);

  const startRecording = async () => {
    setError(null);
    try {
      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        chunksRef.current = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          setVoiceBlob(blob);
          setRecording(false);
          if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        };
        mediaRecorderRef.current = recorder;
        recorder.start();
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') { setError('Нет доступа к микрофону'); return; }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: rec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        nativeRecordingRef.current = rec;
      }
      setRecording(true);
      setVoiceDuration(0);
      recordTimerRef.current = setInterval(() => {
        setVoiceDuration(d => {
          if (d >= 59) { stopRecording(); return d; }
          return d + 1;
        });
      }, 1000);
    } catch {
      setError('Нет доступа к микрофону');
    }
  };

  const stopRecording = async () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (Platform.OS === 'web') {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } else if (nativeRecordingRef.current) {
      try {
        await nativeRecordingRef.current.stopAndUnloadAsync();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        const uri = nativeRecordingRef.current.getURI();
        if (uri) {
          const response = await fetch(uri);
          const blob = await response.blob();
          setVoiceBlob(blob);
        }
      } catch {}
      nativeRecordingRef.current = null;
      setRecording(false);
    }
  };

  useEffect(() => {
    if (tab !== 'media') {
      nativeMediaPickerLaunched.current = false;
    }
  }, [tab]);

  const generateWebVideoThumbnails = (src: string, duration: number, count: number = 10): Promise<string[]> => {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') { resolve([]); return; }
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.preload = 'auto';
      const thumbs: string[] = [];
      let idx = 0;
      const step = duration / count;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      v.onseeked = () => {
        canvas.width = 80;
        canvas.height = 80;
        ctx.drawImage(v, 0, 0, 80, 80);
        thumbs.push(canvas.toDataURL('image/jpeg', 0.4));
        idx++;
        if (idx < count) { v.currentTime = Math.min(step * idx + 0.1, duration - 0.01); }
        else { resolve(thumbs); URL.revokeObjectURL(v.src); }
      };
      v.onloadedmetadata = () => { v.currentTime = 0.1; };
      v.onerror = () => resolve([]);
      v.src = src;
    });
  };

  const initVideoMeta = (dur: number, objectUrl?: string) => {
    setVideoDuration(dur);
    setVideoTrimStart(0);
    const maxPct = dur > VIDEO_MAX_DURATION_SEC ? (VIDEO_MAX_DURATION_SEC / dur) * 100 : 100;
    setVideoTrimEnd(maxPct);
    setShowTrimPanel(dur > 5);
    if (objectUrl && Platform.OS === 'web') {
      generateWebVideoThumbnails(objectUrl, dur, 12).then(setVideoThumbnails);
    }
  };

  const generateAndUploadThumbnail = async (videoSource: string | File): Promise<string | null> => {
    try {
      if (Platform.OS === 'web') {
        const src = videoSource instanceof File ? URL.createObjectURL(videoSource) : videoSource;
        const thumbDataUrl = await new Promise<string | null>((resolve) => {
          if (typeof document === 'undefined') { resolve(null); return; }
          const v = document.createElement('video');
          v.crossOrigin = 'anonymous';
          v.muted = true;
          v.preload = 'auto';
          v.src = src;
          v.currentTime = 0.5;
          const onSeeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(v.videoWidth, 480);
            canvas.height = Math.round(canvas.width * (v.videoHeight / v.videoWidth));
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(null); return; }
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
            if (videoSource instanceof File) URL.revokeObjectURL(src);
          };
          v.addEventListener('seeked', onSeeked, { once: true });
          v.addEventListener('error', () => { resolve(null); }, { once: true });
        });
        if (!thumbDataUrl) return null;
        const response = await fetch(thumbDataUrl);
        const blob = await response.blob();
        const arrBuf = await new Response(blob).arrayBuffer();
        const thumbPath = `${userId}/${Date.now()}_thumb.jpg`;
        const { error } = await supabase.storage
          .from('stories-media')
          .upload(thumbPath, arrBuf, { contentType: 'image/jpeg', upsert: false });
        if (error) return null;
        const { data: urlData } = supabase.storage.from('stories-media').getPublicUrl(thumbPath);
        return urlData.publicUrl;
      } else {
        const VideoThumbnails = require('expo-video-thumbnails');
        const uri = typeof videoSource === 'string' ? videoSource : (videoSource as any).uri;
        if (!uri) return null;
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, { time: 500, quality: 0.7 });
        const resp = await fetch(thumbUri);
        const blob = await resp.blob();
        const arrBuf = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = reject;
          reader.readAsArrayBuffer(blob);
        });
        const thumbPath = `${userId}/${Date.now()}_thumb.jpg`;
        const { error } = await supabase.storage
          .from('stories-media')
          .upload(thumbPath, arrBuf, { contentType: 'image/jpeg', upsert: false });
        if (error) return null;
        const { data: urlData } = supabase.storage.from('stories-media').getPublicUrl(thumbPath);
        return urlData.publicUrl;
      }
    } catch {
      return null;
    }
  };

  const clampTrimToMax = (startPct: number, endPct: number, dur: number): [number, number] => {
    const maxPct = (VIDEO_MAX_DURATION_SEC / dur) * 100;
    const span = endPct - startPct;
    if (span > maxPct) return [startPct, startPct + maxPct];
    return [startPct, endPct];
  };

  const handlePickMedia = async (type: 'image' | 'video') => {
    setError(null);
    try {
      if (Platform.OS === 'web') {
        const accept = type === 'image'
          ? 'image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,image/avif,.heic,.heif'
          : 'video/mp4,video/webm,video/quicktime,video/3gpp,.mov,.mp4,.webm';
        const file = await pickFile(accept);
        if (!file) return;
        const preview = await readFileAsDataURL(file);
        setMediaFile(file);
        setMediaPreview(preview);
        setMediaType(type);
        setTab('media');
        setFilterIdx(0);
        if (type === 'video') {
          const objectUrl = URL.createObjectURL(file);
          const videoEl = document.createElement('video');
          videoEl.src = objectUrl;
          videoEl.onloadedmetadata = () => {
            initVideoMeta(videoEl.duration, objectUrl);
          };
        }
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: type === 'image' ? ['images'] : type === 'video' ? ['videos'] : ['images', 'videos'],
          allowsEditing: false,
          quality: 0.8,
          exif: false,
          videoMaxDuration: VIDEO_MAX_DURATION_SEC * 2,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        const detectedType = asset.type === 'video' ? 'video' : 'image';
        setMediaFile(asset as any);
        setMediaPreview(asset.uri);
        setMediaType(detectedType);
        setTab('media');
        setFilterIdx(0);
        if (detectedType === 'video' && (asset as any).duration) {
          initVideoMeta((asset as any).duration / 1000);
        }
      }
    } catch {}
  };

  const handlePickMediaNative = async () => {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 1,
        exif: false,
        videoMaxDuration: VIDEO_MAX_DURATION_SEC * 2,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const detectedType = asset.type === 'video' ? 'video' : 'image';
      setMediaFile(asset as any);
      setMediaPreview(asset.uri);
      setMediaType(detectedType);
      setTab('media');
      setFilterIdx(0);
      if (detectedType === 'video' && (asset as any).duration) {
        initVideoMeta((asset as any).duration / 1000);
      }
    } catch {};
  };

  const applyFilterToCanvas = async (imageDataUrl: string, filterCss: string): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.filter = filterCss;
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9);
      };
      img.src = imageDataUrl;
    });
  };

  const handlePublishText = async () => {
    if (!userId || !statusText.trim()) return;
    if (remainingToday <= 0) { setError(`Лимит ${MAX_STORIES_PER_DAY} сторис в день`); return; }
    setUploading(true);
    const color = STATUS_COLORS[selectedColorIdx];
    const font = FONT_OPTIONS[fontIdx];
    const fontSize = FONT_SIZES[fontSizeIdx];
    const contentMeta = JSON.stringify({ font: font.family, size: fontSize, align: textAlign });
    const { error: err } = await supabase.from('user_statuses').insert({
      user_id: userId,
      content: statusText.trim(),
      background_color: color.bg,
      text_color: color.text,
      visibility,
    });
    setUploading(false);
    if (err) { setError('Ошибка публикации'); return; }
    resetState();
    onCreated();
  };


  const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });

  const doPublishVoice = async (): Promise<boolean> => {
    try {
      const blob = voiceBlob!;
      const ext = Platform.OS === 'web' ? 'webm' : 'm4a';
      const mimeType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';

      const uploadData = await blobToArrayBuffer(blob);

      const filePath = `${userId}/${Date.now()}.${ext}`;
      let uploadError: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await uploadToStorageWithProgress(filePath, uploadData, mimeType, (loaded, total) => {
          setUploadProgress({ loaded, total });
        });
        uploadError = res.error;
        if (!uploadError) break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
      if (uploadError) { console.error('[StatusBar] Voice story upload failed:', uploadError.message); return false; }
      const { data: urlData } = supabase.storage.from('stories-media').getPublicUrl(filePath);
      const color = STATUS_COLORS[selectedColorIdx];
      const { error: insertErr } = await supabase.from('user_statuses').insert({
        user_id: userId,
        content: voiceCaptionRef.current.trim() || null,
        media_url: urlData.publicUrl,
        media_type: 'voice',
        background_color: color.bg,
        text_color: color.text,
        trim_start_pct: durationMs > 0 ? (voiceTrimStart / durationMs) * 100 : 0,
        trim_end_pct: durationMs > 0 ? (voiceTrimEnd / durationMs) * 100 : 100,
        visibility,
      });
      if (insertErr) console.error('[StatusBar] Voice story insert failed:', insertErr.message);
      return !insertErr;
    } catch (err) {
      console.error('[StatusBar] Voice story publish error:', err);
      return false;
    }
  };

  const sendToBackground = useCallback(() => {
    if (!onBackgroundPublish) return;
    const capturedBlob = voiceBlob;
    const capturedColorIdx = selectedColorIdx;
    const capturedCaption = voiceCaptionRef.current;
    const capturedTrimStart = voiceTrimStart;
    const capturedTrimEnd = voiceTrimEnd;
    const capturedDurationMs = Math.round(voiceDuration * 1000);
    const capturedVisibility = visibility;
    resetState();
    onBackgroundPublish(async () => {
      try {
        const ext = Platform.OS === 'web' ? 'webm' : 'm4a';
        const mimeType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
        const uploadData = await blobToArrayBuffer(capturedBlob!);
        const filePath = `${userId}/${Date.now()}.${ext}`;
        let bgUploadErr: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await supabase.storage
            .from('stories-media')
            .upload(filePath, uploadData, { contentType: mimeType, upsert: false });
          bgUploadErr = res.error;
          if (!bgUploadErr) break;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
        if (bgUploadErr) { console.error('[StatusBar] BG voice upload failed:', bgUploadErr.message); return false; }
        const { data: urlData } = supabase.storage.from('stories-media').getPublicUrl(filePath);
        const color = STATUS_COLORS[capturedColorIdx];
        const { error: insertErr } = await supabase.from('user_statuses').insert({
          user_id: userId,
          content: capturedCaption.trim() || null,
          media_url: urlData.publicUrl,
          media_type: 'voice',
          background_color: color.bg,
          text_color: color.text,
          trim_start_pct: capturedDurationMs > 0 ? (capturedTrimStart / capturedDurationMs) * 100 : 0,
          trim_end_pct: capturedDurationMs > 0 ? (capturedTrimEnd / capturedDurationMs) * 100 : 100,
          visibility: capturedVisibility,
        });
        if (insertErr) console.error('[StatusBar] BG voice insert failed:', insertErr.message);
        return !insertErr;
      } catch (err) { console.error('[StatusBar] BG voice publish error:', err); return false; }
    });
  }, [onBackgroundPublish, voiceBlob, selectedColorIdx, voiceDuration, visibility, userId]);

  const handlePublishVoice = async () => {
    if (!userId || !voiceBlob) return;
    if (remainingToday <= 0) { setError(`Лимит ${MAX_STORIES_PER_DAY} сторис в день`); return; }
    setUploading(true);
    setUploadProgress(null);
    setError(null);
    const success = await doPublishVoice();
    setUploading(false);
    setUploadProgress(null);
    if (!success) { setError('Ошибка загрузки'); return; }
    resetState();
    onCreated();
  };

  const trimVideoBlob = async (file: File, startPct: number, endPct: number, duration: number): Promise<Blob> => {
    if (Platform.OS !== 'web' || (startPct === 0 && endPct === 100) || duration <= 0) return file;
    try {
      const startTime = duration * startPct / 100;
      const endTime = duration * endPct / 100;
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      video.muted = true;
      await new Promise<void>((resolve) => { video.onloadedmetadata = () => resolve(); });
      video.currentTime = startTime;
      await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(30);
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaElementSource(video);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      source.connect(audioCtx.destination);
      for (const track of dest.stream.getAudioTracks()) {
        stream.addTrack(track);
      }
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const recordPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: 'video/webm' }));
        };
      });
      recorder.start();
      video.play();
      await new Promise<void>((resolve) => {
        const check = () => {
          if (video.currentTime >= endTime) {
            recorder.stop();
            video.pause();
            resolve();
          } else {
            ctx.drawImage(video, 0, 0);
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      });
      const result = await recordPromise;
      URL.revokeObjectURL(video.src);
      audioCtx.close();
      return result;
    } catch {
      return file;
    }
  };

  const doPublishMedia = async (): Promise<boolean> => {
    try {
      let uploadData: File | Blob | ArrayBuffer;
      let contentType: string;
      let ext: string;

      const selectedFilter = FILTERS[filterIdx];
      const currentMediaFile = mediaFile;
      const currentMediaType = mediaType;
      const currentMediaPreview = mediaPreview;
      const currentCaption = captionRef.current;

      if (!currentMediaFile || !currentMediaType) return false;

      if (Platform.OS === 'web' && currentMediaType === 'video' && (videoTrimStart > 0 || videoTrimEnd < 100) && currentMediaFile instanceof File) {
        const trimmedBlob = await trimVideoBlob(currentMediaFile, videoTrimStart, videoTrimEnd, videoDuration);
        uploadData = await blobToArrayBuffer(trimmedBlob);
        ext = 'webm';
        contentType = 'video/webm';
      } else if (Platform.OS === 'web' && currentMediaType === 'image' && selectedFilter.key !== 'none' && currentMediaPreview) {
        const filteredBlob = await applyFilterToCanvas(currentMediaPreview, selectedFilter.css);
        uploadData = await blobToArrayBuffer(filteredBlob);
        ext = 'jpg';
        contentType = 'image/jpeg';
      } else if (Platform.OS !== 'web' && currentMediaPreview && typeof (currentMediaFile as any).uri === 'string') {
        let uri = (currentMediaFile as any).uri as string;
        const pathParts = uri.split('.');
        ext = pathParts[pathParts.length - 1].split('?')[0] || (currentMediaType === 'video' ? 'mp4' : 'jpg');
        const mimeTypes: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
          heic: 'image/heic', heif: 'image/heif',
          mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
          '3gp': 'video/3gpp', '3gpp': 'video/3gpp',
          m4a: 'audio/mp4', ogg: 'audio/ogg',
        };
        contentType = mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
        if (currentMediaType === 'image') {
          try {
            const manipResult = await ImageManipulator.manipulateAsync(
              uri,
              [{ resize: { width: 1920 } }],
              { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
            );
            uri = manipResult.uri;
            ext = 'jpg';
            contentType = 'image/jpeg';
          } catch (imgErr) {
            console.warn('[StatusBar] Image compression failed, uploading original:', imgErr);
          }
        }
        const response = await fetch(uri);
        const blob = await response.blob();
        uploadData = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = reject;
          reader.readAsArrayBuffer(blob);
        });
      } else {
        const file = currentMediaFile as File;
        ext = file.name.split('.').pop() || (currentMediaType === 'video' ? 'mp4' : 'jpg');
        uploadData = file;
        contentType = file.type || (currentMediaType === 'video' ? 'video/mp4' : 'image/jpeg');
      }

      const filePath = `${userId}/${Date.now()}.${ext}`;
      let uploadError: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await uploadToStorageWithProgress(filePath, uploadData, contentType, (loaded, total) => {
          setUploadProgress({ loaded, total });
        });
        uploadError = res.error;
        if (!uploadError) break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
      if (uploadError) { console.error('[StatusBar] Story media upload failed:', uploadError.message); return false; }
      const { data: urlData } = supabase.storage.from('stories-media').getPublicUrl(filePath);
      const needTrimMeta = currentMediaType === 'video' && Platform.OS !== 'web' && (videoTrimStart > 0 || videoTrimEnd < 100);

      let thumbnailUrl: string | null = null;
      if (currentMediaType === 'video') {
        thumbnailUrl = await generateAndUploadThumbnail(currentMediaFile!);
      } else if (currentMediaType === 'image') {
        thumbnailUrl = urlData.publicUrl;
      }

      const { error: insertErr } = await supabase.from('user_statuses').insert({
        user_id: userId,
        content: currentCaption.trim() || null,
        media_url: urlData.publicUrl,
        media_type: currentMediaType,
        background_color: '#000000',
        text_color: '#FFFFFF',
        visibility,
        thumbnail_url: thumbnailUrl,
        ...(needTrimMeta ? { trim_start_pct: videoTrimStart, trim_end_pct: videoTrimEnd } : {}),
      });
      if (insertErr) console.error('[StatusBar] Story insert failed:', insertErr.message);
      return !insertErr;
    } catch (err) {
      console.error('[StatusBar] Story media publish error:', err);
      return false;
    }
  };

  const sendMediaToBackground = useCallback(() => {
    if (!onBackgroundPublish) return;
    const capturedFile = mediaFile;
    const capturedType = mediaType;
    const capturedPreview = mediaPreview;
    const capturedCaption = captionRef.current;
    const capturedFilterIdx = filterIdx;
    const capturedTrimStart = videoTrimStart;
    const capturedTrimEnd = videoTrimEnd;
    const capturedDuration = videoDuration;
    const capturedVisibility = visibility;
    resetState();
    onBackgroundPublish(async () => {
      try {
        let uploadData: File | Blob | ArrayBuffer;
        let contentType: string;
        let ext: string;
        const selectedFilter = FILTERS[capturedFilterIdx];

        if (Platform.OS === 'web' && capturedType === 'video' && (capturedTrimStart > 0 || capturedTrimEnd < 100) && capturedFile instanceof File) {
          const trimmedBlob = await trimVideoBlob(capturedFile, capturedTrimStart, capturedTrimEnd, capturedDuration);
          uploadData = await blobToArrayBuffer(trimmedBlob);
          ext = 'webm';
          contentType = 'video/webm';
        } else if (Platform.OS === 'web' && capturedType === 'image' && selectedFilter.key !== 'none' && capturedPreview) {
          const filteredBlob = await applyFilterToCanvas(capturedPreview, selectedFilter.css);
          uploadData = await blobToArrayBuffer(filteredBlob);
          ext = 'jpg';
          contentType = 'image/jpeg';
        } else if (Platform.OS !== 'web' && capturedPreview && typeof (capturedFile as any).uri === 'string') {
          let uri = (capturedFile as any).uri as string;
          const pathParts = uri.split('.');
          ext = pathParts[pathParts.length - 1].split('?')[0] || (capturedType === 'video' ? 'mp4' : 'jpg');
          const bgMimeTypes: Record<string, string> = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
            gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
            heic: 'image/heic', heif: 'image/heif',
            mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
            '3gp': 'video/3gpp', '3gpp': 'video/3gpp',
          };
          contentType = bgMimeTypes[ext.toLowerCase()] || (capturedType === 'video' ? 'video/mp4' : 'image/jpeg');
          if (capturedType === 'image') {
            try {
              const manipResult = await ImageManipulator.manipulateAsync(
                uri,
                [{ resize: { width: 1920 } }],
                { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
              );
              uri = manipResult.uri;
              ext = 'jpg';
              contentType = 'image/jpeg';
            } catch (imgErr) {
              console.warn('[StatusBar] BG image compression failed:', imgErr);
            }
          }
          const response = await fetch(uri);
          const blob = await response.blob();
          uploadData = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
          });
        } else {
          const file = capturedFile as File;
          ext = file.name.split('.').pop() || (capturedType === 'video' ? 'mp4' : 'jpg');
          uploadData = file;
          contentType = file.type || (capturedType === 'video' ? 'video/mp4' : 'image/jpeg');
        }
        const filePath = `${userId}/${Date.now()}.${ext}`;
        let bgUploadErr: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await supabase.storage
            .from('stories-media')
            .upload(filePath, uploadData, { contentType, upsert: false });
          bgUploadErr = res.error;
          if (!bgUploadErr) break;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
        if (bgUploadErr) { console.error('[StatusBar] BG media upload failed:', bgUploadErr.message); return false; }
        const { data: urlData } = supabase.storage.from('stories-media').getPublicUrl(filePath);
        const bgNeedTrimMeta = capturedType === 'video' && Platform.OS !== 'web' && (capturedTrimStart > 0 || capturedTrimEnd < 100);

        let bgThumbnailUrl: string | null = null;
        if (capturedType === 'video' && capturedFile) {
          bgThumbnailUrl = await generateAndUploadThumbnail(capturedFile);
        } else if (capturedType === 'image') {
          bgThumbnailUrl = urlData.publicUrl;
        }

        const { error: insertErr } = await supabase.from('user_statuses').insert({
          user_id: userId,
          content: capturedCaption.trim() || null,
          media_url: urlData.publicUrl,
          media_type: capturedType,
          background_color: '#000000',
          text_color: '#FFFFFF',
          visibility: capturedVisibility,
          thumbnail_url: bgThumbnailUrl,
          ...(bgNeedTrimMeta ? { trim_start_pct: capturedTrimStart, trim_end_pct: capturedTrimEnd } : {}),
        });
        return !insertErr;
      } catch (err) { console.error('[StatusBar] BG media publish error:', err); return false; }
    });
  }, [onBackgroundPublish, mediaFile, mediaType, mediaPreview, filterIdx, videoTrimStart, videoTrimEnd, videoDuration, visibility, userId]);

  const handlePublishMedia = async () => {
    if (!userId || !mediaFile || !mediaType) return;
    if (remainingToday <= 0) { setError(`Лимит ${MAX_STORIES_PER_DAY} сторис в день`); return; }
    setUploading(true);
    setUploadProgress(null);
    setError(null);
    const success = await doPublishMedia();
    setUploading(false);
    setUploadProgress(null);
    if (!success) { setError('Ошибка загрузки'); return; }
    resetState();
    onCreated();
  };

  const color = STATUS_COLORS[selectedColorIdx];
  const font = FONT_OPTIONS[fontIdx];
  const baseFontSize = FONT_SIZES[fontSizeIdx];
  const fontSize = useMemo(() => {
    const len = statusText.length;
    if (len > 600) return Math.max(14, Math.round(baseFontSize * 0.55));
    if (len > 400) return Math.max(16, Math.round(baseFontSize * 0.65));
    if (len > 200) return Math.max(18, Math.round(baseFontSize * 0.8));
    return baseFontSize;
  }, [baseFontSize, statusText.length]);
  const canPublish = tab === 'text' ? !!statusText.trim() : tab === 'voice' ? !!voiceBlob : !!mediaFile;
  const handlePublish = tab === 'text' ? handlePublishText : tab === 'voice' ? handlePublishVoice : handlePublishMedia;
  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  // Format milliseconds as M:SS.ms (e.g. 0:02.340)
  const fmtMs = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = (totalSec % 60).toString().padStart(2, '0');
    const centis = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
    return `${m}:${s}.${centis}`;
  };
  const durationMs = Math.round(voiceDuration * 1000);

  const cycleAlign = () => {
    setTextAlign(prev => prev === 'left' ? 'center' : prev === 'center' ? 'right' : 'left');
  };

  const AlignIcon = textAlign === 'left' ? AlignLeft : textAlign === 'right' ? AlignRight : AlignCenter;

  const visibilityIcons = { everyone: Eye, contacts: Heart, close_friends: Sparkles, nobody: EyeOff };
  const VisIcon = visibilityIcons[visibility];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={cs.root}>
        {/* ===== CANVAS ===== */}
        {tab === 'text' && (
          <LinearGradient colors={color.gradient} style={cs.canvas} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <View style={cs.textCanvasSafeArea}>
              <GestureLayer
                gesture={textGesture.composed}
                animatedStyle={textGesture.animatedStyle}
                style={cs.textGestureLayer}
              >
                <ScrollView
                  style={cs.textScrollContainer}
                  contentContainerStyle={cs.textScrollContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  bounces={false}
                >
                  <TextInput
                    style={[
                      cs.textOnCanvas,
                      { color: color.text, fontSize, textAlign },
                      font.style,
                    ]}
                    value={statusText}
                    onChangeText={(t) => setStatusText(t.slice(0, 1000))}
                    placeholder="Введите текст..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    multiline
                    autoFocus
                    scrollEnabled={false}
                  />
                </ScrollView>
              </GestureLayer>
            </View>
            <View style={cs.charCountWrap}>
              <Text style={[cs.charCount, statusText.length > 900 && cs.charCountWarn, statusText.length > 980 && cs.charCountDanger]}>{statusText.length}/1000</Text>
            </View>

            {textGesture.isTransformed && (
              <TouchableOpacity style={cs.gestureResetBtn} onPress={textGesture.reset}>
                <RotateCcw color="rgba(255,255,255,0.8)" size={14} />
              </TouchableOpacity>
            )}
          </LinearGradient>
        )}

        {tab === 'media' && !mediaPreview && (
          <View style={[cs.canvas, { backgroundColor: '#0A0A0A' }]}>
            <View style={cs.mediaPickerWrap}>
              <Text style={cs.mediaPickerTitle}>Добавить медиа</Text>
              <Text style={cs.mediaPickerSubtitle}>Выберите фото или видео для истории</Text>
              {Platform.OS === 'web' ? (
                <View style={cs.mediaPickerCards}>
                  <TouchableOpacity style={cs.mediaPickCard} onPress={() => handlePickMedia('image')} activeOpacity={0.7}>
                    <LinearGradient colors={['#1E88E5', '#42A5F5']} style={cs.mediaPickIconWrap}>
                      <ImageIcon color="#FFFFFF" size={28} />
                    </LinearGradient>
                    <Text style={cs.mediaPickTitle}>Фото</Text>
                    <Text style={cs.mediaPickSub}>JPG, PNG, WebP</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={cs.mediaPickCard} onPress={() => handlePickMedia('video')} activeOpacity={0.7}>
                    <LinearGradient colors={['#E53935', '#EF5350']} style={cs.mediaPickIconWrap}>
                      <Play color="#FFFFFF" size={28} fill="#FFFFFF" />
                    </LinearGradient>
                    <Text style={cs.mediaPickTitle}>Видео</Text>
                    <Text style={cs.mediaPickSub}>MP4, WebM, MOV</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={cs.mediaPickCardSingle} onPress={handlePickMediaNative} activeOpacity={0.7}>
                  <LinearGradient colors={['#1E88E5', '#42A5F5']} style={cs.mediaPickIconWrap}>
                    <ImageIcon color="#FFFFFF" size={28} />
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={cs.mediaPickTitle}>Выбрать из галереи</Text>
                    <Text style={cs.mediaPickSub}>Фото или видео</Text>
                  </View>
                  <ChevronRight color="rgba(255,255,255,0.3)" size={20} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {tab === 'media' && mediaPreview && (
          <View style={[cs.canvas, { backgroundColor: '#000' }]}>
            <GestureLayer
              gesture={mediaGesture.composed}
              animatedStyle={mediaGesture.animatedStyle}
            >
              {mediaType === 'video' ? (
                Platform.OS === 'web' ? (
                  <View style={cs.videoPreviewContainer}>
                    {/* @ts-ignore */}
                    <video
                      ref={(el: HTMLVideoElement | null) => {
                        if (el && el !== videoPreviewRef.current) {
                          videoPreviewRef.current = el;
                          el.muted = true;
                          el.playsInline = true;
                          el.loop = false;
                          el.ontimeupdate = () => {
                            if (!el.duration) return;
                            const endSec = el.duration * (videoTrimEndRef.current / 100);
                            if (el.currentTime >= endSec) {
                              const startSec = el.duration * (videoTrimStartRef.current / 100);
                              el.currentTime = startSec;
                            }
                          };
                          el.onended = () => {
                            const startSec = el.duration * (videoTrimStartRef.current / 100);
                            el.currentTime = startSec;
                            el.play().catch(() => {});
                          };
                          el.play().then(() => setVideoPlaying(true)).catch(() => {});
                        }
                      }}
                      src={mediaPreview}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain' as any,
                        filter: FILTERS[filterIdx].css === 'none' ? undefined : FILTERS[filterIdx].css,
                      }}
                      autoPlay playsInline
                    />
                    <TouchableOpacity
                      style={cs.videoPlayOverlay}
                      onPress={() => {
                        const v = videoPreviewRef.current;
                        if (v) {
                          if (v.paused) { v.play().catch(() => {}); setVideoPlaying(true); }
                          else { v.pause(); setVideoPlaying(false); }
                        }
                      }}
                      activeOpacity={1}
                    >
                      {!videoPlaying && (
                        <View style={cs.videoPlayCircle}>
                          <Play color="#FFFFFF" size={32} fill="#FFFFFF" />
                        </View>
                      )}
                    </TouchableOpacity>
                    {videoPlaying && (
                      <TouchableOpacity
                        style={cs.videoPauseMini}
                        onPress={() => {
                          const v = videoPreviewRef.current;
                          if (v) { v.pause(); setVideoPlaying(false); }
                        }}
                        activeOpacity={0.7}
                      >
                        <Pause color="#FFFFFF" size={16} fill="#FFFFFF" />
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <View style={cs.videoPreviewContainer}>
                    <Video
                      ref={nativeVideoRef}
                      source={{ uri: mediaPreview! }}
                      style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.65 }}
                      resizeMode={ResizeMode.CONTAIN}
                      shouldPlay={videoPlaying}
                      isLooping={false}
                      isMuted
                      onPlaybackStatusUpdate={(status: any) => {
                        if (status.isLoaded) {
                          if (!videoDuration && status.durationMillis) {
                            initVideoMeta(status.durationMillis / 1000);
                          }
                          if (status.durationMillis > 0) {
                            const endMs = status.durationMillis * videoTrimEndRef.current / 100;
                            if (status.positionMillis >= endMs || status.didJustFinish) {
                              const startMs = status.durationMillis * videoTrimStartRef.current / 100;
                              nativeVideoRef.current?.setPositionAsync(startMs);
                              nativeVideoRef.current?.playAsync();
                            }
                          }
                        }
                      }}
                    />
                    <TouchableOpacity
                      style={cs.videoPlayOverlay}
                      onPress={() => {
                        if (videoPlaying) {
                          nativeVideoRef.current?.pauseAsync();
                        } else {
                          nativeVideoRef.current?.playAsync();
                        }
                      }}
                      activeOpacity={1}
                    >
                      {!videoPlaying && (
                        <View style={cs.videoPlayCircle}>
                          <Play color="#FFFFFF" size={32} fill="#FFFFFF" />
                        </View>
                      )}
                    </TouchableOpacity>
                    {videoPlaying && (
                      <TouchableOpacity
                        style={cs.videoPauseMini}
                        onPress={() => nativeVideoRef.current?.pauseAsync()}
                        activeOpacity={0.7}
                      >
                        <Pause color="#FFFFFF" size={16} fill="#FFFFFF" />
                      </TouchableOpacity>
                    )}
                  </View>
                )
              ) : mediaType === 'image' ? (
                Platform.OS === 'web' ? (
                  // @ts-ignore
                  <img
                    src={mediaPreview}
                    style={{
                      width: SCREEN_WIDTH,
                      height: SCREEN_HEIGHT * 0.65,
                      objectFit: 'contain',
                      filter: FILTERS[filterIdx].css === 'none' ? undefined : FILTERS[filterIdx].css,
                      pointerEvents: 'none',
                    }}
                  />
                ) : (
                  <Image source={{ uri: mediaPreview }} style={cs.mediaFullImage} resizeMode="contain" />
                )
              ) : null}
            </GestureLayer>
            <TouchableOpacity
              style={cs.mediaChangeBtn}
              onPress={() => { setMediaFile(null); setMediaPreview(null); setMediaType(null); setFilterIdx(0); mediaGesture.reset(); }}
            >
              <X color="#FFFFFF" size={16} />
            </TouchableOpacity>
            {mediaGesture.isTransformed && (
              <TouchableOpacity style={cs.gestureResetBtnMedia} onPress={mediaGesture.reset}>
                <RotateCcw color="rgba(255,255,255,0.8)" size={14} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {tab === 'voice' && (
          <LinearGradient colors={color.gradient} style={cs.canvas} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}>
            <View style={cs.voiceCenter}>
              {recording ? (
                <>
                  <View style={cs.voiceWaves}>
                    {Array.from({ length: 32 }).map((_, i) => {
                      const h = 4 + Math.abs(Math.sin((Date.now() / 200 + i) * 0.5)) * 36 + Math.sin(i * 0.8) * 8;
                      return <RNAnimated.View key={i} style={[cs.voiceBar, { height: h, backgroundColor: 'rgba(255,255,255,0.5)' }]} />;
                    })}
                  </View>
                  <Text style={cs.voiceTimer}>{fmtDur(voiceDuration)}</Text>
                  <View style={cs.voiceRecRingOuter}>
                    <RNAnimated.View style={[cs.voiceRecRing, { transform: [{ scale: pulseAnim }] }]} />
                    <TouchableOpacity style={cs.voiceBtnRec} onPress={stopRecording} activeOpacity={0.7}>
                      <Square color="#FFFFFF" size={24} fill="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                  <Text style={cs.voiceHint}>Нажмите для остановки</Text>
                </>
              ) : voiceBlob ? (
                <>
                  <View style={cs.voiceReadyIconOuter}>
                    <View style={cs.voiceReadyIcon}><Mic color="#FFFFFF" size={32} /></View>
                    <View style={cs.voiceCheckBadge}>
                      <Text style={{ color: '#FFFFFF', fontSize: 12 }}>{'\u2713'}</Text>
                    </View>
                  </View>
                  <Text style={cs.voiceTimer}>{fmtDur(voiceDuration)}</Text>
                  <Text style={cs.voiceHintReady}>Голосовое записано</Text>
                  <View style={cs.voiceActions}>
                    <TouchableOpacity
                      style={cs.voiceActionBtn}
                      onPress={() => { setVoiceBlob(null); setVoiceDuration(0); setVoiceTrimStart(0); setVoiceTrimEnd(0); }}
                    >
                      <Trash2 color="rgba(255,255,255,0.9)" size={16} />
                      <Text style={cs.voiceActionText}>Перезаписать</Text>
                    </TouchableOpacity>
                    {voiceDuration > 0 && (
                      <TouchableOpacity
                        style={cs.voiceActionBtn}
                        onPress={() => setShowVoiceTrim(!showVoiceTrim)}
                      >
                        <Scissors color="rgba(255,255,255,0.9)" size={16} />
                        <Text style={cs.voiceActionText}>
                          {showVoiceTrim ? 'Скрыть' : 'Обрезать'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              ) : (
                <>
                  <View style={cs.voiceIdleRing}>
                    <TouchableOpacity style={cs.voiceBtnIdle} onPress={startRecording} activeOpacity={0.7}>
                      <Mic color="#FFFFFF" size={36} />
                    </TouchableOpacity>
                  </View>
                  <Text style={cs.voiceHint}>Нажмите для записи</Text>
                  <Text style={cs.voiceHintSub}>до 60 секунд</Text>
                </>
              )}
            </View>
          </LinearGradient>
        )}

        {/* ===== TOP BAR ===== */}
        <View style={cs.topBar}>
          <TouchableOpacity style={cs.topBtn} onPress={handleClose}>
            <X color="#FFFFFF" size={22} />
          </TouchableOpacity>
          <View style={cs.topCenter}>
            {(['media', 'voice', 'text'] as CreateTab[]).map((t) => (
              <TouchableOpacity key={t} style={[cs.topTab, tab === t && cs.topTabActive]} onPress={() => setTab(t)} activeOpacity={0.7}>
                {t === 'text' && <Type color={tab === t ? '#FFFFFF' : 'rgba(255,255,255,0.55)'} size={14} />}
                {t === 'media' && <Camera color={tab === t ? '#FFFFFF' : 'rgba(255,255,255,0.55)'} size={14} />}
                {t === 'voice' && <Mic color={tab === t ? '#FFFFFF' : 'rgba(255,255,255,0.55)'} size={14} />}
                <Text style={[cs.topTabText, tab === t && cs.topTabTextActive]}>
                  {t === 'text' ? 'Текст' : t === 'media' ? 'Медиа' : 'Голос'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ width: 40 }} />
        </View>

        {tab === 'text' && (
          <View style={cs.fontPickerBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cs.fontPickerScroll}>
              {FONT_OPTIONS.map((f, i) => (
                <TouchableOpacity
                  key={f.label}
                  style={[cs.fontPickerChip, fontIdx === i && cs.fontPickerChipActive]}
                  onPress={() => setFontIdx(i)}
                  activeOpacity={0.7}
                >
                  <Text style={[cs.fontPickerChipText, f.style, fontIdx === i && cs.fontPickerChipTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={cs.fontPickerDivider} />
            <TouchableOpacity style={cs.fontPickerAlignBtn} onPress={cycleAlign} activeOpacity={0.7}>
              <AlignIcon color="#FFFFFF" size={18} />
            </TouchableOpacity>
          </View>
        )}

        {error && (
          <View style={cs.errorFloat}>
            <Text style={cs.errorFloatText}>{error}</Text>
          </View>
        )}

        {/* ===== BOTTOM TOOLBAR (WhatsApp-style) ===== */}
        <View style={cs.bottomBar}>
          {/* Video trim panel - above bottom bar when active */}
          {tab === 'media' && mediaPreview && mediaType === 'video' && videoDuration > 0 && showTrimPanel && (
            <View style={cs.trimPanelWA}>
              {videoDuration > VIDEO_MAX_DURATION_SEC && (
                <View style={cs.trimLimitBadge}>
                  <Clock color="#FFA726" size={11} />
                  <Text style={cs.trimLimitText}>
                    Макс. {Math.floor(VIDEO_MAX_DURATION_SEC / 60)}:{String(VIDEO_MAX_DURATION_SEC % 60).padStart(2, '0')}
                  </Text>
                </View>
              )}
              {videoThumbnails.length > 0 && Platform.OS === 'web' ? (
                <View style={cs.trimThumbContainer}>
                  <View style={cs.videoThumbTrack}>
                    {videoThumbnails.map((t, i) => (
                      <Image key={i} source={{ uri: t }} style={cs.videoThumbFrame} />
                    ))}
                    <View style={[cs.videoThumbDim, { left: 0, width: `${videoTrimStart}%` as any }]} />
                    <View style={[cs.videoThumbDim, { right: 0, width: `${100 - videoTrimEnd}%` as any }]} />
                    <View style={[cs.videoThumbSelection, { left: `${videoTrimStart}%` as any, right: `${100 - videoTrimEnd}%` as any }]} />
                  </View>
                  <TrimSlider
                    startMs={videoDuration * 1000 * videoTrimStart / 100}
                    endMs={videoDuration * 1000 * videoTrimEnd / 100}
                    durationMs={videoDuration * 1000}
                    onStartChange={(ms) => {
                      const pct = videoDuration > 0 ? (ms / (videoDuration * 1000)) * 100 : 0;
                      const [s, e] = clampTrimToMax(Math.min(pct, videoTrimEnd - 2), videoTrimEnd, videoDuration);
                      setVideoTrimStart(s); setVideoTrimEnd(e);
                      if (videoPreviewRef.current) videoPreviewRef.current.currentTime = ms / 1000;
                    }}
                    onEndChange={(ms) => {
                      const pct = videoDuration > 0 ? (ms / (videoDuration * 1000)) * 100 : 100;
                      const [s, e] = clampTrimToMax(videoTrimStart, Math.max(pct, videoTrimStart + 2), videoDuration);
                      setVideoTrimStart(s); setVideoTrimEnd(e);
                      if (videoPreviewRef.current) videoPreviewRef.current.currentTime = ms / 1000;
                    }}
                  />
                </View>
              ) : (
                <TrimSlider
                  startMs={videoDuration * 1000 * videoTrimStart / 100}
                  endMs={videoDuration * 1000 * videoTrimEnd / 100}
                  durationMs={videoDuration * 1000}
                  onStartChange={(ms) => {
                    const pct = videoDuration > 0 ? (ms / (videoDuration * 1000)) * 100 : 0;
                    const [s, e] = clampTrimToMax(Math.min(pct, videoTrimEnd - 2), videoTrimEnd, videoDuration);
                    setVideoTrimStart(s); setVideoTrimEnd(e);
                    if (Platform.OS === 'web' && videoPreviewRef.current) videoPreviewRef.current.currentTime = ms / 1000;
                    if (Platform.OS !== 'web' && nativeVideoRef.current) nativeVideoRef.current.setPositionAsync(ms);
                  }}
                  onEndChange={(ms) => {
                    const pct = videoDuration > 0 ? (ms / (videoDuration * 1000)) * 100 : 100;
                    const [s, e] = clampTrimToMax(videoTrimStart, Math.max(pct, videoTrimStart + 2), videoDuration);
                    setVideoTrimStart(s); setVideoTrimEnd(e);
                    if (Platform.OS === 'web' && videoPreviewRef.current) videoPreviewRef.current.currentTime = ms / 1000;
                    if (Platform.OS !== 'web' && nativeVideoRef.current) nativeVideoRef.current.setPositionAsync(ms);
                  }}
                />
              )}
              <View style={cs.trimTimecodes}>
                <Text style={cs.trimTimecode}>{fmtDur(Math.round(videoDuration * videoTrimStart / 100))}</Text>
                <Text style={cs.trimTimecodeCenter}>{fmtDur(Math.round(videoDuration * (videoTrimEnd - videoTrimStart) / 100))}</Text>
                <Text style={cs.trimTimecode}>{fmtDur(Math.round(videoDuration * videoTrimEnd / 100))}</Text>
              </View>
            </View>
          )}

          {/* Voice trim panel */}
          {tab === 'voice' && !recording && voiceBlob && durationMs > 0 && showVoiceTrim && (
            <View style={cs.trimPanelWA}>
              <View style={cs.trimHeader}>
                <View style={cs.trimTimeRow}>
                  <Text style={cs.trimTimeLabel}>{fmtMs(voiceTrimStart)}</Text>
                  <Text style={cs.trimTimeDash}>{'\u2014'}</Text>
                  <Text style={cs.trimTimeLabel}>{fmtMs(voiceTrimEnd)}</Text>
                </View>
                <View style={cs.trimDurationBadge}>
                  <Text style={cs.trimDurationBadgeText}>{fmtMs(voiceTrimEnd - voiceTrimStart)}</Text>
                </View>
              </View>
              <TrimSlider
                startMs={voiceTrimStart}
                endMs={voiceTrimEnd}
                durationMs={durationMs}
                onStartChange={(ms) => setVoiceTrimStart(Math.min(ms, voiceTrimEnd - 100))}
                onEndChange={(ms) => setVoiceTrimEnd(Math.max(ms, voiceTrimStart + 100))}
                playbackMs={voiceTrimPreview.cursorMs >= 0 ? voiceTrimPreview.cursorMs : undefined}
                waveform={voiceWaveform}
              />
              <View style={cs.trimActionsRow}>
                <TouchableOpacity
                  style={[cs.trimPlayBtn, voiceTrimPreview.playing && cs.trimPlayBtnActive]}
                  onPress={voiceTrimPreview.toggle}
                  activeOpacity={0.7}
                >
                  {voiceTrimPreview.playing
                    ? <Pause color="#FFFFFF" size={13} fill="#FFFFFF" />
                    : <Play color="#FFFFFF" size={13} fill="#FFFFFF" />
                  }
                  <Text style={cs.trimPlayText}>
                    {voiceTrimPreview.playing ? 'Стоп' : 'Прослушать'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={cs.trimResetBtn}
                  onPress={() => { voiceTrimPreview.stop(); setVoiceTrimStart(0); setVoiceTrimEnd(durationMs); }}
                  activeOpacity={0.6}
                >
                  <RotateCcw color="rgba(255,255,255,0.5)" size={13} />
                  <Text style={cs.trimResetText}>Сбросить</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Color strip for text/voice */}
          {(tab === 'text' || tab === 'voice') && (
            <View style={cs.colorStripContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cs.colorStripContent}>
                {STATUS_COLORS.map((c, i) => {
                  const isActive = selectedColorIdx === i;
                  return (
                    <TouchableOpacity key={i} onPress={() => setSelectedColorIdx(i)} activeOpacity={0.7} style={[cs.colorCircleWrap, isActive && cs.colorCircleWrapActive]}>
                      <LinearGradient
                        colors={[c.gradient[0], c.gradient[2]]}
                        style={cs.colorCircle}
                      />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Image filter chips */}
          {tab === 'media' && mediaPreview && mediaType === 'image' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cs.filterScroll} contentContainerStyle={cs.filterScrollContent}>
              {FILTERS.map((f, i) => (
                <TouchableOpacity
                  key={f.key}
                  style={[cs.filterChip, filterIdx === i && cs.filterChipActive]}
                  onPress={() => setFilterIdx(i)}
                >
                  <Text style={[cs.filterChipText, filterIdx === i && cs.filterChipTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Video trim toggle (subtle, above input row) */}
          {tab === 'media' && mediaPreview && mediaType === 'video' && videoDuration > 0 && (
            <TouchableOpacity
              style={cs.trimToggleBtnWA}
              onPress={() => setShowTrimPanel(!showTrimPanel)}
              activeOpacity={0.7}
            >
              <Scissors color={showTrimPanel ? '#25D366' : 'rgba(255,255,255,0.6)'} size={15} />
              <Text style={[cs.trimToggleTextWA, showTrimPanel && { color: '#25D366' }]}>
                {fmtDur(Math.round(videoDuration * (videoTrimEnd - videoTrimStart) / 100))}
              </Text>
            </TouchableOpacity>
          )}

          {/* Caption input + send button row (WhatsApp-style) — only show when content exists */}
          {canPublish && <View style={cs.waBottomRow}>
            {/* Visibility button */}
            <TouchableOpacity
              style={cs.waVisibilityBtn}
              onPress={() => setShowVisibilityPicker(!showVisibilityPicker)}
              activeOpacity={0.7}
            >
              <VisIcon color="rgba(255,255,255,0.85)" size={18} />
            </TouchableOpacity>

            <View style={cs.waVisibilityLabel}>
              <Text style={cs.waVisibilityLabelText} numberOfLines={1}>
                {visibility === 'everyone' ? 'Мой статус' : visibility === 'contacts' ? 'Контакты' : visibility === 'close_friends' ? 'Близкие друзья' : 'Только я'}
              </Text>
            </View>

            {/* Send button */}
            <TouchableOpacity
              style={[cs.waSendBtn, (!canPublish || uploading || remainingToday <= 0) && cs.waSendBtnDisabled]}
              onPress={handlePublish}
              disabled={!canPublish || uploading || remainingToday <= 0}
              activeOpacity={0.8}
            >
              {uploading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Send color="#FFFFFF" size={20} />
              )}
            </TouchableOpacity>
          </View>}

          {/* Upload overlay with progress and background option */}
          {uploading && (
            <View style={cs.uploadOverlay} pointerEvents="box-none">
              <View style={cs.uploadCard}>
                <View style={cs.uploadProgressRow}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <View style={cs.uploadProgressInfo}>
                    <Text style={cs.uploadText}>Загрузка...</Text>
                    <Text style={cs.uploadBytes}>
                      {uploadProgress
                        ? `${formatBytes(uploadProgress.loaded)} / ${formatBytes(uploadProgress.total)} · ${Math.round((uploadProgress.loaded / Math.max(1, uploadProgress.total)) * 100)}%`
                        : 'Подготовка...'}
                    </Text>
                  </View>
                </View>
                {uploadProgress && uploadProgress.total > 0 && (
                  <View style={cs.uploadBarTrack}>
                    <View style={[cs.uploadBarFill, { width: `${Math.min(100, (uploadProgress.loaded / uploadProgress.total) * 100)}%` }]} />
                  </View>
                )}
                {onBackgroundPublish && (
                  <TouchableOpacity
                    style={cs.uploadBgBtn}
                    onPress={() => {
                      if (tab === 'voice') sendToBackground();
                      else sendMediaToBackground();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={cs.uploadBgBtnText}>Свернуть в фон</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Visibility picker dropdown */}
          {showVisibilityPicker && (
            <View style={cs.waVisibilityDropdown}>
              {([
                { key: 'everyone', label: 'Мой статус', desc: 'Видно всем пользователям', icon: Eye },
                { key: 'contacts', label: 'Мои контакты', desc: 'Только ваши контакты', icon: Heart },
                { key: 'close_friends', label: 'Близкие друзья', desc: 'Только близкие друзья', icon: Sparkles },
                { key: 'nobody', label: 'Только я', desc: 'Никто не увидит', icon: EyeOff },
              ] as const).map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[cs.waVisibilityOption, visibility === opt.key && cs.waVisibilityOptionActive]}
                  onPress={() => { setVisibility(opt.key); setShowVisibilityPicker(false); }}
                  activeOpacity={0.7}
                >
                  <View style={[cs.waVisibilityOptIcon, visibility === opt.key && cs.waVisibilityOptIconActive]}>
                    <opt.icon color={visibility === opt.key ? '#FFFFFF' : 'rgba(255,255,255,0.6)'} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[cs.waVisibilityOptionLabel, visibility === opt.key && { color: '#FFFFFF', fontWeight: '600' }]}>{opt.label}</Text>
                    <Text style={cs.waVisibilityOptionDesc}>{opt.desc}</Text>
                  </View>
                  {visibility === opt.key && (
                    <View style={cs.waCheckCircle}>
                      <Check color="#FFFFFF" size={12} strokeWidth={3} />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const cs = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  canvas: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  textCanvasSafeArea: {
    flex: 1,
    width: '100%',
    marginTop: 56,
    marginBottom: 44,
    overflow: 'hidden',
    borderRadius: 4,
  },
  textGestureLayer: {
    flex: 1,
    paddingHorizontal: 24,
  },
  textScrollContainer: {
    flex: 1,
  },
  textScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  textOnCanvas: {
    fontWeight: '700',
    lineHeight: undefined,
    width: '100%',
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  charCountWrap: {
    position: 'absolute',
    bottom: 14,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  charCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'] as any,
  },
  charCountWarn: {
    color: 'rgba(255,200,50,0.85)',
  },
  charCountDanger: {
    color: 'rgba(255,80,80,0.9)',
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingHorizontal: 12,
    paddingBottom: 12,
    zIndex: 20,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topColorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  fontPickerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 4,
  },
  fontPickerScroll: {
    gap: 6,
    paddingRight: 4,
  },
  fontPickerChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  fontPickerChipActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  fontPickerChipText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '600',
  },
  fontPickerChipTextActive: {
    color: '#FFFFFF',
  },
  fontPickerDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginHorizontal: 4,
  },
  fontPickerAlignBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topCenter: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  topTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  topTabActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  topTabText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '600',
  },
  topTabTextActive: {
    color: '#FFFFFF',
  },

  errorFloat: {
    position: 'absolute',
    top: 110,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(220,38,38,0.92)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorFloatText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    flex: 1,
  },

  bottomBar: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingBottom: Platform.OS === 'web' ? 24 : Platform.OS === 'ios' ? 28 : 16,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  colorStripContainer: {
    marginBottom: 10,
    marginHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingVertical: 8,
  },
  colorStripContent: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  colorCircleWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorCircleWrapActive: {
    borderColor: 'rgba(255,255,255,0.9)',
  },
  colorCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  filterScroll: {
    marginBottom: 8,
    maxHeight: 36,
  },
  filterScrollContent: {
    gap: 6,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  filterChip: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: {
    backgroundColor: 'rgba(37,211,102,0.15)',
    borderColor: 'rgba(37,211,102,0.4)',
  },
  filterChipText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#25D366',
  },

  // WhatsApp-style bottom row
  waBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waVisibilityBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waCaptionField: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 40,
    maxHeight: 100,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  waCaptionInput: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 80,
    paddingVertical: 0,
  },
  waVisibilityLabel: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 6,
    height: 44,
  },
  waVisibilityLabelText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    fontWeight: '500',
  },
  waSendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#25D366',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waSendBtnDisabled: {
    opacity: 0.35,
  },
  uploadOverlay: {
    position: 'absolute',
    bottom: 90,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  uploadCard: {
    flexDirection: 'column',
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    minWidth: 220,
  },
  uploadProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  uploadProgressInfo: {
    flexDirection: 'column',
    gap: 2,
  },
  uploadText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  uploadBytes: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  uploadBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  uploadBarFill: {
    height: 4,
    backgroundColor: '#22C55E',
    borderRadius: 2,
  },
  uploadBgBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    alignSelf: 'flex-end',
  },
  uploadBgBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },

  // Trim toggle (video)
  trimToggleBtnWA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  trimToggleTextWA: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // Trim panel (video) WhatsApp-style
  trimPanelWA: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  trimLimitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
    alignSelf: 'center',
  },
  trimLimitText: {
    color: '#FFA726',
    fontSize: 11,
    fontWeight: '600',
  },
  trimThumbContainer: {
    marginBottom: 2,
  },
  trimTimecodes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingHorizontal: 2,
  },
  trimTimecode: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  trimTimecodeCenter: {
    color: '#25D366',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  // Visibility dropdown
  waVisibilityDropdown: {
    position: 'absolute',
    bottom: 64,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(18,18,18,0.98)',
    borderRadius: 16,
    paddingVertical: 6,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  waVisibilityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderRadius: 10,
    marginHorizontal: 4,
  },
  waVisibilityOptionActive: {
    backgroundColor: 'rgba(37,211,102,0.08)',
  },
  waVisibilityOptIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waVisibilityOptIconActive: {
    backgroundColor: 'rgba(37,211,102,0.2)',
  },
  waVisibilityOptionLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    fontWeight: '500',
  },
  waVisibilityOptionDesc: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    marginTop: 1,
  },
  waCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#25D366',
    justifyContent: 'center',
    alignItems: 'center',
  },

  mediaPickerWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  mediaPickerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  mediaPickerSubtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
  },
  mediaPickerCards: {
    flexDirection: 'row',
    gap: 14,
  },
  mediaPickCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    paddingVertical: 36,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  mediaPickCardSingle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  mediaPickIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaPickTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  mediaPickSub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
  },
  mediaFullImage: {
    width: '100%',
    height: '100%',
  },
  mediaChangeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 44,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  gestureResetBtn: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  gestureResetBtnMedia: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 44,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },

  voiceCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
    paddingTop: 80,
    paddingBottom: 60,
  },
  voiceWaves: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    height: 64,
    marginBottom: 12,
  },
  voiceBar: {
    width: 3,
    borderRadius: 1.5,
  },
  voiceTimer: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '200',
    letterSpacing: 4,
    fontVariant: ['tabular-nums'] as any,
  },
  voiceRecRingOuter: {
    width: 88,
    height: 88,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  voiceRecRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(220,38,38,0.25)',
  },
  voiceBtnRec: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceBtnIdle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceIdleRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  voiceHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '500',
  },
  voiceHintSub: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontWeight: '400',
    marginTop: -8,
  },
  voiceHintReady: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  voiceReadyIconOuter: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceReadyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  voiceCheckBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.3)',
  },
  voiceActions: {
    flexDirection: 'row',
    gap: 10,
  },
  voiceActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  voiceActionText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  trimPanel: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  trimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  trimTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trimTimeLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'] as any,
  },
  trimTimeDash: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
  },
  trimDurationLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  trimDurationBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  trimDurationBadgeText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'] as any,
  },
  trimActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  trimPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  trimPlayBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  trimPlayText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  trimResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  trimResetText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '500',
  },
  videoPreviewContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65,
    position: 'relative',
  },
  videoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
  },
  videoPauseMini: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoThumbTimeline: {
    marginBottom: 4,
  },
  videoThumbTrack: {
    flexDirection: 'row',
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  videoThumbFrame: {
    flex: 1,
    height: 48,
  },
  videoThumbDim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 2,
  },
  videoThumbSelection: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 4,
    zIndex: 3,
  },
});

const styles = StyleSheet.create({
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    overflow: 'hidden',
  },
  compactAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
  },
  container: {
    borderBottomWidth: 0.5,
    paddingTop: 14,
    paddingBottom: 10,
    marginTop: 2,
  },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 14,
  },
  statusItem: {
    alignItems: 'center',
    width: 72,
    position: 'relative',
  },
  addStatusRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  statusAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  statusAvatarLetter: {
    fontSize: 20,
    fontWeight: '600',
  },
  statusName: {
    fontSize: 11,
    marginTop: 5,
    textAlign: 'center',
    fontWeight: '500',
  },
  segmentedRingContainer: {
    width: 66,
    height: 66,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  segmentedRingInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  storyCountBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
  },
  storyCountText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  miniAddBtn: {
    position: 'absolute',
    right: 6,
    bottom: 22,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  viewerModal: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerTopOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  viewerTopGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingTop: 56,
  },
  progressBarBg: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  viewerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  viewerHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  viewerAvatar2: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  viewerHeaderRight: {
    flexDirection: 'row',
    gap: 12,
  },
  viewerName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  viewerTime: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
  },
  viewerBtn: {
    padding: 4,
  },
  storyMenuDropdown: {
    position: 'absolute',
    top: 32,
    right: 0,
    backgroundColor: 'rgba(30,30,30,0.95)',
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 180,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  storyMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  storyMenuText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },
  statusContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  statusContentMedia: {
    flex: 1,
    position: 'relative',
  },
  statusContentText: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 34,
  },
  statusFullImage: {
    width: '100%',
    height: '100%',
  },
  mediaCaption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  mediaCaptionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  navLeft: {
    position: 'absolute',
    left: 0,
    top: 120,
    bottom: 80,
    width: '30%',
  },
  navRight: {
    position: 'absolute',
    right: 0,
    top: 120,
    bottom: 80,
    width: '70%',
  },
  viewersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingBottom: 40,
  },
  viewersBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  viewersPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '55%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
    zIndex: 20,
  },
  viewersPanelHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
    opacity: 0.4,
  },
  viewersPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  viewersPanelTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  noViewers: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  viewerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  viewerRowName: {
    fontSize: 15,
    fontWeight: '600',
  },
  viewerRowTime: {
    fontSize: 12,
    marginTop: 2,
  },
  viewerRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  viewerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  viewerAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerAvatarLetter: {
    fontSize: 16,
    fontWeight: '600',
  },
  storyBottomWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 5,
  },
  storyBottomGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  storyBottomCaption: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  storyBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 16,
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  emojiBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  emojiBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  emojiBtnText: {
    fontSize: 22,
  },
  replyInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  replyInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    paddingVertical: 4,
  },
  replySendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceStatusContent: {
    alignItems: 'center',
    gap: 16,
  },
  voiceWaveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 60,
  },
  voiceWaveBar: {
    width: 4,
    borderRadius: 2,
  },
  voiceIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '500',
  },
});

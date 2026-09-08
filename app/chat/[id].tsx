import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Image, ImageBackground, Platform, Modal, ActivityIndicator, Pressable, Dimensions, Linking, Animated as RNAnimated, Easing as RNEasing, InteractionManager, ScrollView, Keyboard, BackHandler, PanResponder } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Send, Image as ImageIcon, Mic, Video, Phone as PhoneIcon, Paperclip, Play, Pause, Check, CheckCheck, X, Download, MoreVertical, Ban, Trash2, Reply, Edit3, Copy, Forward, Search, Pin, Smile, CornerUpRight, Timer, ChevronUp, ChevronDown, SmilePlus, Users, UserMinus, UserPlus, Crown, Star, AlertCircle, RefreshCw, FileDown, Camera, MapPin, File as FileIcon, Images, ExternalLink, CirclePlay, UserCircle, Bookmark, WifiOff, Eye } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as ImageManipulator from 'expo-image-manipulator';
import { Audio, Video as ExpoVideo, ResizeMode, AVPlaybackStatus, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAppearance } from '@/lib/appearance-context';
import TypingDots from '@/components/TypingDots';
import LinkPreviewCard from '@/components/LinkPreviewCard';
import FormattingToolbar from '@/components/FormattingToolbar';
import SwipeableMessage from '@/components/SwipeableMessage';
import CachedImage from '@/components/CachedImage';
import Avatar from '@/components/Avatar';
import { setActiveChatId, updateBadgeCount, dismissChatNotifications } from '@/lib/notifications';
import { StatusViewer, type Status, type UserWithStatuses } from '@/components/StatusBar';
import { playSendSound, playReceiveSound, playRecordStartSound, playRecordSendSound, playRecordCancelSound, playRecordLockSound, hapticLight, hapticMedium, hapticHeavy, hapticKeypress } from '@/lib/chat-feedback';
import { enqueueMessage, startQueueProcessor, onQueueEvent, forceProcessQueue, retryQueueItem, removeFromQueue, getQueuedCount } from '@/lib/message-queue';
import type { QueueEvent } from '@/lib/message-queue';
import { useVoicePlayer, useVoiceProgress, useVoicePlayerContext } from '@/lib/voice-player';
import { useNetwork } from '@/lib/use-network';
import { encryptMessage, decryptMessage, isEncryptedMessage, isE2EEnabled, computeSafetyNumber, getStoredPublicKey } from '@/lib/encryption';
import { isUserOnline, dataCache, type CachedMessage } from '@/lib/data-cache';
import { saveDraft, getDraft, clearDraft } from '@/lib/drafts';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import {
  enqueueUpload, onUploadEvent, clearCompleted,
  clearUploadsForConversation, retryUpload, uploadAndWait,
  type UploadEvent,
} from '@/lib/upload-queue';
import MediaCollage from '@/components/MediaCollage';
import VideoNotePlayer from '@/components/VideoNotePlayer';
import PhotoPreviewSheet, { type PreviewAsset } from '@/components/PhotoPreviewSheet';
import MediaGalleryViewer from '@/components/MediaGalleryViewer';
import EmojiStickerPanel from '@/components/EmojiStickerPanel';
import { ShieldCheck, Clock, ChevronRight, Bell, BellOff, UserX, Megaphone, Share2, Link2, LogOut, Type, Lock, Palette } from 'lucide-react-native';
import SwipeToClose from '@/components/SwipeToClose';
import { MessagesSkeleton } from '@/components/Skeleton';
import WallpaperPicker from '@/components/WallpaperPicker';
import { getChatWallpaper, setChatWallpaper, type ChatWallpaperConfig } from '@/lib/chat-wallpaper';
const DateTimePicker = Platform.OS !== 'web' ? (() => { try { return require('@react-native-community/datetimepicker').default; } catch { return null; } })() : null;

const MAX_MEDIA_W = 280;
const CHANNEL_MEDIA_W = Math.min((Dimensions.get('window').width - 16) * 0.88, 440);



const WALLPAPER_GRADIENTS: Record<string, Record<'dark' | 'light', string[]>> = {
  'night-sky':  { dark: ['#0D1B2A', '#152535', '#1B3044'], light: ['#D6E8F7', '#C1D9EE', '#B0CCE6'] },
  'sunset':     { dark: ['#1A1A2E', '#2A1840', '#1A1A2E'], light: ['#F5E6F0', '#EDD6E8', '#E5C8DF'] },
  'ocean':      { dark: ['#0A2633', '#0D3345', '#0A2633'], light: ['#D4EDF7', '#C0E3F0', '#B0D8EA'] },
  'forest':     { dark: ['#0B1F15', '#15312A', '#0B1F15'], light: ['#DAF0E0', '#C8E6CF', '#BBDFC4'] },
  'warm':       { dark: ['#201408', '#30220F', '#201408'], light: ['#F7EDE0', '#F0E2D0', '#EAD8C2'] },
  'slate':      { dark: ['#111822', '#1A2536', '#111822'], light: ['#E8ECF1', '#DDE2EA', '#D3D9E3'] },
  'midnight':   { dark: ['#0A0E18', '#121B2E', '#0E1422'], light: ['#E0E4EE', '#D4D9E6', '#CBCFDC'] },
  'sand':       { dark: ['#1C1610', '#28201A', '#1C1610'], light: ['#F5EEE4', '#EFE6D8', '#E8DDCC'] },
  'moss':       { dark: ['#0E180E', '#182818', '#0E180E'], light: ['#E0EFD8', '#D2E6C8', '#C4DCBA'] },
  'steel':      { dark: ['#14181C', '#1E2428', '#14181C'], light: ['#EAECEF', '#E0E3E7', '#D5D9DE'] },
  'aurora':     { dark: ['#0B1628', '#0F2235', '#0A1A30'], light: ['#D8E8F8', '#CCE0F4', '#C0D8F0'] },
  'terracotta': { dark: ['#1C120D', '#2A1C15', '#1C120D'], light: ['#F5E8E0', '#EDDED4', '#E6D4C8'] },
};

interface Reaction {
  emoji: string;
  count: number;
  users: string[];
  reacted: boolean;
}

const sortReactions = (reactions: Reaction[]): Reaction[] =>
  reactions.slice().sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.reacted !== b.reacted) return a.reacted ? -1 : 1;
    return a.emoji.localeCompare(b.emoji);
  });

interface Message {
  id: string;
  sender_id: string;
  content: string;
  message_type: 'text' | 'image' | 'video' | 'voice' | 'file' | 'location' | 'video_note' | 'contact' | 'call';
  media_url: string | null;
  media_duration: number;
  created_at: string;
  is_read: boolean;
  reply_to_id: string | null;
  edited_at: string | null;
  is_pinned: boolean;
  expires_at: string | null;
  deleted_at: string | null;
  forwarded_from_id: string | null;
  status_id: string | null;
  status_snapshot: {
    content: string | null;
    background_color: string | null;
    text_color: string | null;
    media_url: string | null;
    media_type: string | null;
    author_name: string;
    author_id: string;
  } | null;
  media_group_id?: string | null;
  reactions?: Reaction[];
  sender?: {
    display_name: string;
    avatar_url: string | null;
  };
  reply_to?: {
    content: string;
    sender_name: string;
    message_type: string;
  } | null;
}

interface ChatInfo {
  name: string;
  avatar_url: string | null;
  is_online: boolean;
  last_seen: string | null;
  other_user_id: string | null;
  type: 'direct' | 'group' | 'saved' | 'channel';
  member_count?: number;
  description?: string;
  username?: string;
  is_verified?: boolean;
}

interface GroupedMessage {
  type: 'date' | 'message' | 'unread';
  date?: string;
  data?: Message;
  isLastInGroup?: boolean;
  isFirstInGroup?: boolean;
  unreadCount?: number;
  mediaGroupItems?: Message[];
}

const EMOJI_LIST = ['😀','😂','😍','🥰','😎','🤔','👍','👎','❤️','🔥','🎉','😢','😡','🙏','💪','✨','🌟','😊','🤣','😘','🥺','😤','💯','🙌','👏','🤝','💕','😱','🤗','😏'];
const QUICK_REACTIONS = ['❤️','👍','😂','😮','😢','🔥'];
const ALL_AVAILABLE_REACTIONS = ['❤️','👍','👎','😂','😮','😢','😡','🔥','🎉','💯','🤔','🙏','👏','💔','🤡','💀','🥰','😈','🤯','🥳','😎','🤝','✅','❌','⭐','💎','🚀','🏆'];
const PAGE_SIZE = 30;

const GREETING_STICKERS = [
  { emoji: '🤲', label: 'Ассаламу алайкум!' },
  { emoji: '☪️', label: 'Ва алайкум ассалам!' },
  { emoji: '🤝', label: 'Маршалла ду хьоьга!' },
  { emoji: '😊', label: 'Муха ду хьал?' },
  { emoji: '🌙', label: 'Баракаллах!' },
  { emoji: '🕌', label: 'Иншааллах!' },
  { emoji: '💚', label: 'Дала аьтто бойла!' },
  { emoji: '🕊️', label: 'Машааллах!' },
];

const formatReactionCount = (count: number): string => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K`;
  return String(count);
};

const ReactionChip = memo(function ReactionChip({ reaction, messageId, colors, toggleReaction }: { reaction: { emoji: string; count: number; reacted: boolean }; messageId: string; colors: any; toggleReaction: (id: string, emoji: string) => void }) {
  const scaleAnim = useRef(new RNAnimated.Value(1)).current;

  const handlePress = () => {
    RNAnimated.sequence([
      RNAnimated.timing(scaleAnim, { toValue: 1.35, duration: 120, easing: RNEasing.out(RNEasing.back(2)), useNativeDriver: true }),
      RNAnimated.timing(scaleAnim, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      RNAnimated.timing(scaleAnim, { toValue: 1, duration: 100, easing: RNEasing.out(RNEasing.quad), useNativeDriver: true }),
    ]).start();
    toggleReaction(messageId, reaction.emoji);
  };

  return (
    <RNAnimated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
          paddingHorizontal: 7,
          paddingVertical: 3,
          borderRadius: 11,
          backgroundColor: reaction.reacted ? `${colors.primary}35` : colors.backgroundTertiary,
        }}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 15 }}>{reaction.emoji}</Text>
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.1, color: reaction.reacted ? colors.primary : colors.textSecondary }}>{formatReactionCount(reaction.count)}</Text>
      </TouchableOpacity>
    </RNAnimated.View>
  );
});

const CollapsibleChannelText = memo(function CollapsibleChannelText({ content, textColor, isMine, renderFn, fontScale, bgColor }: { content: string; textColor: string; isMine: boolean; renderFn: (text: string, color: string, mine?: boolean) => any; fontScale: number; bgColor: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = content.split('\n').length;
  const shouldCollapse = lineCount > 11;

  if (!shouldCollapse || expanded) {
    return <>{renderFn(content, textColor, isMine)}</>;
  }

  const truncated = content.split('\n').slice(0, 5).join('\n');
  return (
    <View style={{ position: 'relative' }}>
      <View style={{ maxHeight: 5 * 22 * fontScale, overflow: 'hidden' }}>
        {renderFn(truncated, textColor, isMine)}
      </View>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 48, justifyContent: 'flex-end', alignItems: 'center' }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bgColor + 'CC', borderRadius: 0 }} />
        <TouchableOpacity
          onPress={() => setExpanded(true)}
          activeOpacity={0.7}
          style={{ paddingVertical: 8, paddingHorizontal: 16 }}
        >
          <Text style={{ color: '#2196F3', fontSize: 14, fontWeight: '600' }}>Показать полностью</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|(?:[\w-]+\.)+(?:ru|com|org|net|io|dev|info|biz|me|co|app|tv|by|ua|kz|su|рф|pro|xyz|online|site|club|shop|blog|news|live|world|tech|ai|gg|cc|ly|link|top|fr|de|uk|it|es|nl|pl|cz|se|no|fi|be|at|ch|dk|jp|kr|cn|in|br|ar|za|au|nz|us|ca)(?:\/[^\s<]*[^<.,:;"')\]\s])?)/gi;

const CHAT_BAR_COUNT = 48;

const waveformCache = new Map<string, number[]>();
function getCachedWaveformBars(id: string): number[] {
  let bars = waveformCache.get(id);
  if (!bars) {
    bars = new Array(CHAT_BAR_COUNT);
    for (let i = 0; i < CHAT_BAR_COUNT; i++) {
      const seed = id.charCodeAt(i % id.length) + i * 7;
      const h1 = Math.abs(Math.sin(seed * 0.3)) * 0.6;
      const h2 = Math.abs(Math.sin(seed * 0.7 + 2)) * 0.4;
      const envelope = Math.sin(((i + 1) / CHAT_BAR_COUNT) * Math.PI) * 0.5 + 0.5;
      bars[i] = 4 + (h1 + h2) * envelope * 28;
    }
    waveformCache.set(id, bars);
    if (waveformCache.size > 200) {
      const first = waveformCache.keys().next().value;
      if (first) waveformCache.delete(first);
    }
  }
  return bars;
}

const ChatWaveform = memo(function ChatWaveform({
  messageId, isActiveTrack, playedColor, unplayedColor,
}: {
  messageId: string; isActiveTrack: boolean; playedColor: string; unplayedColor: string;
}) {
  const progress = useVoiceProgress();
  const effectiveProgress = isActiveTrack ? progress : 0;
  const bars = getCachedWaveformBars(messageId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevKeyRef = useRef('');

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const key = `${effectiveProgress.toFixed(3)}|${playedColor}|${unplayedColor}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }
    ctx.clearRect(0, 0, w, h);

    const barW = 2.5;
    const gap = (w - barW * bars.length) / Math.max(bars.length - 1, 1);
    const playedIdx = Math.floor(effectiveProgress * bars.length);

    for (let i = 0; i < bars.length; i++) {
      const bh = bars[i];
      const x = i * (barW + gap);
      const y = (h - bh) / 2;
      ctx.fillStyle = i <= playedIdx ? playedColor : unplayedColor;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, bh, 1.25);
      ctx.fill();
    }
  }, [bars, effectiveProgress, playedColor, unplayedColor]);

  if (Platform.OS === 'web') {
    return (
      <View style={wfStyles.container}>
        {/* @ts-ignore: web canvas */}
        <canvas
          ref={(el: HTMLCanvasElement | null) => { canvasRef.current = el; }}
          style={{ width: '100%', height: '100%', display: 'block' } as any}
        />
      </View>
    );
  }

  const playedIdx = Math.floor(effectiveProgress * bars.length);
  return (
    <View style={wfStyles.nativeRow}>
      {bars.map((h, i) => (
        <View
          key={i}
          style={{
            width: 3, height: h, borderRadius: 1.5,
            backgroundColor: i <= playedIdx ? playedColor : unplayedColor,
          }}
        />
      ))}
    </View>
  );
});

const wfStyles = StyleSheet.create({
  container: { flex: 1, height: 36 },
  nativeRow: { flexDirection: 'row', alignItems: 'center', gap: 1.5, height: 36 },
});

function fmtVoiceDur(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
}

const VoiceDuration = memo(function VoiceDuration({ isThisTrack, totalDuration, color }: { isThisTrack: boolean; totalDuration: number; color: string }) {
  const progress = useVoiceProgress();
  const text = isThisTrack ? fmtVoiceDur(Math.round(totalDuration * progress)) : fmtVoiceDur(totalDuration);
  return <Text style={{ fontSize: 12, color, fontVariant: ['tabular-nums'] as any }}>{text}</Text>;
});

export function ChatViewContent({ chatId, onBack }: { chatId: string; onBack?: () => void }) {
  const id = chatId;
  const { messageId: targetMessageId } = useLocalSearchParams<{ id?: string; messageId?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isConnected = useNetwork();
  const { colors, fontScale, chatSpacing, chatWallpaper, resolvedTheme } = useAppearance();

  const sentColors = useMemo(() => {
    const hex = colors.messageSent.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const isLight = (r * 299 + g * 587 + b * 114) / 1000 > 160;
    return {
      text: isLight ? '#1A1A1A' : '#FFFFFF',
      textSoft: isLight ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.78)',
      textFaint: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.62)',
      timeText: isLight ? 'rgba(0,0,0,0.52)' : 'rgba(255,255,255,0.68)',
      overlay12: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.12)',
      overlay15: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)',
      overlay20: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)',
      accent: isLight ? colors.primary : 'rgba(255,255,255,0.92)',
      accentBorder: isLight ? colors.primary : 'rgba(255,255,255,0.65)',
      link: isLight ? '#1565C0' : '#90CAF9',
      waveUnplayed: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.55)',
    };
  }, [colors.messageSent, colors.primary]);

  const voicePlayer = useVoicePlayer();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const selectionRef = useRef({ start: 0, end: 0 });
  const [chatInfo, setChatInfo] = useState<ChatInfo>(() => {
    const cachedConv = id ? dataCache.getConversation(id as string) : undefined;
    const cachedType = cachedConv?.type === 'channel' ? 'channel' : cachedConv?.type === 'group' ? 'group' : 'direct';
    return { name: cachedConv?.name || '', avatar_url: cachedConv?.avatar_url || null, is_online: false, last_seen: null, other_user_id: null, type: cachedType };
  });
  const [lastCallInfo, setLastCallInfo] = useState<{ call_type: string; ended_at: string; duration: number; status: string } | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: 'image' | 'video'; senderName?: string; date?: string; messageId?: string } | null>(null);
  const [galleryViewerOpen, setGalleryViewerOpen] = useState(false);
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0);
  const avatarGalleryRef = useRef<{ id: string; url: string; type: 'image'; senderName?: string }[] | null>(null);

  const [liveStory, setLiveStory] = useState<{ user: UserWithStatuses; index: number } | null>(null);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showWallpaperPicker, setShowWallpaperPicker] = useState(false);
  const [perChatWallpaper, setPerChatWallpaper] = useState<ChatWallpaperConfig | null>(null);
  const effectiveWallpaperId = perChatWallpaper?.type === 'gradient' ? perChatWallpaper.value : chatWallpaper;
  const wpColors = effectiveWallpaperId && WALLPAPER_GRADIENTS[effectiveWallpaperId] ? WALLPAPER_GRADIENTS[effectiveWallpaperId][resolvedTheme] : null;
  const wpImageUri = perChatWallpaper?.type === 'image' ? perChatWallpaper.value : null;
  const [showCallPicker, setShowCallPicker] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [typingUsers, setTypingUsers] = useState<{ name: string; activity: string }[]>([]);
  const [pinnedMessage, setPinnedMessage] = useState<Message | null>(null);
  const [allPinnedMessages, setAllPinnedMessages] = useState<Message[]>([]);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [forwardMessages, setForwardMessages] = useState<Message[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<string>('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [conversations, setConversations] = useState<{id: string; name: string}[]>([]);
  const [disappearTimer, setDisappearTimer] = useState<number>(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const [reactionsMap, setReactionsMap] = useState<Map<string, Reaction[]>>(new Map());
  const [showGroupInfo, setShowGroupInfoRaw] = useState(false);
  const [editChannelModal, setEditChannelModal] = useState(false);
  const [editChannelName, setEditChannelName] = useState('');
  const [editChannelDesc, setEditChannelDesc] = useState('');
  const [editChannelUsername, setEditChannelUsername] = useState('');
  const [editChannelSaving, setEditChannelSaving] = useState(false);
  const [editChannelReactions, setEditChannelReactions] = useState<string[]>(QUICK_REACTIONS);
  const [channelAllowedReactions, setChannelAllowedReactions] = useState<string[] | null>(null);
  const screenWidth = Dimensions.get('window').width;
  const groupInfoSlideAnim = useRef(new RNAnimated.Value(screenWidth)).current;
  const setShowGroupInfo = useCallback((v: boolean) => {
    if (v) {
      groupInfoSlideAnim.setValue(screenWidth);
      setShowGroupInfoRaw(true);
      RNAnimated.spring(groupInfoSlideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      RNAnimated.timing(groupInfoSlideAnim, {
        toValue: screenWidth,
        duration: 250,
        useNativeDriver: true,
      }).start(() => setShowGroupInfoRaw(false));
    }
  }, [groupInfoSlideAnim]);

  const groupInfoPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 15 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (g.dx > 0) groupInfoSlideAnim.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx > 80 || g.vx > 0.5) {
          RNAnimated.timing(groupInfoSlideAnim, {
            toValue: screenWidth,
            duration: 200,
            useNativeDriver: true,
          }).start(() => setShowGroupInfoRaw(false));
        } else {
          RNAnimated.spring(groupInfoSlideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 65,
            friction: 11,
          }).start();
        }
      },
    })
  ).current;

  const [groupMembers, setGroupMembers] = useState<{user_id: string; role: string; display_name: string; avatar_url: string | null; is_online: boolean; last_seen: string | null}[]>([]);
  const [myChannelRoleEager, setMyChannelRoleEager] = useState<string | null>(null);
  const [channelMuted, setChannelMuted] = useState(false);
  const [channelMuteSheet, setChannelMuteSheet] = useState(false);
  const [showJustSubscribed, setShowJustSubscribed] = useState(false);
  const [subscribingToChannel, setSubscribingToChannel] = useState(false);
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [sharedMedia, setSharedMedia] = useState<{id: string; media_url: string; message_type: string; created_at: string; content?: string; sender_name?: string; media_duration?: number}[]>([]);
  const [mediaTab, setMediaTab] = useState<'media' | 'files' | 'voice' | 'links'>('media');
  const [sharedLinks, setSharedLinks] = useState<{id: string; content: string; created_at: string; sender_name: string}[]>([]);



  const [photoPreviewAssets, setPhotoPreviewAssets] = useState<PreviewAsset[]>([]);
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);
  const [uploadingMsgIds, setUploadingMsgIds] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());
  const [slowUploadMsgIds, setSlowUploadMsgIds] = useState<Set<string>>(new Set());
  const [recordingVideoNote, setRecordingVideoNote] = useState(false);
  const [videoNoteStream, setVideoNoteStream] = useState<MediaStream | null>(null);
  const [videoNoteDuration, setVideoNoteDuration] = useState(0);
  const videoNoteRecorderRef = useRef<MediaRecorder | null>(null);
  const videoNoteChunksRef = useRef<Blob[]>([]);
  const videoNoteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoNotePreviewRef = useRef<HTMLVideoElement | null>(null);


  const [e2eActive, setE2eActive] = useState(false);
  const [peerPublicKey, setPeerPublicKey] = useState<JsonWebKey | null>(null);
  const peerPublicKeyRef = useRef<JsonWebKey | null>(null);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [myPublicKey, setMyPublicKey] = useState<JsonWebKey | null>(null);
  const [pendingVoiceDraft, setPendingVoiceDraft] = useState<{ uri: string; duration: number; mimeType: string } | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unreadScrollCount, setUnreadScrollCount] = useState(0);
  const scrollBtnAnim = useRef(new RNAnimated.Value(0)).current;
  const [showUserProfile, setShowUserProfileRaw] = useState(false);
  const userProfileSlideAnim = useRef(new RNAnimated.Value(400)).current;
  const setShowUserProfile = useCallback((v: boolean) => {
    if (v) {
      userProfileSlideAnim.setValue(400);
      setShowUserProfileRaw(true);
      RNAnimated.spring(userProfileSlideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      RNAnimated.timing(userProfileSlideAnim, {
        toValue: 400,
        duration: 250,
        useNativeDriver: true,
      }).start(() => setShowUserProfileRaw(false));
    }
  }, [userProfileSlideAnim]);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockFeedback, setBlockFeedback] = useState<string | null>(null);
  const [starredMessageIds, setStarredMessageIds] = useState<Set<string>>(new Set());
  const [userProfileData, setUserProfileData] = useState<{display_name: string; avatar_url: string | null; phone: string; status_text: string; is_online: boolean; last_seen: string | null; stories: {id: string; content: string | null; media_url: string | null; media_type: string | null; background_color: string | null; text_color: string | null; created_at: string}[]; sharedPhotos: {id: string; media_url: string; message_type: string; created_at: string; sender_name: string; media_duration: number | null}[]} | null>(null);
  const [profileAvatarFull, setProfileAvatarFull] = useState(false);
  const [profileStoryView, setProfileStoryView] = useState<number | null>(null);
  const [profileMediaIndex, setProfileMediaIndex] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [addMemberContacts, setAddMemberContacts] = useState<{id: string; display_name: string; avatar_url: string | null; is_online: boolean}[]>([]);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [addingMemberIds, setAddingMemberIds] = useState<Set<string>>(new Set());
  const [failedMsgIds, setFailedMsgIds] = useState<Set<string>>(new Set());
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [readReceiptsModal, setReadReceiptsModal] = useState(false);
  const [readReceipts, setReadReceipts] = useState<{ name: string; time: string }[]>([]);

  // Scheduled messages
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduledMessages, setScheduledMessages] = useState<{ id: string; content: string; message_type: string; media_url: string | null; media_duration: number; scheduled_at: string; status: string }[]>([]);
  const [showScheduledList, setShowScheduledList] = useState(false);
  const [scheduleSending, setScheduleSending] = useState(false);
  const [pendingScheduleMedia, setPendingScheduleMedia] = useState<{ type: string; url: string; duration: number; caption: string } | null>(null);
  const [otherLastRead, setOtherLastRead] = useState<string | null>(null);
  const [otherPrivacy, setOtherPrivacy] = useState<{ show_online?: boolean; show_last_seen?: boolean; show_read_receipts?: boolean } | null>(null);
  const [myPrivacy, setMyPrivacy] = useState<{ show_read_receipts?: boolean; show_typing?: boolean } | null>(null);
  const linkPreviewCache = useRef<Map<string, { title?: string; description?: string; image?: string } | null>>(new Map());

  // Stable refs that renderItem reads without causing re-creation
  const uploadingMsgIdsRef = useRef<Set<string>>(new Set());
  const uploadProgressRef = useRef<Map<string, number>>(new Map());
  const uploadIdByTempIdRef = useRef<Map<string, string>>(new Map());
  const slowUploadTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const slowUploadMsgIdsRef = useRef<Set<string>>(new Set());
  const reactionsMapRef = useRef<Map<string, Reaction[]>>(new Map());
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const failedMsgIdsRef = useRef<Set<string>>(new Set());
  const starredMessageIdsRef = useRef<Set<string>>(new Set());
  const viewCountsRef = useRef<Map<string, number>>(new Map());
  const [viewCountsTick, setViewCountsTick] = useState(0);
  const viewedMsgIdsRef = useRef<Set<string>>(new Set());
  const showReactionPickerRef = useRef<string | null>(null);
  const selectModeRef = useRef(false);
  const lastTapRef = useRef<{ time: number; msgId: string }>({ time: 0, msgId: '' });

  const mediaRecorderRef = useRef<any>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);
  const webFileInputModeRef = useRef<'pick' | 'add'>('pick');
  const myDisplayNameRef = useRef('');
  const initialScrollDone = useRef(false);
  const [listReady, setListReady] = useState(false);
  const pendingScrollToEnd = useRef(false);
  const lastContentHeight = useRef(0);
  const isNearBottom = useRef(true);
  const firstUnreadIndex = useRef(-1);
  const dbUnreadCount = useRef(-1);
  const presenceChannelRef = useRef<any>(null);
  const mountedRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const senderProfileCache = useRef<Map<string, { display_name: string; avatar_url: string | null }>>(new Map());
  const lastPaddingBottom = useRef(0);
  const lastPaddingBottomApplied = useRef<number | undefined>(undefined);
  const wasAtBottomRef = useRef(true);
  const currentScrollOffsetRef = useRef(0);
  const preLoadMoreSnapshot = useRef<{ offset: number; contentHeight: number } | null>(null);
  const realtimeScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSentRef = useRef(false);
  // Stable mirrors of state/memo values used inside stable callbacks
  const searchModeRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const targetMessageIdRef = useRef<string | undefined>(undefined);
  const messageIndexMapRef = useRef<Map<string, number>>(new Map());

  // Keep refs in sync with state (no extra renders, just ref updates)
  uploadingMsgIdsRef.current = uploadingMsgIds;
  uploadProgressRef.current = uploadProgress;
  slowUploadMsgIdsRef.current = slowUploadMsgIds;
  reactionsMapRef.current = reactionsMap;
  selectedIdsRef.current = selectedIds;
  failedMsgIdsRef.current = failedMsgIds;
  starredMessageIdsRef.current = starredMessageIds;
  showReactionPickerRef.current = showReactionPicker;
  selectModeRef.current = selectMode;
  searchModeRef.current = searchMode;
  loadingMoreRef.current = loadingMore;
  targetMessageIdRef.current = targetMessageId;

  const effectiveOtherLastRead = otherPrivacy?.show_read_receipts === false ? null : otherLastRead;

  const voiceExtraData = useMemo(() => {
    const trackId = voicePlayer.state.track?.id || '';
    const playing = voicePlayer.state.playing;
    const uploadCount = uploadingMsgIds.size;
    const slowUploadCount = slowUploadMsgIds.size;
    const selectedCount = selectedIds.size;
    return `${trackId}-${playing}-${effectiveOtherLastRead}-${uploadCount}-${slowUploadCount}-${selectedCount}-${selectMode}-${showReactionPicker}`;
  }, [voicePlayer.state.track?.id, voicePlayer.state.playing, effectiveOtherLastRead, uploadingMsgIds.size, slowUploadMsgIds.size, selectedIds.size, selectMode, showReactionPicker]);

  // Instant snap to bottom. Uses a large offset instead of scrollToEnd because
  // scrollToEnd relies on __getFrameMetricsApprox which underestimates the
  // position when the newest message hasn't been measured yet. The runtime
  // clamps the value to (contentHeight - viewportHeight) automatically.
  const scrollToBottomNow = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 999999999, animated: false });
  }, []);

  // Animated scroll for the "scroll down" FAB button.
  const scrollToBottom = useCallback(() => {
    if (!flatListRef.current) return;
    programmaticScrollRef.current = true;
    setShowScrollDown(false);
    setUnreadScrollCount(0);
    scrollToBottomNow();
    setTimeout(() => {
      isNearBottom.current = true;
      setShowScrollDown(false);
      programmaticScrollRef.current = false;
    }, 100);
  }, [scrollToBottomNow]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (chatId) {
      getChatWallpaper(chatId, user!.id).then(cfg => { if (mountedRef.current) setPerChatWallpaper(cfg); });
    }
  }, [chatId]);

  useEffect(() => {
    if (user) {
      supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
        .then(({ data }) => { if (data?.display_name) myDisplayNameRef.current = data.display_name; });
    }
  }, [user]);

  useEffect(() => { startQueueProcessor(); }, []);

  // Show upload progress for voice messages only if upload takes longer than 2 seconds
  useEffect(() => {
    for (const tempId of uploadingMsgIds) {
      if (!slowUploadTimersRef.current.has(tempId) && !slowUploadMsgIdsRef.current.has(tempId)) {
        const timer = setTimeout(() => {
          slowUploadTimersRef.current.delete(tempId);
          if (uploadingMsgIdsRef.current.has(tempId)) {
            setSlowUploadMsgIds(prev => new Set(prev).add(tempId));
          }
        }, 2000);
        slowUploadTimersRef.current.set(tempId, timer);
      }
    }
    for (const tempId of Array.from(slowUploadTimersRef.current.keys())) {
      if (!uploadingMsgIds.has(tempId)) {
        clearTimeout(slowUploadTimersRef.current.get(tempId)!);
        slowUploadTimersRef.current.delete(tempId);
      }
    }
    const completed = Array.from(slowUploadMsgIds).filter(id => !uploadingMsgIds.has(id));
    if (completed.length > 0) {
      setSlowUploadMsgIds(prev => {
        const n = new Set(prev);
        for (const id of completed) n.delete(id);
        return n;
      });
    }
  }, [uploadingMsgIds]);

  useEffect(() => {
    return () => {
      slowUploadTimersRef.current.forEach(t => clearTimeout(t));
      slowUploadTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || !showUserProfile) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowUserProfile(false);
      return true;
    });
    return () => sub.remove();
  }, [showUserProfile, setShowUserProfile]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    RNAnimated.spring(scrollBtnAnim, {
      toValue: showScrollDown ? 1 : 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [showScrollDown, scrollBtnAnim]);



  // Web scroll restoration is now handled directly in handleContentSizeChange
  // to avoid the race condition between useEffect and layout updates

  useEffect(() => {
    if (!id) return;
    const draft = getDraft(id as string);
    if (draft) {
      if (draft.text) setInput(draft.text);
      if (draft.voiceUri && draft.voiceMimeType) {
        setPendingVoiceDraft({ uri: draft.voiceUri, duration: draft.voiceDuration, mimeType: draft.voiceMimeType });
      }
    }
  }, [id]);

  const inputRef2 = useRef(input);
  inputRef2.current = input;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const editingRef = useRef(editingMessage);
  editingRef.current = editingMessage;

  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const recordingDurationRef = useRef(recordingDuration);
  recordingDurationRef.current = recordingDuration;
  const videoNoteDurationRef = useRef(videoNoteDuration);
  videoNoteDurationRef.current = videoNoteDuration;
  const videoNoteStreamRef = useRef(videoNoteStream);
  videoNoteStreamRef.current = videoNoteStream;
  const stopVideoNoteRef = useRef<((send: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!id) return;
    return () => {
      const currentInput = inputRef2.current;
      const currentReply = replyToRef.current;
      const currentEditing = editingRef.current;

      if (recordingRef.current && mediaRecorderRef.current && Platform.OS === 'web') {
        const recorder = mediaRecorderRef.current as MediaRecorder;
        const dur = recordingDurationRef.current;
        const mime = recorder.mimeType;
        recorder.onstop = () => {
          const stream = recorder.stream as MediaStream;
          stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
          if (recordedChunksRef.current.length > 0) {
            const blob = new Blob(recordedChunksRef.current, { type: mime });
            const voiceUri = URL.createObjectURL(blob);
            saveDraft(id as string, {
              text: currentInput,
              replyToId: currentReply?.id || null,
              editingMessageId: currentEditing?.id || null,
              voiceUri,
              voiceDuration: Math.max(dur, 1),
              voiceMimeType: mime,
            });
          }
          recordedChunksRef.current = [];
        };
        recorder.stop();
        if (recordingTimer.current) clearInterval(recordingTimer.current);
      }

      if (Platform.OS !== 'web' && mediaRecorderRef.current) {
        const rec = mediaRecorderRef.current as Audio.Recording;
        mediaRecorderRef.current = null;
        if (recordingTimer.current) { clearInterval(recordingTimer.current); recordingTimer.current = null; }
        (async () => {
          try { await rec.stopAndUnloadAsync(); } catch {}
          try {
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: false,
              playsInSilentModeIOS: true,
              staysActiveInBackground: false,
              shouldDuckAndroid: true,
              interruptionModeIOS: InterruptionModeIOS.DoNotMix,
              interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
            });
          } catch {}
        })();
      }

      if (videoNoteStreamRef.current) {
        videoNoteStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      }
      if (videoNoteTimerRef.current) {
        clearInterval(videoNoteTimerRef.current);
        videoNoteTimerRef.current = null;
      }
      if (videoNoteRecorderRef.current) {
        try { videoNoteRecorderRef.current.stop(); } catch {}
        videoNoteRecorderRef.current = null;
      }

      if (!recordingRef.current || Platform.OS !== 'web') {
        saveDraft(id as string, {
          text: currentInput,
          replyToId: currentReply?.id || null,
          editingMessageId: currentEditing?.id || null,
        });
      }

      clearUploadsForConversation(id as string);
    };
  }, [id]);

  const chatIdRef = useRef(id);
  chatIdRef.current = id;
  useEffect(() => {
    return () => {
      const cid = chatIdRef.current as string;
      if (!cid) return;
      const currentInput = inputRef2.current;
      const currentReply = replyToRef.current;
      const currentEditing = editingRef.current;
      if (!recordingRef.current) {
        saveDraft(cid, {
          text: currentInput,
          replyToId: currentReply?.id || null,
          editingMessageId: currentEditing?.id || null,
        });
      }
    };
  }, []);

  useEffect(() => {
    if (id) {
      setActiveChatId(id);
      dismissChatNotifications(id);
    }
    return () => setActiveChatId(null);
  }, [id]);

  useEffect(() => {
    initialScrollDone.current = false;
    pendingScrollToEnd.current = false;
    lastContentHeight.current = 0;
    let hasCacheHit = false;
    if (id && user) {
      const cached = dataCache.getMessages(id as string);
      if (cached && cached.length > 0 && messages.length === 0) {
        const asMessages = cached.map(m => {
          const profile = dataCache.getProfile(m.sender_id);
          return {
            ...m,
            message_type: m.message_type as Message['message_type'],
            sender: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : undefined,
            reply_to: undefined,
            reactions: undefined,
          };
        }) as Message[];
        setMessages(asMessages);
        setInitialLoaded(true);
        setListReady(true);
        pendingScrollToEnd.current = true;
        hasCacheHit = true;
      }
    }
    if (!hasCacheHit) {
      setListReady(false);
    }
    const safetyTimer = setTimeout(() => { setListReady(true); if (!initialLoaded) setInitialLoaded(true); }, hasCacheHit ? 0 : 1500);
    loadChatInfo();
    if (hasCacheHit) {
      Promise.all([
        loadMessages(),
        loadPinnedMessage(),
        isE2EEnabled().then(setE2eActive),
        getStoredPublicKey().then(setMyPublicKey),
      ]);
    } else {
      let fallbackFired = false;
      const handle = InteractionManager.runAfterInteractions(() => {
        if (fallbackFired) return;
        Promise.all([
          loadMessages(),
          loadPinnedMessage(),
          isE2EEnabled().then(setE2eActive),
          getStoredPublicKey().then(setMyPublicKey),
        ]);
      });
      const fallbackTimer = setTimeout(() => {
        if (!initialLoaded) { fallbackFired = true; loadMessages(); }
      }, 300);
      return () => { handle.cancel(); clearTimeout(safetyTimer); clearTimeout(fallbackTimer); };
    }
    return () => { clearTimeout(safetyTimer); };
  }, [id, user]);

  useEffect(() => {
    if (!id || !user?.id) return;

    const currentUserId = user.id;

    const channel = supabase
      .channel(`chat-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${id}`,
      }, async (payload) => {
        const newMsg = payload.new as Message;
        const enriched = (await enrichMessages([newMsg]))[0];
        if (enriched.message_type === 'text' && isEncryptedMessage(enriched.content) && peerPublicKeyRef.current) {
          enriched.content = await decryptMessage(peerPublicKeyRef.current, enriched.content);
          (enriched as any).is_e2e = true;
        }
        if (newMsg.sender_id === currentUserId) {
          setMessages((prev) => {
            if (resolvedIdsRef.current.has(newMsg.id)) {
              resolvedIdsRef.current.delete(newMsg.id);
              const exists = prev.some((m) => m.id === newMsg.id);
              if (exists) return prev;
            }
            const exists = prev.some((m) => m.id === newMsg.id);
            if (exists) return prev;
            const tempIdx = prev.findIndex((m) => {
              if (!m.id.startsWith('temp-') || m.sender_id !== currentUserId || m.message_type !== newMsg.message_type) return false;
              if (newMsg.message_type === 'text') return m.content === newMsg.content;
              if (m.media_url === newMsg.media_url) return true;
              const matchTempId = uploadIdByTempIdRef.current.has(m.id);
              return matchTempId;
            });
            if (tempIdx >= 0) {
              resolvedIdsRef.current.add(enriched.id);
              const updated = [...prev];
              updated[tempIdx] = { ...updated[tempIdx], ...enriched, id: enriched.id, created_at: enriched.created_at };
              return updated;
            }
            return [...prev, enriched];
          });

        } else {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === newMsg.id);
            if (exists) return prev;
            return [...prev, enriched];
          });
          setTypingUsers((prev) => prev.filter((t) => t.name !== (enriched.sender?.display_name || '')));
          playReceiveSound();
          hapticLight();
          debouncedMarkAsRead();
        }
        dataCache.appendMessage(id as string, {
          id: enriched.id, sender_id: enriched.sender_id, content: enriched.content,
          message_type: enriched.message_type, media_url: enriched.media_url,
          media_duration: enriched.media_duration, created_at: enriched.created_at,
          is_read: enriched.is_read, reply_to_id: enriched.reply_to_id,
          edited_at: enriched.edited_at, is_pinned: enriched.is_pinned,
          expires_at: enriched.expires_at, deleted_at: enriched.deleted_at,
          forwarded_from_id: enriched.forwarded_from_id,
          status_id: enriched.status_id || null, status_snapshot: enriched.status_snapshot || null,
          media_group_id: (enriched as any).media_group_id || null,
        });
        loadReactions([newMsg.id]);
        if (chatInfo.type === 'channel') {
          recordChannelViews([newMsg.id]);
          viewCountsRef.current.set(newMsg.id, (viewCountsRef.current.get(newMsg.id) || 0) + 1);
        }
        if (newMsg.sender_id !== currentUserId) {
          // Own messages scroll via the RAF in the branch above; only others need the debounce
          if (isNearBottom.current) {
            if (realtimeScrollTimerRef.current) clearTimeout(realtimeScrollTimerRef.current);
            realtimeScrollTimerRef.current = setTimeout(() => {
              scrollToBottomNow();
              realtimeScrollTimerRef.current = null;
            }, 50);
          } else {
            setUnreadScrollCount(c => c + 1);
          }
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as Message;
        if (updated.deleted_at) {
          setMessages((prev) => prev.filter((m) => m.id !== updated.id));
          if (voicePlayer.state.track?.id === updated.id) {
            voicePlayer.stop();
          }
        } else {
          setMessages((prev) => prev.map((m) => m.id === updated.id ? { ...m, ...updated, sender: m.sender, reply_to: m.reply_to } : m));
        }
        if (updated.is_pinned !== undefined) loadPinnedMessage();
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${id}`,
      }, (payload) => {
        const deleted = payload.old as { id: string };
        if (voicePlayer.state.track?.id === deleted.id) {
          voicePlayer.stop();
        }
        setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversation_members',
        filter: `conversation_id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as { user_id: string; last_read_at: string | null };
        if (updated.user_id !== currentUserId && updated.last_read_at) {
          setOtherLastRead(prev => {
            if (!prev || new Date(updated.last_read_at!) > new Date(prev)) return updated.last_read_at;
            return prev;
          });
        }
      })
      .subscribe();

    const reactionsChannel = supabase
      .channel(`reactions-${id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_reactions',
      }, (payload) => {
        const msgId = (payload.new as any)?.message_id || (payload.old as any)?.message_id;
        if (!msgId) return;
        setMessages(prev => {
          if (prev.some(m => m.id === msgId)) loadReactions([msgId]);
          return prev;
        });
      })
      .subscribe();

    // Presence for typing indicators
    const presenceChannel = supabase.channel(`typing-${id}`, {
      config: { presence: { key: currentUserId } },
    });
    presenceChannelRef.current = presenceChannel;

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const active: { name: string; activity: string }[] = [];
        Object.entries(state).forEach(([uid, data]) => {
          if (uid !== currentUserId && Array.isArray(data) && data.length > 0) {
            const entry = data[0] as any;
            if (entry.typing === true) {
              active.push({
                name: entry.name || 'Пользователь',
                activity: entry.activity || 'typing',
              });
            }
          }
        });
        setTypingUsers((prev) => {
          const prevKey = prev.map(t => t.name + ':' + t.activity).join(',');
          const newKey = active.map(t => t.name + ':' + t.activity).join(',');
          return prevKey === newKey ? prev : active;
        });
      })
      .subscribe();

    return () => {
      if (presenceChannelRef.current) {
        presenceChannelRef.current.track({ typing: false }).catch(() => {});
      }
      presenceChannelRef.current = null;
      supabase.removeChannel(channel);
      supabase.removeChannel(presenceChannel);
      supabase.removeChannel(reactionsChannel);
    };
  }, [id, user?.id]);

  useEffect(() => {
    if (!chatInfo.other_user_id) return;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    const profileChannel = supabase
      .channel(`profile-presence-${chatInfo.other_user_id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${chatInfo.other_user_id}`,
      }, (payload) => {
        const updated = payload.new as { is_online?: boolean; last_seen?: string; privacy_settings?: any };
        if (updated.privacy_settings) {
          setOtherPrivacy(updated.privacy_settings);
        }
        const ps = updated.privacy_settings ?? otherPrivacy;
        const hideOnline = ps?.show_online === false;
        const hideLastSeen = ps?.show_last_seen === false;
        const newIsOnline = hideOnline ? false : (updated.is_online ?? true);
        const newLastSeen = hideLastSeen ? null : (updated.last_seen ?? null);
        if (offlineTimer) clearTimeout(offlineTimer);
        if (newIsOnline) {
          setChatInfo(prev => ({ ...prev, is_online: true, last_seen: newLastSeen ?? prev.last_seen }));
        } else {
          offlineTimer = setTimeout(() => {
            setChatInfo(prev => ({ ...prev, is_online: false, last_seen: newLastSeen ?? prev.last_seen }));
          }, 5000);
        }
      })
      .subscribe();
    return () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      supabase.removeChannel(profileChannel);
    };
  }, [chatInfo.other_user_id]);


  // Auto-remove expired messages -- schedule timeout for next expiry
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expiringIds = useMemo(() => {
    return messages.filter(m => m.expires_at).map(m => `${m.id}:${m.expires_at}`).join(',');
  }, [messages]);

  useEffect(() => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    if (!expiringIds) return;
    const now = Date.now();
    let nextExpiry = Infinity;
    const parts = expiringIds.split(',');
    for (const part of parts) {
      const expiresAt = part.split(':').slice(1).join(':');
      if (expiresAt) {
        const t = new Date(expiresAt).getTime();
        if (t <= now) { nextExpiry = 0; break; }
        if (t < nextExpiry) nextExpiry = t;
      }
    }
    const delay = nextExpiry === 0 ? 0 : Math.max(nextExpiry - now + 500, 1000);
    expiryTimerRef.current = setTimeout(() => {
      const n = Date.now();
      setMessages(prev => prev.filter(m => !m.expires_at || new Date(m.expires_at).getTime() > n));
    }, delay);
    return () => { if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current); };
  }, [expiringIds]);

  const loadChatInfo = async () => {
    if (!user || !id) return;

    const [convResult, membersResult, myProfileResult] = await Promise.all([
      supabase
        .from('conversations')
        .select('type, name, avatar_url, description, username, is_verified, allowed_reactions')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('conversation_members')
        .select('user_id, role, is_muted')
        .eq('conversation_id', id),
      supabase
        .from('profiles')
        .select('privacy_settings')
        .eq('id', user.id)
        .maybeSingle(),
    ]);

    if (myProfileResult.data?.privacy_settings) {
      setMyPrivacy(myProfileResult.data.privacy_settings);
    }

    const conv = convResult.data;
    if (!conv || !mountedRef.current) return;
    const members = membersResult.data || [];

    if (conv.type === 'saved') {
      setChatInfo({
        name: 'Избранное',
        avatar_url: null,
        is_online: false,
        last_seen: null,
        other_user_id: null,
        type: 'saved',
      });
    } else if (conv.type === 'direct') {
      const otherMember = members.find(m => m.user_id !== user.id);
      if (otherMember) {
        const cachedProfile = dataCache.getProfile(otherMember.user_id);
        const cached = senderProfileCache.current.get(otherMember.user_id);
        let profile = cachedProfile
          ? { display_name: cachedProfile.display_name, avatar_url: cachedProfile.avatar_url, is_online: cachedProfile.is_online, last_seen: cachedProfile.last_seen as string | null, privacy_settings: cachedProfile.privacy_settings as any, public_key: undefined as string | undefined }
          : cached
            ? { ...cached, is_online: false, last_seen: null as string | null, privacy_settings: undefined as any, public_key: undefined as string | undefined }
            : null;
        if (!cachedProfile) {
          const { data } = await supabase
            .from('profiles')
            .select('display_name, avatar_url, is_online, last_seen, privacy_settings, public_key')
            .eq('id', otherMember.user_id)
            .maybeSingle();
          profile = data;
          if (data) {
            senderProfileCache.current.set(otherMember.user_id, { display_name: data.display_name, avatar_url: data.avatar_url });
            setOtherPrivacy(data.privacy_settings ?? null);
            if (data.public_key) {
              try {
                const jwk = JSON.parse(data.public_key);
                setPeerPublicKey(jwk);
                peerPublicKeyRef.current = jwk;
              } catch {}
            }
          }
        } else {
          if (cachedProfile.privacy_settings) {
            setOtherPrivacy(cachedProfile.privacy_settings ?? null);
          }
        }
        if (mountedRef.current) {
          if (profile) {
            const ps = (profile as any).privacy_settings;
            const hideOnline = ps?.show_online === false;
            const hideLastSeen = ps?.show_last_seen === false;
            setChatInfo({
              name: profile.display_name,
              avatar_url: profile.avatar_url,
              is_online: hideOnline ? false : profile.is_online,
              last_seen: hideLastSeen ? null : profile.last_seen,
              other_user_id: otherMember.user_id,
              type: 'direct',
            });
            const { data: lastCall } = await supabase
              .from('calls')
              .select('call_type, ended_at, duration, status')
              .or(`and(caller_id.eq.${user.id},receiver_id.eq.${otherMember.user_id}),and(caller_id.eq.${otherMember.user_id},receiver_id.eq.${user.id})`)
              .in('status', ['ended', 'missed', 'declined'])
              .order('ended_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (lastCall && mountedRef.current) setLastCallInfo(lastCall);
          } else {
            setChatInfo({
              name: 'Пользователь',
              avatar_url: null,
              is_online: false,
              last_seen: null,
              other_user_id: otherMember.user_id,
              type: 'direct',
            });
          }
        }
      }
    } else {
      if (!mountedRef.current) return;
      const isChannel = conv.type === 'channel';
      setChatInfo({
        name: conv.name || (isChannel ? 'Канал' : 'Группа'),
        avatar_url: conv.avatar_url,
        is_online: false,
        last_seen: null,
        other_user_id: null,
        type: isChannel ? 'channel' : 'group',
        member_count: members.length,
        description: conv.description || undefined,
        username: conv.username || undefined,
        is_verified: conv.is_verified || false,
      });
      if (isChannel) {
        const myMembership = members.find((m: any) => m.user_id === user.id);
        setMyChannelRoleEager(myMembership?.role || null);
        setChannelMuted(myMembership?.is_muted || false);
        if (conv.allowed_reactions) {
          setChannelAllowedReactions(conv.allowed_reactions as string[]);
        }
      }
    }
  };

  const enrichMessages = async (data: any[], senderMapOverride?: Map<string, any>): Promise<Message[]> => {
    const senderIds = [...new Set(data.map(m => m.sender_id))];
    const replyIds = data.filter(m => m.reply_to_id).map(m => m.reply_to_id);

    let senderMap = senderMapOverride;
    if (!senderMap) {
      const uncachedIds = senderIds.filter(id => !senderProfileCache.current.has(id));
      if (uncachedIds.length > 0) {
        const { data: senders } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .in('id', uncachedIds);
        (senders || []).forEach(s => senderProfileCache.current.set(s.id, s));
      }
      senderMap = new Map(senderIds.map(id => [id, senderProfileCache.current.get(id)]).filter(([, v]) => v) as [string, any][]);
    }

    let replyMap = new Map<string, { content: string; sender_name: string; message_type: string }>();
    if (replyIds.length > 0) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id, content, sender_id, message_type')
        .in('id', replyIds);
      if (replies) {
        replies.forEach(r => {
          const s = senderMap!.get(r.sender_id);
          replyMap.set(r.id, {
            content: r.content,
            sender_name: s?.display_name || 'Пользователь',
            message_type: r.message_type,
          });
        });
      }
    }

    return data.map((msg) => {
      const sender = senderMap!.get(msg.sender_id);
      return {
        ...msg,
        sender: sender ? { display_name: sender.display_name, avatar_url: sender.avatar_url } : undefined,
        reply_to: msg.reply_to_id ? replyMap.get(msg.reply_to_id) || null : null,
      };
    });
  };

  const loadReactions = async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const { data } = await supabase
      .from('message_reactions')
      .select('message_id, emoji, user_id')
      .in('message_id', messageIds);

    if (!data) return;
    const grouped = new Map<string, Reaction[]>();
    const byMsg = new Map<string, Map<string, { count: number; users: string[] }>>();

    data.forEach(r => {
      if (!byMsg.has(r.message_id)) byMsg.set(r.message_id, new Map());
      const emojiMap = byMsg.get(r.message_id)!;
      if (!emojiMap.has(r.emoji)) emojiMap.set(r.emoji, { count: 0, users: [] });
      const entry = emojiMap.get(r.emoji)!;
      entry.count++;
      entry.users.push(r.user_id);
    });

    byMsg.forEach((emojiMap, msgId) => {
      const reactions: Reaction[] = [];
      emojiMap.forEach((val, emoji) => {
        reactions.push({
          emoji,
          count: val.count,
          users: val.users,
          reacted: val.users.includes(user?.id || ''),
        });
      });
      grouped.set(msgId, sortReactions(reactions));
    });

    setReactionsMap(prev => {
      const next = new Map(prev);
      grouped.forEach((v, k) => next.set(k, v));
      messageIds.forEach(mid => {
        if (!grouped.has(mid)) next.delete(mid);
      });
      return next;
    });
  };

  const loadGroupMembers = async () => {
    if (!id || !user?.id) return;
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id, role')
      .eq('conversation_id', id);
    if (!members?.length) return;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_online, last_seen, privacy_settings')
      .in('id', members.map(m => m.user_id));

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    setGroupMembers(members.map(m => {
      const p = profileMap.get(m.user_id);
      const ps = p?.privacy_settings as { show_online?: boolean; show_last_seen?: boolean } | null;
      const isSelf = m.user_id === user.id;
      return {
        user_id: m.user_id,
        role: m.role,
        display_name: p?.display_name || 'Пользователь',
        avatar_url: p?.avatar_url || null,
        is_online: isSelf ? (p?.is_online || false) : (ps?.show_online === false ? false : (p?.is_online || false)),
        last_seen: isSelf ? (p?.last_seen || null) : (ps?.show_last_seen === false ? null : (p?.last_seen || null)),
      };
    }));
  };

  const handleOpenUserProfile = async () => {
    if (!chatInfo.other_user_id || chatInfo.type !== 'direct') return;
    const [profileRes, storiesRes, mediaRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('display_name, avatar_url, phone, status_text, is_online, last_seen, privacy_settings')
        .eq('id', chatInfo.other_user_id)
        .maybeSingle(),
      supabase
        .from('user_statuses')
        .select('id, content, media_url, media_type, background_color, text_color, created_at')
        .eq('user_id', chatInfo.other_user_id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('messages')
        .select('id, media_url, message_type, created_at, sender_id, media_duration')
        .eq('conversation_id', id)
        .in('message_type', ['image', 'video'])
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(60),
    ]);
    if (profileRes.data) {
      const mediaItems = (mediaRes.data || []).filter((m: any) => m.media_url);
      const senderIds = [...new Set(mediaItems.map((m: any) => m.sender_id))];
      let senderMap = new Map<string, string>();
      if (senderIds.length > 0) {
        const { data: senderProfiles } = await supabase.from('profiles').select('id, display_name').in('id', senderIds);
        senderMap = new Map((senderProfiles || []).map((p: any) => [p.id, p.display_name]));
      }
      const pps = profileRes.data?.privacy_settings;
      setUserProfileData({
        ...profileRes.data,
        is_online: pps?.show_online === false ? false : profileRes.data?.is_online,
        last_seen: pps?.show_last_seen === false ? null : profileRes.data?.last_seen,
        phone: pps?.show_phone === false ? '' : profileRes.data?.phone,
        stories: storiesRes.data || [],
        sharedPhotos: mediaItems.map((m: any) => ({
          id: m.id,
          media_url: m.media_url,
          message_type: m.message_type,
          created_at: m.created_at,
          sender_name: senderMap.get(m.sender_id) || 'Пользователь',
          media_duration: m.media_duration,
        })),
      });
      setShowUserProfile(true);
      setProfileAvatarFull(false);
      setProfileStoryView(null);
      setProfileMediaIndex(null);
    }
  };

  const loadSharedMedia = async () => {
    if (!id) return;
    const [mediaRes, linksRes] = await Promise.all([
      supabase
        .from('messages')
        .select('id, media_url, message_type, created_at, content, media_duration, sender_id')
        .eq('conversation_id', id)
        .in('message_type', ['image', 'video', 'file', 'voice'])
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('messages')
        .select('id, content, created_at, sender_id')
        .eq('conversation_id', id)
        .eq('message_type', 'text')
        .is('deleted_at', null)
        .ilike('content', '%http%')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const senderIds = new Set<string>();
    (mediaRes.data || []).forEach(m => senderIds.add(m.sender_id));
    (linksRes.data || []).forEach(m => senderIds.add(m.sender_id));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', [...senderIds]);
    const nameMap = new Map((profiles || []).map(p => [p.id, p.display_name]));

    setSharedMedia((mediaRes.data || []).map(m => ({
      ...m,
      sender_name: nameMap.get(m.sender_id) || '',
    })));

    const urlRegex = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/g;
    setSharedLinks(
      (linksRes.data || [])
        .filter(m => urlRegex.test(m.content || ''))
        .map(m => ({
          id: m.id,
          content: m.content || '',
          created_at: m.created_at,
          sender_name: nameMap.get(m.sender_id) || '',
        }))
    );
  };

  const handleOpenMediaGallery = () => {
    setShowChatMenu(false);
    setMediaTab('media');
    loadSharedMedia();
    setShowMediaGallery(true);
  };

  const handleOpenGroupInfo = () => {
    setShowChatMenu(false);
    loadGroupMembers();
    setShowGroupInfo(true);
  };

  const handleRemoveMember = async (userId: string) => {
    await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', id)
      .eq('user_id', userId);
    await supabase
      .from('channel_subscribers')
      .delete()
      .eq('channel_id', id)
      .eq('user_id', userId);
    setGroupMembers(prev => prev.filter(m => m.user_id !== userId));
    if (chatInfo.member_count) {
      setChatInfo(prev => ({ ...prev, member_count: (prev.member_count || 0) - 1 }));
    }
  };

  const handleSubscribeToChannel = async () => {
    if (!user || !id) return;
    setSubscribingToChannel(true);
    await supabase.from('channel_subscribers').insert({ channel_id: id, user_id: user.id });
    await supabase.from('conversation_members').insert({ conversation_id: id, user_id: user.id, role: 'member' });
    setMyChannelRoleEager('member');
    setChatInfo(prev => ({ ...prev, member_count: (prev.member_count || 0) + 1 }));
    setSubscribingToChannel(false);
    setShowJustSubscribed(true);
    setTimeout(() => setShowJustSubscribed(false), 5000);
    loadMessages();
  };

  const openStoryFromSnapshot = useCallback((snapshot: Message['status_snapshot']) => {
    if (!snapshot) return;
    const syntheticStatus: Status = {
      id: 'snapshot-preview',
      user_id: '',
      content: snapshot.content || null,
      media_url: snapshot.media_url || null,
      media_type: snapshot.media_type || null,
      background_color: snapshot.background_color || '#1E88E5',
      text_color: snapshot.text_color || '#FFFFFF',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      trim_start_pct: 0,
      trim_end_pct: 1,
    };
    setLiveStory({
      user: {
        user_id: '',
        display_name: snapshot.author_name || '',
        avatar_url: null,
        statuses: [syntheticStatus],
        viewed_all: true,
        viewedCount: 1,
      },
      index: 0,
    });
  }, []);

  const handleStoryQuoteTap = async (snapshot: Message['status_snapshot'], statusId: string | null) => {
    if (!statusId) {
      openStoryFromSnapshot(snapshot);
      return;
    }
    const { data: status } = await supabase
      .from('user_statuses')
      .select('*')
      .eq('id', statusId)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (status) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .eq('id', status.user_id)
        .maybeSingle();

      const { data: allStatuses } = await supabase
        .from('user_statuses')
        .select('*')
        .eq('user_id', status.user_id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });

      const statuses: Status[] = (allStatuses || []).map(s => ({
        ...s,
        trim_start_pct: (s as any).trim_start_pct ?? 0,
        trim_end_pct: (s as any).trim_end_pct ?? 1,
      }));
      const idx = statuses.findIndex(s => s.id === statusId);
      const { data: viewedData } = await supabase
        .from('status_views')
        .select('status_id')
        .eq('viewer_id', user?.id || '')
        .in('status_id', statuses.map(s => s.id));
      const viewedSet = new Set((viewedData || []).map(v => v.status_id));

      setLiveStory({
        user: {
          user_id: status.user_id,
          display_name: profile?.display_name || snapshot?.author_name || '',
          avatar_url: profile?.avatar_url || null,
          statuses,
          viewed_all: statuses.every(s => viewedSet.has(s.id)),
          viewedCount: statuses.filter(s => viewedSet.has(s.id)).length,
        },
        index: idx >= 0 ? idx : 0,
      });
    } else {
      openStoryFromSnapshot(snapshot);
    }
  };

  const showReadReceipts = async (msg: Message) => {
    if (!user) return;
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id, last_read_at')
      .eq('conversation_id', id)
      .neq('user_id', user.id);

    if (!members?.length) {
      setReadReceipts([]);
      setReadReceiptsModal(true);
      return;
    }

    const readMembers = members.filter(m => m.last_read_at && new Date(m.last_read_at) >= new Date(msg.created_at));
    const userIds = readMembers.map(m => m.user_id);

    if (userIds.length === 0) {
      setReadReceipts([]);
      setReadReceiptsModal(true);
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, privacy_settings')
      .in('id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const visibleReaders = readMembers.filter(m => {
      const p = profileMap.get(m.user_id);
      const ps = p?.privacy_settings as { show_read_receipts?: boolean } | null;
      return ps?.show_read_receipts !== false;
    });

    setReadReceipts(visibleReaders.map(m => ({
      name: profileMap.get(m.user_id)?.display_name || '',
      time: formatReadTime(m.last_read_at!),
    })));
    setReadReceiptsModal(true);
  };

  const formatReadTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins}м назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}ч назад`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const handleRenameGroup = async () => {
    if (!groupNameInput.trim() || !id) return;
    await supabase
      .from('conversations')
      .update({ name: groupNameInput.trim() })
      .eq('id', id);
    setChatInfo(prev => ({ ...prev, name: groupNameInput.trim() }));
    setEditingGroupName(false);
  };

  const webAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const avatarUploadResolveRef = useRef<((file: File | null) => void) | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.style.display = 'none';
    document.body.appendChild(input);
    webAvatarInputRef.current = input;
    input.addEventListener('change', () => {
      const f = input.files?.[0] ?? null;
      input.value = '';
      avatarUploadResolveRef.current?.(f && f.size <= 5 * 1024 * 1024 ? f : null);
      avatarUploadResolveRef.current = null;
    });
    return () => { document.body.removeChild(input); webAvatarInputRef.current = null; };
  }, []);

  const handleGroupAvatarUpload = async () => {
    if (!user || !id) return;
    const myRole = groupMembers.find(m => m.user_id === user.id)?.role;
    if (myRole !== 'admin' && myRole !== 'owner') return;
    try {
      let uploadData: File | ArrayBuffer | null = null;
      let contentType = 'image/jpeg';
      let ext = 'jpg';

      if (Platform.OS === 'web') {
        const file = await new Promise<File | null>((resolve) => {
          avatarUploadResolveRef.current = resolve;
          webAvatarInputRef.current?.click();
        });
        if (!file) return;
        uploadData = file;
        contentType = file.type;
        ext = file.name.split('.').pop() || 'jpg';
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.85,
          exif: false,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const pickedUri = result.assets[0].uri;
        const pathParts = pickedUri.split('.');
        ext = pathParts[pathParts.length - 1].split('?')[0] || 'jpg';
        contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

        const path = `${user.id}/group_${id}.${ext}`;
        const formData = new FormData();
        formData.append('', { uri: pickedUri, name: `group_${id}.${ext}`, type: contentType } as any);
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
        const session = (await supabase.auth.getSession()).data.session;
        const uploadResp = await fetch(`${supabaseUrl}/storage/v1/object/avatars/${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!}`,
            'x-upsert': 'true',
          },
          body: formData,
        });
        if (!uploadResp.ok) return;
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        if (data.publicUrl) {
          const avatarUrl = `${data.publicUrl}?t=${Date.now()}`;
          await supabase.from('conversations').update({ avatar_url: avatarUrl }).eq('id', id);
          setChatInfo(prev => ({ ...prev, avatar_url: avatarUrl }));
        }
        return;
      }

      const path = `${user.id}/group_${id}.${ext}`;
      const { error } = await supabase.storage.from('avatars').upload(path, uploadData!, { contentType, upsert: true });
      if (error) return;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      if (data.publicUrl) {
        const avatarUrl = `${data.publicUrl}?t=${Date.now()}`;
        await supabase.from('conversations').update({ avatar_url: avatarUrl }).eq('id', id);
        setChatInfo(prev => ({ ...prev, avatar_url: avatarUrl }));
      }
    } catch {}
  };

  const handleToggleAdmin = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    await supabase
      .from('conversation_members')
      .update({ role: newRole })
      .eq('conversation_id', id)
      .eq('user_id', userId);
    setGroupMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role: newRole } : m));
  };

  const handleLeaveGroup = async () => {
    if (!user || !id) return;
    await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', id)
      .eq('user_id', user.id);
    setShowGroupInfo(false);
    onBack ? onBack() : router.back();
  };

  const handleOpenAddMembers = async () => {
    if (!user?.id) return;
    const { data: contacts } = await supabase
      .from('contacts')
      .select('contact_id, profile:profiles!contacts_contact_id_fkey(id, display_name, avatar_url, is_online)')
      .eq('user_id', user.id);
    if (!contacts) return;

    const existingIds = new Set(groupMembers.map(m => m.user_id));
    const available = contacts
      .map((c: any) => {
        const p = Array.isArray(c.profile) ? c.profile[0] : c.profile;
        return p ? { id: p.id, display_name: p.display_name, avatar_url: p.avatar_url, is_online: p.is_online } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null && !existingIds.has(p.id));

    setAddMemberContacts(available);
    setAddMemberSearch('');
    setShowAddMembers(true);
  };

  const handleAddMember = async (contactId: string) => {
    if (!id || addingMemberIds.has(contactId)) return;
    setAddingMemberIds(prev => new Set(prev).add(contactId));

    const { error } = await supabase.from('conversation_members').insert({
      conversation_id: id,
      user_id: contactId,
      role: 'member',
    });

    if (!error) {
      if (chatInfo.type === 'channel') {
        await supabase.from('channel_subscribers').insert({ channel_id: id, user_id: contactId }).then(r => {
          if (r.error && r.error.code !== '23505') console.warn('channel_subscribers insert:', r.error.message);
        });
      }
      const added = addMemberContacts.find(c => c.id === contactId);
      if (added) {
        setGroupMembers(prev => [...prev, {
          user_id: added.id,
          role: 'member',
          display_name: added.display_name,
          avatar_url: added.avatar_url,
          is_online: added.is_online,
          last_seen: null,
        }]);
        setChatInfo(prev => ({ ...prev, member_count: (prev.member_count || 0) + 1 }));
      }
      setAddMemberContacts(prev => prev.filter(c => c.id !== contactId));
    }

    setAddingMemberIds(prev => {
      const next = new Set(prev);
      next.delete(contactId);
      return next;
    });
  };

  const handleToggleChannelMute = async () => {
    if (!id || !user?.id) return;
    if (channelMuted) {
      setChannelMuted(false);
      await supabase
        .from('conversation_members')
        .update({ is_muted: false, muted_until: null })
        .eq('conversation_id', id)
        .eq('user_id', user.id);
    } else {
      setChannelMuteSheet(true);
    }
  };

  const handleMuteChannelFor = async (hours: number | null) => {
    if (!id || !user?.id) return;
    setChannelMuteSheet(false);
    setChannelMuted(true);
    const muted_until = hours ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null;
    await supabase
      .from('conversation_members')
      .update({ is_muted: true, muted_until })
      .eq('conversation_id', id)
      .eq('user_id', user.id);
  };

  const handleUnsubscribeChannel = async () => {
    if (!id || !user?.id) return;
    try {
      const { error: subErr } = await supabase.from('channel_subscribers').delete().eq('channel_id', id).eq('user_id', user.id);
      if (subErr) throw subErr;
      const { error: memErr } = await supabase.from('conversation_members').delete().eq('conversation_id', id).eq('user_id', user.id);
      if (memErr) throw memErr;
      router.back();
    } catch (e) {
      console.error('Unsubscribe error:', e);
    }
  };

  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyInviteLink = async () => {
    const link = chatInfo.username
      ? `https://vaychat.net/@${chatInfo.username}`
      : `https://vaychat.net/channel/${id}`;
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(link);
      } else {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.setStringAsync(link);
      }
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {}
  };

  const handleShareChannel = async () => {
    const link = chatInfo.username
      ? `https://vaychat.net/@${chatInfo.username}`
      : `https://vaychat.net/channel/${id}`;

    if (Platform.OS !== 'web') {
      try {
        const { Share: RNShare } = await import('react-native');
        await RNShare.share({ message: `${chatInfo.name}: ${link}` });
      } catch {}
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: chatInfo.name, url: link });
        return;
      } catch {}
    }

    let copied = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {}
    }
    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = link;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {}
    }
    if (!copied) {
      if (typeof window !== 'undefined') {
        window.prompt('Скопируйте ссылку:', link);
      }
      return;
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  };

  const loadMessages = async () => {
    if (!id || !user) {
      if (mountedRef.current) setInitialLoaded(true);
      return;
    }

    const allProfiles = dataCache.getAllProfiles();
    allProfiles.forEach(p => {
      if (!senderProfileCache.current.has(p.id)) {
        senderProfileCache.current.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
      }
    });

    const [messagesResult, memberResult, otherMembersResult] = await Promise.all([
      supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from('conversation_members')
        .select('last_read_at')
        .eq('conversation_id', id)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('conversation_members')
        .select('last_read_at')
        .eq('conversation_id', id)
        .neq('user_id', user.id)
        .order('last_read_at', { ascending: false })
        .limit(1),
    ]);

    if (messagesResult.error) {
      console.error('loadMessages error:', messagesResult.error.message);
      if (mountedRef.current) setInitialLoaded(true);
      return;
    }

    if (!mountedRef.current) return;

    const data = messagesResult.data;
    const memberData = memberResult.data;

    if (data) {
      const reversed = [...data].reverse();
      setHasMore(data.length === PAGE_SIZE);
      const enriched = await enrichMessages(reversed);
      const decrypted = await Promise.all(enriched.map(async (m) => {
        if (m.message_type === 'text' && isEncryptedMessage(m.content) && peerPublicKeyRef.current) {
          return { ...m, content: await decryptMessage(peerPublicKeyRef.current, m.content), is_e2e: true };
        }
        return m;
      }));
      const lastRead = memberData?.last_read_at;
      if (lastRead) {
        const idx = decrypted.findIndex(m => m.sender_id !== user.id && new Date(m.created_at) > new Date(lastRead));
        firstUnreadIndex.current = idx;
        if (idx >= 0) {
          const { count: realCount } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', id)
            .neq('sender_id', user.id)
            .is('deleted_at', null)
            .gt('created_at', lastRead);
          dbUnreadCount.current = realCount ?? -1;
        }
      }

      const hadCachedMessages = messages.length > 0;
      if (!hadCachedMessages) {
        initialScrollDone.current = false;
        pendingScrollToEnd.current = true;
        lastContentHeight.current = 0;
      }
      setMessages(decrypted);
      await loadReactions(decrypted.map(m => m.id));

      dataCache.setMessages(id as string, decrypted.map(m => ({
        id: m.id,
        sender_id: m.sender_id,
        content: m.content,
        message_type: m.message_type,
        media_url: m.media_url,
        media_duration: m.media_duration,
        created_at: m.created_at,
        is_read: m.is_read,
        reply_to_id: m.reply_to_id,
        edited_at: m.edited_at,
        is_pinned: m.is_pinned,
        expires_at: m.expires_at,
        deleted_at: m.deleted_at,
        forwarded_from_id: m.forwarded_from_id,
        status_id: m.status_id || null,
        status_snapshot: m.status_snapshot || null,
        media_group_id: (m as any).media_group_id || null,
      })));

      if (otherMembersResult.data?.[0]?.last_read_at) {
        setOtherLastRead(otherMembersResult.data[0].last_read_at);
      }
    }
    setInitialLoaded(true);
  };

  const loadChannelViewCounts = useCallback(async (messageIds: string[]) => {
    if (!messageIds.length) return;
    const { data } = await supabase.rpc('get_message_view_counts', { p_message_ids: messageIds });
    if (data) {
      data.forEach((row: { message_id: string; view_count: number }) => {
        viewCountsRef.current.set(row.message_id, row.view_count);
      });
      setViewCountsTick(t => t + 1);
    }
  }, []);

  const recordChannelViews = useCallback(async (messageIds: string[]) => {
    if (!user?.id) return;
    const newIds = messageIds.filter(mid => !viewedMsgIdsRef.current.has(mid));
    if (!newIds.length) return;
    newIds.forEach(mid => viewedMsgIdsRef.current.add(mid));
    const rows = newIds.map(mid => ({ message_id: mid, user_id: user.id }));
    await supabase.from('message_views').upsert(rows, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
    newIds.forEach(mid => {
      viewCountsRef.current.set(mid, (viewCountsRef.current.get(mid) || 0) + 1);
    });
    setViewCountsTick(t => t + 1);
  }, [user?.id]);

  const loadStarredMessages = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('starred_messages')
      .select('message_id')
      .eq('user_id', user.id);
    if (data) {
      setStarredMessageIds(new Set(data.map(s => s.message_id)));
    }
  };

  useEffect(() => {
    if (user) loadStarredMessages();
  }, [user]);

  useEffect(() => {
    if (chatInfo.type !== 'channel' || !user?.id || !messages.length) return;
    const msgIds = messages.map(m => m.id);
    loadChannelViewCounts(msgIds);
    recordChannelViews(msgIds);
  }, [chatInfo.type, user?.id, messages.length, loadChannelViewCounts, recordChannelViews]);

  const toggleStarMessage = async (messageId: string) => {
    if (!user) return;
    setSelectedMessage(null);
    const isStarred = starredMessageIds.has(messageId);
    if (isStarred) {
      await supabase
        .from('starred_messages')
        .delete()
        .eq('user_id', user.id)
        .eq('message_id', messageId);
      setStarredMessageIds(prev => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    } else {
      await supabase
        .from('starred_messages')
        .insert({ user_id: user.id, message_id: messageId });
      setStarredMessageIds(prev => new Set([...prev, messageId]));
    }
  };

  const toggleSelect = (msgId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const bulkDelete = async () => {
    if (!user) return;
    const idsToDelete = [...selectedIds];
    if (idsToDelete.length > 0) {
      setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
      await supabase
        .from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', idsToDelete);
    }
    exitSelectMode();
  };

  const bulkStar = async () => {
    if (!user) return;
    const idsArr = [...selectedIds];
    const toStar = idsArr.filter(id => !starredMessageIds.has(id));
    if (toStar.length > 0) {
      await supabase
        .from('starred_messages')
        .insert(toStar.map(mid => ({ user_id: user.id, message_id: mid })));
      setStarredMessageIds(prev => new Set([...prev, ...toStar]));
    }
    exitSelectMode();
  };

  const bulkForward = () => {
    const selected = messages.filter(m => selectedIds.has(m.id)).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (selected.length > 0) {
      setForwardMessages(selected);
      setForwardMessage(selected[0]);
      setShowForwardModal(true);
      loadConversationsForForward();
    }
    exitSelectMode();
  };

  const bulkSaveToFavorites = async () => {
    if (!user) return;
    const savedConvId = await getOrCreateSavedConversation();
    if (!savedConvId) { exitSelectMode(); return; }
    const selectedMsgs = messages.filter(m => selectedIds.has(m.id));
    for (const msg of selectedMsgs) {
      await supabase.from('messages').insert({
        conversation_id: savedConvId,
        sender_id: user.id,
        content: msg.message_type === 'voice' ? '' : msg.content,
        message_type: msg.message_type,
        media_url: msg.media_url || null,
        media_duration: msg.media_duration || 0,
        forwarded_from_id: msg.id,
        is_read: true,
      });
    }
    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', savedConvId);
    exitSelectMode();
  };

  const loadOlderMessages = async () => {
    if (!id || !hasMore || loadingMore || messages.length === 0) return;
    if (Platform.OS !== 'ios') {
      preLoadMoreSnapshot.current = {
        offset: currentScrollOffsetRef.current,
        contentHeight: lastContentHeight.current,
      };
    }
    setLoadingMore(true);

    const oldest = messages[0];
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .is('deleted_at', null)
      .lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (data && data.length > 0) {
      const reversed = [...data].reverse();
      setHasMore(data.length === PAGE_SIZE);
      const enriched = await enrichMessages(reversed);
      setMessages(prev => [...enriched, ...prev]);
      loadReactions(enriched.map(m => m.id));
      if (chatInfo.type === 'channel') {
        const newIds = enriched.map(m => m.id);
        loadChannelViewCounts(newIds);
        recordChannelViews(newIds);
      }
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  const loadPinnedMessage = async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .eq('is_pinned', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error || !mountedRef.current) {
      if (error) console.error('loadPinnedMessage error:', error.message);
      return;
    }

    if (data && data.length > 0) {
      const senderIds = [...new Set(data.map(m => m.sender_id))];
      const { data: senders, error: sendersError } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', senderIds);
      if (sendersError || !mountedRef.current) {
        if (sendersError) console.error('loadPinnedMessage senders error:', sendersError.message);
        return;
      }
      const senderMap = new Map((senders || []).map(s => [s.id, s]));
      const enriched = data.map(m => ({ ...m, sender: senderMap.get(m.sender_id) || undefined }));
      setPinnedMessage(enriched[0]);
      setAllPinnedMessages(enriched);
    } else {
      setPinnedMessage(null);
      setAllPinnedMessages([]);
    }
  };

  const markAsRead = useCallback(async () => {
    if (!user || !id) return;
    if (myPrivacy?.show_read_receipts === false) return;
    const memberUpdate = supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', id)
      .eq('user_id', user.id);
    if (chatInfo.type !== 'channel') {
      await Promise.all([
        memberUpdate,
        supabase
          .from('messages')
          .update({ is_read: true })
          .eq('conversation_id', id)
          .neq('sender_id', user.id)
          .eq('is_read', false),
      ]);
    } else {
      await memberUpdate;
    }
    updateBadgeCount(user.id);
  }, [user, id, chatInfo.type, myPrivacy]);
  // Stable ref so scroll handlers don't recreate on every render
  const markAsReadRef = useRef(markAsRead);
  markAsReadRef.current = markAsRead;

  const lastTrackRef = useRef(0);
  const markAsReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedMarkAsRead = useCallback(() => {
    if (markAsReadTimerRef.current) clearTimeout(markAsReadTimerRef.current);
    markAsReadTimerRef.current = setTimeout(() => {
      markAsRead();
    }, 300);
  }, [markAsRead]);
  const broadcastTyping = (activity: 'typing' | 'voice' | 'media' = 'typing') => {
    if (!user || !id || !presenceChannelRef.current || chatInfo.type === 'saved') return;
    if (myPrivacy?.show_typing === false) return;
    const now = Date.now();
    if (now - lastTrackRef.current < 2000) return;
    lastTrackRef.current = now;
    const ch = presenceChannelRef.current;
    ch.track({
      typing: true,
      activity,
      name: myDisplayNameRef.current || user.email?.split('@')[0] || 'Пользователь',
    });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (presenceChannelRef.current) {
        presenceChannelRef.current.track({ typing: false });
      }
    }, activity === 'typing' ? 3000 : 5000);
  };

  const resolvedIdsRef = useRef<Set<string>>(new Set());
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  useEffect(() => {
    setPendingQueueCount(getQueuedCount(id as string));
    const unsub = onQueueEvent((event: QueueEvent) => {
      if (event.type === 'sent' && event.conversationId === id) {
        resolvedIdsRef.current.add(event.insertedId);
        setFailedMsgIds(prev => { const n = new Set(prev); n.delete(event.tempId); return n; });
        setMessages(prev => prev.map(m =>
          m.id === event.tempId ? { ...m, id: event.insertedId, created_at: event.createdAt } : m
        ));
      } else if (event.type === 'failed' && event.conversationId === id) {
        setFailedMsgIds(prev => new Set(prev).add(event.tempId));
      } else if (event.type === 'removed' && event.conversationId === id) {
        setMessages(prev => prev.filter(m => m.id !== event.tempId));
        setFailedMsgIds(prev => { const n = new Set(prev); n.delete(event.tempId); return n; });
      }
      if (event.type === 'queue_changed' || event.type === 'sent' || event.type === 'removed') {
        setPendingQueueCount(getQueuedCount(id as string));
      }
    });
    return unsub;
  }, [id]);

  const sendMessage = async (type: 'text' | 'image' | 'video' | 'voice' | 'file' | 'location' | 'video_note' | 'contact' = 'text', mediaUrl?: string, duration?: number, textContent?: string) => {
    if (!user || !id) return;
    const effectiveText = textContent !== undefined ? textContent : input.trim();
    if (type === 'text' && !effectiveText) return;

    const rawContent = type === 'text' ? effectiveText : (textContent || '');
    const content = (type === 'text' && e2eActive && peerPublicKey) ? await encryptMessage(peerPublicKey, rawContent) : rawContent;
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const now = new Date().toISOString();

    if (textContent === undefined) {
      setInput('');
      clearDraft(id as string);
    }
    const currentReply = replyTo;
    setReplyTo(null);

    // Stop typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (presenceChannelRef.current) {
      presenceChannelRef.current.track({ typing: false });
    }

    const optimisticMsg: Message = {
      id: tempId,
      sender_id: user.id,
      content: rawContent,
      message_type: type,
      media_url: mediaUrl || null,
      media_duration: duration || 0,
      created_at: now,
      is_read: false,
      reply_to_id: currentReply?.id || null,
      edited_at: null,
      is_pinned: false,
      expires_at: null,
      deleted_at: null,
      forwarded_from_id: null,
      status_id: null,
      status_snapshot: null,
      reply_to: currentReply ? {
        content: currentReply.content,
        sender_name: currentReply.sender?.display_name || 'Пользователь',
        message_type: currentReply.message_type,
      } : null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    playSendSound();
    hapticMedium();
    setUnreadScrollCount(0);
    isNearBottom.current = true;
    justSentRef.current = true;
    // RAF fires after React commits the optimistic message to the DOM.
    // Primary path: onContentSizeChange fires via justSentRef before this.
    // Fallback: this snaps to bottom if onContentSizeChange didn't clear the flag.
    requestAnimationFrame(() => {
      if (justSentRef.current) {
        justSentRef.current = false;
        scrollToBottomNow();
      }
    });

    const expiresAt = disappearTimer > 0 ? new Date(Date.now() + disappearTimer * 1000).toISOString() : null;

    const payload = {
      conversation_id: id,
      sender_id: user.id,
      content,
      message_type: type,
      media_url: mediaUrl || null,
      media_duration: duration || 0,
      reply_to_id: currentReply?.id || null,
      is_read: chatInfo.type === 'saved' ? true : false,
      expires_at: expiresAt,
    };

    if (!isConnected) {
      enqueueMessage(id as string, payload, tempId);
      setFailedMsgIds(prev => new Set(prev).add(tempId));
      return;
    }

    const { data: inserted, error } = await supabase.from('messages')
      .insert(payload)
      .select('id, created_at')
      .single();

    if (error) {
      enqueueMessage(id as string, payload, tempId);
      setFailedMsgIds(prev => new Set(prev).add(tempId));
      return;
    }

    if (inserted) {
      resolvedIdsRef.current.add(inserted.id);
      setMessages((prev) =>
        prev.map((m) => m.id === tempId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m)
      );
    }

    supabase.from('conversations').update({ updated_at: now }).eq('id', id).then(null, () => {});
  };

  const sendStickerMessage = async (stickerText: string) => {
    if (!user || !id) return;
    playSendSound();
    hapticMedium();
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const now = new Date().toISOString();

    const optimisticMsg: Message = {
      id: tempId,
      sender_id: user.id,
      content: stickerText,
      message_type: 'text',
      media_url: null,
      media_duration: 0,
      created_at: now,
      is_read: false,
      reply_to_id: null,
      edited_at: null,
      is_pinned: false,
      expires_at: null,
      deleted_at: null,
      forwarded_from_id: null,
      status_id: null,
      status_snapshot: null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    isNearBottom.current = true;
    justSentRef.current = true;
    requestAnimationFrame(() => {
      if (justSentRef.current) {
        justSentRef.current = false;
        scrollToBottomNow();
      }
    });

    const expiresAt = disappearTimer > 0 ? new Date(Date.now() + disappearTimer * 1000).toISOString() : null;
    const payload = {
      conversation_id: id,
      sender_id: user.id,
      content: stickerText,
      message_type: 'text',
      media_url: null,
      media_duration: 0,
      reply_to_id: null,
      is_read: false,
      expires_at: expiresAt,
    };

    if (!isConnected) {
      enqueueMessage(id as string, payload, tempId);
      return;
    }

    const { data: inserted, error } = await supabase.from('messages')
      .insert(payload)
      .select('id, created_at')
      .single();

    if (error) {
      enqueueMessage(id as string, payload, tempId);
      setFailedMsgIds(prev => new Set(prev).add(tempId));
      return;
    }

    if (inserted) {
      resolvedIdsRef.current.add(inserted.id);
      setMessages((prev) =>
        prev.map((m) => m.id === tempId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m)
      );
    }

    supabase.from('conversations').update({ updated_at: now }).eq('id', id).then(null, () => {});
  };

  const editMessage = async () => {
    if (!editingMessage) return;
    const isMedia = editingMessage.message_type === 'image' || editingMessage.message_type === 'video';
    const trimmed = input.trim();
    if (!isMedia && !trimmed) return;
    const newContent = isMedia ? trimmed : trimmed;
    await supabase
      .from('messages')
      .update({ content: newContent, edited_at: new Date().toISOString() })
      .eq('id', editingMessage.id);

    setMessages((prev) => prev.map((m) =>
      m.id === editingMessage.id ? { ...m, content: newContent, edited_at: new Date().toISOString() } : m
    ));
    setEditingMessage(null);
    setInput('');
  };

  const deleteMessage = async (msg: Message) => {
    setSelectedMessage(null);
    if (voicePlayer.state.track?.id === msg.id) {
      voicePlayer.stop();
    }
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    const { error } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', msg.id);
    if (error) {
      const enriched = (await enrichMessages([msg]))[0];
      setMessages((prev) => [...prev, enriched].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ));
    }
  };

  const pinMessage = async (msg: Message) => {
    const newPinned = !msg.is_pinned;
    setSelectedMessage(null);
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_pinned: newPinned } : m));
    if (newPinned) {
      setPinnedMessage({ ...msg, is_pinned: true });
      setAllPinnedMessages((prev) => [{ ...msg, is_pinned: true }, ...prev]);
    } else {
      setAllPinnedMessages((prev) => prev.filter((m) => m.id !== msg.id));
      setPinnedMessage((prev) => prev?.id === msg.id ? null : prev);
    }
    const { error } = await supabase
      .from('messages')
      .update({ is_pinned: newPinned })
      .eq('id', msg.id);
    if (error) {
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_pinned: !newPinned } : m));
      await loadPinnedMessage();
    }
  };

  const exportChat = async () => {
    const lines = messages.map(msg => {
      const name = msg.sender?.display_name || (msg.sender_id === user?.id ? 'Вы' : 'Пользователь');
      const time = new Date(msg.created_at).toLocaleString('ru-RU');
      let content = msg.content;
      if (msg.message_type === 'voice') content = '[Голосовое сообщение]';
      else if (msg.message_type === 'image') content = '[Фото]';
      else if (msg.message_type === 'video') content = '[Видео]';
      else if (msg.message_type === 'file') content = '[Файл]';
      else if (msg.message_type === 'video_note') content = '[Видеокружок]';
      else if (msg.message_type === 'contact') content = '[Контакт]';
      else if (msg.message_type === 'location') content = '[Геолокация]';
      if (msg.deleted_at) content = '[Удалено]';
      return `[${time}] ${name}: ${content}`;
    });
    const header = `Чат: ${chatInfo.name}\nЭкспорт: ${new Date().toLocaleString('ru-RU')}\n${'='.repeat(50)}\n`;
    const text = header + lines.join('\n');

    if (Platform.OS === 'web') {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${chatInfo.name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const filename = `chat-${chatInfo.name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.txt`;
      const cacheDir = (FileSystem as any).cacheDirectory ?? ((FileSystem as any).default?.cacheDirectory ?? '');
      const fileUri = `${cacheDir}${filename}`;
      const encoding = (FileSystem as any).EncodingType?.UTF8 ?? 'utf8';
      await FileSystem.writeAsStringAsync(fileUri, text, { encoding });
      await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'Экспорт чата' });
    }
    setShowChatMenu(false);
  };

  const galleryItems = useMemo(() => {
    return messages
      .filter(m => !m.deleted_at && (m.message_type === 'image' || m.message_type === 'video') && m.media_url)
      .map(m => ({
        id: m.id,
        url: m.media_url!,
        type: m.message_type as 'image' | 'video',
        senderName: m.sender?.display_name || undefined,
        date: m.created_at,
        caption: m.content || undefined,
        duration: (m as any).duration || undefined,
      }));
  }, [messages]);

  const openGalleryViewer = useCallback((messageId: string) => {
    const idx = galleryItems.findIndex(g => g.id === messageId);
    if (idx >= 0) {
      setGalleryInitialIndex(idx);
      setGalleryViewerOpen(true);
    }
  }, [galleryItems]);

  const downloadMedia = async (url: string, type: 'image' | 'video') => {
    try {
      if (Platform.OS === 'web') {
        const res = await fetch(url);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        const ext = type === 'video' ? 'mp4' : 'jpg';
        a.download = `vaychat_${Date.now()}.${ext}`;
        a.click();
        URL.revokeObjectURL(blobUrl);
      } else {
        const MediaLibrary = require('expo-media-library');
        const { Alert: NativeAlert } = require('react-native');

        // Request permission to save to gallery
        const { status } = await MediaLibrary.requestPermissionsAsync();

        const ext = type === 'video' ? 'mp4' : 'jpg';
        const nativeCacheDir = (FileSystem as any).cacheDirectory ?? '';
        const fileUri = `${nativeCacheDir}vaychat_${Date.now()}.${ext}`;
        const { uri } = await FileSystem.downloadAsync(url, fileUri);

        if (status === 'granted') {
          // Save directly to the device gallery
          await MediaLibrary.saveToLibraryAsync(uri);
          NativeAlert.alert('Сохранено', type === 'video' ? 'Видео сохранено в галерею' : 'Фото сохранено в галерею');
        } else {
          // Permission denied — fall back to share sheet
          await Sharing.shareAsync(uri, {
            mimeType: type === 'video' ? 'video/mp4' : 'image/jpeg',
            dialogTitle: 'Сохранить',
          });
        }

        // Cleanup temp file after a short delay
        setTimeout(() => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}), 10000);
      }
    } catch (e: any) {
      if (Platform.OS !== 'web') {
        const { Alert: NativeAlert } = require('react-native');
        NativeAlert.alert('Ошибка', 'Не удалось сохранить файл');
      }
    }
  };

  const forwardToConversation = async (convId: string) => {
    if (!user) return;
    const msgsToForward = forwardMessages.length > 0 ? forwardMessages : (forwardMessage ? [forwardMessage] : []);
    if (msgsToForward.length === 0) return;

    for (const msg of msgsToForward) {
      const insertData: any = {
        conversation_id: convId,
        sender_id: user.id,
        content: msg.message_type === 'voice' ? '' : msg.content,
        message_type: msg.message_type,
        media_url: msg.media_url || null,
        media_duration: msg.media_duration || 0,
        forwarded_from_id: msg.id,
        is_read: false,
      };

      const { error } = await supabase.from('messages').insert(insertData);
      if (error) {
        console.error('forwardToConversation error:', error.message);
        if (Platform.OS === 'web') {
          alert('Не удалось переслать сообщение');
        } else {
          const { Alert: NativeAlert } = require('react-native');
          NativeAlert.alert('Ошибка', 'Не удалось переслать сообщение');
        }
        return;
      }
    }

    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);

    setShowForwardModal(false);
    setForwardMessage(null);
    setForwardMessages([]);
    setSelectedMessage(null);
  };

  const getOrCreateSavedConversation = async (): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase.rpc('get_or_create_saved_conversation');
    if (error || !data) return null;
    return data;
  };

  const forwardToSaved = async (msg: Message) => {
    if (!user) return;
    const savedConvId = await getOrCreateSavedConversation();
    if (!savedConvId) return;

    await supabase.from('messages').insert({
      conversation_id: savedConvId,
      sender_id: user.id,
      content: msg.message_type === 'voice' ? '' : msg.content,
      message_type: msg.message_type,
      media_url: msg.media_url || null,
      media_duration: msg.media_duration || 0,
      forwarded_from_id: msg.id,
      is_read: true,
    });
    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', savedConvId);
    setSelectedMessage(null);
  };

  const loadConversationsForForward = async () => {
    if (!user) return;
    const { data: memberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (!memberships) return;
    const convIds = memberships.map(m => m.conversation_id).filter(cid => cid !== id);

    const result: {id: string; name: string; isSaved?: boolean}[] = [];

    if (convIds.length > 0) {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, name, type')
        .in('id', convIds);

      if (convs) {
        const savedConv = convs.find(c => c.type === 'saved');
        if (savedConv) {
          result.push({ id: savedConv.id, name: 'Избранное', isSaved: true });
        } else {
          const savedId = await getOrCreateSavedConversation();
          if (savedId) result.push({ id: savedId, name: 'Избранное', isSaved: true });
        }

        for (const c of convs) {
          if (c.type === 'saved') continue;
          if (c.type === 'group') {
            result.push({ id: c.id, name: c.name || 'Группа' });
          } else {
            const { data: otherMember } = await supabase
              .from('conversation_members')
              .select('user_id')
              .eq('conversation_id', c.id)
              .neq('user_id', user.id)
              .maybeSingle();
            if (otherMember) {
              const { data: prof } = await supabase
                .from('profiles')
                .select('display_name')
                .eq('id', otherMember.user_id)
                .maybeSingle();
              result.push({ id: c.id, name: prof?.display_name || 'Чат' });
            }
          }
        }
      }
    } else {
      const savedId = await getOrCreateSavedConversation();
      if (savedId) result.push({ id: savedId, name: 'Избранное', isSaved: true });
    }

    setConversations(result);
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;
    const current = reactionsMap.get(messageId) || [];
    const existing = current.find(r => r.emoji === emoji && r.reacted);

    // Optimistic update
    setReactionsMap(prev => {
      const next = new Map(prev);
      const reactions = [...(next.get(messageId) || [])];

      if (existing) {
        const idx = reactions.findIndex(r => r.emoji === emoji);
        if (idx >= 0) {
          if (!reactions[idx].users.includes(user.id)) return prev;
          if (reactions[idx].count <= 1) {
            reactions.splice(idx, 1);
          } else {
            reactions[idx] = { ...reactions[idx], count: reactions[idx].count - 1, reacted: false, users: reactions[idx].users.filter(u => u !== user.id) };
          }
        }
      } else {
        const idx = reactions.findIndex(r => r.emoji === emoji);
        if (idx >= 0) {
          if (reactions[idx].users.includes(user.id)) return prev;
          reactions[idx] = { ...reactions[idx], count: reactions[idx].count + 1, reacted: true, users: [...reactions[idx].users, user.id] };
        } else {
          reactions.push({ emoji, count: 1, reacted: true, users: [user.id] });
        }
      }

      next.set(messageId, sortReactions(reactions));
      return next;
    });
    setShowReactionPicker(null);

    if (existing) {
      await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', user.id)
        .eq('emoji', emoji);
    } else {
      await supabase
        .from('message_reactions')
        .insert({ message_id: messageId, user_id: user.id, emoji });
    }
  };

  const copyMessage = async (msg: Message) => {
    if (Platform.OS === 'web') {
      navigator.clipboard.writeText(msg.content);
    } else {
      await Clipboard.setStringAsync(msg.content);
    }
    setSelectedMessage(null);
  };

  const compressImage = (file: File, maxWidth = 2560, quality = 0.85): Promise<File> => {
    return new Promise((resolve) => {
      if (Platform.OS !== 'web' || !file.type.startsWith('image/') || file.type === 'image/gif') {
        resolve(file);
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxWidth && file.size < 200_000) {
          resolve(file);
          return;
        }
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  };

  const uploadFile = async (fileInput: File | string, skipCompression = false, forceExt?: string): Promise<string | null> => {
    if (!user) return null;
    try {
      let ext: string;
      let uploadData: File | ArrayBuffer;
      let contentType: string;

      if (typeof fileInput === 'string') {
        let uri = fileInput;
        const mimeTypes: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4',
          mov: 'video/quicktime',
          m4a: 'audio/mp4', caf: 'audio/x-caf', aac: 'audio/aac',
          ogg: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm',
        };
        if (forceExt) {
          ext = forceExt;
        } else {
          const pathParts = uri.split('.');
          const rawExt = pathParts.length > 1 ? pathParts[pathParts.length - 1].split('?')[0].split('/')[0] : '';
          ext = rawExt || 'bin';
        }
        contentType = mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
        if (!skipCompression && Platform.OS !== 'web' && ['jpg', 'jpeg', 'png', 'webp'].includes(ext.toLowerCase())) {
          try {
            const manipResult = await ImageManipulator.manipulateAsync(
              uri,
              [{ resize: { width: 2560 } }],
              { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
            );
            uri = manipResult.uri;
            ext = 'jpg';
            contentType = 'image/jpeg';
          } catch {}
        }

        if (Platform.OS !== 'web') {
          const fileInfo = await FileSystem.getInfoAsync(uri);
          if (!fileInfo.exists) {
            console.warn('[uploadFile] File does not exist:', uri);
            return null;
          }
          if ('size' in fileInfo && fileInfo.size !== undefined && fileInfo.size === 0) {
            console.warn('[uploadFile] File is empty (0 bytes):', uri);
            return null;
          }
          const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const formData = new FormData();
          formData.append('', {
            uri,
            name: path.split('/').pop()!,
            type: contentType,
          } as any);
          const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
          const session = (await supabase.auth.getSession()).data.session;
          const uploadResp = await fetch(`${supabaseUrl}/storage/v1/object/chat-media/${path}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!}`,
              'x-upsert': 'true',
            },
            body: formData,
          });
          if (!uploadResp.ok) {
            const errText = await uploadResp.text().catch(() => '');
            console.warn('[uploadFile] Native upload error:', uploadResp.status, errText);
            return null;
          }
          const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
          return data.publicUrl;
        } else {
          const response = await fetch(uri);
          const blob = await response.blob();
          if (blob.size < 100 && contentType.startsWith('video/')) {
            console.warn('[uploadFile] Blob too small for video:', blob.size);
            return null;
          }
          uploadData = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
          });
        }
      } else {
        const processed = !skipCompression && fileInput.type.startsWith('image/') && Platform.OS === 'web' ? await compressImage(fileInput) : fileInput;
        ext = processed.name.split('.').pop() || 'bin';
        uploadData = processed;
        contentType = processed.type;
      }

      const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from('chat-media')
        .upload(path, uploadData, { contentType });
      if (error) {
        console.warn('[uploadFile] Storage upload error:', error.message);
        return null;
      }
      const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
      return data.publicUrl;
    } catch (err) {
      console.warn('[uploadFile] Exception:', err);
      return null;
    }
  };

  const processWebFiles = useCallback(async (files: File[], mode: 'pick' | 'add') => {
    if (files.length === 0) return;
    if (mode === 'pick') {
      const selected = files.slice(0, 10);
      const previewAssets: PreviewAsset[] = await Promise.all(
        selected.map(async (file, i) => {
          const uri = URL.createObjectURL(file);
          let width: number | undefined;
          let height: number | undefined;
          if (file.type.startsWith('image/')) {
            try {
              const HtmlImg = (window.Image || globalThis.Image) as typeof HTMLImageElement;
              const img = new HtmlImg();
              await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = uri; });
              width = img.naturalWidth;
              height = img.naturalHeight;
            } catch {}
          }
          return {
            id: `web-${Date.now()}-${i}`,
            uri,
            mediaType: file.type.startsWith('video') ? 'video' as const : 'photo' as const,
            width,
            height,
            _file: file,
          } as any;
        })
      );
      setPhotoPreviewAssets(previewAssets);
      setShowPhotoPreview(true);
    } else {
      const remaining = 10 - photoPreviewAssetsRef.current.length;
      const selected = files.slice(0, remaining);
      const newAssets: PreviewAsset[] = selected.map((file, i) => ({
        id: `web-${Date.now()}-${i}`,
        uri: URL.createObjectURL(file),
        mediaType: file.type.startsWith('video') ? 'video' as const : 'photo' as const,
        _file: file,
      } as any));
      setPhotoPreviewAssets(prev => [...prev, ...newAssets]);
    }
  }, []);

  const photoPreviewAssetsRef = useRef(photoPreviewAssets);
  photoPreviewAssetsRef.current = photoPreviewAssets;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    webFileInputRef.current = input;

    input.addEventListener('change', () => {
      const files = Array.from(input.files || []) as File[];
      input.value = '';
      processWebFiles(files, webFileInputModeRef.current);
    });

    return () => {
      document.body.removeChild(input);
      webFileInputRef.current = null;
    };
  }, [processWebFiles]);

  const handlePickImage = async () => {
    broadcastTyping('media');
    try {
      if (Platform.OS === 'web') {
        webFileInputModeRef.current = 'pick';
        webFileInputRef.current?.click();
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          const { Linking, Alert } = require('react-native');
          Alert.alert(
            'Нет доступа к галерее',
            'Разрешите доступ к фотографиям в настройках, чтобы отправлять медиафайлы.',
            [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Открыть настройки', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsEditing: false,
          allowsMultipleSelection: true,
          selectionLimit: 10,
          quality: 1,
          exif: false,
        });
        if (!result.canceled && result.assets?.length) {
          const previewAssets: PreviewAsset[] = result.assets.map((asset, i) => ({
            id: `native-${Date.now()}-${i}`,
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            mediaType: asset.type === 'video' ? 'video' as const : 'photo' as const,
          }));
          setPhotoPreviewAssets(previewAssets);
          setShowPhotoPreview(true);
        }
      }
    } catch {}
  };

  const handleAddMorePhotos = async () => {
    try {
      if (Platform.OS === 'web') {
        webFileInputModeRef.current = 'add';
        webFileInputRef.current?.click();
      } else {
        const remaining = 10 - photoPreviewAssets.length;
        if (remaining <= 0) return;
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          const { Linking, Alert } = require('react-native');
          Alert.alert(
            'Нет доступа к галерее',
            'Разрешите доступ к фотографиям в настройках.',
            [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Открыть настройки', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsEditing: false,
          allowsMultipleSelection: true,
          selectionLimit: remaining,
          quality: 1,
          exif: false,
        });
        if (!result.canceled && result.assets?.length) {
          const newAssets: PreviewAsset[] = result.assets.map((asset, i) => ({
            id: `native-${Date.now()}-${i}`,
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            mediaType: asset.type === 'video' ? 'video' as const : 'photo' as const,
          }));
          setPhotoPreviewAssets(prev => [...prev, ...newAssets]);
        }
      }
    } catch {}
  };

  const handleSendPhotos = async (assets: PreviewAsset[], caption: string, hdMode: boolean) => {
    setShowPhotoPreview(false);
    setPhotoPreviewAssets([]);

    const groupId = assets.length > 1 ? `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;
    const batchTime = new Date().toISOString();

    playSendSound();
    hapticMedium();

    const pendingUploads: { tempId: string; uploadId: string; assetIndex: number; msgType: string }[] = [];

    for (let ai = 0; ai < assets.length; ai++) {
      const asset = assets[ai];
      const msgType = asset.mediaType === 'video' ? 'video' : 'image';
      const tempId = `temp-${Date.now()}-${ai}-${Math.random().toString(36).slice(2, 8)}`;
      setUploadingMsgIds(prev => new Set(prev).add(tempId));
      setUploadProgress(prev => new Map(prev).set(tempId, 0));

      const optimistic: Message = {
        id: tempId,
        sender_id: user!.id,
        content: ai === 0 ? (caption || '') : '',
        message_type: msgType,
        media_url: asset.uri,
        media_duration: 0,
        created_at: batchTime,
        is_read: false,
        reply_to_id: null,
        edited_at: null,
        is_pinned: false,
        expires_at: null,
        deleted_at: null,
        forwarded_from_id: null,
        status_id: null,
        status_snapshot: null,
        media_group_id: groupId,
      };
      setMessages(prev => [...prev, optimistic]);

      const webFile = (asset as any)._file as File | undefined;
      const contentType = msgType === 'video'
        ? ((asset as any).mimeType || 'video/mp4')
        : ((asset as any).mimeType || 'image/jpeg');

      const uploadId = enqueueUpload({
        conversationId: id as string,
        tempMessageId: tempId,
        uri: asset.uri,
        file: webFile,
        mediaType: msgType === 'video' ? 'video' : 'image',
        contentType,
        caption: ai === 0 ? (caption || '') : undefined,
        skipCompression: hdMode || msgType === 'video',
      });

      pendingUploads.push({ tempId, uploadId, assetIndex: ai, msgType });
      uploadIdByTempIdRef.current.set(tempId, uploadId);
    }

    isNearBottom.current = true;
    justSentRef.current = true;
    requestAnimationFrame(() => {
      if (justSentRef.current) {
        justSentRef.current = false;
        scrollToBottomNow();
      }
    });

    const totalAssets = assets.length;
    let completedCount = 0;
    const expiresAt = disappearTimer > 0 ? new Date(Date.now() + disappearTimer * 1000).toISOString() : null;

    const unsub = onUploadEvent(async (event: UploadEvent) => {
      const match = pendingUploads.find(p => p.uploadId === event.upload.id);
      if (!match) return;

      if (event.type === 'progress') {
        setUploadProgress(prev => new Map(prev).set(match.tempId, event.upload.progress));
      }

      if (event.type === 'completed' && event.upload.publicUrl) {
        const publicUrl = event.upload.publicUrl;

        setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(match.tempId); return n; });
        setUploadProgress(prev => { const n = new Map(prev); n.delete(match.tempId); return n; });

        try {
          const insertPayload: any = {
            conversation_id: id,
            sender_id: user!.id,
            content: match.assetIndex === 0 ? (caption || '') : '',
            message_type: match.msgType,
            media_url: publicUrl,
            media_duration: 0,
            reply_to_id: null,
            is_read: false,
            expires_at: expiresAt,
          };
          if (groupId) insertPayload.media_group_id = groupId;
          const { data: inserted } = await supabase.from('messages')
            .insert(insertPayload)
            .select('id, created_at')
            .single();

          if (inserted) {
            resolvedIdsRef.current.add(inserted.id);
            setMessages(prev =>
              prev.map(m => m.id === match.tempId ? { ...m, id: inserted.id, created_at: inserted.created_at, media_url: publicUrl } : m)
            );
          }
        } catch (dbErr: any) {
          console.error('[chat] Failed to insert media message:', dbErr?.message ?? dbErr);
          setMessages(prev => prev.map(m => m.id === match.tempId ? { ...m, media_url: publicUrl } : m));
          setFailedMsgIds(prev => new Set(prev).add(match.tempId));
        }

        completedCount++;
        if (completedCount >= totalAssets) {
          unsub();
          clearCompleted();

          supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id).then(null, () => {});
        }
      }

      if (event.type === 'failed') {
        setFailedMsgIds(prev => new Set(prev).add(match.tempId));
        setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(match.tempId); return n; });
        setUploadProgress(prev => { const n = new Map(prev); n.delete(match.tempId); return n; });

        completedCount++;
        if (completedCount >= totalAssets) {
          unsub();
          clearCompleted();

        }
      }
    });
  };

  const handleSchedulePhotos = async (assets: PreviewAsset[], caption: string, hdMode: boolean) => {
    setShowPhotoPreview(false);
    setPhotoPreviewAssets([]);
    if (assets.length === 0) return;

    try {
      const makeParams = (asset: PreviewAsset) => {
        const msgType = asset.mediaType === 'video' ? 'video' : 'image';
        const contentType = msgType === 'video'
          ? ((asset as any).mimeType || 'video/mp4')
          : ((asset as any).mimeType || 'image/jpeg');
        return {
          conversationId: id as string,
          tempMessageId: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uri: asset.uri,
          file: (asset as any)._file as File | undefined,
          mediaType: msgType as 'image' | 'video',
          contentType,
          skipCompression: hdMode || msgType === 'video',
        };
      };

      const firstAsset = assets[0];
      const firstType = firstAsset.mediaType === 'video' ? 'video' : 'image';
      const publicUrl = await uploadAndWait(makeParams(firstAsset));

      for (let i = 1; i < assets.length; i++) {
        const extra = assets[i];
        const extraType = extra.mediaType === 'video' ? 'video' : 'image';
        try {
          const extraUrl = await uploadAndWait(makeParams(extra));
          await supabase.from('scheduled_messages').insert({
            conversation_id: id,
            sender_id: user!.id,
            content: '',
            message_type: extraType,
            media_url: extraUrl,
            media_duration: 0,
            scheduled_at: new Date(Date.now() + 30 * 60000).toISOString(),
          });
        } catch {}
      }

      openSchedulePicker({ type: firstType, url: publicUrl, duration: 0, caption: caption.trim() });
    } catch {}
  };

  const handleScheduleVoice = async (audioUrl: string, duration: number) => {
    openSchedulePicker({ type: 'voice', url: audioUrl, duration, caption: '' });
  };

  const handleSendMediaFromSheet = async (assets: { id: string; uri: string; mediaType: 'photo' | 'video'; duration?: number }[]) => {
    if (Platform.OS === 'web') {
      const previewAssets: PreviewAsset[] = assets.map(a => ({
        id: a.id, uri: a.uri, mediaType: a.mediaType,
      }));
      if (previewAssets.length > 0) {
        setPhotoPreviewAssets(previewAssets);
        setShowPhotoPreview(true);
      }
      return;
    }

    const resolved: PreviewAsset[] = [];
    try {
      const MediaLibrary = require('expo-media-library');
      for (const a of assets) {
        let uri = a.uri;
        if (!uri.startsWith('file://') && !uri.startsWith('http')) {
          try {
            const info = await MediaLibrary.getAssetInfoAsync(a.id);
            if (info?.localUri) uri = info.localUri;
          } catch (resErr) {
            console.warn('[handleSendMediaFromSheet] getAssetInfoAsync failed for', a.id, resErr);
          }
        }
        resolved.push({ id: a.id, uri, mediaType: a.mediaType });
      }
    } catch {
      for (const a of assets) {
        resolved.push({ id: a.id, uri: a.uri, mediaType: a.mediaType });
      }
    }

    if (resolved.length > 0) {
      setPhotoPreviewAssets(resolved);
      setShowPhotoPreview(true);
    }
  };

  // --- Video Note (circle video) ---
  const startVideoNote = async () => {
    if (Platform.OS !== 'web') {
      try {
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['videos'],
          videoMaxDuration: 60,
          quality: 0.7,
          cameraType: ImagePicker.CameraType.front,
        });
        if (!result.canceled && result.assets[0]) {
          const asset = result.assets[0];
          const vnDur = Math.round((asset.duration || 0) / 1000);
          const vnTempId = `temp-videonote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setUploadingMsgIds(prev => new Set(prev).add(vnTempId));
          setUploadProgress(prev => new Map(prev).set(vnTempId, 0));

          const vnOptimistic: Message = {
            id: vnTempId, sender_id: user!.id, content: '', message_type: 'video_note',
            media_url: asset.uri, media_duration: vnDur, created_at: new Date().toISOString(),
            is_read: false, reply_to_id: replyTo?.id || null, edited_at: null, is_pinned: false,
            expires_at: disappearTimer > 0 ? new Date(Date.now() + disappearTimer * 1000).toISOString() : null,
            deleted_at: null, forwarded_from_id: null, status_id: null, status_snapshot: null, media_group_id: null,
          };
          setMessages(prev => [...prev, vnOptimistic]);
          setReplyTo(null);
          scrollToBottomNow();

          const uploadId = enqueueUpload({
            conversationId: id as string, tempMessageId: vnTempId,
            uri: asset.uri, mediaType: 'video_note', contentType: 'video/mp4', skipCompression: true,
          });
          uploadIdByTempIdRef.current.set(vnTempId, uploadId);

          const unsub = onUploadEvent(async (event: UploadEvent) => {
            if (event.upload.id !== uploadId) return;
            if (event.type === 'progress') {
              setUploadProgress(prev => new Map(prev).set(vnTempId, event.upload.progress));
            }
            if (event.type === 'completed' && event.upload.publicUrl) {
              setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(vnTempId); return n; });
              setUploadProgress(prev => { const n = new Map(prev); n.delete(vnTempId); return n; });
              try {
                const { data: ins } = await supabase.from('messages')
                  .insert({ conversation_id: id, sender_id: user!.id, content: '', message_type: 'video_note', media_url: event.upload.publicUrl, media_duration: vnDur, reply_to_id: vnOptimistic.reply_to_id, is_read: false, expires_at: vnOptimistic.expires_at })
                  .select('id, created_at').single();
                if (ins) {
                  resolvedIdsRef.current.add(ins.id);
                  setMessages(prev => prev.map(m => m.id === vnTempId ? { ...m, id: ins.id, created_at: ins.created_at, media_url: event.upload.publicUrl! } : m));
                }
              } catch (dbErr: any) {
                console.error('[chat] Failed to insert video note message:', dbErr?.message ?? dbErr);
                setMessages(prev => prev.map(m => m.id === vnTempId ? { ...m, media_url: event.upload.publicUrl! } : m));
                setFailedMsgIds(prev => new Set(prev).add(vnTempId));
              }
              unsub(); clearCompleted();
              supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id).then(null, () => {});
            }
            if (event.type === 'failed') {
              setFailedMsgIds(prev => new Set(prev).add(vnTempId));
              setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(vnTempId); return n; });
              setUploadProgress(prev => { const n = new Map(prev); n.delete(vnTempId); return n; });
              unsub(); clearCompleted();
            }
          });
        }
      } catch (err) {
        console.error('startVideoNote native error:', err);
      }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 }, audio: true });
      setVideoNoteStream(stream);
      setRecordingVideoNote(true);
      setVideoNoteDuration(0);

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      videoNoteRecorderRef.current = recorder;
      videoNoteChunksRef.current = [];

      recorder.ondataavailable = (e: any) => {
        if (e.data.size > 0) videoNoteChunksRef.current.push(e.data);
      };
      recorder.start(100);

      let tick = 0;
      videoNoteTimerRef.current = setInterval(() => {
        tick++;
        setVideoNoteDuration(tick);
        videoNoteDurationRef.current = tick;
        if (tick >= 60) stopVideoNoteRef.current?.(true);
      }, 1000);

      setTimeout(() => {
        const el = document.getElementById('video-note-preview') as HTMLVideoElement | null;
        if (el) {
          el.srcObject = stream;
          el.muted = true;
          el.play().catch(() => {});
          videoNotePreviewRef.current = el;
        }
      }, 50);
    } catch (err) {
      console.error('startVideoNote web error:', err);
    }
  };

  const stopVideoNote = async (send: boolean) => {
    if (videoNoteTimerRef.current) { clearInterval(videoNoteTimerRef.current); videoNoteTimerRef.current = null; }
    const recorder = videoNoteRecorderRef.current;
    if (!recorder) { setRecordingVideoNote(false); setVideoNoteStream(null); return; }

    const durationAtStop = videoNoteDurationRef.current;
    const streamToStop = videoNoteStreamRef.current;

    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        if (streamToStop) streamToStop.getTracks().forEach(t => t.stop());
        setVideoNoteStream(null);

        if (send && videoNoteChunksRef.current.length > 0) {
          const blob = new Blob(videoNoteChunksRef.current, { type: recorder.mimeType });
          const vnFile = new File([blob], `videonote_${Date.now()}.webm`, { type: recorder.mimeType });
          const blobUri = URL.createObjectURL(blob);
          const vnDur = Math.max(durationAtStop, 1);
          const vnTempId = `temp-videonote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setUploadingMsgIds(prev => new Set(prev).add(vnTempId));
          setUploadProgress(prev => new Map(prev).set(vnTempId, 0));
          const vnOptimistic: Message = {
            id: vnTempId, sender_id: user!.id, content: '', message_type: 'video_note',
            media_url: blobUri, media_duration: vnDur, created_at: new Date().toISOString(),
            is_read: false, reply_to_id: replyTo?.id || null, edited_at: null, is_pinned: false,
            expires_at: disappearTimer > 0 ? new Date(Date.now() + disappearTimer * 1000).toISOString() : null,
            deleted_at: null, forwarded_from_id: null, status_id: null, status_snapshot: null, media_group_id: null,
          };
          setMessages(prev => [...prev, vnOptimistic]);
          setReplyTo(null);
          scrollToBottomNow();

          const uploadId = enqueueUpload({
            conversationId: id as string, tempMessageId: vnTempId,
            uri: blobUri, file: vnFile, mediaType: 'video_note', contentType: recorder.mimeType || 'video/webm', skipCompression: true,
          });
          uploadIdByTempIdRef.current.set(vnTempId, uploadId);

          const unsub = onUploadEvent(async (event: UploadEvent) => {
            if (event.upload.id !== uploadId) return;
            if (event.type === 'progress') {
              setUploadProgress(prev => new Map(prev).set(vnTempId, event.upload.progress));
            }
            if (event.type === 'completed' && event.upload.publicUrl) {
              try {
                const { data: ins } = await supabase.from('messages')
                  .insert({ conversation_id: id, sender_id: user!.id, content: '', message_type: 'video_note', media_url: event.upload.publicUrl, media_duration: vnDur, reply_to_id: vnOptimistic.reply_to_id, is_read: false, expires_at: vnOptimistic.expires_at })
                  .select('id, created_at').single();
                if (ins) {
                  resolvedIdsRef.current.add(ins.id);
                  setMessages(prev => prev.map(m => m.id === vnTempId ? { ...m, id: ins.id, created_at: ins.created_at, media_url: event.upload.publicUrl! } : m));
                }
              } catch (dbErr: any) {
                console.error('[chat] Failed to insert web video note:', dbErr?.message ?? dbErr);
                setMessages(prev => prev.map(m => m.id === vnTempId ? { ...m, media_url: event.upload.publicUrl! } : m));
                setFailedMsgIds(prev => new Set(prev).add(vnTempId));
              }
              setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(vnTempId); return n; });
              setUploadProgress(prev => { const n = new Map(prev); n.delete(vnTempId); return n; });
              unsub(); clearCompleted();
              supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id).then(null, () => {});
            }
            if (event.type === 'failed') {
              setFailedMsgIds(prev => new Set(prev).add(vnTempId));
              setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(vnTempId); return n; });
              setUploadProgress(prev => { const n = new Map(prev); n.delete(vnTempId); return n; });
              unsub(); clearCompleted();
            }
          });
        }

        videoNoteRecorderRef.current = null;
        videoNoteChunksRef.current = [];
        setRecordingVideoNote(false);
        setVideoNoteDuration(0);
        resolve();
      };
      recorder.stop();
    });
  };
  stopVideoNoteRef.current = stopVideoNote;

  const startRecording = async () => {
    broadcastTyping('voice');
    hapticMedium();
    if (Platform.OS !== 'web') {
      await voicePlayer.stop();
    }
    try {
      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
              ? 'audio/webm'
              : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
                ? 'audio/ogg;codecs=opus'
                : '';
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recordedChunksRef.current = [];

        recorder.ondataavailable = (e: any) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };

        recorder.start(100);
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          const { Alert: NativeAlert } = require('react-native');
          NativeAlert.alert('Нет доступа к микрофону', 'Разрешите доступ к микрофону в настройках устройства');
          return;
        }
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        });
        const { recording: rec } = await Audio.Recording.createAsync({
          isMeteringEnabled: true,
          android: {
            extension: '.m4a',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 44100,
            numberOfChannels: 1,
            bitRate: 128000,
          },
          ios: {
            extension: '.m4a',
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 44100,
            numberOfChannels: 1,
            bitRate: 128000,
          },
          web: {
            mimeType: 'audio/webm',
            bitsPerSecond: 128000,
          },
        });
        mediaRecorderRef.current = rec;
      }
      setRecording(true);
      setRecordingDuration(0);
      playRecordStartSound();
      let tick = 0;
      recordingTimer.current = setInterval(() => {
        tick++;
        setRecordingDuration((prev) => prev + 1);
        if (tick % 3 === 0) broadcastTyping('voice');
      }, 1000);
    } catch (err: any) {
      console.error('[startRecording] failed:', err);
      setRecording(false);
      setRecordingDuration(0);
      if (recordingTimer.current) { clearInterval(recordingTimer.current); recordingTimer.current = null; }
      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
      try {
        if (Platform.OS !== 'web') {
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        }
      } catch {}
      if (Platform.OS === 'web') {
        const msg = err?.name === 'NotAllowedError'
          ? 'Доступ к микрофону заблокирован. Разрешите доступ в настройках браузера.'
          : err?.name === 'NotFoundError'
            ? 'Микрофон не найден на этом устройстве.'
            : 'Не удалось начать запись голосового сообщения.';
        window.alert(msg);
      } else {
        const { Alert: NativeAlert } = require('react-native');
        const msg = err?.message?.includes('permission')
          ? 'Разрешите доступ к микрофону в настройках устройства'
          : 'Не удалось начать запись';
        NativeAlert.alert('Ошибка записи', msg);
      }
    }
  };

  const stopRecording = async (send: boolean) => {
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    recordingTimer.current = null;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (presenceChannelRef.current) {
      presenceChannelRef.current.track({ typing: false }).catch(() => {});
    }
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    const durationAtStop = recordingDurationRef.current;

    setRecording(false);
    setRecordingDuration(0);

    if (!send) playRecordCancelSound();

    if (!recorder) return;

    if (Platform.OS === 'web') {
      const webRecorder = recorder as MediaRecorder;
      if (webRecorder.state === 'inactive') {
        try {
          const stream = webRecorder.stream as MediaStream;
          stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        } catch {}
        recordedChunksRef.current = [];
        return;
      }
      return new Promise<void>((resolve) => {
        webRecorder.onstop = async () => {
          try {
            const stream = webRecorder.stream as MediaStream;
            stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
          } catch {}

          if (send && recordedChunksRef.current.length > 0) {
            const rawMime = webRecorder.mimeType || 'audio/webm';
            const ext = rawMime.includes('mp4') ? 'm4a' : rawMime.includes('ogg') ? 'ogg' : 'webm';
            const cleanMime = ext === 'm4a' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : 'audio/webm';
            const blob = new Blob(recordedChunksRef.current, { type: cleanMime });
            const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: cleanMime });
            const blobUri = URL.createObjectURL(blob);
            try {
              const tempId = `temp-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const voiceDur = Math.max(durationAtStop, 1);
              setUploadingMsgIds(prev => new Set(prev).add(tempId));
              setUploadProgress(prev => new Map(prev).set(tempId, 0));
              const optimistic: Message = {
                id: tempId,
                sender_id: user!.id,
                content: '',
                message_type: 'voice',
                media_url: blobUri,
                media_duration: voiceDur,
                created_at: new Date().toISOString(),
                is_read: false,
                reply_to_id: replyTo?.id || null,
                edited_at: null,
                is_pinned: false,
                expires_at: disappearTimer > 0 ? new Date(Date.now() + disappearTimer * 1000).toISOString() : null,
                deleted_at: null,
                forwarded_from_id: null,
                status_id: null,
                status_snapshot: null,
                media_group_id: null,
              };
              setMessages(prev => [...prev, optimistic]);
              setReplyTo(null);
              scrollToBottomNow();

              const uploadId = enqueueUpload({
                conversationId: id as string,
                tempMessageId: tempId,
                uri: blobUri,
                file,
                mediaType: 'voice',
                contentType: cleanMime,
                skipCompression: true,
              });
              uploadIdByTempIdRef.current.set(tempId, uploadId);

              const unsub = onUploadEvent(async (event: UploadEvent) => {
                if (event.upload.id !== uploadId) return;
                if (event.type === 'progress') {
                  setUploadProgress(prev => new Map(prev).set(tempId, event.upload.progress));
                }
                if (event.type === 'completed' && event.upload.publicUrl) {
                  setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(tempId); return n; });
                  setUploadProgress(prev => { const n = new Map(prev); n.delete(tempId); return n; });
                  try {
                    const insertPayload: any = {
                      conversation_id: id,
                      sender_id: user!.id,
                      content: '',
                      message_type: 'voice',
                      media_url: event.upload.publicUrl,
                      media_duration: voiceDur,
                      reply_to_id: optimistic.reply_to_id,
                      is_read: false,
                      expires_at: optimistic.expires_at,
                    };
                    const { data: inserted } = await supabase.from('messages')
                      .insert(insertPayload)
                      .select('id, created_at')
                      .single();
                    if (inserted) {
                      resolvedIdsRef.current.add(inserted.id);
                      setMessages(prev =>
                        prev.map(m => m.id === tempId ? { ...m, id: inserted.id, created_at: inserted.created_at, media_url: event.upload.publicUrl! } : m)
                      );
                    }
                  } catch (dbErr: any) {
                    console.error('[voice] web DB insert failed:', dbErr?.message ?? dbErr);
                    setMessages(prev => prev.map(m => m.id === tempId ? { ...m, media_url: event.upload.publicUrl! } : m));
                    setFailedMsgIds(prev => new Set(prev).add(tempId));
                  }
                  unsub();
                  clearCompleted();
                  supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id).then(null, () => {});
                }
                if (event.type === 'failed') {
                  setFailedMsgIds(prev => new Set(prev).add(tempId));
                  setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(tempId); return n; });
                  setUploadProgress(prev => { const n = new Map(prev); n.delete(tempId); return n; });
                  unsub();
                  clearCompleted();
                }
              });
            } catch (err) {
              console.warn('[stopRecording] voice upload failed:', err);
            }
          }

          recordedChunksRef.current = [];
          resolve();
        };

        webRecorder.stop();
      });
    }

    try {
      await (recorder as Audio.Recording).stopAndUnloadAsync();
    } catch (stopErr) {
      console.error('[stopRecording] stopAndUnloadAsync failed:', stopErr);
    }
    let uri = (recorder as Audio.Recording).getURI();
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
    } catch (modeErr) {
      console.warn('[stopRecording] setAudioModeAsync failed:', modeErr);
    }
    if (send) {
      try {
        if (uri) {
          if (uri && !uri.startsWith('file://') && !uri.startsWith('http')) {
            uri = 'file://' + uri;
          }
          if (!uri.match(/\.(m4a|caf|aac|mp4|wav|ogg|webm)(\?|$)/i)) {
            const newUri = uri.replace(/\/?$/, '') + '.m4a';
            try {
              await FileSystem.moveAsync({ from: uri, to: newUri });
              uri = newUri;
            } catch (moveErr) {
              console.warn('[stopRecording] rename failed, using original URI:', moveErr);
            }
          }
          const tempId = `temp-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const voiceDur = Math.max(durationAtStop, 1);
          setUploadingMsgIds(prev => new Set(prev).add(tempId));
          setUploadProgress(prev => new Map(prev).set(tempId, 0));

          const optimistic: Message = {
            id: tempId,
            sender_id: user!.id,
            content: '',
            message_type: 'voice',
            media_url: uri,
            media_duration: voiceDur,
            created_at: new Date().toISOString(),
            is_read: false,
            reply_to_id: replyTo?.id || null,
            edited_at: null,
            is_pinned: false,
            expires_at: disappearTimer > 0 ? new Date(Date.now() + disappearTimer * 1000).toISOString() : null,
            deleted_at: null,
            forwarded_from_id: null,
            status_id: null,
            status_snapshot: null,
            media_group_id: null,
          };
          setMessages(prev => [...prev, optimistic]);
          setReplyTo(null);
          scrollToBottomNow();

          const uploadId = enqueueUpload({
            conversationId: id as string,
            tempMessageId: tempId,
            uri,
            mediaType: 'voice',
            contentType: 'audio/mp4',
            skipCompression: true,
          });
          uploadIdByTempIdRef.current.set(tempId, uploadId);

          const unsub = onUploadEvent(async (event: UploadEvent) => {
            if (event.upload.id !== uploadId) return;
            if (event.type === 'progress') {
              setUploadProgress(prev => new Map(prev).set(tempId, event.upload.progress));
            }
            if (event.type === 'completed' && event.upload.publicUrl) {
              setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(tempId); return n; });
              setUploadProgress(prev => { const n = new Map(prev); n.delete(tempId); return n; });
              try {
                const insertPayload: any = {
                  conversation_id: id,
                  sender_id: user!.id,
                  content: '',
                  message_type: 'voice',
                  media_url: event.upload.publicUrl,
                  media_duration: voiceDur,
                  reply_to_id: optimistic.reply_to_id,
                  is_read: false,
                  expires_at: optimistic.expires_at,
                };
                const { data: inserted } = await supabase.from('messages')
                  .insert(insertPayload)
                  .select('id, created_at')
                  .single();
                if (inserted) {
                  resolvedIdsRef.current.add(inserted.id);
                  setMessages(prev =>
                    prev.map(m => m.id === tempId ? { ...m, id: inserted.id, created_at: inserted.created_at, media_url: event.upload.publicUrl! } : m)
                  );
                }
              } catch (dbErr: any) {
                console.error('[voice] DB insert failed:', dbErr?.message ?? dbErr);
                setMessages(prev => prev.map(m => m.id === tempId ? { ...m, media_url: event.upload.publicUrl! } : m));
                setFailedMsgIds(prev => new Set(prev).add(tempId));
              }
              unsub();
              clearCompleted();
              supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id).then(null, () => {});
            }
            if (event.type === 'failed') {
              setFailedMsgIds(prev => new Set(prev).add(tempId));
              setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(tempId); return n; });
              setUploadProgress(prev => { const n = new Map(prev); n.delete(tempId); return n; });
              unsub();
              clearCompleted();
            }
          });
        } else {
          console.warn('[stopRecording] getURI returned null');
        }
      } catch (err) {
        console.error('[stopRecording] native voice upload error:', err);
      }
    }
  };

  const scheduleVoiceRecording = async () => {
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    recordingTimer.current = null;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (presenceChannelRef.current) {
      presenceChannelRef.current.track({ typing: false }).catch(() => {});
    }
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    const durationAtStop = recordingDurationRef.current;
    setRecording(false);
    setRecordingDuration(0);
    if (!recorder) return;

    if (Platform.OS === 'web') {
      const webRecorder = recorder as MediaRecorder;
      if (webRecorder.state === 'inactive') {
        try { webRecorder.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
        recordedChunksRef.current = [];
        return;
      }
      return new Promise<void>((resolve) => {
        webRecorder.onstop = async () => {
          try { webRecorder.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
          if (recordedChunksRef.current.length > 0) {
            const rawMime = webRecorder.mimeType || 'audio/webm';
            const ext = rawMime.includes('mp4') ? 'm4a' : rawMime.includes('ogg') ? 'ogg' : 'webm';
            const cleanMime = ext === 'm4a' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : 'audio/webm';
            const blob = new Blob(recordedChunksRef.current, { type: cleanMime });
            const schedFile = new File([blob], `voice_${Date.now()}.${ext}`, { type: cleanMime });
            const schedBlobUri = URL.createObjectURL(blob);
            const publicUrl = await uploadAndWait({
              conversationId: id as string, tempMessageId: `sched-voice-${Date.now()}`,
              uri: schedBlobUri, file: schedFile, mediaType: 'voice', contentType: cleanMime, skipCompression: true,
            });
            if (publicUrl) {
              handleScheduleVoice(publicUrl, Math.max(durationAtStop, 1));
            }
          }
          recordedChunksRef.current = [];
          resolve();
        };
        webRecorder.stop();
      });
    }

    try {
      await (recorder as Audio.Recording).stopAndUnloadAsync();
    } catch (stopErr) {
      console.error('[scheduleVoiceRecording] stopAndUnloadAsync failed:', stopErr);
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {}
    try {
      let uri = (recorder as Audio.Recording).getURI();
      if (uri) {
        if (!uri.startsWith('file://')) {
          uri = 'file://' + uri;
        }
        if (!uri.match(/\.(m4a|caf|aac|mp4|wav|ogg|webm)(\?|$)/i)) {
          const newUri = uri + '.m4a';
          try { await FileSystem.moveAsync({ from: uri, to: newUri }); uri = newUri; } catch {}
        }
        const publicUrl = await uploadAndWait({
          conversationId: id as string, tempMessageId: `sched-voice-${Date.now()}`,
          uri, mediaType: 'voice', contentType: 'audio/mp4', skipCompression: true,
        });
        if (publicUrl) {
          handleScheduleVoice(publicUrl, Math.max(durationAtStop, 1));
        }
      }
    } catch (err) {
      console.error('[scheduleVoiceRecording] native voice error:', err);
    }
  };

  const toggleRecording = () => {
    if (recording) {
      stopRecording(true);
    } else {
      startRecording();
    }
  };

  const sendPendingVoiceDraft = async () => {
    if (!pendingVoiceDraft || !user) return;
    playRecordSendSound();
    let { uri, duration, mimeType } = pendingVoiceDraft;
    const voiceDur = Math.max(duration, 1);
    const tempId = `temp-voicedraft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      setUploadingMsgIds(prev => new Set(prev).add(tempId));
      setUploadProgress(prev => new Map(prev).set(tempId, 0));
      const optimistic: Message = {
        id: tempId, sender_id: user.id, content: '', message_type: 'voice',
        media_url: uri, media_duration: voiceDur, created_at: new Date().toISOString(),
        is_read: false, reply_to_id: replyTo?.id || null, edited_at: null, is_pinned: false,
        expires_at: disappearTimer > 0 ? new Date(Date.now() + disappearTimer * 1000).toISOString() : null,
        deleted_at: null, forwarded_from_id: null, status_id: null, status_snapshot: null, media_group_id: null,
      };
      setMessages(prev => [...prev, optimistic]);
      setReplyTo(null);
      scrollToBottomNow();

      let uploadFile_: File | undefined;
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        const ext = mimeType.includes('webm') ? 'webm' : 'ogg';
        uploadFile_ = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
      } else if (!uri.startsWith('file://') && !uri.startsWith('http')) {
        uri = 'file://' + uri;
      }

      const uploadId = enqueueUpload({
        conversationId: id as string, tempMessageId: tempId,
        uri, file: uploadFile_, mediaType: 'voice',
        contentType: Platform.OS === 'web' ? mimeType : 'audio/mp4', skipCompression: true,
      });
      uploadIdByTempIdRef.current.set(tempId, uploadId);

      const unsub = onUploadEvent(async (event: UploadEvent) => {
        if (event.upload.id !== uploadId) return;
        if (event.type === 'progress') {
          setUploadProgress(prev => new Map(prev).set(tempId, event.upload.progress));
        }
        if (event.type === 'completed' && event.upload.publicUrl) {
          setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(tempId); return n; });
          setUploadProgress(prev => { const n = new Map(prev); n.delete(tempId); return n; });
          try {
            const { data: ins } = await supabase.from('messages')
              .insert({ conversation_id: id, sender_id: user.id, content: '', message_type: 'voice', media_url: event.upload.publicUrl, media_duration: voiceDur, reply_to_id: optimistic.reply_to_id, is_read: false, expires_at: optimistic.expires_at })
              .select('id, created_at').single();
            if (ins) {
              resolvedIdsRef.current.add(ins.id);
              setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: ins.id, created_at: ins.created_at, media_url: event.upload.publicUrl! } : m));
            }
          } catch (dbErr: any) {
            console.error('[chat] Failed to insert file message:', dbErr?.message ?? dbErr);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, media_url: event.upload.publicUrl! } : m));
            setFailedMsgIds(prev => new Set(prev).add(tempId));
          }
          unsub(); clearCompleted();
          supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id).then(null, () => {});
        }
        if (event.type === 'failed') {
          setFailedMsgIds(prev => new Set(prev).add(tempId));
          setUploadingMsgIds(prev => { const n = new Set(prev); n.delete(tempId); return n; });
          setUploadProgress(prev => { const n = new Map(prev); n.delete(tempId); return n; });
          unsub(); clearCompleted();
        }
      });
    } catch (err) {
      console.error('[sendPendingVoiceDraft] failed:', err);
    }
    setPendingVoiceDraft(null);
    clearDraft(id as string);
  };

  const discardVoiceDraft = () => {
    if (pendingVoiceDraft) {
      playRecordCancelSound();
      if (Platform.OS === 'web') {
        try { URL.revokeObjectURL(pendingVoiceDraft.uri); } catch {}
      }
      setPendingVoiceDraft(null);
      saveDraft(id as string, { voiceUri: null, voiceDuration: 0, voiceMimeType: null });
    }
  };

  const initiateCall = async (callType: 'voice' | 'video') => {
    if (!user) return;

    if (chatInfo.type === 'group') {
      const { data: members } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', id)
        .neq('user_id', user.id);
      if (!members || members.length === 0) return;

      const receiverId = members[0].user_id;
      const { data } = await supabase.from('calls').insert({
        caller_id: user.id,
        receiver_id: receiverId,
        call_type: callType,
        status: 'ringing',
        is_group_call: true,
        group_name: chatInfo.name || 'Групповой звонок',
      }).select('id').single();

      if (data) {
        const participants = members.map(m => ({
          call_id: data.id,
          user_id: m.user_id,
          status: 'ringing',
        }));
        participants.push({ call_id: data.id, user_id: user.id, status: 'active' });
        await supabase.from('call_participants').insert(participants);
      }

      router.push({
        pathname: '/call',
        params: {
          type: callType, userId: receiverId, name: chatInfo.name || 'Групповой звонок',
          callId: data?.id || '', role: 'caller', groupCall: 'true',
          conversationId: id as string,
        },
      });
    } else {
      if (!chatInfo.other_user_id) return;
      const { data } = await supabase.from('calls').insert({
        caller_id: user.id,
        receiver_id: chatInfo.other_user_id,
        call_type: callType,
        status: 'ringing',
      }).select('id').single();

      router.push({
        pathname: '/call',
        params: { type: callType, userId: chatInfo.other_user_id, name: chatInfo.name, callId: data?.id || '', role: 'caller', conversationId: id as string },
      });
    }
  };

  const handleDeleteChat = async () => {
    if (!user || !id) return;
    setShowChatMenu(false);
    const { error } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', id)
      .eq('user_id', user.id);
    if (!error) {
      onBack ? onBack() : router.back();
    }
  };

  useEffect(() => {
    if (!user || !chatInfo.other_user_id) return;
    (async () => {
      const { data } = await supabase
        .from('blocked_users')
        .select('id')
        .eq('user_id', user.id)
        .eq('blocked_user_id', chatInfo.other_user_id)
        .maybeSingle();
      setIsBlocked(!!data);
    })();
  }, [user?.id, chatInfo.other_user_id]);

  const handleBlockUser = async () => {
    if (!user || !chatInfo.other_user_id) return;
    setShowChatMenu(false);
    setShowUserProfile(false);
    const { error } = await supabase.from('blocked_users').insert({
      user_id: user.id,
      blocked_user_id: chatInfo.other_user_id,
    });
    if (error) {
      setBlockFeedback('Ошибка при блокировке пользователя');
    } else {
      setIsBlocked(true);
      setBlockFeedback(`${chatInfo.name || 'Пользователь'} заблокирован`);
    }
    setTimeout(() => setBlockFeedback(null), 3000);
  };

  const handleUnblockUser = async () => {
    if (!user || !chatInfo.other_user_id) return;
    setShowChatMenu(false);
    setShowUserProfile(false);
    const { error } = await supabase
      .from('blocked_users')
      .delete()
      .eq('user_id', user.id)
      .eq('blocked_user_id', chatInfo.other_user_id);
    if (error) {
      setBlockFeedback('Ошибка при разблокировке пользователя');
    } else {
      setIsBlocked(false);
      setBlockFeedback(`${chatInfo.name || 'Пользователь'} разблокирован`);
    }
    setTimeout(() => setBlockFeedback(null), 3000);
  };

  const handleReportUser = async () => {
    if (!user || !chatInfo.other_user_id || !reportReason) return;
    setReportSending(true);
    const { error } = await supabase.from('reports').insert({
      reporter_id: user.id,
      reported_user_id: chatInfo.other_user_id,
      conversation_id: id as string,
      reason: reportReason,
      details: reportDetails.trim(),
    });
    setReportSending(false);
    if (!error) {
      setReportSent(true);
      setTimeout(() => {
        setShowReportModal(false);
        setReportReason('');
        setReportDetails('');
        setReportSent(false);
      }, 1500);
    }
  };

  const playVoice = async (msg: Message) => {
    if (!msg.media_url) return;
    const senderName = msg.sender?.display_name || (msg.sender_id === user?.id ? 'Вы' : 'Пользователь');
    voicePlayer.play({
      id: msg.id,
      url: msg.media_url,
      duration: msg.media_duration,
      senderName,
      conversationId: id || '',
    });
  };

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    voicePlayer.setOnFinished((finishedId: string) => {
      const msgs = messagesRef.current;
      const idx = msgs.findIndex(m => m.id === finishedId);
      if (idx < 0 || idx >= msgs.length - 1) return;
      const next = msgs[idx + 1];
      if (next.message_type === 'voice' && next.media_url) {
        const senderName = next.sender?.display_name || (next.sender_id === user?.id ? 'Вы' : 'Пользователь');
        voicePlayer.play({
          id: next.id,
          url: next.media_url,
          duration: next.media_duration,
          senderName,
          conversationId: id || '',
        });
      }
    });
    return () => voicePlayer.setOnFinished(null);
  }, [id, user?.id]);

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateCache = useRef<Map<string, string>>(new Map());
  const formatDate = (dateStr: string) => {
    const dayKey = dateStr.slice(0, 10);
    const cached = formatDateCache.current.get(dayKey);
    if (cached !== undefined) return cached;
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let result: string;
    if (date.toDateString() === today.toDateString()) result = 'Сегодня';
    else if (date.toDateString() === yesterday.toDateString()) result = 'Вчера';
    else result = date.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
    formatDateCache.current.set(dayKey, result);
    return result;
  };

  const formatLastSeen = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин назад`;
    if (diffHrs < 24) return `${diffHrs} ч назад`;
    if (diffHrs < 48) return 'вчера в ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' в ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const formatLastCallLabel = useCallback(() => {
    if (!lastCallInfo?.ended_at) return null;
    const date = new Date(lastCallInfo.ended_at);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays > 7) return null;
    const icon = lastCallInfo.call_type === 'video' ? 'Видеозвонок' : 'Звонок';
    let ago = '';
    if (diffHrs < 1) ago = 'только что';
    else if (diffHrs < 24) ago = `${diffHrs} ч назад`;
    else if (diffDays === 1) ago = 'вчера';
    else ago = `${diffDays} дн назад`;
    return `${icon} ${ago}`;
  }, [lastCallInfo]);

  const formatVoiceDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const searchRegex = useMemo(() => {
    if (!searchMode || !searchQuery.trim()) return null;
    const q = searchQuery.trim();
    return new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  }, [searchMode, searchQuery]);

  const highlightSearchText = (text: string, textColor: string) => {
    if (!searchRegex) return text;
    const parts = text.split(searchRegex);
    if (parts.length === 1) return text;
    return parts.map((part, i) =>
      searchRegex.test(part) ? (
        <Text key={`hl-${i}`} style={{ backgroundColor: 'rgba(255,213,0,0.4)', color: textColor, borderRadius: 2 }}>{part}</Text>
      ) : part
    );
  };

  const isEmojiOnly = (text: string): number => {
    const stripped = text.replace(/\s/g, '');
    if (stripped.length === 0 || stripped.length > 20) return 0;
    const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji}\u200D\p{Emoji}|[\u200D\uFE0F])+$/u;
    if (!emojiRegex.test(stripped)) return 0;
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stripped)];
        return segments.length <= 3 ? segments.length : 0;
      }
    } catch {}
    const graphemes = stripped.match(/\p{Emoji_Presentation}(\u200D\p{Emoji_Presentation})*|\p{Emoji}\uFE0F/gu);
    const count = graphemes?.length || 0;
    return count <= 3 ? count : 0;
  };

  const handleLinkPress = (href: string) => {
    try {
      const url = new URL(href.startsWith('http') ? href : `https://${href}`);
      if (url.hostname === 'vaychat.net' || url.hostname === 'www.vaychat.net') {
        const path = url.pathname;
        const usernameMatch = path.match(/^\/@([a-zA-Z0-9_]+)$/);
        if (usernameMatch) {
          router.push({ pathname: '/@[username]', params: { username: usernameMatch[1] } });
          return;
        }
        const channelIdMatch = path.match(/^\/channel\/([a-f0-9-]+)$/i);
        if (channelIdMatch) {
          router.push({ pathname: '/channel/[id]', params: { id: channelIdMatch[1] } });
          return;
        }
        const userMatch = path.match(/^\/u\/([a-f0-9-]+)$/i);
        if (userMatch) {
          router.push({ pathname: '/u/[userId]', params: { userId: userMatch[1] } });
          return;
        }
      }
    } catch {}
    if (Platform.OS === 'web') window.open(href, '_blank'); else Linking.openURL(href);
  };

  const mentionShakeAnim = useRef(new RNAnimated.Value(0)).current;

  const triggerMentionShake = () => {
    if (Platform.OS === 'web' && navigator.vibrate) {
      navigator.vibrate([30, 40, 30]);
    }
    mentionShakeAnim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(mentionShakeAnim, { toValue: 1, duration: 50, useNativeDriver: true, easing: RNEasing.linear }),
      RNAnimated.timing(mentionShakeAnim, { toValue: -1, duration: 50, useNativeDriver: true, easing: RNEasing.linear }),
      RNAnimated.timing(mentionShakeAnim, { toValue: 1, duration: 50, useNativeDriver: true, easing: RNEasing.linear }),
      RNAnimated.timing(mentionShakeAnim, { toValue: -1, duration: 50, useNativeDriver: true, easing: RNEasing.linear }),
      RNAnimated.timing(mentionShakeAnim, { toValue: 0, duration: 50, useNativeDriver: true, easing: RNEasing.linear }),
    ]).start();
  };

  const handleMentionPress = async (mentionUsername: string) => {
    const { data } = await supabase
      .from('conversations')
      .select('id, username')
      .eq('type', 'channel')
      .eq('username', mentionUsername)
      .maybeSingle();

    if (!data) return;

    if (data.id === id) {
      triggerMentionShake();
    } else {
      router.push({ pathname: '/chat/[id]', params: { id: data.id } });
    }
  };

  const renderFormattedText = (text: string, textColor: string, mine?: boolean): React.ReactNode => {
    const linkColor = mine ? sentColors.link || '#90CAF9' : colors.primary;
    const quoteBarColor = mine ? 'rgba(255,255,255,0.4)' : colors.primary;
    const quoteBg = mine ? 'rgba(255,255,255,0.06)' : `${colors.primary}08`;
    const faintColor = mine ? sentColors.textFaint || 'rgba(255,255,255,0.5)' : colors.textTertiary;

    const rawLines = text.split('\n');
    // Collapse 3+ consecutive empty lines into a single blank line
    const lines: string[] = [];
    let emptyCount = 0;
    for (const l of rawLines) {
      if (l.trim() === '') {
        emptyCount++;
        if (emptyCount <= 1) lines.push(l);
      } else {
        emptyCount = 0;
        lines.push(l);
      }
    }
    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

    const blockquoteLines: string[] = [];
    const result: React.ReactNode[] = [];
    let blockKey = 0;

    const flushBlockquote = () => {
      if (blockquoteLines.length === 0) return;
      const quoteContent = blockquoteLines.splice(0).join('\n');
      const quoteMarkColor = mine ? 'rgba(255,255,255,0.25)' : `${colors.primary}40`;
      result.push(
        <View key={`bq-${blockKey++}`} style={{ borderLeftWidth: 3, borderLeftColor: quoteBarColor, backgroundColor: quoteBg, borderRadius: 8, paddingLeft: 12, paddingRight: 12, paddingVertical: 10, marginVertical: 4, position: 'relative' as const, overflow: 'hidden' as const }}>
          <Text style={{ position: 'absolute', top: 4, left: 8, fontSize: 24, color: quoteMarkColor, fontFamily: 'serif' }}>{'\u201C'}</Text>
          <Text style={{ position: 'absolute', top: 4, right: 8, fontSize: 24, color: quoteMarkColor, fontFamily: 'serif' }}>{'\u201D'}</Text>
          <View style={{ paddingTop: 4 }}>
            <Text style={[styles.messageText, { fontSize: 15 * fontScale, color: textColor, fontStyle: 'italic', lineHeight: 20 * fontScale }]}>
              {parseInline(quoteContent, textColor, linkColor, faintColor, mine)}
            </Text>
          </View>
        </View>
      );
    };

    let prevWasBlank = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('> ')) {
        blockquoteLines.push(line.slice(2));
      } else {
        flushBlockquote();
        if (line.trim() === '') {
          if (result.length > 0) prevWasBlank = true;
        } else {
          if (result.length > 0 && !prevWasBlank) {
            result.push(<Text key={`nl-${i}`}>{'\n'}</Text>);
          }
          if (prevWasBlank) {
            result.push(<View key={`sp-${i}`} style={{ height: 4 }} />);
            prevWasBlank = false;
          }
          result.push(
            <Text key={`ln-${i}`} style={[styles.messageText, { fontSize: 16 * fontScale, color: textColor }]}>
              {parseInline(line, textColor, linkColor, faintColor, mine)}
            </Text>
          );
        }
      }
    }
    flushBlockquote();

    if (result.length === 1) return result[0];
    return <View>{result}</View>;
  };

  const parseInline = (text: string, textColor: string, linkColor: string, faintColor: string, mine?: boolean): React.ReactNode[] => {
    const tokens: React.ReactNode[] = [];
    const regex = /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIndex = 0;
    let key = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push(...renderUrlParts(text.slice(lastIndex, match.index), textColor, linkColor, mine, key));
        key += 10;
      }

      if (match[2]) {
        tokens.push(<Text key={`b-${key++}`} style={{ fontWeight: '700', color: textColor }}>{match[2]}</Text>);
      } else if (match[3]) {
        tokens.push(<Text key={`i-${key++}`} style={{ fontStyle: 'italic', color: textColor }}>{match[3]}</Text>);
      } else if (match[4]) {
        tokens.push(<Text key={`s-${key++}`} style={{ textDecorationLine: 'line-through', color: faintColor }}>{match[4]}</Text>);
      } else if (match[5]) {
        tokens.push(<Text key={`c-${key++}`} style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14 * fontScale, backgroundColor: mine ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', color: textColor, borderRadius: 3 }}>{match[5]}</Text>);
      } else if (match[6] && match[7]) {
        const href = match[7].startsWith('http') ? match[7] : `https://${match[7]}`;
        tokens.push(
          <Text
            key={`a-${key++}`}
            style={{ color: linkColor, textDecorationLine: 'underline' }}
            onPress={() => handleLinkPress(href)}
            accessibilityRole="link"
          >
            {match[6]}
          </Text>
        );
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      tokens.push(...renderUrlParts(text.slice(lastIndex), textColor, linkColor, mine, key));
    }

    return tokens;
  };

  const MENTION_REGEX = /@([a-zA-Z][a-zA-Z0-9_]{2,})/g;

  const renderMentionParts = (text: string, textColor: string, linkColor: string, startKey: number): React.ReactNode[] => {
    MENTION_REGEX.lastIndex = 0;
    const nodes: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    let k = startKey;

    while ((m = MENTION_REGEX.exec(text)) !== null) {
      if (m.index > lastIdx) {
        const hl = highlightSearchText(text.slice(lastIdx, m.index), textColor);
        if (typeof hl === 'string') nodes.push(<Text key={k++}>{hl}</Text>);
        else if (Array.isArray(hl)) nodes.push(<Text key={k++}>{hl}</Text>);
        else nodes.push(hl);
      }
      const username = m[1];
      nodes.push(
        <Text
          key={k++}
          style={{ color: linkColor, fontWeight: '600' }}
          onPress={() => handleMentionPress(username)}
        >
          @{username}
        </Text>
      );
      lastIdx = MENTION_REGEX.lastIndex;
    }

    if (lastIdx < text.length) {
      const hl = highlightSearchText(text.slice(lastIdx), textColor);
      if (typeof hl === 'string') nodes.push(<Text key={k++}>{hl}</Text>);
      else if (Array.isArray(hl)) nodes.push(<Text key={k++}>{hl}</Text>);
      else nodes.push(hl);
    }

    return nodes.length > 0 ? nodes : [<Text key={startKey}>{text}</Text>];
  };

  const renderUrlParts = (text: string, textColor: string, linkColor: string, mine?: boolean, startKey = 0): React.ReactNode[] => {
    URL_REGEX.lastIndex = 0;
    const parts = text.split(URL_REGEX);
    if (parts.length === 1) {
      return renderMentionParts(text, textColor, linkColor, startKey);
    }
    return parts.map((part, i) => {
      URL_REGEX.lastIndex = 0;
      if (URL_REGEX.test(part)) {
        URL_REGEX.lastIndex = 0;
        const href = part.startsWith('http') ? part : `https://${part}`;
        return (
          <Text
            key={startKey + i}
            style={{ color: linkColor, textDecorationLine: 'underline' }}
            onPress={() => handleLinkPress(href)}
            accessibilityRole="link"
          >
            {part}
          </Text>
        );
      }
      return <Text key={startKey + i}>{renderMentionParts(part, textColor, linkColor, startKey + i * 100)}</Text>;
    });
  };

  const renderTextWithLinks = (text: string, textColor: string, mine?: boolean) => {
    return renderFormattedText(text, textColor, mine);
  };

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter(m => m.content.toLowerCase().includes(q));
  }, [messages, searchQuery]);

  const searchMatchIds = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return filteredMessages.map(m => m.id);
  }, [filteredMessages, searchQuery]);

  useEffect(() => {
    if (searchMatchIds.length > 0) {
      setSearchMatchIndex(0);
    }
  }, [searchMatchIds.length > 0 ? searchMatchIds[0] : '']);

  useEffect(() => {
    if (!searchMode || searchMatchIds.length === 0) return;
    const targetId = searchMatchIds[searchMatchIndex];
    if (!targetId) return;
    const idx = messageIndexMap.get(targetId) ?? -1;
    if (idx >= 0) {
      setTimeout(() => flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.4 }), 100);
    }
  }, [searchMatchIndex, searchMode]);

  const groupedMessagesRef = useRef<GroupedMessage[]>([]);
  const groupedMessages = useMemo(() => {
    const source = searchMode ? filteredMessages : messages;
    const grouped: GroupedMessage[] = [];
    let lastDate: string | null = null;
    let lastSender: string | null = null;
    let unreadInserted = false;
    const processedGroupIds = new Set<string>();

    const mediaGroupMap = new Map<string, Message[]>();
    for (const m of source) {
      if (m.media_group_id) {
        let arr = mediaGroupMap.get(m.media_group_id);
        if (!arr) { arr = []; mediaGroupMap.set(m.media_group_id, arr); }
        arr.push(m);
      }
    }

    source.forEach((msg, idx) => {
      if (msg.media_group_id && processedGroupIds.has(msg.media_group_id)) return;
      if (chatInfo?.type === 'channel' && msg.message_type === 'call') return;

      const msgDate = formatDate(msg.created_at);

      if (msgDate !== lastDate) {
        grouped.push({ type: 'date', date: msgDate });
        lastDate = msgDate;
        lastSender = null;
      }

      if (!unreadInserted && !searchMode && firstUnreadIndex.current >= 0 && idx === firstUnreadIndex.current) {
        const localCount = source.slice(idx).filter(m => m.sender_id !== user?.id).length;
        const count = dbUnreadCount.current > 0 ? dbUnreadCount.current : localCount;
        grouped.push({ type: 'unread', unreadCount: count });
        unreadInserted = true;
      }

      let mediaGroupItems: Message[] | undefined;
      if (msg.media_group_id) {
        processedGroupIds.add(msg.media_group_id);
        mediaGroupItems = mediaGroupMap.get(msg.media_group_id);
      }

      const nextNonGroupIdx = (() => {
        for (let ni = idx + 1; ni < source.length; ni++) {
          if (msg.media_group_id && source[ni].media_group_id === msg.media_group_id) continue;
          return ni;
        }
        return source.length;
      })();

      const isFirstInGroup = msg.sender_id !== lastSender;
      const isLastInGroup = nextNonGroupIdx >= source.length || source[nextNonGroupIdx].sender_id !== msg.sender_id;

      grouped.push({ type: 'message', data: msg, isFirstInGroup, isLastInGroup, mediaGroupItems });
      lastSender = msg.sender_id;
    });

    groupedMessagesRef.current = grouped;
    return grouped;
  }, [messages, filteredMessages, searchMode]);

  const messageIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    groupedMessages.forEach((g, i) => {
      if (g.type === 'message' && g.data) {
        map.set(g.data.id, i);
        if (g.mediaGroupItems) {
          g.mediaGroupItems.forEach(gm => map.set(gm.id, i));
        }
      }
    });
    return map;
  }, [groupedMessages]);
  messageIndexMapRef.current = messageIndexMap;

  const handleContentSizeChange = useCallback((_w: number, h: number) => {
    if (searchModeRef.current) {
      lastContentHeight.current = h;
      return;
    }
    if (loadingMoreRef.current && preLoadMoreSnapshot.current) {
      const { offset, contentHeight } = preLoadMoreSnapshot.current;
      const delta = h - contentHeight;
      if (delta > 0) {
        programmaticScrollRef.current = true;
        flatListRef.current?.scrollToOffset({ offset: offset + delta, animated: false });
        setTimeout(() => { programmaticScrollRef.current = false; }, 100);
      }
      preLoadMoreSnapshot.current = null;
      lastContentHeight.current = h;
      return;
    }
    if (loadingMoreRef.current) {
      lastContentHeight.current = h;
      return;
    }
    const paddingDelta = lastPaddingBottom.current - (lastPaddingBottomApplied.current ?? lastPaddingBottom.current);
    lastPaddingBottomApplied.current = lastPaddingBottom.current;
    const effectiveH = h - Math.max(0, paddingDelta);
    const grew = effectiveH > lastContentHeight.current + 10;
    if (justSentRef.current) {
      justSentRef.current = false;
      lastContentHeight.current = h;
      scrollToBottomNow();
    } else if (initialScrollDone.current && grew && isNearBottom.current) {
      lastContentHeight.current = h;
      scrollToBottomNow();
    }
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      const tid = targetMessageIdRef.current;
      if (tid) {
        const targetIdx = messageIndexMapRef.current.get(tid) ?? -1;
        if (targetIdx >= 0) {
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index: targetIdx, animated: false, viewPosition: 0.4 });
            setHighlightedMessageId(tid);
            setTimeout(() => setHighlightedMessageId(null), 2500);
            setListReady(true);
          }, 50);
          setTimeout(() => markAsReadRef.current(), 3000);
          lastContentHeight.current = h;
          return;
        }
      }
      if (firstUnreadIndex.current >= 0) {
        const unreadGroupedIdx = groupedMessagesRef.current.findIndex(g => g.type === 'unread');
        if (unreadGroupedIdx >= 0) {
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index: unreadGroupedIdx, animated: false, viewOffset: 50 });
            setListReady(true);
          }, 50);
          setTimeout(() => markAsReadRef.current(), 3000);
          lastContentHeight.current = h;
          return;
        }
      }
      lastContentHeight.current = h;
      scrollToBottomNow();
      requestAnimationFrame(() => setListReady(true));
      setTimeout(() => markAsReadRef.current(), 3000);
    }
    lastContentHeight.current = h;
  }, []);

  useEffect(() => {
    if (!targetMessageId || !initialScrollDone.current) return;
    const targetIdx = messageIndexMap.get(targetMessageId) ?? -1;
    if (targetIdx >= 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: targetIdx, animated: true, viewPosition: 0.4 });
        setHighlightedMessageId(targetMessageId);
        setTimeout(() => setHighlightedMessageId(null), 2500);
      }, 100);
    } else if (targetIdx < 0 && messages.length > 0) {
      const loadAndScroll = async () => {
        const { data: targetMsg } = await supabase
          .from('messages')
          .select('created_at')
          .eq('id', targetMessageId)
          .eq('conversation_id', id)
          .maybeSingle();
        if (!targetMsg) return;
        const { data: older } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', id)
          .gte('created_at', targetMsg.created_at)
          .order('created_at', { ascending: false })
          .limit(200);
        if (!older || older.length === 0) return;
        const allIds = new Set(messages.map(m => m.id));
        const newMsgs = older.filter(m => !allIds.has(m.id));
        if (newMsgs.length > 0) {
          setMessages(prev => {
            const merged = [...prev, ...newMsgs].sort((a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            return merged;
          });
        }
      };
      loadAndScroll();
    }
  }, [targetMessageId, messageIndexMap]);

  const handleRetryMessage = async (msgId: string) => {
    setFailedMsgIds(prev => { const n = new Set(prev); n.delete(msgId); return n; });

    const msg = messagesRef.current.find(m => m.id === msgId);
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
    const isUploadedMedia = msg?.media_url?.startsWith(supabaseUrl + '/storage/');

    if (isUploadedMedia && msg) {
      try {
        const { data: inserted, error } = await supabase.from('messages')
          .insert({
            conversation_id: id,
            sender_id: user!.id,
            content: msg.content || '',
            message_type: msg.message_type || 'image',
            media_url: msg.media_url,
            media_duration: msg.media_duration,
            reply_to_id: msg.reply_to_id,
            is_read: false,
            expires_at: msg.expires_at,
            media_group_id: msg.media_group_id,
          })
          .select('id, created_at')
          .single();
        if (error) throw error;
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m));
        uploadIdByTempIdRef.current.delete(msgId);
        supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id).then(null, () => {});
      } catch (e: any) {
        console.error('[chat] Retry DB insert failed:', e?.message ?? e);
        setFailedMsgIds(prev => new Set(prev).add(msgId));
      }
      return;
    }

    const uploadId = uploadIdByTempIdRef.current.get(msgId);
    if (uploadId) {
      setUploadingMsgIds(prev => new Set(prev).add(msgId));
      setUploadProgress(prev => new Map(prev).set(msgId, 0));
      retryUpload(uploadId);
    } else {
      retryQueueItem(msgId);
    }
  };

  const handleLongPress = (msg: Message) => {
    setSelectedMessage(msg);
  };

  const handleReply = (msg: Message) => {
    setReplyTo(msg);
    setSelectedMessage(null);
    inputRef.current?.focus();
  };

  const handleEdit = (msg: Message) => {
    setEditingMessage(msg);
    setInput(msg.content);
    setSelectedMessage(null);
    inputRef.current?.focus();
  };

  const handleForward = (msg: Message) => {
    setForwardMessage(msg);
    setSelectedMessage(null);
    setShowForwardModal(true);
    loadConversationsForForward();
  };

  const conversationStartDate = useMemo(() => {
    if (hasMore || messages.length === 0) return null;
    const first = messages[0];
    const d = new Date(first.created_at);
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const now = new Date();
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    if (year === now.getFullYear()) return `${day} ${month}, ${hours}:${mins}`;
    return `${day} ${month} ${year}, ${hours}:${mins}`;
  }, [hasMore, messages]);

  const chatKeyExtractor = useCallback((item: GroupedMessage, _idx: number) => {
    if (item.type === 'message') return item.data!.id;
    if (item.type === 'date') return `date-${item.date}`;
    if (item.type === 'unread') return 'unread-separator';
    return `${item.type}-${item.date || _idx}`;
  }, []);

  // When user manually drags: cancel any in-flight programmatic scroll immediately
  const handleScrollBeginDrag = useCallback(() => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      pendingScrollToEnd.current = false;
    }
  }, []);

  // Final scroll position after a momentum fling — more reliable than throttled onScroll
  const handleMomentumScrollEnd = useCallback((e: any) => {
    if (programmaticScrollRef.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    currentScrollOffsetRef.current = contentOffset.y;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const atBottom = distanceFromBottom <= 80;
    isNearBottom.current = atBottom;
    if (showScrollDownRef.current === atBottom) {
      showScrollDownRef.current = !atBottom;
      setShowScrollDown(!atBottom);
    }
    if (atBottom) {
      setUnreadScrollCount(0);
      if (!wasAtBottomRef.current) markAsReadRef.current();
    }
    wasAtBottomRef.current = atBottom;
  }, []);

  const keyboardOffset = keyboardHeight > 0 ? keyboardHeight - insets.bottom : 0;
  const inputBarBottom = keyboardOffset + Math.max(insets.bottom, 8) + 4;
  // Height: inputBar (56) + optional reply banner (~52) + border
  const inputAreaHeight = 56 + (replyTo || editingMessage ? 52 : 0);

  const messagesListContentStyle = useMemo(() => {
    const scheduledBannerHeight = scheduledMessages.length > 0 ? 32 : 0;
    const paddingBottom = 60 + (replyTo || editingMessage ? 48 : 0) + scheduledBannerHeight + (keyboardHeight > 0 ? keyboardHeight - insets.bottom : 0) + Math.max(insets.bottom, 4);
    lastPaddingBottom.current = paddingBottom;
    return [
      styles.messagesList,
      { paddingTop: Math.max(insets.top, 8) + 60 + 8, paddingBottom },
      chatInfo?.type === 'channel' && { paddingHorizontal: 8 },
    ];
  }, [insets.top, insets.bottom, replyTo, editingMessage, keyboardHeight, chatInfo?.type, scheduledMessages.length]);

  const scrollDownButtonBottom = inputBarBottom + inputAreaHeight + 8;

  const showScrollDownRef = useRef(false);
  const loadOlderRef = useRef(loadOlderMessages);
  loadOlderRef.current = loadOlderMessages;
  const handleFlatListScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    currentScrollOffsetRef.current = contentOffset.y;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const atBottom = distanceFromBottom <= 80;
    if (!programmaticScrollRef.current) {
      isNearBottom.current = atBottom;
      if (showScrollDownRef.current === atBottom) {
        showScrollDownRef.current = !atBottom;
        setShowScrollDown(!atBottom);
      }
      if (atBottom) {
        setUnreadScrollCount(0);
        if (!wasAtBottomRef.current) markAsReadRef.current();
      }
      wasAtBottomRef.current = atBottom;
    }
    if (pendingScrollToEnd.current && distanceFromBottom > 50) {
      pendingScrollToEnd.current = false;
    }
    if (contentOffset.y < 300 && initialScrollDone.current) {
      loadOlderRef.current();
    }
  }, []);

  const renderItem = useCallback(({ item }: { item: GroupedMessage }) => {
    if (item.type === 'date') {
      return (
        <View style={styles.dateSeparatorContainer}>
          <View style={[styles.dateBadge, { backgroundColor: colors.backgroundTertiary }]}>
            <Text style={[styles.dateSeparator, { color: colors.textSecondary }]}>{item.date}</Text>
          </View>
        </View>
      );
    }

    if (item.type === 'unread') {
      const countLabel = item.unreadCount && item.unreadCount > 0
        ? `${item.unreadCount} ${item.unreadCount === 1 ? 'непрочитанное' : item.unreadCount < 5 ? 'непрочитанных' : 'непрочитанных'}`
        : 'Непрочитанные';
      return (
        <View style={styles.unreadSeparatorContainer}>
          <View style={[styles.unreadLine, { backgroundColor: colors.primary }]} />
          <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.unreadBadgeText}>{countLabel}</Text>
          </View>
          <View style={[styles.unreadLine, { backgroundColor: colors.primary }]} />
        </View>
      );
    }

    const msg = item.data!;
    const isChannelPost = chatInfo.type === 'channel';
    const usePostStyle = isChannelPost;
    const isChannelAdminUser = isChannelPost && (
      groupMembers.find(m => m.user_id === user?.id)?.role === 'admin' ||
      groupMembers.find(m => m.user_id === user?.id)?.role === 'owner' ||
      myChannelRoleEager === 'admin' || myChannelRoleEager === 'owner'
    );
    const isMine = msg.sender_id === user?.id;
    const spacing = item.isLastInGroup ? chatSpacing : 2;
    const isActiveSearchMatch = searchMode && searchMatchIds.length > 0 && searchMatchIds[searchMatchIndex] === msg.id;
    const isHighlighted = highlightedMessageId === msg.id;

    if (msg.message_type === 'call') {
      let callMeta: { call_type?: string; status?: string; duration?: number; call_id?: string; caller_id?: string } = {};
      try { callMeta = JSON.parse(msg.content); } catch {}
      const isVideoCall = callMeta.call_type === 'video';
      const callDuration = callMeta.duration || 0;
      const callStatus = callMeta.status || 'ended';
      const isMissed = callStatus === 'missed' || callStatus === 'declined';
      const wasOutgoing = callMeta.caller_id === user?.id;

      const fmtDur = (s: number) => {
        if (s <= 0) return '';
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
      };

      let label = '';
      if (isMissed) {
        label = wasOutgoing ? 'Нет ответа' : 'Пропущенный звонок';
      } else {
        label = (isVideoCall ? 'Видеозвонок' : 'Голосовой звонок') + (callDuration > 0 ? ` \u2014 ${fmtDur(callDuration)}` : '');
      }

      const iconColor = isMissed ? (colors.error || '#EF4444') : (colors.success || '#22C55E');

      return (
        <View style={[styles.callSystemMsg, { marginBottom: spacing }]}>
          <TouchableOpacity
            style={[styles.callSystemCard, { backgroundColor: colors.backgroundSecondary, borderColor: `${colors.text}0A` }]}
            activeOpacity={0.7}
            onPress={() => {
              if (chatInfo.other_user_id) {
                initiateCall(isVideoCall ? 'video' : 'voice');
              }
            }}
          >
            <View style={[styles.callSystemIcon, { backgroundColor: isMissed ? `${colors.error}15` : `${colors.success}15` }]}>
              {isVideoCall ? <Video color={iconColor} size={16} /> : <PhoneIcon color={iconColor} size={16} />}
            </View>
            <View style={styles.callSystemInfo}>
              <Text style={[styles.callSystemLabel, { color: isMissed ? colors.error : colors.text }]}>{label}</Text>
              <Text style={[styles.callSystemTime, { color: colors.textTertiary }]}>
                {wasOutgoing ? 'Исходящий' : 'Входящий'} {'\u00B7'} {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <View style={[styles.callSystemAction, { backgroundColor: `${colors.primary}12` }]}>
              <PhoneIcon color={colors.primary} size={14} />
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <SwipeableMessage
        isMine={isMine}
        accentColor={colors.primary}
        enabled={!selectModeRef.current && !isChannelPost}
        onSwipeReply={() => {
          setReplyTo(msg);
          inputRef.current?.focus();
        }}
      >
      <Pressable
        onLongPress={() => {
          if (selectModeRef.current) return;
          hapticHeavy();
          handleLongPress(msg);
        }}
        onPress={() => {
          if (selectModeRef.current) { toggleSelect(msg.id); return; }
          const now = Date.now();
          if (now - lastTapRef.current.time < 300 && lastTapRef.current.msgId === msg.id) {
            lastTapRef.current = { time: 0, msgId: '' };
            hapticMedium();
            setShowReactionPicker(showReactionPickerRef.current === msg.id ? null : msg.id);
          } else {
            lastTapRef.current = { time: now, msgId: msg.id };
          }
        }}
        role="none"
        style={[styles.messageBubbleContainer, isMine ? styles.myMessageContainer : styles.otherMessageContainer, { marginBottom: spacing }, (isActiveSearchMatch || isHighlighted) && { backgroundColor: `${colors.primary}18`, borderRadius: 14 }, usePostStyle && { maxWidth: '100%', width: '100%', alignSelf: isMine ? 'flex-end' : 'flex-start' }]}
      >
        {selectModeRef.current && (
          <View style={[styles.selectCheckbox, { backgroundColor: selectedIdsRef.current.has(msg.id) ? colors.primary : 'transparent', borderColor: selectedIdsRef.current.has(msg.id) ? colors.primary : colors.textTertiary }]}>
            {selectedIdsRef.current.has(msg.id) && <Check color="#FFFFFF" size={12} strokeWidth={3} />}
          </View>
        )}
        <View
          style={[
            styles.messageBubble,
            isMine
              ? [styles.myMessage, { backgroundColor: colors.messageSent }]
              : [styles.otherMessage, { backgroundColor: colors.messageReceived }],
            item.isLastInGroup ? (isMine ? styles.myMessageTail : styles.otherMessageTail) : undefined,
            msg.message_type === 'text' && msg.content && !msg.reply_to_id && !msg.status_snapshot && isEmojiOnly(msg.content) > 0 && { backgroundColor: 'transparent', paddingHorizontal: 4, paddingVertical: 2 },
            msg.message_type === 'video_note' && { backgroundColor: 'transparent', padding: 0 },
            msg.message_type === 'voice' && { paddingHorizontal: 8, paddingVertical: 6 },
            (msg.message_type === 'image' || msg.message_type === 'video') && !msg.content && !msg.reply_to_id && !msg.forwarded_from_id && { padding: 0 },
            (msg.message_type === 'image' || msg.message_type === 'video') && !!msg.content && { paddingBottom: 8, paddingHorizontal: 0, paddingTop: 0 },
            usePostStyle && { borderRadius: 12, maxWidth: '88%', width: '88%', overflow: 'hidden', alignSelf: isMine ? 'flex-end' as const : 'flex-start' as const },
            usePostStyle && (msg.message_type === 'image' || msg.message_type === 'video') && !msg.content && !msg.reply_to_id && !msg.forwarded_from_id && { borderRadius: 12, padding: 0 },
          ]}
        >
          {msg.forwarded_from_id && (
            <View style={[styles.forwardedBadge, { borderLeftColor: isMine ? sentColors.textSoft : colors.primary }]}>
              <CornerUpRight color={isMine ? sentColors.textSoft : colors.primary} size={12} />
              <Text style={[styles.forwardedText, { color: isMine ? sentColors.textSoft : colors.textSecondary }]}>
                Переслано
              </Text>
            </View>
          )}

          {msg.status_snapshot && (
            <TouchableOpacity activeOpacity={0.7} onPress={() => handleStoryQuoteTap(msg.status_snapshot, msg.status_id)} style={[styles.storyQuoteCard, { backgroundColor: isMine ? sentColors.overlay12 : `${colors.primary}08`, borderLeftColor: isMine ? sentColors.accentBorder : colors.primary }]}>
              {msg.status_snapshot.media_url && (msg.status_snapshot.media_type === 'image' || msg.status_snapshot.media_type === 'video') ? (
                <View style={styles.storyQuoteRow}>
                  <View style={styles.storyQuoteThumb}>
                    {msg.status_snapshot.media_type === 'video' && Platform.OS === 'web' ? (
                      // @ts-ignore
                      <video src={msg.status_snapshot.media_url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                    ) : (
                      <CachedImage uri={msg.status_snapshot.media_url} style={styles.storyQuoteThumbImg} contentFit="cover" />
                    )}
                  </View>
                  <View style={styles.storyQuoteInfo}>
                    <Text style={[styles.storyQuoteLabel, { color: isMine ? sentColors.textFaint : colors.textTertiary }]}>
                      {isMine ? `Ответ на статус ${msg.status_snapshot.author_name}` : 'Ответ на ваш статус'}
                    </Text>
                    {msg.status_snapshot.content ? (
                      <Text style={[styles.storyQuoteText, { color: isMine ? sentColors.textSoft : colors.textSecondary }]} numberOfLines={2}>
                        {msg.status_snapshot.content}
                      </Text>
                    ) : (
                      <Text style={[styles.storyQuoteText, { color: isMine ? sentColors.textSoft : colors.textSecondary }]}>
                        {msg.status_snapshot.media_type === 'video' ? 'Видео' : 'Фото'}
                      </Text>
                    )}
                  </View>
                </View>
              ) : msg.status_snapshot.media_type === 'voice' ? (
                <View style={styles.storyQuoteInfo}>
                  <Text style={[styles.storyQuoteLabel, { color: isMine ? sentColors.textFaint : colors.textTertiary }]}>
                    {isMine ? `Ответ на статус ${msg.status_snapshot.author_name}` : 'Ответ на ваш статус'}
                  </Text>
                  <Text style={[styles.storyQuoteText, { color: isMine ? sentColors.textSoft : colors.textSecondary }]}>
                    Голосовой статус
                  </Text>
                </View>
              ) : (
                <View style={[styles.storyQuoteColorBlock, { backgroundColor: msg.status_snapshot.background_color || '#1E88E5' }]}>
                  <View style={styles.storyQuoteRow}>
                    <View style={[styles.storyQuoteThumb, { backgroundColor: msg.status_snapshot.background_color || '#1E88E5', justifyContent: 'center', alignItems: 'center' }]}>
                      <Text style={{ color: msg.status_snapshot.text_color || '#FFF', fontSize: 9, textAlign: 'center' }} numberOfLines={3}>
                        {msg.status_snapshot.content}
                      </Text>
                    </View>
                    <View style={styles.storyQuoteInfo}>
                      <Text style={[styles.storyQuoteLabel, { color: isMine ? sentColors.textFaint : colors.textTertiary }]}>
                        {isMine ? `Ответ на статус ${msg.status_snapshot.author_name}` : 'Ответ на ваш статус'}
                      </Text>
                      <Text style={[styles.storyQuoteText, { color: isMine ? sentColors.textSoft : colors.textSecondary }]} numberOfLines={2}>
                        {msg.status_snapshot.content || 'Текстовый статус'}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          )}

          {msg.reply_to && (
            <View style={[styles.replyPreview, { backgroundColor: isMine ? sentColors.overlay15 : `${colors.primary}15`, borderLeftColor: isMine ? sentColors.accentBorder : colors.primary }]}>
              <Text style={[styles.replyName, { color: isMine ? sentColors.accent : colors.primary }]} numberOfLines={1}>
                {msg.reply_to.sender_name}
              </Text>
              <Text style={[styles.replyContent, { color: isMine ? sentColors.textSoft : colors.textSecondary }]} numberOfLines={1}>
                {msg.reply_to.message_type === 'voice' ? 'Голосовое сообщение' :
                 msg.reply_to.message_type === 'image' ? 'Фото' :
                 msg.reply_to.message_type === 'video' ? 'Видео' :
                 msg.reply_to.message_type === 'video_note' ? 'Видеокружок' :
                 msg.reply_to.message_type === 'contact' ? 'Контакт' :
                 msg.reply_to.message_type === 'location' ? 'Геолокация' :
                 msg.reply_to.content}
              </Text>
            </View>
          )}

          {msg.message_type === 'text' && msg.content ? (() => {
            const emojiCount = !msg.status_snapshot ? isEmojiOnly(msg.content) : 0;
            if (emojiCount > 0) {
              const baseFontSize = emojiCount === 1 ? 58 : emojiCount === 2 ? 46 : 38;
              const scaledSize = baseFontSize * fontScale;
              return <Text style={{ fontSize: scaledSize, lineHeight: scaledSize * 1.18, textAlign: 'center', letterSpacing: emojiCount > 1 ? 2 : 0 }}>{msg.content}</Text>;
            }
            return usePostStyle
              ? <CollapsibleChannelText content={msg.content} textColor={isMine ? sentColors.text : colors.text} isMine={isMine} renderFn={renderTextWithLinks} fontScale={fontScale} bgColor={isMine ? colors.messageSent : colors.messageReceived} />
              : renderTextWithLinks(msg.content, isMine ? sentColors.text : colors.text, isMine);
          })() : null}

          {msg.message_type === 'text' && msg.content && (() => {
            URL_REGEX.lastIndex = 0;
            const urlMatch = msg.content.match(URL_REGEX);
            if (!urlMatch) return null;
            const matchedUrl = urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`;
            return <LinkPreviewCard url={matchedUrl} bubbleColor={isMine ? colors.messageSent : colors.messageReceived} textColor={isMine ? sentColors.text : colors.text} />;
          })()}

          {(msg.message_type === 'image' || msg.message_type === 'video') && (() => {
            const groupItems = item.mediaGroupItems;
            if (groupItems && groupItems.length > 1) {
              const anyUploading = groupItems.some(gm => uploadingMsgIdsRef.current.has(gm.id));
              const collageItems = groupItems.map(gm => ({
                id: gm.id,
                media_url: gm.media_url,
                message_type: gm.message_type as 'image' | 'video',
                isUploading: uploadingMsgIdsRef.current.has(gm.id),
                uploadProgress: uploadProgressRef.current.get(gm.id) ?? 0,
              }));
              const lastGroupMsg = groupItems[groupItems.length - 1];
              return (
                <View style={usePostStyle ? { borderWidth: 0.3, borderColor: 'rgba(128,128,128,0.3)' } : undefined}>
                  <MediaCollage
                    items={collageItems}
                    maxWidth={usePostStyle ? CHANNEL_MEDIA_W : MAX_MEDIA_W}
                    borderRadius={usePostStyle ? 0 : undefined}
                    fixedAspectRatio={usePostStyle ? 16 / 9 : undefined}
                    autoPlayVideo
                    onPress={(idx) => {
                      const gm = groupItems[idx];
                      if (gm?.media_url) {
                        openGalleryViewer(gm.id);
                      }
                    }}
                    onLongPress={() => { if (!selectModeRef.current) { hapticHeavy(); handleLongPress(msg); } }}
                  />
                  {!anyUploading && (
                    <View style={styles.mediaTimeOverlay}>
                      {lastGroupMsg.edited_at && <Text style={styles.mediaTimeOverlayText}>ред.</Text>}
                      {starredMessageIdsRef.current.has(lastGroupMsg.id) && <Star color="#FFD60A" fill="#FFD60A" size={10} />}
                      {lastGroupMsg.is_pinned && <Pin color="rgba(255,255,255,0.85)" size={10} />}
                      {isChannelPost && (
                        <View style={styles.viewCountContainer}>
                          <Eye color="rgba(255,255,255,0.85)" size={11} />
                          <Text style={styles.mediaTimeOverlayText}>{viewCountsRef.current.get(lastGroupMsg.id) || 1}</Text>
                        </View>
                      )}
                      <Text style={styles.mediaTimeOverlayText}>{formatTime(lastGroupMsg.created_at)}</Text>
                      {isMine && !isChannelPost && failedMsgIdsRef.current.has(lastGroupMsg.id) ? (
                        <TouchableOpacity onPress={() => handleRetryMessage(lastGroupMsg.id)} style={{ padding: 4 }}>
                          <AlertCircle color="#FF4444" size={14} />
                        </TouchableOpacity>
                      ) : isMine && !isChannelPost && (
                        <TouchableOpacity onPress={() => showReadReceipts(lastGroupMsg)}>
                          {lastGroupMsg.id.startsWith('temp-') ? (
                            <RefreshCw color="rgba(255,255,255,0.85)" size={12} />
                          ) : (effectiveOtherLastRead && new Date(effectiveOtherLastRead) >= new Date(lastGroupMsg.created_at)) ? (
                            <CheckCheck color="#4FC3F7" size={14} />
                          ) : (
                            <Check color="rgba(255,255,255,0.85)" size={14} />
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            }

            if (msg.message_type === 'image') {
              const isUploading = uploadingMsgIdsRef.current.has(msg.id);
              const hasCaption = !!msg.content;
              if (msg.media_url) {
                const singleItem = [{
                  id: msg.id,
                  media_url: msg.media_url,
                  message_type: 'image' as const,
                  isUploading,
                  uploadProgress: uploadProgressRef.current.get(msg.id) ?? 0,
                }];
                return (
                  <View style={hasCaption ? { marginBottom: 4 } : undefined}>
                    <View style={[hasCaption ? { borderRadius: 16, overflow: 'hidden', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined, usePostStyle && { borderRadius: 0, borderWidth: 0.3, borderColor: 'rgba(128,128,128,0.3)' }]}>
                      <MediaCollage
                        items={singleItem}
                        maxWidth={usePostStyle ? CHANNEL_MEDIA_W : MAX_MEDIA_W}
                        borderRadius={usePostStyle ? 0 : undefined}
                        fixedAspectRatio={usePostStyle ? 16 / 9 : undefined}
                        autoPlayVideo
                        onPress={() => !isUploading && msg.id ? openGalleryViewer(msg.id) : null}
                        onLongPress={() => { if (!selectModeRef.current) { hapticHeavy(); handleLongPress(msg); } }}
                      />
                    </View>
                    {!hasCaption && !isUploading && (
                      <View style={styles.mediaTimeOverlay}>
                        {msg.edited_at && <Text style={styles.mediaTimeOverlayText}>ред.</Text>}
                        {starredMessageIdsRef.current.has(msg.id) && <Star color="#FFD60A" fill="#FFD60A" size={10} />}
                        {msg.is_pinned && <Pin color="rgba(255,255,255,0.85)" size={10} />}
                        {isChannelPost && (
                          <View style={styles.viewCountContainer}>
                            <Eye color="rgba(255,255,255,0.85)" size={11} />
                            <Text style={styles.mediaTimeOverlayText}>{viewCountsRef.current.get(msg.id) || 1}</Text>
                          </View>
                        )}
                        <Text style={styles.mediaTimeOverlayText}>{formatTime(msg.created_at)}</Text>
                        {isMine && !isChannelPost && failedMsgIdsRef.current.has(msg.id) ? (
                          <TouchableOpacity onPress={() => handleRetryMessage(msg.id)} style={{ padding: 4 }}>
                            <AlertCircle color="#FF4444" size={14} />
                          </TouchableOpacity>
                        ) : isMine && !isChannelPost && (
                          <TouchableOpacity onPress={() => showReadReceipts(msg)}>
                            {msg.id.startsWith('temp-') ? (
                              <RefreshCw color="rgba(255,255,255,0.85)" size={12} />
                            ) : (effectiveOtherLastRead && new Date(effectiveOtherLastRead) >= new Date(msg.created_at)) ? (
                              <CheckCheck color="#4FC3F7" size={14} />
                            ) : (
                              <Check color="rgba(255,255,255,0.85)" size={14} />
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              }
              return (
                <View style={[styles.mediaPlaceholder, { backgroundColor: colors.surfaceTertiary }]}>
                  <ActivityIndicator color={colors.primary} size="small" />
                </View>
              );
            }

            if (msg.message_type === 'video') {
              if (msg.media_url) {
                const isUploading = uploadingMsgIdsRef.current.has(msg.id);
                const hasCaption = !!msg.content;
                const singleItem = [{
                  id: msg.id,
                  media_url: msg.media_url,
                  message_type: 'video' as const,
                  isUploading,
                  uploadProgress: uploadProgressRef.current.get(msg.id) ?? 0,
                }];
                return (
                  <View style={hasCaption ? { marginBottom: 4 } : undefined}>
                    <View style={[hasCaption ? { borderRadius: 16, overflow: 'hidden', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined, usePostStyle && { borderRadius: 0, borderWidth: 0.3, borderColor: 'rgba(128,128,128,0.3)' }]}>
                      <MediaCollage
                        items={singleItem}
                        maxWidth={usePostStyle ? CHANNEL_MEDIA_W : MAX_MEDIA_W}
                        borderRadius={usePostStyle ? 0 : undefined}
                        fixedAspectRatio={usePostStyle ? 16 / 9 : undefined}
                        autoPlayVideo
                        onPress={() => { if (!isUploading && msg.id) openGalleryViewer(msg.id); }}
                        onLongPress={() => { if (!selectModeRef.current) { hapticHeavy(); handleLongPress(msg); } }}
                      />
                    </View>
                    {!hasCaption && !isUploading && (
                      <View style={styles.mediaTimeOverlay}>
                        {msg.edited_at && <Text style={styles.mediaTimeOverlayText}>ред.</Text>}
                        {starredMessageIdsRef.current.has(msg.id) && <Star color="#FFD60A" fill="#FFD60A" size={10} />}
                        {msg.is_pinned && <Pin color="rgba(255,255,255,0.85)" size={10} />}
                        {isChannelPost && (
                          <View style={styles.viewCountContainer}>
                            <Eye color="rgba(255,255,255,0.85)" size={11} />
                            <Text style={styles.mediaTimeOverlayText}>{viewCountsRef.current.get(msg.id) || 1}</Text>
                          </View>
                        )}
                        <Text style={styles.mediaTimeOverlayText}>{formatTime(msg.created_at)}</Text>
                        {isMine && !isChannelPost && failedMsgIdsRef.current.has(msg.id) ? (
                          <TouchableOpacity onPress={() => handleRetryMessage(msg.id)} style={{ padding: 4 }}>
                            <AlertCircle color="#FF4444" size={14} />
                          </TouchableOpacity>
                        ) : isMine && !isChannelPost && (
                          <TouchableOpacity onPress={() => showReadReceipts(msg)}>
                            {msg.id.startsWith('temp-') ? (
                              <RefreshCw color="rgba(255,255,255,0.85)" size={12} />
                            ) : (effectiveOtherLastRead && new Date(effectiveOtherLastRead) >= new Date(msg.created_at)) ? (
                              <CheckCheck color="#4FC3F7" size={14} />
                            ) : (
                              <Check color="rgba(255,255,255,0.85)" size={14} />
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              }
              return (
                <View style={[styles.mediaPlaceholder, { backgroundColor: colors.surfaceTertiary }]}>
                  <ActivityIndicator color={colors.primary} size="small" />
                </View>
              );
            }
            return null;
          })()}

          {(msg.message_type === 'image' || msg.message_type === 'video') && msg.content ? (
            <View style={{ marginTop: 6, paddingHorizontal: 12 }}>
              {usePostStyle
                ? <CollapsibleChannelText content={msg.content} textColor={isMine ? sentColors.text : colors.text} isMine={isMine} renderFn={renderTextWithLinks} fontScale={fontScale} bgColor={isMine ? colors.messageSent : colors.messageReceived} />
                : renderTextWithLinks(msg.content, isMine ? sentColors.text : colors.text, isMine)}
              {(() => {
                URL_REGEX.lastIndex = 0;
                const urlMatch = msg.content.match(URL_REGEX);
                if (urlMatch) {
                  const matchedUrl = urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`;
                  return <LinkPreviewCard url={matchedUrl} bubbleColor={isMine ? colors.messageSent : colors.messageReceived} textColor={isMine ? sentColors.text : colors.text} />;
                }
                return null;
              })()}
            </View>
          ) : null}

          {msg.message_type === 'voice' && (() => {
            const isSlowUploading = slowUploadMsgIdsRef.current.has(msg.id);
            const isThisPlaying = voicePlayer.isPlaying(msg.id);
            const isThisTrack = voicePlayer.state.track?.id === msg.id;
            const playBtnBg = isMine ? 'rgba(255,255,255,0.25)' : colors.primary;
            const playIconColor = isMine ? '#FFFFFF' : '#FFFFFF';
            const voiceError = isThisTrack ? voicePlayer.state.error : null;
            if (isSlowUploading) {
              const pct = Math.min(100, Math.round(uploadProgressRef.current.get(msg.id) ?? 0));
              return (
                <View style={[styles.voiceContainer, { alignItems: 'center', gap: 10, minWidth: 160 }]}>
                  <ActivityIndicator color={isMine ? '#FFFFFF' : colors.primary} size="small" />
                  <Text style={{ color: isMine ? sentColors.textSoft : colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                    Загрузка{pct > 0 ? ` ${pct}%` : '...'}
                  </Text>
                  {pct > 0 && (
                    <View style={{ width: 100, height: 3, backgroundColor: isMine ? 'rgba(255,255,255,0.2)' : `${colors.primary}20`, borderRadius: 2, overflow: 'hidden' }}>
                      <View style={{ width: `${pct}%`, height: 3, backgroundColor: isMine ? '#FFFFFF' : colors.primary, borderRadius: 2 }} />
                    </View>
                  )}
                </View>
              );
            }
            return (
            <Pressable style={styles.voiceContainer} onLongPress={() => { if (!selectModeRef.current) { hapticHeavy(); handleLongPress(msg); } }} delayLongPress={300}>
              <TouchableOpacity
                style={[styles.voicePlayButton, { backgroundColor: playBtnBg }]}
                onPress={() => playVoice(msg)}
                activeOpacity={0.7}
              >
                {isThisPlaying ? (
                  <Pause color={playIconColor} size={20} fill={playIconColor} />
                ) : (
                  <Play color={playIconColor} size={20} fill={playIconColor} style={{ marginLeft: 2 }} />
                )}
              </TouchableOpacity>
              <View style={styles.voiceRight}>
                {voiceError ? (
                  <Text style={{ color: colors.error, fontSize: 13, paddingVertical: 6 }}>{voiceError}</Text>
                ) : (
                  <>
                    <ChatWaveform
                      messageId={msg.id}
                      isActiveTrack={isThisTrack}
                      playedColor={isMine ? '#FFFFFF' : colors.primary}
                      unplayedColor={isMine ? sentColors.waveUnplayed : `${colors.primary}30`}
                    />
                    <View style={styles.voiceInfoRow}>
                      <VoiceDuration
                        isThisTrack={isThisTrack}
                        totalDuration={msg.media_duration}
                        color={isMine ? sentColors.textSoft : colors.textSecondary}
                      />
                      {isThisTrack && (
                        <TouchableOpacity
                          style={[styles.voiceSpeedBtn, { backgroundColor: isMine ? sentColors.overlay20 : `${colors.primary}15` }]}
                          onPress={voicePlayer.toggleSpeed}
                          activeOpacity={0.6}
                        >
                          <Text style={[styles.voiceSpeedText, { color: isMine ? '#FFFFFF' : colors.primary }]}>
                            {voicePlayer.state.speed}x
                          </Text>
                        </TouchableOpacity>
                      )}
                      <View style={{ flex: 1 }} />
                      {msg.edited_at && <Text style={[styles.editedLabel, { color: isMine ? sentColors.textSoft : colors.textTertiary }]}>ред.</Text>}
                      <Text style={[styles.messageTime, { color: isMine ? sentColors.textSoft : colors.textTertiary }]}>
                        {formatTime(msg.created_at)}
                      </Text>
                      {isMine && !isChannelPost && !failedMsgIdsRef.current.has(msg.id) && (
                        <TouchableOpacity style={{ marginLeft: 2 }} onPress={() => showReadReceipts(msg)}>
                          {msg.id.startsWith('temp-') ? (
                            <RefreshCw color="rgba(255,255,255,0.7)" size={12} />
                          ) : (effectiveOtherLastRead && new Date(effectiveOtherLastRead) >= new Date(msg.created_at)) ? (
                            <CheckCheck color="#4FC3F7" size={13} />
                          ) : (
                            <Check color="rgba(255,255,255,0.7)" size={13} />
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                )}
              </View>
            </Pressable>
            );
          })()}

          {msg.message_type === 'file' && (
            <TouchableOpacity
              style={[styles.fileContainer, { backgroundColor: isMine ? sentColors.overlay12 : `${colors.primary}08`, borderColor: isMine ? sentColors.overlay15 : `${colors.primary}20` }]}
              onPress={() => msg.media_url ? Linking.openURL(msg.media_url) : null}
              onLongPress={() => { if (!selectModeRef.current) { hapticHeavy(); handleLongPress(msg); } }}
              delayLongPress={300}
              activeOpacity={0.7}
            >
              <View style={[styles.fileIconWrap, { backgroundColor: isMine ? sentColors.overlay20 : `${colors.primary}18` }]}>
                <FileIcon color={isMine ? '#FFFFFF' : colors.primary} size={22} />
              </View>
              <View style={styles.fileInfo}>
                <Text style={[styles.fileName, { color: isMine ? sentColors.text : colors.text }]} numberOfLines={1}>
                  {msg.content || 'Файл'}
                </Text>
                <Text style={[styles.fileSub, { color: isMine ? sentColors.textFaint : colors.textSecondary }]}>
                  Нажмите для загрузки
                </Text>
              </View>
              <FileDown color={isMine ? sentColors.textFaint : colors.textSecondary} size={18} />
            </TouchableOpacity>
          )}

          {msg.message_type === 'location' && (() => {
            let locData: { lat: number; lng: number; live?: boolean } | null = null;
            try { locData = JSON.parse(msg.content); } catch {}
            const yandexMapUrl = locData ? `https://yandex.ru/maps/?pt=${locData.lng},${locData.lat}&z=15&l=map` : (msg.media_url || '');
            const yandexStaticUrl = locData ? `https://static-maps.yandex.ru/v1?ll=${locData.lng},${locData.lat}&z=15&size=450,200&l=map&pt=${locData.lng},${locData.lat},pm2rdm&apikey=7d5a4127-acda-4a9d-a87a-2db10295ca5e` : '';
            return (
              <TouchableOpacity
                style={[styles.locationContainer, { borderColor: isMine ? sentColors.overlay15 : `${colors.primary}20` }]}
                onPress={() => { if (Platform.OS === 'web') window.open(yandexMapUrl, '_blank'); else Linking.openURL(yandexMapUrl); }}
                activeOpacity={0.7}
              >
                <View style={[styles.locationMapPreview, { backgroundColor: isMine ? sentColors.overlay12 : `${colors.primary}08` }]}>
                  {locData && Platform.OS === 'web' ? (
                    <View style={{ width: '100%', height: '100%', position: 'relative' }}>
                      {/* @ts-ignore */}
                      <img src={yandexStaticUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', borderTopLeftRadius: 13, borderTopRightRadius: 13 }} alt="" />
                    </View>
                  ) : (
                    <MapPin color={isMine ? '#FFFFFF' : colors.primary} size={28} />
                  )}
                  {locData?.live && (
                    <View style={[styles.liveBadge, { backgroundColor: '#4CAF50' }]}>
                      <Text style={styles.liveBadgeText}>LIVE</Text>
                    </View>
                  )}
                </View>
                <View style={styles.locationDetails}>
                  <Text style={[styles.locationLabel, { color: isMine ? sentColors.text : colors.text }]}>
                    {locData?.live ? 'Геолокация в реальном времени' : 'Местоположение'}
                  </Text>
                  {locData && (
                    <Text style={[styles.locationCoords, { color: isMine ? sentColors.textFaint : colors.textSecondary }]}>
                      {locData.lat.toFixed(5)}, {locData.lng.toFixed(5)}
                    </Text>
                  )}
                </View>
                {Platform.OS === 'web' && (
                  <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, padding: 4 }}>
                    <ExternalLink color="#FFFFFF" size={12} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })()}

          {msg.message_type === 'video_note' && msg.media_url && (
              <Pressable style={styles.videoNoteContainer} onLongPress={() => { if (!selectModeRef.current) { hapticHeavy(); handleLongPress(msg); } }} delayLongPress={300}>
                <VideoNotePlayer
                  url={msg.media_url}
                  duration={msg.media_duration || 0}
                />
              </Pressable>
          )}

          {msg.message_type === 'contact' && (() => {
            let contactData: { name: string; phone: string; user_id?: string; avatar_url?: string | null } | null = null;
            try { contactData = JSON.parse(msg.content); } catch {}
            if (!contactData) return null;
            const letter = (contactData.name || '?').charAt(0).toUpperCase();
            return (
              <TouchableOpacity
                style={[styles.contactCardContainer, { backgroundColor: isMine ? sentColors.overlay12 : `${colors.primary}08`, borderColor: isMine ? sentColors.overlay15 : `${colors.primary}20` }]}
                onPress={async () => {
                  if (contactData?.user_id && user) {
                    const { data: membership } = await supabase
                      .from('conversation_members')
                      .select('conversation_id')
                      .eq('user_id', contactData.user_id);
                    if (membership && membership.length > 0) {
                      const { data: myMembership } = await supabase
                        .from('conversation_members')
                        .select('conversation_id')
                        .eq('user_id', user.id);
                      const myConvIds = new Set(myMembership?.map(m => m.conversation_id) || []);
                      const shared = membership.find(m => myConvIds.has(m.conversation_id));
                      if (shared) router.push({ pathname: '/chat/[id]', params: { id: shared.conversation_id } });
                    }
                  }
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.contactCardAvatar, { backgroundColor: isMine ? sentColors.overlay20 : `${colors.primary}18` }]}>
                  {contactData.avatar_url ? (
                    <CachedImage uri={contactData.avatar_url} style={{ width: 44, height: 44, borderRadius: 22 }} />
                  ) : (
                    <Text style={[styles.contactCardAvatarLetter, { color: isMine ? '#FFFFFF' : colors.primary }]}>{letter}</Text>
                  )}
                </View>
                <View style={styles.contactCardInfo}>
                  <Text style={[styles.contactCardName, { color: isMine ? sentColors.text : colors.text }]}>{contactData.name}</Text>
                  {contactData.phone ? (
                    <Text style={[styles.contactCardPhone, { color: isMine ? sentColors.textFaint : colors.textSecondary }]}>{contactData.phone}</Text>
                  ) : null}
                </View>
                <UserCircle color={isMine ? sentColors.textFaint : colors.textTertiary} size={20} />
              </TouchableOpacity>
            );
          })()}

          {/* Reactions display - inside bubble, below content */}
          {(() => {
            const msgReactions = reactionsMapRef.current.get(msg.id);
            if (!msgReactions || msgReactions.length === 0) return null;
            return (
              <View style={[styles.reactionsRow, { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 2 }]}>
                {msgReactions.map((r) => (
                  <ReactionChip key={r.emoji} reaction={r} messageId={msg.id} colors={colors} toggleReaction={toggleReaction} />
                ))}
                <TouchableOpacity
                  style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 11, backgroundColor: colors.backgroundTertiary, justifyContent: 'center', alignItems: 'center' }}
                  onPress={() => setShowReactionPicker(showReactionPickerRef.current === msg.id ? null : msg.id)}
                >
                  <SmilePlus color={colors.textTertiary} size={14} />
                </TouchableOpacity>
              </View>
            );
          })()}

          {/* Quick reaction picker - inside bubble */}
          {showReactionPickerRef.current === msg.id && !(chatInfo.type === 'channel' && channelAllowedReactions && channelAllowedReactions.length === 0) && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.quickReactionPicker, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, alignSelf: isMine ? 'flex-end' : 'flex-start', marginHorizontal: 8, marginBottom: 4 }]} contentContainerStyle={{ gap: 2, paddingHorizontal: 4 }}>
              {(chatInfo.type === 'channel' && channelAllowedReactions ? channelAllowedReactions : QUICK_REACTIONS).map((emoji) => (
                <TouchableOpacity key={emoji} style={styles.quickReactionItem} onPress={() => toggleReaction(msg.id, emoji)}>
                  <Text style={styles.quickReactionEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <View style={[styles.messageFooter, msg.message_type === 'video_note' && styles.videoNoteFooter, (msg.message_type === 'video' || msg.message_type === 'image') && !msg.content && { display: 'none' }, (msg.message_type === 'image' || msg.message_type === 'video') && msg.content && { paddingHorizontal: 12 }, msg.message_type === 'voice' && { display: 'none' }]}>
            {msg.edited_at && (
              <Text style={[styles.editedLabel, { color: msg.message_type === 'video_note' ? 'rgba(255,255,255,0.7)' : isMine ? sentColors.textSoft : colors.textTertiary }]}>ред.</Text>
            )}
            {starredMessageIdsRef.current.has(msg.id) && (
              <Star color={msg.message_type === 'video_note' ? '#FFD60A' : '#FFD60A'} fill="#FFD60A" size={10} />
            )}
            {msg.is_pinned && (
              <Pin color={msg.message_type === 'video_note' ? 'rgba(255,255,255,0.7)' : isMine ? sentColors.textSoft : colors.textTertiary} size={10} />
            )}
            {isChannelPost && (
              <View style={styles.viewCountContainer}>
                <Eye color={isMine ? sentColors.textSoft : colors.textTertiary} size={12} />
                <Text style={[styles.viewCountText, { color: isMine ? sentColors.textSoft : colors.textTertiary }]}>
                  {viewCountsRef.current.get(msg.id) || 1}
                </Text>
              </View>
            )}
            {(msg as any).is_e2e && <Lock color={isMine ? sentColors.textSoft : colors.textTertiary} size={10} style={{ marginRight: 2 }} />}
            <Text style={[styles.messageTime, { color: msg.message_type === 'video_note' ? 'rgba(255,255,255,0.85)' : isMine ? sentColors.textSoft : colors.textTertiary }]}>
              {formatTime(msg.created_at)}
            </Text>
            {isMine && !isChannelPost && failedMsgIdsRef.current.has(msg.id) ? (
              <TouchableOpacity style={{ marginLeft: 4, padding: 4 }} onPress={() => handleRetryMessage(msg.id)}>
                <AlertCircle color="#FF4444" size={14} />
              </TouchableOpacity>
            ) : isMine && !isChannelPost && (
              <TouchableOpacity style={{ marginLeft: 4 }} onPress={() => showReadReceipts(msg)}>
                {msg.id.startsWith('temp-') ? (
                  <RefreshCw color="rgba(255,255,255,0.7)" size={12} />
                ) : (effectiveOtherLastRead && new Date(effectiveOtherLastRead) >= new Date(msg.created_at)) ? (
                  <CheckCheck color="#4FC3F7" size={14} />
                ) : (
                  <Check color="rgba(255,255,255,0.7)" size={14} />
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

      </Pressable>
      </SwipeableMessage>
    );
  }, [colors, user?.id, chatInfo, searchMode, searchQuery, voiceExtraData, groupMembers, myChannelRoleEager]);

  const letter = chatInfo.name.charAt(0).toUpperCase() || '?';
  const isSavedChat = chatInfo.type === 'saved';
  const isChannel = chatInfo.type === 'channel';
  const myChannelRole = isChannel ? (groupMembers.find(m => m.user_id === user?.id)?.role || myChannelRoleEager) : null;
  const isChannelAdmin = myChannelRole === 'owner' || myChannelRole === 'admin';
  const isChannelMember = isChannel && !!myChannelRole;

  const handleInputChange = (text: string) => {
    setInput(text);
    if (text.length > 0) {
      broadcastTyping();
    } else if (presenceChannelRef.current) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      presenceChannelRef.current.track({ typing: false });
    }
    hapticKeypress();
  };

  const handleSend = () => {
    if (editingMessage) {
      editMessage();
    } else if (input.trim()) {
      sendMessage('text');
    }
  };

  // === Scheduled Messages ===
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleSuccess, setScheduleSuccess] = useState('');
  const [activePresetIndex, setActivePresetIndex] = useState<number | null>(null);
  const [sendingScheduledId, setSendingScheduledId] = useState<string | null>(null);
  const [nativeDatePickerVisible, setNativeDatePickerVisible] = useState(false);
  const [nativeTimePickerVisible, setNativeTimePickerVisible] = useState(false);
  const scheduleModalAnim = useRef(new RNAnimated.Value(0)).current;
  const [editingScheduledId, setEditingScheduledId] = useState<string | null>(null);
  const [editingScheduledContent, setEditingScheduledContent] = useState('');
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleNativeDateVisible, setRescheduleNativeDateVisible] = useState(false);
  const [rescheduleNativeTimeVisible, setRescheduleNativeTimeVisible] = useState(false);

  const formatRelativeTime = (dateStr: string) => {
    const target = new Date(dateStr);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    if (diffMs <= 0) return 'сейчас';
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60) return `через ${diffMin} мин`;
    const diffHours = Math.floor(diffMin / 60);
    const remMin = diffMin % 60;
    if (diffHours < 24) return remMin > 0 ? `через ${diffHours} ч ${remMin} мин` : `через ${diffHours} ч`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return `завтра в ${target.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    return `через ${diffDays} дн`;
  };

  const getScheduledDateTime = () => {
    if (!scheduleDate || !scheduleTime) return null;
    try { return new Date(`${scheduleDate}T${scheduleTime}:00`); } catch { return null; }
  };

  const isScheduleValid = () => {
    const dt = getScheduledDateTime();
    return dt && dt.getTime() > Date.now() + 60000;
  };

  const openSchedulePicker = (media?: { type: string; url: string; duration: number; caption: string }) => {
    hapticMedium();
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    setScheduleDate(`${y}-${m}-${d}`);
    setScheduleTime(`${h}:${min}`);
    setScheduleError('');
    setScheduleSuccess('');
    setActivePresetIndex(null);
    setPendingScheduleMedia(media || null);
    setShowSchedulePicker(true);
    RNAnimated.spring(scheduleModalAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 9 }).start();
  };

  const getScheduleDateAsDate = (): Date => {
    if (scheduleDate && scheduleTime) {
      try { return new Date(`${scheduleDate}T${scheduleTime}:00`); } catch {}
    }
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    return d;
  };

  const handleNativeDateChange = (_: any, selectedDate?: Date) => {
    setNativeDatePickerVisible(Platform.OS === 'ios');
    if (selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      setScheduleDate(`${y}-${m}-${d}`);
      setScheduleError('');
      setActivePresetIndex(null);
    }
  };

  const handleNativeTimeChange = (_: any, selectedDate?: Date) => {
    setNativeTimePickerVisible(Platform.OS === 'ios');
    if (selectedDate) {
      const h = String(selectedDate.getHours()).padStart(2, '0');
      const min = String(selectedDate.getMinutes()).padStart(2, '0');
      setScheduleTime(`${h}:${min}`);
      setScheduleError('');
      setActivePresetIndex(null);
    }
  };

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return 'Выберите дату';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return dateStr; }
  };

  const formatDisplayTime = (timeStr: string) => {
    if (!timeStr) return 'Выберите время';
    return timeStr;
  };

  const closeSchedulePicker = () => {
    setNativeDatePickerVisible(false);
    setNativeTimePickerVisible(false);
    RNAnimated.timing(scheduleModalAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setShowSchedulePicker(false);
      setScheduleError('');
      setScheduleSuccess('');
      setActivePresetIndex(null);
      setPendingScheduleMedia(null);
    });
  };

  const scheduleMessage = async () => {
    const hasMedia = !!pendingScheduleMedia;
    const hasText = !!input.trim();
    if (!user || !id || (!hasText && !hasMedia)) return;
    if (!scheduleDate || !scheduleTime) return;

    const dt = getScheduledDateTime();
    if (!dt || dt.getTime() <= Date.now() + 60000) {
      setScheduleError('Выберите время не менее чем через минуту');
      hapticLight();
      return;
    }

    setScheduleError('');
    setScheduleSending(true);
    hapticMedium();

    const msgType = hasMedia ? pendingScheduleMedia!.type : 'text';
    const content = hasMedia ? (pendingScheduleMedia!.caption || input.trim()) : input.trim();
    const mediaUrl = hasMedia ? pendingScheduleMedia!.url : null;
    const mediaDuration = hasMedia ? pendingScheduleMedia!.duration : 0;

    const { error } = await supabase.from('scheduled_messages').insert({
      conversation_id: id,
      sender_id: user.id,
      content,
      message_type: msgType,
      media_url: mediaUrl,
      media_duration: mediaDuration,
      reply_to_id: replyTo?.id || null,
      scheduled_at: dt.toISOString(),
    });

    setScheduleSending(false);
    if (error) {
      setScheduleError('Не удалось запланировать');
      return;
    }

    hapticHeavy();
    if (!hasMedia) {
      setInput('');
      clearDraft(id as string);
    }
    setReplyTo(null);
    setPendingScheduleMedia(null);
    loadScheduledMessages();

    const relTime = formatRelativeTime(dt.toISOString());
    setScheduleSuccess(`Отправится ${relTime}`);
    setTimeout(() => {
      closeSchedulePicker();
      setScheduleSuccess('');
    }, 1600);
  };

  const loadScheduledMessages = async () => {
    if (!user || !id) return;
    const { data } = await supabase
      .from('scheduled_messages')
      .select('id, content, message_type, media_url, media_duration, scheduled_at, status')
      .eq('conversation_id', id)
      .eq('sender_id', user.id)
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true });
    if (data) setScheduledMessages(data);
  };

  const cancelScheduledMessage = async (msgId: string) => {
    hapticMedium();
    setScheduledMessages(prev => prev.filter(m => m.id !== msgId));
    await supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled' })
      .eq('id', msgId);
  };

  const sendScheduledNow = async (msgId: string) => {
    const msg = scheduledMessages.find(m => m.id === msgId);
    if (!msg || sendingScheduledId) return;
    setSendingScheduledId(msgId);
    hapticMedium();
    const msgType = (msg.message_type || 'text') as any;
    if (msg.media_url && msgType !== 'text') {
      await sendMessage(msgType, msg.media_url, msg.media_duration || 0, msg.content || '');
    } else {
      await sendMessage('text', undefined, undefined, msg.content);
    }
    await supabase
      .from('scheduled_messages')
      .update({ status: 'sent' })
      .eq('id', msgId);
    setScheduledMessages(prev => prev.filter(m => m.id !== msgId));
    setSendingScheduledId(null);
  };

  const startEditScheduled = (msgId: string) => {
    const msg = scheduledMessages.find(m => m.id === msgId);
    if (!msg) return;
    hapticLight();
    setEditingScheduledId(msgId);
    setEditingScheduledContent(msg.content);
  };

  const saveScheduledEdit = async () => {
    if (!editingScheduledId || !editingScheduledContent.trim()) return;
    hapticMedium();
    setScheduledMessages(prev => prev.map(m =>
      m.id === editingScheduledId ? { ...m, content: editingScheduledContent.trim() } : m
    ));
    await supabase
      .from('scheduled_messages')
      .update({ content: editingScheduledContent.trim() })
      .eq('id', editingScheduledId);
    setEditingScheduledId(null);
    setEditingScheduledContent('');
  };

  const cancelScheduledEdit = () => {
    setEditingScheduledId(null);
    setEditingScheduledContent('');
  };

  const startReschedule = (msgId: string) => {
    const msg = scheduledMessages.find(m => m.id === msgId);
    if (!msg) return;
    hapticLight();
    const dt = new Date(msg.scheduled_at);
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const min = String(dt.getMinutes()).padStart(2, '0');
    setRescheduleId(msgId);
    setRescheduleDate(`${y}-${mo}-${d}`);
    setRescheduleTime(`${h}:${min}`);
  };

  const saveReschedule = async () => {
    if (!rescheduleId || !rescheduleDate || !rescheduleTime) return;
    const dt = new Date(`${rescheduleDate}T${rescheduleTime}:00`);
    if (dt.getTime() <= Date.now() + 60000) return;
    hapticMedium();
    setScheduledMessages(prev => prev.map(m =>
      m.id === rescheduleId ? { ...m, scheduled_at: dt.toISOString() } : m
    ));
    await supabase
      .from('scheduled_messages')
      .update({ scheduled_at: dt.toISOString() })
      .eq('id', rescheduleId);
    setRescheduleId(null);
    setRescheduleDate('');
    setRescheduleTime('');
  };

  const cancelReschedule = () => {
    setRescheduleId(null);
    setRescheduleDate('');
    setRescheduleTime('');
    setRescheduleNativeDateVisible(false);
    setRescheduleNativeTimeVisible(false);
  };

  const isRescheduleValid = () => {
    if (!rescheduleDate || !rescheduleTime) return false;
    try {
      const dt = new Date(`${rescheduleDate}T${rescheduleTime}:00`);
      return dt.getTime() > Date.now() + 60000;
    } catch { return false; }
  };

  useEffect(() => {
    if (user && id) loadScheduledMessages();
  }, [user, id]);

  const cancelEditReply = () => {
    setReplyTo(null);
    setEditingMessage(null);
    setInput('');
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {/* Full-screen wallpaper layer */}
      {wpImageUri && (
        <Image source={{ uri: wpImageUri }} style={[StyleSheet.absoluteFill, { zIndex: 0 }]} resizeMode="cover" />
      )}
      {wpColors && !wpImageUri && (
        <LinearGradient
          colors={wpColors as [string, string, ...string[]]}
          style={[StyleSheet.absoluteFill, { zIndex: 0 }]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      )}
      {/* Header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: Math.max(insets.top, 8), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.backgroundSecondary, ...(Platform.OS === 'web' ? { backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } : {}) } as any}>
      <View style={[styles.chatHeader, { backgroundColor: 'transparent' }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => onBack ? onBack() : router.back()} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>

        {searchMode ? (
          <View style={styles.searchBar}>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.backgroundTertiary, color: colors.text }]}
              placeholder="Поиск по сообщениям..."
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={(t) => { setSearchQuery(t); setSearchMatchIndex(0); }}
              autoFocus
            />
            {searchQuery.trim().length > 0 && (
              <Text style={[styles.searchCount, { color: colors.textTertiary }]}>
                {searchMatchIds.length > 0 ? `${searchMatchIndex + 1}/${searchMatchIds.length}` : '0'}
              </Text>
            )}
            <TouchableOpacity
              onPress={() => { if (searchMatchIds.length > 0) setSearchMatchIndex(i => i > 0 ? i - 1 : searchMatchIds.length - 1); }}
              style={styles.searchNavBtn}
              disabled={searchMatchIds.length === 0}
            >
              <ChevronUp color={searchMatchIds.length > 0 ? colors.text : colors.textTertiary} size={18} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (searchMatchIds.length > 0) setSearchMatchIndex(i => i < searchMatchIds.length - 1 ? i + 1 : 0); }}
              style={styles.searchNavBtn}
              disabled={searchMatchIds.length === 0}
            >
              <ChevronDown color={searchMatchIds.length > 0 ? colors.text : colors.textTertiary} size={18} />
            </TouchableOpacity>
            <TouchableOpacity style={{ width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' }} onPress={() => { setSearchMode(false); setSearchQuery(''); setSearchMatchIndex(0); }}>
              <X color={colors.textSecondary} size={18} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.headerInfo}>
              {isSavedChat ? (
                <View style={styles.headerAvatarContainer}>
                  <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder, { backgroundColor: colors.primary }]}>
                    <Bookmark color="#FFFFFF" size={18} />
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={styles.headerAvatarContainer}
                  onPress={(chatInfo.type === 'group' || isChannel) ? handleOpenGroupInfo : handleOpenUserProfile} activeOpacity={0.7}
                  accessibilityLabel={isChannel ? 'Информация о канале' : chatInfo.type === 'group' ? 'Информация о группе' : 'Профиль пользователя'}>
                  <Avatar
                    uri={chatInfo.avatar_url}
                    name={chatInfo.name || '?'}
                    size="sm"
                    showOnline={chatInfo.type !== 'group'}
                    isOnline={isUserOnline(chatInfo.is_online, chatInfo.last_seen)}
                  />
                </TouchableOpacity>
              )}
              {isSavedChat ? (
                <View style={{ flex: 1 }}>
                  <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>Избранное</Text>
                  <Text style={[styles.headerStatus, { color: colors.textSecondary }]}>Личное хранилище</Text>
                </View>
              ) : (
                <TouchableOpacity style={{ flex: 1 }} onPress={(chatInfo.type === 'group' || isChannel) ? handleOpenGroupInfo : handleOpenUserProfile} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
                      {chatInfo.name || 'Чат'}
                    </Text>
                    {chatInfo.is_verified && (
                      <View style={styles.verifiedBadge}>
                        <View style={styles.verifiedCheckmark} />
                      </View>
                    )}
                  </View>
                  <Text style={[styles.headerStatus, { color: typingUsers.length > 0 ? colors.primary : colors.textSecondary }]} numberOfLines={1}>
                    {typingUsers.length > 0
                      ? (typingUsers.length === 1
                          ? `${typingUsers[0].name} ${typingUsers[0].activity === 'voice' ? 'записывает голосовое' : typingUsers[0].activity === 'media' ? 'отправляет файл' : 'печатает...'}`
                          : typingUsers.length === 2
                            ? `${typingUsers[0].name} и ${typingUsers[1].name} печатают...`
                            : `${typingUsers[0].name} и ещё ${typingUsers.length - 1} печатают...`)
                      : isChannel
                        ? `${chatInfo.member_count || 0} ${chatInfo.member_count === 1 ? 'подписчик' : 'подписчиков'}`
                        : isUserOnline(chatInfo.is_online, chatInfo.last_seen)
                        ? 'в сети'
                        : chatInfo.type === 'group'
                          ? `${chatInfo.member_count || 0} участник${(chatInfo.member_count || 0) === 1 ? '' : 'ов'}`
                          : chatInfo.last_seen
                            ? `был(а) ${formatLastSeen(chatInfo.last_seen)}`
                            : 'не в сети'}
                  </Text>

                </TouchableOpacity>
              )}
            </View>

            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.headerAction} onPress={() => setSearchMode(true)}>
                <Search color={colors.text} size={20} />
              </TouchableOpacity>
              {!isSavedChat && !isChannel && (
                <TouchableOpacity style={styles.headerAction} onPress={() => setShowCallPicker(true)}>
                  <PhoneIcon color={colors.text} size={20} />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.headerAction} onPress={() => setShowChatMenu(true)}>
                <MoreVertical color={colors.text} size={20} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
      </View>

      {/* Pinned message banner */}
      {pinnedMessage && !searchMode && (
        <TouchableOpacity
          style={[styles.pinnedBanner, { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border }]}
          onPress={() => {
            if (allPinnedMessages.length > 1) {
              setShowPinnedPanel(true);
            } else {
              const idx = messageIndexMap.get(pinnedMessage.id) ?? -1;
              if (idx >= 0) flatListRef.current?.scrollToIndex({ index: idx, animated: true });
            }
          }}
        >
          <Pin color={colors.primary} size={14} />
          <View style={styles.pinnedContent}>
            <Text style={[styles.pinnedLabel, { color: colors.primary }]}>
              {allPinnedMessages.length > 1 ? `${allPinnedMessages.length} закреплённых` : 'Закреплённое сообщение'}
            </Text>
            <Text style={[styles.pinnedText, { color: colors.textSecondary }]} numberOfLines={1}>
              {pinnedMessage.message_type === 'voice' ? 'Голосовое сообщение' : pinnedMessage.content}
            </Text>
          </View>
          <TouchableOpacity onPress={() => pinMessage(pinnedMessage)}>
            <X color={colors.textTertiary} size={16} />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {blockFeedback && (
        <View style={{ backgroundColor: colors.backgroundSecondary, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
          <Ban color={colors.textSecondary} size={16} />
          <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>{blockFeedback}</Text>
        </View>
      )}

      {isBlocked && !blockFeedback && (
        <View style={{ backgroundColor: colors.backgroundSecondary, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ban color={colors.error} size={16} />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Пользователь заблокирован</Text>
          </View>
          <TouchableOpacity onPress={handleUnblockUser} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.primary, borderRadius: 6 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Разблокировать</Text>
          </TouchableOpacity>
        </View>
      )}

      {(!isConnected || pendingQueueCount > 0) && (
        <View style={[styles.offlineChatBanner, { backgroundColor: !isConnected ? '#FF525210' : `${colors.warning || '#F59E0B'}10`, borderBottomColor: colors.border }]}>
          <View style={[styles.offlineDot, { backgroundColor: !isConnected ? '#FF5252' : colors.warning || '#F59E0B' }]} />
          {!isConnected ? <WifiOff color="#FF5252" size={14} /> : <RefreshCw color={colors.warning || '#F59E0B'} size={14} />}
          <Text style={[styles.offlineChatBannerText, { color: !isConnected ? '#FF5252' : colors.warning || '#F59E0B' }]}>
            {!isConnected
              ? pendingQueueCount > 0
                ? `Оффлайн -- ${pendingQueueCount} в очереди`
                : 'Нет подключения к сети'
              : `Отправка ${pendingQueueCount} ${pendingQueueCount === 1 ? 'сообщения' : 'сообщений'}...`}
          </Text>
          {isConnected && pendingQueueCount > 0 && (
            <TouchableOpacity style={[styles.offlineRetryBtn, { backgroundColor: `${colors.warning || '#F59E0B'}15` }]} onPress={forceProcessQueue} activeOpacity={0.7}>
              <Text style={[styles.offlineRetryText, { color: colors.warning || '#F59E0B' }]}>Повторить</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Messages */}
      <View style={{ flex: 1, opacity: listReady || messages.length === 0 ? 1 : 0 }}>
        <RNAnimated.View style={{ flex: 1, transform: [{ translateX: mentionShakeAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-6, 0, 6] }) }] }}>
          <FlatList
            ref={flatListRef}
            data={groupedMessages}
            renderItem={renderItem}
            keyExtractor={chatKeyExtractor}
            keyboardDismissMode="on-drag"
            extraData={voiceExtraData}
            contentContainerStyle={messagesListContentStyle}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={handleContentSizeChange}
            maintainVisibleContentPosition={Platform.OS === 'ios' ? { minIndexForVisible: 0 } : undefined}
            onScrollToIndexFailed={(info) => {
              const offset = info.averageItemLength * info.index;
              setTimeout(() => flatListRef.current?.scrollToOffset({ offset, animated: false }), 100);
            }}
            onScroll={handleFlatListScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            scrollEventThrottle={Platform.OS === 'ios' ? 16 : 100}
            keyboardShouldPersistTaps="handled"
            windowSize={chatInfo?.type === 'channel' ? 21 : 7}
            maxToRenderPerBatch={chatInfo?.type === 'channel' ? 15 : 10}
            initialNumToRender={chatInfo?.type === 'channel' ? 20 : 15}
            removeClippedSubviews={Platform.OS !== 'web' && chatInfo?.type !== 'channel'}
            updateCellsBatchingPeriod={chatInfo?.type === 'channel' ? 50 : 30}
            ListHeaderComponent={hasMore ? (
              <View style={styles.loadMoreButton}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : conversationStartDate ? (
              <View style={styles.conversationStartContainer}>
                <View style={[styles.conversationStartBadge, { backgroundColor: (wpColors || wpImageUri) ? 'rgba(0,0,0,0.25)' : colors.backgroundTertiary }]}>
                  <Clock color={(wpColors || wpImageUri) ? 'rgba(255,255,255,0.6)' : colors.textTertiary} size={12} />
                  <Text style={[styles.conversationStartText, { color: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.6)' : colors.textTertiary }]}>
                    {isChannel ? 'Канал создан' : 'Начало диалога'}: {conversationStartDate}
                  </Text>
                </View>
              </View>
            ) : null}
            ListEmptyComponent={initialLoaded ? (
              isChannel ? (
                <View style={styles.greetingContainer}>
                  <View style={[styles.greetingIconCircle, { backgroundColor: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.1)' : colors.backgroundSecondary }]}>
                    <Megaphone color={(wpColors || wpImageUri) ? 'rgba(255,255,255,0.85)' : colors.textSecondary} size={28} />
                  </View>
                  <Text style={[styles.greetingTitle, { color: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.85)' : colors.text }]}>{chatInfo?.name || 'Канал'}</Text>
                  <Text style={[styles.greetingSubtitle, { color: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
                    {isChannelAdmin ? 'Здесь пока нет публикаций.\nНапишите первый пост!' : 'Здесь пока нет публикаций.\nОжидайте новые посты.'}
                  </Text>
                  {isChannelAdmin && (
                    <View style={{ marginTop: 20 }}>
                      <TouchableOpacity
                        onPress={() => inputRef.current?.focus?.()}
                        activeOpacity={0.7}
                        style={{ paddingVertical: 12, paddingHorizontal: 24, borderRadius: 22, backgroundColor: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.12)' : colors.primary + '14', borderWidth: StyleSheet.hairlineWidth, borderColor: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.2)' : colors.primary + '40' }}
                      >
                        <Text style={{ color: (wpColors || wpImageUri) ? '#FFFFFF' : colors.primary, fontSize: 14, fontWeight: '600' }}>Создать публикацию</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ) : (
              <View style={styles.greetingContainer}>
                <View style={styles.greetingIconCircle}>
                  <Text style={styles.greetingIconEmoji}>💬</Text>
                </View>
                <Text style={[styles.greetingTitle, { color: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.85)' : colors.text }]}>Къамел дIадоладе!</Text>
                <Text style={[styles.greetingSubtitle, { color: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>Салам далийта цхьа тIе тоьхна</Text>
                <View style={styles.greetingStickersGrid}>
                  {GREETING_STICKERS.map((sticker) => (
                    <TouchableOpacity
                      key={sticker.emoji}
                      style={[styles.greetingStickerButton, { backgroundColor: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.1)' : colors.backgroundSecondary, borderColor: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.15)' : colors.border }]}
                      onPress={() => sendStickerMessage(`${sticker.emoji} ${sticker.label}`)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.greetingStickerEmoji}>{sticker.emoji}</Text>
                      <Text style={[styles.greetingStickerLabel, { color: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.8)' : colors.text }]} numberOfLines={1}>{sticker.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              )
            ) : <MessagesSkeleton count={6} color={colors.backgroundTertiary || 'rgba(255,255,255,0.06)'} />}
            ListFooterComponent={typingUsers.length > 0 ? (
              <View style={styles.typingBubbleContainer}>
                <View style={[styles.typingBubble, { backgroundColor: colors.messageReceived }]}>
                  {typingUsers[0]?.activity === 'voice' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Mic color={colors.primary} size={14} />
                      <TypingDots color={colors.textSecondary} size={5} />
                    </View>
                  ) : typingUsers[0]?.activity === 'media' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Paperclip color={colors.primary} size={14} />
                      <TypingDots color={colors.textSecondary} size={5} />
                    </View>
                  ) : (
                    <TypingDots color={colors.textSecondary} size={5} />
                  )}
                </View>
              </View>
            ) : null}
          />
          <RNAnimated.View
            style={[
              styles.scrollDownButton,
              { backgroundColor: (wpColors || wpImageUri) ? 'rgba(0,0,0,0.4)' : colors.backgroundSecondary, borderColor: (wpColors || wpImageUri) ? 'rgba(255,255,255,0.2)' : colors.border, bottom: scrollDownButtonBottom },
              { opacity: scrollBtnAnim, transform: [{ translateY: scrollBtnAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
            ]}
            pointerEvents={showScrollDown ? 'auto' : 'none'}
          >
            <TouchableOpacity onPress={scrollToBottom} activeOpacity={0.8} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ChevronDown color={(wpColors || wpImageUri) ? '#FFFFFF' : colors.text} size={20} />
              {unreadScrollCount > 0 && (
                <View style={[styles.scrollDownBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.scrollDownBadgeText}>{unreadScrollCount > 99 ? '99+' : unreadScrollCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </RNAnimated.View>
        </RNAnimated.View>
      </View>

      {/* Top/bottom gradient fades removed - Telegram uses flat bars */}

      {/* Selection toolbar */}
      {selectMode ? (
        <View style={[styles.selectionToolbar, { backgroundColor: colors.backgroundSecondary, borderTopColor: colors.border, position: 'absolute', bottom: Math.max(insets.bottom, 8) + 4, left: 0, right: 0, zIndex: 20 }]}>
          <TouchableOpacity onPress={exitSelectMode} style={styles.selectionAction}>
            <X color={colors.text} size={22} />
          </TouchableOpacity>
          <Text style={[styles.selectionCount, { color: colors.text }]}>
            {selectedIds.size} выбрано
          </Text>
          <View style={styles.selectionActions}>
            <TouchableOpacity onPress={bulkSaveToFavorites} style={styles.selectionAction} disabled={selectedIds.size === 0}>
              <Bookmark color={colors.primary} size={22} />
            </TouchableOpacity>
            <TouchableOpacity onPress={bulkStar} style={styles.selectionAction}>
              <Star color="#FFD60A" size={22} />
            </TouchableOpacity>
            <TouchableOpacity onPress={bulkForward} style={styles.selectionAction} disabled={selectedIds.size === 0}>
              <Forward color={colors.primary} size={22} />
            </TouchableOpacity>
            {(!isChannel || isChannelAdmin) && (
              <TouchableOpacity onPress={bulkDelete} style={styles.selectionAction} disabled={selectedIds.size === 0}>
                <Trash2 color={colors.error} size={22} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : null}

      {/* Channel subscribe / mute button for non-admins */}
      {isChannel && !isChannelAdmin && !selectMode && (
        <View style={{ position: 'absolute', bottom: Math.max(insets.bottom, 16) + 8, left: 0, right: 0, alignItems: 'center', zIndex: 2 }}>
          {!isChannelMember ? (
            <TouchableOpacity onPress={handleSubscribeToChannel} activeOpacity={0.7} disabled={subscribingToChannel} style={{ borderRadius: 22, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
              <View style={{ paddingVertical: 10, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 22, backgroundColor: colors.primary }}>
                {subscribingToChannel ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Bell color="#FFFFFF" size={17} />}
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>Подписаться</Text>
              </View>
            </TouchableOpacity>
          ) : showJustSubscribed ? (
            <TouchableOpacity onPress={() => { handleToggleChannelMute(); setShowJustSubscribed(false); }} activeOpacity={0.7} style={{ borderRadius: 22, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
              <View style={{ paddingVertical: 10, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 22, backgroundColor: colors.backgroundSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                <BellOff color={colors.textSecondary} size={17} />
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>Отключить уведомления</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleToggleChannelMute} activeOpacity={0.7} style={{ borderRadius: 20, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
              {Platform.OS !== 'web' ? (
                <BlurView intensity={60} tint={resolvedTheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              ) : null}
              <View style={[{ paddingVertical: 8, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, Platform.OS === 'web' ? { backgroundColor: colors.backgroundSecondary + 'B3', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } as any : { backgroundColor: colors.backgroundSecondary + '99' }]}>
                {channelMuted ? <BellOff color={colors.textSecondary} size={16} /> : <Bell color={colors.textSecondary} size={16} />}
                <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>{channelMuted ? 'Без звука' : 'Звук'}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Input area */}
      {!selectMode && !(isChannel && !isChannelAdmin) && initialLoaded && pendingVoiceDraft && !recording ? (
        <View style={{ position: 'absolute', bottom: (keyboardHeight > 0 ? keyboardHeight - insets.bottom : 0), left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, zIndex: 2 }}>
          <View style={[styles.recordingBar, { backgroundColor: colors.backgroundSecondary }]}>
            <Mic color={colors.primary} size={20} />
            <Text style={[styles.recordingText, { color: colors.text }]}>
              Голосовое {formatVoiceDuration(pendingVoiceDraft.duration)}
            </Text>
            <TouchableOpacity style={[styles.sendRecordingButton, { backgroundColor: colors.primary }]} onPress={sendPendingVoiceDraft}>
              <Send color="#FFFFFF" size={18} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelRecordingButton, { borderColor: colors.border }]}
              onPress={discardVoiceDraft}
            >
              <Text style={[styles.cancelText, { color: colors.text }]}>Удалить</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : !selectMode && !(isChannel && !isChannelAdmin) && initialLoaded ? (
        <View style={{ position: 'absolute', bottom: (keyboardHeight > 0 ? keyboardHeight - insets.bottom : 0), left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, overflow: recording ? 'visible' : 'hidden', zIndex: 2 }}>
          <View style={{ backgroundColor: colors.backgroundSecondary, overflow: recording ? 'visible' : 'hidden', paddingBottom: Math.max(insets.bottom, 4) }}>
          {/* Reply/Edit banner */}
          {!recording && (replyTo || editingMessage) && (
            <View style={[styles.replyBanner, { borderBottomColor: colors.border }]}>
              <View style={[styles.replyBannerLine, { backgroundColor: colors.primary }]} />
              {editingMessage && (editingMessage.message_type === 'image' || editingMessage.message_type === 'video') && editingMessage.media_url ? (
                <View style={{ width: 36, height: 36, borderRadius: 6, overflow: 'hidden', marginRight: 8 }}>
                  <Image source={{ uri: editingMessage.media_url }} style={{ width: 36, height: 36 }} />
                  {editingMessage.message_type === 'video' && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}>
                      <Play color="#fff" size={14} fill="#fff" />
                    </View>
                  )}
                </View>
              ) : null}
              <View style={styles.replyBannerContent}>
                <Text style={[styles.replyBannerLabel, { color: colors.primary }]}>
                  {editingMessage ? 'Редактирование' : (replyTo?.sender?.display_name || 'Сообщение')}
                </Text>
                <Text style={[styles.replyBannerText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {editingMessage
                    ? (editingMessage.content || (editingMessage.message_type === 'image' ? 'Фото' : editingMessage.message_type === 'video' ? 'Видео' : ''))
                    : (replyTo?.content || '')}
                </Text>
              </View>
              <TouchableOpacity onPress={cancelEditReply}>
                <X color={colors.textSecondary} size={18} />
              </TouchableOpacity>
            </View>
          )}

          {scheduledMessages.length > 0 && (
            <TouchableOpacity
              style={[styles.scheduledBanner, { backgroundColor: `${colors.primary}06`, borderBottomColor: colors.border }]}
              onPress={() => { hapticLight(); loadScheduledMessages(); setShowScheduledList(true); }}
              activeOpacity={0.6}
            >
              <View style={[styles.scheduledBannerDot, { backgroundColor: colors.primary }]} />
              <Clock color={colors.primary} size={13} />
              <Text style={[styles.scheduledBannerText, { color: colors.primary }]}>
                {scheduledMessages.length} {scheduledMessages.length === 1 ? 'запланированное' : scheduledMessages.length < 5 ? 'запланированных' : 'запланированных'}
              </Text>
              <ChevronRight color={`${colors.primary}80`} size={14} />
            </TouchableOpacity>
          )}
          <FormattingToolbar
            inputRef={inputRef}
            input={input}
            onChangeText={setInput}
            colors={colors}
            visible={showFormatToolbar}
            onClose={() => setShowFormatToolbar(false)}
            selectionRef={selectionRef}
          />
          <View style={[styles.inputBar]}>
            {!recording && (
              <>
                <TouchableOpacity style={styles.attachButton} onPress={handlePickImage} accessibilityLabel="Фото или видео">
                  <Images color={colors.textSecondary} size={22} />
                </TouchableOpacity>
                <View style={[styles.inputFieldWrapper, { backgroundColor: colors.backgroundTertiary }]}>
                  <TextInput
                    ref={inputRef}
                    style={[styles.textInput, { color: colors.text, fontSize: 16 * fontScale }]}
                    value={input}
                    onChangeText={handleInputChange}
                    placeholder={isSavedChat ? "Заметка..." : "Сообщение..."}
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    maxLength={4096}
                    onSelectionChange={(e) => { selectionRef.current = e.nativeEvent.selection; }}
                  />
                  <TouchableOpacity style={styles.inputEmojiButton} onPress={() => { setShowFormatToolbar(!showFormatToolbar); }}>
                    <Type color={showFormatToolbar ? colors.primary : colors.textTertiary} size={20} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.inputEmojiButton} onPress={() => setShowEmojiPicker(!showEmojiPicker)}>
                    <Smile color={showEmojiPicker ? colors.primary : colors.textTertiary} size={22} />
                  </TouchableOpacity>
                </View>
              </>
            )}
            {!recording && (input.trim() || editingMessage) ? (
              <TouchableOpacity
                style={[styles.sendButton, { backgroundColor: colors.primary }]}
                onPress={handleSend}
                onLongPress={() => openSchedulePicker()}
                delayLongPress={400}
                accessibilityLabel="Отправить"
              >
                <Send color="#FFFFFF" size={18} />
              </TouchableOpacity>
            ) : (
              <VoiceRecorder
                colors={colors}
                onStartRecording={startRecording}
                onStopRecording={stopRecording}
                onScheduleRecording={scheduleVoiceRecording}
                onStartVideoNote={startVideoNote}
                recording={recording}
                recordingDuration={recordingDuration}
                formatDuration={formatVoiceDuration}
              />
            )}
          </View>

          {/* Emoji & Sticker panel */}
          {!recording && showEmojiPicker && (
            <EmojiStickerPanel
              visible={showEmojiPicker}
              onEmojiSelect={(emoji) => setInput(prev => prev + emoji)}
              onStickerSend={(text) => { setShowEmojiPicker(false); sendStickerMessage(text); }}
              onClose={() => setShowEmojiPicker(false)}
              colors={colors}
            />
          )}
        </View>
        </View>
      ) : null}

      {/* Schedule picker modal */}
      {showSchedulePicker && (
        <Modal visible transparent animationType="none" onRequestClose={closeSchedulePicker}>
          <Pressable style={styles.actionModalBackdrop} onPress={closeSchedulePicker}>
            <RNAnimated.View style={[
              styles.scheduleModal,
              { backgroundColor: colors.backgroundElevated,
                opacity: scheduleModalAnim,
                transform: [{ scale: scheduleModalAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
              },
            ]}>
              <Pressable onPress={e => e.stopPropagation()}>
                {scheduleSuccess ? (
                  <View style={styles.scheduleSuccessWrap}>
                    <View style={[styles.scheduleSuccessIcon, { backgroundColor: `${colors.success || '#22C55E'}15` }]}>
                      <Check color={colors.success || '#22C55E'} size={32} />
                    </View>
                    <Text style={[styles.scheduleSuccessTitle, { color: colors.text }]}>Запланировано</Text>
                    <Text style={[styles.scheduleSuccessDetail, { color: colors.textSecondary }]}>{scheduleSuccess}</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.scheduleHeader}>
                      <View style={[styles.scheduleIconBg, { backgroundColor: `${colors.primary}12` }]}>
                        <Clock color={colors.primary} size={18} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.scheduleTitle, { color: colors.text }]}>Запланировать</Text>
                        <Text style={[styles.scheduleLabel, { color: colors.textSecondary }]}>Отправится автоматически</Text>
                      </View>
                    </View>

                    <View style={[styles.schedulePreview, { backgroundColor: `${colors.primary}08`, borderColor: `${colors.primary}20` }]}>
                      <View style={[styles.schedulePreviewBubble, { backgroundColor: colors.messageSentBg || colors.primary }]}>
                        {pendingScheduleMedia ? (
                          <View style={styles.scheduleMediaPreview}>
                            {pendingScheduleMedia.type === 'voice' ? (
                              <View style={styles.scheduleMediaRow}>
                                <Mic color={colors.messageSentText || '#FFF'} size={15} />
                                <Text style={[styles.schedulePreviewText, { color: colors.messageSentText || '#FFF' }]}>
                                  Голосовое {pendingScheduleMedia.duration > 0 ? formatVoiceDuration(pendingScheduleMedia.duration) : ''}
                                </Text>
                              </View>
                            ) : pendingScheduleMedia.type === 'video_note' ? (
                              <View style={styles.scheduleMediaRow}>
                                <Video color={colors.messageSentText || '#FFF'} size={15} />
                                <Text style={[styles.schedulePreviewText, { color: colors.messageSentText || '#FFF' }]}>
                                  Видеосообщение {pendingScheduleMedia.duration > 0 ? formatVoiceDuration(pendingScheduleMedia.duration) : ''}
                                </Text>
                              </View>
                            ) : pendingScheduleMedia.type === 'video' ? (
                              <View style={styles.scheduleMediaRow}>
                                <Video color={colors.messageSentText || '#FFF'} size={15} />
                                <Text style={[styles.schedulePreviewText, { color: colors.messageSentText || '#FFF' }]} numberOfLines={1}>
                                  Видео{pendingScheduleMedia.caption ? `: ${pendingScheduleMedia.caption}` : ''}
                                </Text>
                              </View>
                            ) : (
                              <View style={styles.scheduleMediaRow}>
                                <ImageIcon color={colors.messageSentText || '#FFF'} size={15} />
                                <Text style={[styles.schedulePreviewText, { color: colors.messageSentText || '#FFF' }]} numberOfLines={1}>
                                  Фото{pendingScheduleMedia.caption ? `: ${pendingScheduleMedia.caption}` : ''}
                                </Text>
                              </View>
                            )}
                          </View>
                        ) : (
                          <Text style={[styles.schedulePreviewText, { color: colors.messageSentText || '#FFF' }]} numberOfLines={2}>
                            {input.trim() || 'Сообщение'}
                          </Text>
                        )}
                      </View>
                      {isScheduleValid() && (
                        <Text style={[styles.scheduleRelativeTime, { color: colors.primary }]}>
                          {formatRelativeTime(`${scheduleDate}T${scheduleTime}:00`)}
                        </Text>
                      )}
                    </View>

                    <View style={styles.scheduleFields}>
                      <View style={styles.scheduleFieldGroup}>
                        <Text style={[styles.scheduleFieldLabel, { color: colors.textSecondary }]}>Дата</Text>
                        <View style={[styles.scheduleInputWrap, { backgroundColor: colors.backgroundTertiary, borderColor: scheduleError ? '#EF4444' : 'transparent' }]}>
                          {Platform.OS === 'web' ? (
                            // @ts-ignore
                            <input
                              type="date"
                              value={scheduleDate}
                              onChange={(e: any) => { setScheduleDate(e.target.value); setScheduleError(''); setActivePresetIndex(null); }}
                              min={new Date().toISOString().split('T')[0]}
                              style={{
                                width: '100%', height: 42, border: 'none', outline: 'none',
                                background: 'transparent', fontSize: 15,
                                color: colors.text, fontFamily: 'inherit', padding: '0 12px',
                                borderRadius: 10,
                              }}
                            />
                          ) : (
                            <>
                              <TouchableOpacity
                                style={[styles.scheduleInput, { justifyContent: 'center' }]}
                                onPress={() => setNativeDatePickerVisible(true)}
                              >
                                <Text style={{ color: scheduleDate ? colors.text : colors.textTertiary, fontSize: 15 }}>
                                  {formatDisplayDate(scheduleDate)}
                                </Text>
                              </TouchableOpacity>
                              {nativeDatePickerVisible && DateTimePicker && (
                                <DateTimePicker
                                  value={getScheduleDateAsDate()}
                                  mode="date"
                                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                  minimumDate={new Date()}
                                  onChange={handleNativeDateChange}
                                />
                              )}
                            </>
                          )}
                        </View>
                      </View>
                      <View style={styles.scheduleFieldGroup}>
                        <Text style={[styles.scheduleFieldLabel, { color: colors.textSecondary }]}>Время</Text>
                        <View style={[styles.scheduleInputWrap, { backgroundColor: colors.backgroundTertiary, borderColor: scheduleError ? '#EF4444' : 'transparent' }]}>
                          {Platform.OS === 'web' ? (
                            // @ts-ignore
                            <input
                              type="time"
                              value={scheduleTime}
                              onChange={(e: any) => { setScheduleTime(e.target.value); setScheduleError(''); setActivePresetIndex(null); }}
                              style={{
                                width: '100%', height: 42, border: 'none', outline: 'none',
                                background: 'transparent', fontSize: 15,
                                color: colors.text, fontFamily: 'inherit', padding: '0 12px',
                                borderRadius: 10,
                              }}
                            />
                          ) : (
                            <>
                              <TouchableOpacity
                                style={[styles.scheduleInput, { justifyContent: 'center' }]}
                                onPress={() => setNativeTimePickerVisible(true)}
                              >
                                <Text style={{ color: scheduleTime ? colors.text : colors.textTertiary, fontSize: 15 }}>
                                  {formatDisplayTime(scheduleTime)}
                                </Text>
                              </TouchableOpacity>
                              {nativeTimePickerVisible && DateTimePicker && (
                                <DateTimePicker
                                  value={getScheduleDateAsDate()}
                                  mode="time"
                                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                  is24Hour={true}
                                  onChange={handleNativeTimeChange}
                                />
                              )}
                            </>
                          )}
                        </View>
                      </View>
                    </View>

                    {scheduleError ? (
                      <View style={styles.scheduleErrorRow}>
                        <AlertCircle color="#EF4444" size={13} />
                        <Text style={styles.scheduleErrorText}>{scheduleError}</Text>
                      </View>
                    ) : null}

                    <View style={styles.schedulePresets}>
                      {[
                        { label: 'Через 1 ч', hours: 1 },
                        { label: 'Через 3 ч', hours: 3 },
                        { label: 'Завтра 9:00', preset: 'tomorrow9' },
                        { label: 'Завтра 18:00', preset: 'tomorrow18' },
                      ].map((p, i) => {
                        const isActive = activePresetIndex === i;
                        return (
                          <TouchableOpacity
                            key={i}
                            style={[
                              styles.schedulePresetBtn,
                              { backgroundColor: isActive ? colors.primary : `${colors.primary}10`,
                                borderColor: isActive ? colors.primary : `${colors.primary}20` },
                            ]}
                            onPress={() => {
                              hapticKeypress();
                              setActivePresetIndex(i);
                              setScheduleError('');
                              const now = new Date();
                              let target: Date;
                              if (p.preset === 'tomorrow9') {
                                target = new Date(now);
                                target.setDate(target.getDate() + 1);
                                target.setHours(9, 0, 0, 0);
                              } else if (p.preset === 'tomorrow18') {
                                target = new Date(now);
                                target.setDate(target.getDate() + 1);
                                target.setHours(18, 0, 0, 0);
                              } else {
                                target = new Date(now.getTime() + (p.hours || 1) * 3600000);
                              }
                              const y = target.getFullYear();
                              const m = String(target.getMonth() + 1).padStart(2, '0');
                              const d = String(target.getDate()).padStart(2, '0');
                              const h = String(target.getHours()).padStart(2, '0');
                              const min = String(target.getMinutes()).padStart(2, '0');
                              setScheduleDate(`${y}-${m}-${d}`);
                              setScheduleTime(`${h}:${min}`);
                            }}
                          >
                            <Text style={[styles.schedulePresetText, { color: isActive ? '#FFF' : colors.primary }]}>{p.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <View style={styles.scheduleActions}>
                      <TouchableOpacity
                        style={[styles.scheduleCancelBtn, { borderColor: colors.border }]}
                        onPress={closeSchedulePicker}
                      >
                        <Text style={[styles.scheduleCancelText, { color: colors.textSecondary }]}>Отмена</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.scheduleConfirmBtn,
                          { backgroundColor: isScheduleValid() ? colors.primary : `${colors.primary}40`,
                            opacity: scheduleSending ? 0.7 : 1 },
                        ]}
                        onPress={scheduleMessage}
                        disabled={scheduleSending || !isScheduleValid()}
                      >
                        {scheduleSending ? (
                          <ActivityIndicator color="#FFF" size="small" />
                        ) : (
                          <>
                            <Clock color="#FFF" size={15} />
                            <Text style={styles.scheduleConfirmText}>Запланировать</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </Pressable>
            </RNAnimated.View>
          </Pressable>
        </Modal>
      )}

      {/* Scheduled messages list */}
      {showScheduledList && (
        <Modal visible transparent animationType="slide" onRequestClose={() => { setShowScheduledList(false); cancelScheduledEdit(); cancelReschedule(); }}>
          <Pressable style={styles.actionModalBackdrop} onPress={() => { setShowScheduledList(false); cancelScheduledEdit(); cancelReschedule(); }}>
            <Pressable style={[styles.scheduledListModal, { backgroundColor: colors.backgroundElevated }]} onPress={e => e.stopPropagation()}>
              <View style={styles.scheduledListHeader}>
                <View style={[styles.scheduleIconBg, { backgroundColor: `${colors.primary}12` }]}>
                  <Clock color={colors.primary} size={18} />
                </View>
                <Text style={[styles.scheduleTitle, { color: colors.text, flex: 1 }]}>Запланированные</Text>
                <View style={[styles.scheduledCountBadge, { backgroundColor: `${colors.primary}15` }]}>
                  <Text style={[styles.scheduledCountText, { color: colors.primary }]}>{scheduledMessages.length}</Text>
                </View>
                <TouchableOpacity onPress={() => { setShowScheduledList(false); cancelScheduledEdit(); cancelReschedule(); }} style={styles.scheduledCloseBtn}>
                  <X color={colors.textSecondary} size={18} />
                </TouchableOpacity>
              </View>
              {scheduledMessages.length === 0 ? (
                <View style={styles.scheduledEmpty}>
                  <View style={[styles.scheduledEmptyIconBg, { backgroundColor: `${colors.textTertiary}10` }]}>
                    <Clock color={colors.textTertiary} size={28} />
                  </View>
                  <Text style={[styles.scheduledEmptyTitle, { color: colors.textSecondary }]}>Пока ничего</Text>
                  <Text style={[styles.scheduledEmptyText, { color: colors.textTertiary }]}>Зажмите кнопку отправки, чтобы запланировать</Text>
                </View>
              ) : (
                <ScrollView style={styles.scheduledScrollView} showsVerticalScrollIndicator={false}>
                  {scheduledMessages.map((sm, index) => {
                    const dt = new Date(sm.scheduled_at);
                    const dateStr = dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: dt.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
                    const timeStr = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    const relTime = formatRelativeTime(sm.scheduled_at);
                    const isSending = sendingScheduledId === sm.id;
                    const isEditing = editingScheduledId === sm.id;
                    const isRescheduling = rescheduleId === sm.id;
                    return (
                      <View key={sm.id} style={[
                        styles.scheduledItem,
                        index < scheduledMessages.length - 1 && { borderBottomColor: `${colors.border}60`, borderBottomWidth: StyleSheet.hairlineWidth },
                        isSending && { opacity: 0.5 },
                      ]}>
                        <View style={[styles.scheduledItemTimeline, { backgroundColor: isEditing || isRescheduling ? colors.warning || '#F59E0B' : colors.primary }]} />
                        <View style={styles.scheduledItemContent}>
                          {isEditing ? (
                            <View style={styles.scheduledEditWrap}>
                              <TextInput
                                style={[styles.scheduledEditInput, { color: colors.text, backgroundColor: colors.backgroundTertiary, borderColor: `${colors.primary}30` }]}
                                value={editingScheduledContent}
                                onChangeText={setEditingScheduledContent}
                                multiline
                                autoFocus
                                maxLength={4096}
                                placeholderTextColor={colors.textTertiary}
                              />
                              <View style={styles.scheduledEditActions}>
                                <TouchableOpacity style={[styles.scheduledEditBtn, { backgroundColor: `${colors.textTertiary}12` }]} onPress={cancelScheduledEdit}>
                                  <X color={colors.textSecondary} size={14} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.scheduledEditBtn, { backgroundColor: editingScheduledContent.trim() ? `${colors.primary}15` : `${colors.textTertiary}08` }]}
                                  onPress={saveScheduledEdit}
                                  disabled={!editingScheduledContent.trim()}
                                >
                                  <Check color={editingScheduledContent.trim() ? colors.primary : colors.textTertiary} size={14} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : (
                            <TouchableOpacity onPress={() => sm.message_type === 'text' ? startEditScheduled(sm.id) : null} activeOpacity={sm.message_type === 'text' ? 0.6 : 1}>
                              {sm.message_type !== 'text' && sm.media_url ? (
                                <View style={styles.scheduledMediaIndicator}>
                                  {sm.message_type === 'voice' ? (
                                    <>
                                      <Mic color={colors.primary} size={14} />
                                      <Text style={[styles.scheduledItemText, { color: colors.text }]}>
                                        Голосовое {sm.media_duration > 0 ? formatVoiceDuration(sm.media_duration) : ''}
                                      </Text>
                                    </>
                                  ) : sm.message_type === 'video_note' ? (
                                    <>
                                      <Video color={colors.primary} size={14} />
                                      <Text style={[styles.scheduledItemText, { color: colors.text }]}>
                                        Кружок {sm.media_duration > 0 ? formatVoiceDuration(sm.media_duration) : ''}
                                      </Text>
                                    </>
                                  ) : sm.message_type === 'video' ? (
                                    <>
                                      <Video color={colors.primary} size={14} />
                                      <Text style={[styles.scheduledItemText, { color: colors.text }]} numberOfLines={1}>
                                        Видео{sm.content ? `: ${sm.content}` : ''}
                                      </Text>
                                    </>
                                  ) : (
                                    <>
                                      <ImageIcon color={colors.primary} size={14} />
                                      <Text style={[styles.scheduledItemText, { color: colors.text }]} numberOfLines={1}>
                                        Фото{sm.content ? `: ${sm.content}` : ''}
                                      </Text>
                                    </>
                                  )}
                                  {(sm.message_type === 'image' || sm.message_type === 'video') && sm.media_url && (
                                    <Image source={{ uri: sm.media_url }} style={styles.scheduledMediaThumb} />
                                  )}
                                </View>
                              ) : (
                                <Text style={[styles.scheduledItemText, { color: colors.text }]} numberOfLines={3}>{sm.content}</Text>
                              )}
                            </TouchableOpacity>
                          )}

                          {isRescheduling ? (
                            <View style={styles.rescheduleWrap}>
                              <View style={styles.rescheduleRow}>
                                <View style={[styles.rescheduleInputWrap, { backgroundColor: colors.backgroundTertiary }]}>
                                  {Platform.OS === 'web' ? (
                                    // @ts-ignore
                                    <input
                                      type="date"
                                      value={rescheduleDate}
                                      onChange={(e: any) => setRescheduleDate(e.target.value)}
                                      min={new Date().toISOString().split('T')[0]}
                                      style={{ width: '100%', height: 34, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: colors.text, fontFamily: 'inherit', padding: '0 8px', borderRadius: 8 }}
                                    />
                                  ) : (
                                    <>
                                      <TouchableOpacity style={{ height: 34, justifyContent: 'center', paddingHorizontal: 8 }} onPress={() => setRescheduleNativeDateVisible(true)}>
                                        <Text style={{ color: colors.text, fontSize: 13 }}>{formatDisplayDate(rescheduleDate)}</Text>
                                      </TouchableOpacity>
                                      {rescheduleNativeDateVisible && DateTimePicker && (
                                        <DateTimePicker value={new Date(`${rescheduleDate}T${rescheduleTime}:00`)} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} minimumDate={new Date()} onChange={(_: any, d?: Date) => { setRescheduleNativeDateVisible(Platform.OS === 'ios'); if (d) { setRescheduleDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`); } }} />
                                      )}
                                    </>
                                  )}
                                </View>
                                <View style={[styles.rescheduleInputWrap, { backgroundColor: colors.backgroundTertiary }]}>
                                  {Platform.OS === 'web' ? (
                                    // @ts-ignore
                                    <input
                                      type="time"
                                      value={rescheduleTime}
                                      onChange={(e: any) => setRescheduleTime(e.target.value)}
                                      style={{ width: '100%', height: 34, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: colors.text, fontFamily: 'inherit', padding: '0 8px', borderRadius: 8 }}
                                    />
                                  ) : (
                                    <>
                                      <TouchableOpacity style={{ height: 34, justifyContent: 'center', paddingHorizontal: 8 }} onPress={() => setRescheduleNativeTimeVisible(true)}>
                                        <Text style={{ color: colors.text, fontSize: 13 }}>{rescheduleTime}</Text>
                                      </TouchableOpacity>
                                      {rescheduleNativeTimeVisible && DateTimePicker && (
                                        <DateTimePicker value={new Date(`${rescheduleDate}T${rescheduleTime}:00`)} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(_: any, d?: Date) => { setRescheduleNativeTimeVisible(Platform.OS === 'ios'); if (d) { setRescheduleTime(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`); } }} />
                                      )}
                                    </>
                                  )}
                                </View>
                              </View>
                              <View style={styles.rescheduleActions}>
                                <TouchableOpacity style={[styles.scheduledEditBtn, { backgroundColor: `${colors.textTertiary}12` }]} onPress={cancelReschedule}>
                                  <X color={colors.textSecondary} size={14} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.scheduledEditBtn, { backgroundColor: isRescheduleValid() ? `${colors.primary}15` : `${colors.textTertiary}08` }]}
                                  onPress={saveReschedule}
                                  disabled={!isRescheduleValid()}
                                >
                                  <Check color={isRescheduleValid() ? colors.primary : colors.textTertiary} size={14} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : (
                            <TouchableOpacity style={styles.scheduledItemMeta} onPress={() => startReschedule(sm.id)} activeOpacity={0.6}>
                              <Clock color={colors.primary} size={11} />
                              <Text style={[styles.scheduledItemTime, { color: colors.primary }]}>{dateStr}, {timeStr}</Text>
                              <Text style={[styles.scheduledItemRelative, { color: colors.textTertiary }]}>{relTime}</Text>
                              <Edit3 color={colors.textTertiary} size={10} style={{ marginLeft: 2 }} />
                            </TouchableOpacity>
                          )}
                        </View>
                        {!isEditing && !isRescheduling && (
                          <View style={styles.scheduledItemActions}>
                            <TouchableOpacity
                              style={[styles.scheduledActionBtn, { backgroundColor: `${colors.primary}10` }]}
                              onPress={() => sendScheduledNow(sm.id)}
                              disabled={isSending}
                            >
                              {isSending ? <ActivityIndicator color={colors.primary} size={14} /> : <Send color={colors.primary} size={13} />}
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.scheduledActionBtn, { backgroundColor: `${colors.error || '#EF4444'}08` }]}
                              onPress={() => cancelScheduledMessage(sm.id)}
                              disabled={isSending}
                            >
                              <Trash2 color={colors.error || '#EF4444'} size={13} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Photo preview sheet */}
      <PhotoPreviewSheet
        visible={showPhotoPreview}
        assets={photoPreviewAssets}
        onClose={() => { setShowPhotoPreview(false); setPhotoPreviewAssets([]); }}
        onSend={handleSendPhotos}
        onSchedule={handleSchedulePhotos}
        onAddMore={handleAddMorePhotos}
        onRemoveAsset={(id) => setPhotoPreviewAssets(prev => prev.filter(a => a.id !== id))}
        colors={colors}
      />

      {/* Video Note Recording Overlay */}
      {recordingVideoNote && Platform.OS === 'web' && (
        <Modal visible transparent animationType="fade" onRequestClose={() => stopVideoNote(false)}>
          <View style={styles.videoNoteOverlay}>
            <View style={styles.videoNoteRecordContainer}>
              {/* Recording ring + preview */}
              <View style={styles.videoNoteRecordRingWrap}>
                {/* @ts-ignore */}
                <svg width={280} height={280} style={{ position: 'absolute', top: 0, left: 0 }}>
                  {/* @ts-ignore */}
                  <circle cx={140} cy={140} r={137} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
                  {/* @ts-ignore */}
                  <circle
                    cx={140} cy={140} r={137}
                    fill="none" stroke="#E53935" strokeWidth={3}
                    strokeDasharray={2 * Math.PI * 137}
                    strokeDashoffset={2 * Math.PI * 137 * (1 - Math.min(videoNoteDuration / 60, 1))}
                    strokeLinecap="round"
                    transform="rotate(-90 140 140)"
                    style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                  />
                </svg>
                <View style={styles.videoNoteRecordCircle}>
                  {/* @ts-ignore */}
                  <video
                    id="video-note-preview"
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 999, transform: 'scaleX(-1)' }}
                  />
                </View>
              </View>

              {/* Timer with pulsing dot */}
              <View style={styles.videoNoteTimerRow}>
                <View style={styles.videoNoteRecDot} />
                <Text style={styles.videoNoteRecordTimer}>
                  {Math.floor(videoNoteDuration / 60)}:{(videoNoteDuration % 60).toString().padStart(2, '0')}
                </Text>
              </View>

              {/* Action buttons */}
              <View style={styles.videoNoteRecordActions}>
                <TouchableOpacity
                  style={styles.videoNoteCancelBtn}
                  onPress={() => stopVideoNote(false)}
                  activeOpacity={0.7}
                >
                  <X color="#FFFFFF" size={22} />
                  <Text style={styles.videoNoteActionLabel}>Отмена</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.videoNoteSendBtn, { backgroundColor: colors.primary }]}
                  onPress={() => stopVideoNote(true)}
                  activeOpacity={0.7}
                >
                  <Send color="#FFFFFF" size={22} />
                  <Text style={styles.videoNoteActionLabel}>Отправить</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Sending indicator removed - upload happens in background */}

      {/* Media gallery viewer */}
      <MediaGalleryViewer
        visible={galleryViewerOpen}
        items={avatarGalleryRef.current || galleryItems}
        initialIndex={galleryInitialIndex}
        onClose={() => { setGalleryViewerOpen(false); avatarGalleryRef.current = null; }}
      />

      {liveStory && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setLiveStory(null)}>
          <StatusViewer
            viewingUser={liveStory.user}
            currentStatus={liveStory.user.statuses[liveStory.index]}
            viewingIndex={liveStory.index}
            userId={user?.id || ''}
            onNext={async () => {
              if (liveStory.index < liveStory.user.statuses.length - 1) {
                setLiveStory({ ...liveStory, index: liveStory.index + 1 });
              } else {
                setLiveStory(null);
              }
            }}
            onPrev={() => {
              if (liveStory.index > 0) {
                setLiveStory({ ...liveStory, index: liveStory.index - 1 });
              }
            }}
            onDelete={async () => { setLiveStory(null); }}
            onClose={() => setLiveStory(null)}
            onLoadViewers={async () => {}}
            viewersList={[]}
            showViewers={false}
            setShowViewers={() => {}}
            formatStatusTime={(d: string) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            colors={colors}
          />
        </Modal>
      )}

      {/* Message actions modal */}
      <Modal visible={!!selectedMessage} transparent animationType="fade" onRequestClose={() => setSelectedMessage(null)}>
        <Pressable style={styles.actionModalBackdrop} onPress={() => setSelectedMessage(null)}>
          <Pressable style={[styles.actionModalContent, { backgroundColor: colors.backgroundSecondary }]} onPress={(e) => e.stopPropagation()}>
            {(() => {
              const isChannel = chatInfo.type === 'channel';
              const isChAdmin = isChannel && (
                groupMembers.find(m => m.user_id === user?.id)?.role === 'admin' ||
                groupMembers.find(m => m.user_id === user?.id)?.role === 'owner' ||
                myChannelRoleEager === 'admin' || myChannelRoleEager === 'owner'
              );

              return (
                <>
                  {/* Quick reactions row */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.modalReactionsRow, { borderBottomColor: colors.border }]} contentContainerStyle={{ gap: 6, paddingHorizontal: 14 }}>
                    {(chatInfo.type === 'channel' && channelAllowedReactions ? channelAllowedReactions : QUICK_REACTIONS).map((emoji) => (
                      <TouchableOpacity
                        key={emoji}
                        style={styles.modalReactionItem}
                        onPress={() => {
                          if (selectedMessage) toggleReaction(selectedMessage.id, emoji);
                          setSelectedMessage(null);
                        }}
                      >
                        <Text style={styles.modalReactionEmoji}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Reply - not available in channels */}
                  {!isChannel && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => selectedMessage && handleReply(selectedMessage)}>
                      <Reply color={colors.text} size={20} />
                      <Text style={[styles.actionText, { color: colors.text }]}>Ответить</Text>
                    </TouchableOpacity>
                  )}

                  {/* Copy - available to everyone for text messages */}
                  {selectedMessage?.message_type === 'text' && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => selectedMessage && copyMessage(selectedMessage)}>
                      <Copy color={colors.text} size={20} />
                      <Text style={[styles.actionText, { color: colors.text }]}>Копировать</Text>
                    </TouchableOpacity>
                  )}

                  {/* Download - available to everyone for media */}
                  {selectedMessage?.media_url && (selectedMessage.message_type === 'image' || selectedMessage.message_type === 'video' || selectedMessage.message_type === 'file') && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => {
                      if (selectedMessage?.media_url) {
                        const t = selectedMessage.message_type === 'video' ? 'video' as const : 'image' as const;
                        downloadMedia(selectedMessage.media_url, t);
                      }
                      setSelectedMessage(null);
                    }}>
                      <Download color={colors.text} size={20} />
                      <Text style={[styles.actionText, { color: colors.text }]}>Скачать</Text>
                    </TouchableOpacity>
                  )}

                  {/* Forward - available to everyone */}
                  <TouchableOpacity style={styles.actionItem} onPress={() => selectedMessage && handleForward(selectedMessage)}>
                    <Forward color={colors.text} size={20} />
                    <Text style={[styles.actionText, { color: colors.text }]}>Переслать</Text>
                  </TouchableOpacity>

                  {/* Save to favorites - available to subscribers (non-admins) and in non-channel chats */}
                  {!isSavedChat && (!isChannel || !isChAdmin) && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => selectedMessage && forwardToSaved(selectedMessage)}>
                      <Bookmark color={colors.primary} size={20} />
                      <Text style={[styles.actionText, { color: colors.primary }]}>В Избранное</Text>
                    </TouchableOpacity>
                  )}

                  {/* Star message - not shown in channels for subscribers */}
                  {!isChannel && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => selectedMessage && toggleStarMessage(selectedMessage.id)}>
                      <Star
                        color={selectedMessage && starredMessageIds.has(selectedMessage.id) ? '#FFD60A' : colors.text}
                        size={20}
                        fill={selectedMessage && starredMessageIds.has(selectedMessage.id) ? '#FFD60A' : 'none'}
                      />
                      <Text style={[styles.actionText, { color: colors.text }]}>
                        {selectedMessage && starredMessageIds.has(selectedMessage.id) ? 'Убрать из избранного' : 'В избранное'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Pin - only for channel admins or non-channel chats */}
                  {(!isChannel || isChAdmin) && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => selectedMessage && pinMessage(selectedMessage)}>
                      <Pin color={colors.text} size={20} />
                      <Text style={[styles.actionText, { color: colors.text }]}>
                        {selectedMessage?.is_pinned ? 'Открепить' : 'Закрепить'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Edit - only for own messages (channel admin) or non-channel own messages */}
                  {selectedMessage?.sender_id === user?.id && (selectedMessage?.message_type === 'text' || selectedMessage?.message_type === 'image' || selectedMessage?.message_type === 'video') && (!isChannel || isChAdmin) && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => selectedMessage && handleEdit(selectedMessage)}>
                      <Edit3 color={colors.text} size={20} />
                      <Text style={[styles.actionText, { color: colors.text }]}>Редактировать</Text>
                    </TouchableOpacity>
                  )}

                  {/* Delete - only for channel admins or non-channel chats */}
                  {(!isChannel || isChAdmin) && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => selectedMessage && deleteMessage(selectedMessage)}>
                      <Trash2 color={colors.error} size={20} />
                      <Text style={[styles.actionText, { color: colors.error }]}>Удалить</Text>
                    </TouchableOpacity>
                  )}

                  <View style={[{ height: 1, backgroundColor: colors.border, marginVertical: 4 }]} />

                  {/* Select - available to everyone */}
                  <TouchableOpacity style={styles.actionItem} onPress={() => {
                    if (selectedMessage) {
                      setSelectMode(true);
                      setSelectedIds(new Set([selectedMessage.id]));
                    }
                    setSelectedMessage(null);
                  }}>
                    <Check color={colors.text} size={20} />
                    <Text style={[styles.actionText, { color: colors.text }]}>Выбрать</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Forward modal */}
      <Modal visible={showReportModal} transparent animationType="slide" onRequestClose={() => { setShowReportModal(false); setReportReason(''); setReportDetails(''); setReportSent(false); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Пожаловаться</Text>
              <TouchableOpacity onPress={() => { setShowReportModal(false); setReportReason(''); setReportDetails(''); setReportSent(false); }}>
                <X color={colors.textSecondary} size={24} />
              </TouchableOpacity>
            </View>
            {reportSent ? (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Check color={colors.primary} size={48} />
                <Text style={{ color: colors.text, fontSize: 16, marginTop: 12 }}>Жалоба отправлена</Text>
              </View>
            ) : (
              <>
                <Text style={{ color: colors.textSecondary, fontSize: 14, marginBottom: 16 }}>Выберите причину жалобы:</Text>
                {[
                  { key: 'spam', label: 'Спам' },
                  { key: 'harassment', label: 'Оскорбления и домогательства' },
                  { key: 'inappropriate_content', label: 'Неприемлемый контент' },
                  { key: 'violence', label: 'Насилие или угрозы' },
                  { key: 'fraud', label: 'Мошенничество' },
                  { key: 'other', label: 'Другое' },
                ].map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: reportReason === item.key ? `${colors.primary}20` : 'transparent', marginBottom: 4 }}
                    onPress={() => setReportReason(item.key)}
                  >
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: reportReason === item.key ? colors.primary : colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      {reportReason === item.key && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary }} />}
                    </View>
                    <Text style={{ color: colors.text, fontSize: 15 }}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
                {reportReason === 'other' && (
                  <TextInput
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.text, fontSize: 14, marginTop: 8, minHeight: 60, textAlignVertical: 'top' }}
                    placeholder="Опишите проблему..."
                    placeholderTextColor={colors.textTertiary}
                    value={reportDetails}
                    onChangeText={setReportDetails}
                    multiline
                  />
                )}
                <TouchableOpacity
                  style={{ marginTop: 20, backgroundColor: reportReason ? colors.error : colors.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: reportReason ? 1 : 0.5 }}
                  onPress={handleReportUser}
                  disabled={!reportReason || reportSending}
                >
                  {reportSending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Отправить жалобу</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Edit channel modal */}
      <Modal visible={editChannelModal} transparent animationType="slide" onRequestClose={() => setEditChannelModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Редактировать канал</Text>
              <TouchableOpacity onPress={() => setEditChannelModal(false)}>
                <X color={colors.textSecondary} size={24} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>

            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>Название</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 15, marginBottom: 16 }}
              placeholder="Название канала"
              placeholderTextColor={colors.textTertiary}
              value={editChannelName}
              onChangeText={setEditChannelName}
              maxLength={64}
            />

            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>Имя пользователя</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginBottom: 16 }}>
              <Text style={{ paddingLeft: 12, color: colors.textTertiary, fontSize: 15 }}>@</Text>
              <TextInput
                style={{ flex: 1, paddingHorizontal: 4, paddingVertical: 10, color: colors.text, fontSize: 15, paddingRight: 12 }}
                placeholder="username"
                placeholderTextColor={colors.textTertiary}
                value={editChannelUsername}
                onChangeText={(t) => setEditChannelUsername(t.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                maxLength={32}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>Описание</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 15, minHeight: 80, textAlignVertical: 'top', marginBottom: 20 }}
              placeholder="Описание канала"
              placeholderTextColor={colors.textTertiary}
              value={editChannelDesc}
              onChangeText={setEditChannelDesc}
              multiline
              maxLength={512}
            />

            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>Доступные реакции</Text>
            <Text style={{ fontSize: 12, color: colors.textTertiary, marginBottom: 10 }}>Выберите, какие реакции смогут ставить подписчики</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundSecondary }}>
              {ALL_AVAILABLE_REACTIONS.map((emoji) => {
                const isSelected = editChannelReactions.includes(emoji);
                return (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => {
                      setEditChannelReactions(prev =>
                        isSelected ? prev.filter(e => e !== emoji) : [...prev, emoji]
                      );
                    }}
                    style={{ width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: isSelected ? colors.primary + '20' : 'transparent', borderWidth: 1.5, borderColor: isSelected ? colors.primary : colors.border }}
                  >
                    <Text style={{ fontSize: 20 }}>{emoji}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            </ScrollView>

            <TouchableOpacity
              style={{ backgroundColor: editChannelName.trim() ? colors.primary : colors.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: editChannelName.trim() ? 1 : 0.5 }}
              onPress={async () => {
                if (!editChannelName.trim()) return;
                setEditChannelSaving(true);
                const updates: Record<string, any> = {
                  name: editChannelName.trim(),
                  description: editChannelDesc.trim() || null,
                  username: editChannelUsername.trim() || null,
                  allowed_reactions: editChannelReactions.length > 0 ? editChannelReactions : null,
                };
                const { error } = await supabase
                  .from('conversations')
                  .update(updates)
                  .eq('id', id);
                setEditChannelSaving(false);
                if (!error) {
                  setChatInfo(prev => ({ ...prev, name: updates.name || prev.name, description: updates.description || undefined, username: updates.username || undefined }));
                  setChannelAllowedReactions(editChannelReactions.length > 0 ? editChannelReactions : null);
                  setEditChannelModal(false);
                }
              }}
              disabled={!editChannelName.trim() || editChannelSaving}
              activeOpacity={0.7}
            >
              {editChannelSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Сохранить</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Channel Mute Duration Sheet */}
      <Modal visible={channelMuteSheet} transparent animationType="fade" onRequestClose={() => setChannelMuteSheet(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} onPress={() => setChannelMuteSheet(false)}>
          <Pressable style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 34, paddingTop: 12 }} onPress={e => e.stopPropagation()}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: 20, marginBottom: 4 }}>Уведомления</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, paddingHorizontal: 20, marginBottom: 16 }}>Отключить уведомления от этого канала</Text>
            {[
              { label: 'На 1 час', hours: 1 },
              { label: 'На 8 часов', hours: 8 },
              { label: 'На 2 дня', hours: 48 },
              { label: 'Навсегда', hours: null },
            ].map((opt, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => handleMuteChannelFor(opt.hours)}
                activeOpacity={0.6}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, gap: 14 }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                  {opt.hours === null ? <BellOff color={colors.textSecondary} size={18} /> : <Clock color={colors.textSecondary} size={18} />}
                </View>
                <Text style={{ fontSize: 15, color: colors.text, fontWeight: '500' }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setChannelMuteSheet(false)}
              activeOpacity={0.6}
              style={{ marginTop: 8, marginHorizontal: 20, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textSecondary }}>Отмена</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showForwardModal} transparent animationType="slide" onRequestClose={() => setShowForwardModal(false)}>
        <View style={[styles.forwardModal, { backgroundColor: colors.background }]}>
          <View style={[styles.forwardHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.forwardTitle, { color: colors.text }]}>Переслать в...</Text>
            <TouchableOpacity onPress={() => setShowForwardModal(false)}>
              <X color={colors.textSecondary} size={22} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }: { item: { id: string; name: string; isSaved?: boolean } }) => (
              <TouchableOpacity
                style={[styles.forwardItem, { borderBottomColor: colors.border }]}
                onPress={() => forwardToConversation(item.id)}
              >
                {item.isSaved ? (
                  <View style={[styles.forwardAvatar, { backgroundColor: colors.primary }]}>
                    <Bookmark color="#FFFFFF" size={18} />
                  </View>
                ) : (
                  <View style={[styles.forwardAvatar, { backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={[styles.forwardAvatarText, { color: colors.text }]}>{item.name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={[styles.forwardName, { color: colors.text }]}>{item.name}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={[styles.emptyForward, { color: colors.textSecondary }]}>Нет доступных чатов</Text>
            }
          />
        </View>
      </Modal>

      {/* Call type picker */}
      <Modal visible={showCallPicker} transparent animationType="fade" onRequestClose={() => setShowCallPicker(false)}>
        <Pressable style={styles.callPickerBackdrop} onPress={() => setShowCallPicker(false)}>
          <View style={[styles.callPickerSheet, { backgroundColor: colors.backgroundSecondary }]}>
            <TouchableOpacity
              style={styles.callPickerOption}
              activeOpacity={0.7}
              onPress={() => { setShowCallPicker(false); initiateCall('voice'); }}
            >
              <View style={[styles.callPickerIcon, { backgroundColor: colors.primary + '18' }]}>
                <PhoneIcon color={colors.primary} size={22} />
              </View>
              <Text style={[styles.callPickerLabel, { color: colors.text }]}>Аудиозвонок</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.callPickerOption}
              activeOpacity={0.7}
              onPress={() => { setShowCallPicker(false); initiateCall('video'); }}
            >
              <View style={[styles.callPickerIcon, { backgroundColor: colors.primary + '18' }]}>
                <Video color={colors.primary} size={22} />
              </View>
              <Text style={[styles.callPickerLabel, { color: colors.text }]}>Видеозвонок</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Chat menu */}
      <Modal visible={showChatMenu} transparent animationType="fade" onRequestClose={() => setShowChatMenu(false)}>
        <Pressable style={styles.chatMenuBackdrop} onPress={() => setShowChatMenu(false)}>
          <View style={[styles.chatMenuContent, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.chatMenuHeader}>
              <Text style={[styles.chatMenuTitle, { color: colors.text }]}>{isSavedChat ? 'Избранное' : (chatInfo.name || 'Чат')}</Text>
              <TouchableOpacity onPress={() => setShowChatMenu(false)}>
                <X color={colors.textSecondary} size={20} />
              </TouchableOpacity>
            </View>

            {(chatInfo.type === 'group' || isChannel) && (
              <TouchableOpacity style={styles.chatMenuAction} onPress={handleOpenGroupInfo}>
                <Users color={colors.text} size={20} />
                <Text style={[styles.chatMenuActionText, { color: colors.text }]}>{isChannel ? 'Информация о канале' : 'Участники группы'}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.chatMenuAction} onPress={() => {
              setShowChatMenu(false);
              router.push({ pathname: '/search', params: { conversationId: id, conversationName: chatInfo.name || (chatInfo.type === 'direct' ? chatInfo.name : 'Чат') } });
            }}>
              <Search color={colors.text} size={20} />
              <Text style={[styles.chatMenuActionText, { color: colors.text }]}>Поиск в чате</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.chatMenuAction} onPress={handleOpenMediaGallery}>
              <ImageIcon color={colors.text} size={20} />
              <Text style={[styles.chatMenuActionText, { color: colors.text }]}>Медиа файлы</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.chatMenuAction} onPress={() => { setShowChatMenu(false); setTimeout(() => setShowWallpaperPicker(true), 300); }}>
              <Palette color={colors.text} size={20} />
              <Text style={[styles.chatMenuActionText, { color: colors.text }]}>Обои чата</Text>
            </TouchableOpacity>

            {isChannel && !isChannelAdmin && (
              <TouchableOpacity style={styles.chatMenuAction} onPress={() => { handleToggleChannelMute(); setShowChatMenu(false); }}>
                {channelMuted ? <Bell color={colors.text} size={20} /> : <BellOff color={colors.text} size={20} />}
                <Text style={[styles.chatMenuActionText, { color: colors.text }]}>{channelMuted ? 'Включить звук' : 'Убрать звук'}</Text>
              </TouchableOpacity>
            )}

            {!(isChannel && !isChannelAdmin) && (
              <TouchableOpacity style={styles.chatMenuAction} onPress={exportChat}>
                <FileDown color={colors.text} size={20} />
                <Text style={[styles.chatMenuActionText, { color: colors.text }]}>Экспорт чата</Text>
              </TouchableOpacity>
            )}

            {isChannel && !isChannelAdmin ? (
              <TouchableOpacity style={styles.chatMenuAction} onPress={() => { setShowChatMenu(false); handleUnsubscribeChannel(); }}>
                <LogOut color={colors.error} size={20} />
                <Text style={[styles.chatMenuActionText, { color: colors.error }]}>Отписаться</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.chatMenuAction} onPress={handleDeleteChat}>
                <Trash2 color={colors.error} size={20} />
                <Text style={[styles.chatMenuActionText, { color: colors.error }]}>Удалить чат</Text>
              </TouchableOpacity>
            )}

            {!(isChannel && !isChannelAdmin) && (
              <>
                <View style={[styles.chatMenuDivider, { backgroundColor: colors.border }]} />
                <Text style={[styles.chatMenuSectionLabel, { color: colors.textSecondary }]}>Исчезающие сообщения</Text>
                {[
                  { label: 'Выкл', value: 0 },
                  { label: '30 сек', value: 30 },
                  { label: '5 мин', value: 300 },
                  { label: '1 час', value: 3600 },
                  { label: '24 часа', value: 86400 },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={styles.chatMenuAction}
                    onPress={() => { setDisappearTimer(opt.value); setShowChatMenu(false); }}
                  >
                    <Timer color={disappearTimer === opt.value ? colors.primary : colors.text} size={18} />
                    <Text style={[styles.chatMenuActionText, { color: disappearTimer === opt.value ? colors.primary : colors.text }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {chatInfo.other_user_id && (
              <TouchableOpacity style={styles.chatMenuAction} onPress={isBlocked ? handleUnblockUser : handleBlockUser}>
                {isBlocked ? <UserX color={colors.primary} size={20} /> : <Ban color={colors.error} size={20} />}
                <Text style={[styles.chatMenuActionText, { color: isBlocked ? colors.primary : colors.error }]}>
                  {isBlocked ? 'Разблокировать' : 'Заблокировать'}
                </Text>
              </TouchableOpacity>
            )}
            {chatInfo.other_user_id && (
              <TouchableOpacity style={styles.chatMenuAction} onPress={() => { setShowChatMenu(false); setShowReportModal(true); }}>
                <AlertCircle color={colors.error} size={20} />
                <Text style={[styles.chatMenuActionText, { color: colors.error }]}>Пожаловаться</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>
      {showUserProfile && <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} onPress={() => setShowUserProfile(false)} />
        <RNAnimated.View style={[styles.upSlidePanel, { backgroundColor: colors.background, transform: [{ translateX: userProfileSlideAnim }] }]}>
          {/* Full-screen avatar overlay */}
          {profileAvatarFull && userProfileData?.avatar_url && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setProfileAvatarFull(false)}>
              <Pressable style={styles.upAvatarOverlay} onPress={() => setProfileAvatarFull(false)}>
                <TouchableOpacity style={styles.upOverlayClose} onPress={() => setProfileAvatarFull(false)}>
                  <X color="#FFFFFF" size={24} />
                </TouchableOpacity>
                <CachedImage uri={userProfileData.avatar_url} style={styles.upAvatarFullImg} contentFit="contain" />
              </Pressable>
            </Modal>
          )}

          {/* Story viewer overlay */}
          {profileStoryView !== null && userProfileData?.stories?.[profileStoryView] && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setProfileStoryView(null)}>
              <Pressable style={styles.upStoryOverlay} onPress={() => setProfileStoryView(null)}>
                <TouchableOpacity style={styles.upOverlayClose} onPress={() => setProfileStoryView(null)}>
                  <X color="#FFFFFF" size={24} />
                </TouchableOpacity>
                <View style={styles.upStoryProgress}>
                  {userProfileData.stories.map((_, si) => (
                    <View key={si} style={[styles.upStoryProgressDot, { backgroundColor: si === profileStoryView ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }]} />
                  ))}
                </View>
                <View style={[styles.upStoryContent, { paddingTop: Math.max(insets.top, 20) + 30 }]}>
                  {(() => {
                    const story = userProfileData.stories[profileStoryView];
                    if (story.media_url && story.media_type === 'video') {
                      return Platform.OS === 'web' ? (
                        // @ts-ignore
                        <video src={story.media_url} controls autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 16 }} />
                      ) : null;
                    }
                    if (story.media_url) {
                      return <CachedImage uri={story.media_url} style={styles.upStoryMediaImg} contentFit="contain" />;
                    }
                    return (
                      <View style={[styles.upStoryTextCard, { backgroundColor: story.background_color || '#1E88E5' }]}>
                        <Text style={[styles.upStoryTextContent, { color: story.text_color || '#FFFFFF' }]}>{story.content}</Text>
                      </View>
                    );
                  })()}
                </View>
                <View style={styles.upStoryNav}>
                  {profileStoryView > 0 ? (
                    <TouchableOpacity style={styles.upStoryNavBtn} onPress={() => setProfileStoryView(profileStoryView - 1)}>
                      <ChevronUp color="#FFFFFF" size={22} style={{ transform: [{ rotate: '-90deg' }] }} />
                    </TouchableOpacity>
                  ) : <View style={{ width: 44 }} />}
                  <View style={{ flex: 1 }} />
                  {profileStoryView < (userProfileData?.stories?.length || 0) - 1 ? (
                    <TouchableOpacity style={styles.upStoryNavBtn} onPress={() => setProfileStoryView(profileStoryView + 1)}>
                      <ChevronUp color="#FFFFFF" size={22} style={{ transform: [{ rotate: '90deg' }] }} />
                    </TouchableOpacity>
                  ) : <View style={{ width: 44 }} />}
                </View>
              </Pressable>
            </Modal>
          )}

          {/* Media viewer overlay */}
          {profileMediaIndex !== null && userProfileData?.sharedPhotos?.[profileMediaIndex] && (() => {
            const media = userProfileData.sharedPhotos[profileMediaIndex];
            const total = userProfileData.sharedPhotos.length;
            const fmtDate = (d: string) => {
              const dt = new Date(d);
              const day = dt.getDate().toString().padStart(2, '0');
              const mon = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][dt.getMonth()];
              const h = dt.getHours().toString().padStart(2, '0');
              const m = dt.getMinutes().toString().padStart(2, '0');
              return `${day} ${mon}, ${h}:${m}`;
            };
            const goPrev = () => { if (profileMediaIndex > 0) setProfileMediaIndex(profileMediaIndex - 1); };
            const goNext = () => { if (profileMediaIndex < total - 1) setProfileMediaIndex(profileMediaIndex + 1); };
            return (
              <Modal visible transparent animationType="fade" onRequestClose={() => setProfileMediaIndex(null)}>
                <View style={styles.mvOverlay}>
                  <View style={[styles.mvTopBar, { paddingTop: Math.max(insets.top, 12) }]}>
                    <TouchableOpacity style={styles.mvTopBtn} onPress={() => setProfileMediaIndex(null)}>
                      <ArrowLeft color="#FFFFFF" size={22} />
                    </TouchableOpacity>
                    <View style={styles.mvTopInfo}>
                      <Text style={styles.mvTopSender}>{media.sender_name}</Text>
                      <Text style={styles.mvTopDate}>{fmtDate(media.created_at)}</Text>
                    </View>
                    <Text style={styles.mvCounter}>{profileMediaIndex + 1}/{total}</Text>
                  </View>

                  <View style={styles.mvContent}>
                    {media.message_type === 'video' && Platform.OS === 'web' ? (
                      // @ts-ignore
                      <video
                        key={media.id}
                        src={media.media_url}
                        controls
                        autoPlay
                        playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <CachedImage uri={media.media_url} style={styles.mvImage} contentFit="contain" />
                    )}
                  </View>

                  <View style={styles.mvNavRow}>
                    {profileMediaIndex > 0 ? (
                      <TouchableOpacity style={styles.mvNavBtn} onPress={goPrev}>
                        <ChevronUp color="#FFFFFF" size={24} style={{ transform: [{ rotate: '-90deg' }] }} />
                      </TouchableOpacity>
                    ) : <View style={{ width: 48 }} />}
                    <View style={{ flex: 1 }} />
                    {profileMediaIndex < total - 1 ? (
                      <TouchableOpacity style={styles.mvNavBtn} onPress={goNext}>
                        <ChevronUp color="#FFFFFF" size={24} style={{ transform: [{ rotate: '90deg' }] }} />
                      </TouchableOpacity>
                    ) : <View style={{ width: 48 }} />}
                  </View>

                  <View style={[styles.mvThumbStrip, { paddingBottom: Math.max(insets.bottom, 14) }]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mvThumbScroll}>
                      {userProfileData.sharedPhotos.map((p, pi) => (
                        <TouchableOpacity key={p.id} onPress={() => setProfileMediaIndex(pi)} activeOpacity={0.8}>
                          <View style={[styles.mvThumb, pi === profileMediaIndex && styles.mvThumbActive]}>
                            <CachedImage uri={p.media_url} style={styles.mvThumbImg} />
                            {p.message_type === 'video' && (
                              <View style={styles.mvThumbPlay}>
                                <Play color="#FFF" size={8} fill="#FFF" />
                              </View>
                            )}
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              </Modal>
            );
          })()}

          {/* Header bar */}
          <View style={[styles.upHeader, { backgroundColor: colors.primary, paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity style={styles.upHeaderBtn} onPress={() => setShowUserProfile(false)}>
              <X color="#FFFFFF" size={22} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.upHeaderBtn} onPress={() => { setShowUserProfile(false); setShowChatMenu(true); }}>
              <MoreVertical color="#FFFFFF" size={22} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false} style={{ flex: 1 }}>
            {/* Avatar + Name hero */}
            <View style={[styles.upProfileCard, { backgroundColor: colors.primary }]}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => userProfileData?.avatar_url && setProfileAvatarFull(true)} style={styles.upAvatarWrap}>
                {userProfileData?.avatar_url ? (
                  <CachedImage uri={userProfileData.avatar_url} style={styles.upAvatar} />
                ) : (
                  <View style={[styles.upAvatar, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                    <Text style={styles.upAvatarLetter}>
                      {(userProfileData?.display_name || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                {isUserOnline(userProfileData?.is_online ?? false, userProfileData?.last_seen) && (
                  <View style={[styles.upAvatarOnlineBadge, { borderColor: colors.primary }]} />
                )}
              </TouchableOpacity>
              <Text style={styles.upName}>{userProfileData?.display_name || 'Пользователь'}</Text>
              <Text style={styles.upOnlineText}>
                {isUserOnline(userProfileData?.is_online ?? false, userProfileData?.last_seen)
                  ? 'в сети'
                  : userProfileData?.last_seen
                    ? `был(а) ${formatLastSeen(userProfileData.last_seen)}`
                    : 'не в сети'}
              </Text>
            </View>

            {/* Quick actions row */}
            <View style={[styles.upActionsCard, { backgroundColor: colors.backgroundSecondary }]}>
              <TouchableOpacity style={styles.upActBtn} onPress={() => { setShowUserProfile(false); initiateCall('voice'); }} activeOpacity={0.7}>
                <View style={[styles.upActIcon, { backgroundColor: `${colors.primary}14` }]}>
                  <PhoneIcon color={colors.primary} size={20} />
                </View>
                <Text style={[styles.upActLabel, { color: colors.textSecondary }]}>Звонок</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.upActBtn} onPress={() => { setShowUserProfile(false); initiateCall('video'); }} activeOpacity={0.7}>
                <View style={[styles.upActIcon, { backgroundColor: `${colors.primary}14` }]}>
                  <Video color={colors.primary} size={20} />
                </View>
                <Text style={[styles.upActLabel, { color: colors.textSecondary }]}>Видео</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.upActBtn} onPress={() => { setShowUserProfile(false); setSearchMode(true); }} activeOpacity={0.7}>
                <View style={[styles.upActIcon, { backgroundColor: `${colors.primary}14` }]}>
                  <Search color={colors.primary} size={20} />
                </View>
                <Text style={[styles.upActLabel, { color: colors.textSecondary }]}>Поиск</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.upActBtn} onPress={() => { setShowUserProfile(false); handleOpenMediaGallery(); }} activeOpacity={0.7}>
                <View style={[styles.upActIcon, { backgroundColor: `${colors.primary}14` }]}>
                  <ImageIcon color={colors.primary} size={20} />
                </View>
                <Text style={[styles.upActLabel, { color: colors.textSecondary }]}>Медиа</Text>
              </TouchableOpacity>
            </View>

            {/* Info section */}
            <View style={[styles.upInfoCard, { backgroundColor: colors.backgroundSecondary }]}>
              {userProfileData?.status_text ? (
                <View style={styles.upInfoRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={[styles.upInfoIcon, { backgroundColor: `${colors.primary}12` }]}>
                      <Edit3 color={colors.primary} size={15} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.upInfoLabel, { color: colors.textTertiary }]}>О себе</Text>
                      <Text style={[styles.upInfoValue, { color: colors.text }]}>{userProfileData.status_text}</Text>
                    </View>
                  </View>
                </View>
              ) : null}
              {userProfileData?.phone ? (
                <View style={[styles.upInfoRow, userProfileData?.status_text ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={[styles.upInfoIcon, { backgroundColor: `${colors.primary}12` }]}>
                      <PhoneIcon color={colors.primary} size={15} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.upInfoLabel, { color: colors.textTertiary }]}>Телефон</Text>
                      <Text style={[styles.upInfoValue, { color: colors.primary }]}>{userProfileData.phone}</Text>
                    </View>
                  </View>
                </View>
              ) : null}
              {!userProfileData?.status_text && !userProfileData?.phone ? (
                <View style={styles.upInfoRow}>
                  <Text style={[styles.upInfoValue, { color: colors.textTertiary, fontStyle: 'italic' }]}>Нет информации</Text>
                </View>
              ) : null}
            </View>

            {/* Encryption badge */}
            {e2eActive && (
              <View style={[styles.upInfoCard, { backgroundColor: colors.backgroundSecondary }]}>
                <View style={[styles.upInfoRow, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <View style={[styles.upInfoIcon, { backgroundColor: '#E8F5E9' }]}>
                    <ShieldCheck color="#4CAF50" size={15} />
                  </View>
                  <Text style={[styles.upInfoValue, { color: colors.text }]}>Сквозное шифрование</Text>
                </View>
              </View>
            )}

            {/* Stories */}
            {(userProfileData?.stories?.length ?? 0) > 0 && (
              <View style={[styles.upStoriesCard, { backgroundColor: colors.backgroundSecondary }]}>
                <View style={styles.upCardHeader}>
                  <Text style={[styles.upCardTitle, { color: colors.text }]}>Истории</Text>
                  <View style={[styles.upBadge, { backgroundColor: `${colors.primary}14` }]}>
                    <Text style={[styles.upBadgeText, { color: colors.primary }]}>{userProfileData!.stories.length}</Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.upStoriesScroll}>
                  {userProfileData!.stories.map((story, si) => (
                    <TouchableOpacity key={story.id} activeOpacity={0.8} onPress={() => setProfileStoryView(si)} style={styles.upStoryItem}>
                      <View style={[styles.upStoryRing, { borderColor: colors.primary }]}>
                        {story.media_url ? (
                          <CachedImage uri={story.media_url} style={styles.upStoryImg} />
                        ) : (
                          <View style={[styles.upStoryImg, { backgroundColor: story.background_color || '#1E88E5', justifyContent: 'center', alignItems: 'center' }]}>
                            <Text style={{ color: story.text_color || '#FFF', fontSize: 9, textAlign: 'center', paddingHorizontal: 2 }} numberOfLines={3}>{story.content}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.upStoryTime, { color: colors.textTertiary }]}>
                        {(() => {
                          const mins = Math.floor((Date.now() - new Date(story.created_at).getTime()) / 60000);
                          if (mins < 60) return `${mins} мин`;
                          return `${Math.floor(mins / 60)} ч`;
                        })()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Shared media grid */}
            {(userProfileData?.sharedPhotos?.length ?? 0) > 0 && (
              <View style={[styles.upMediaCard, { backgroundColor: colors.backgroundSecondary }]}>
                <View style={styles.upCardHeader}>
                  <Text style={[styles.upCardTitle, { color: colors.text }]}>Фото и видео</Text>
                  <View style={[styles.upBadge, { backgroundColor: `${colors.primary}14` }]}>
                    <Text style={[styles.upBadgeText, { color: colors.primary }]}>{userProfileData!.sharedPhotos.length}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity onPress={() => { setShowUserProfile(false); handleOpenMediaGallery(); }} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.primary }}>Все</Text>
                    <ChevronRight color={colors.primary} size={14} />
                  </TouchableOpacity>
                </View>
                <View style={styles.upMediaGrid}>
                  {userProfileData!.sharedPhotos.slice(0, 6).map((m, mi) => (
                    <TouchableOpacity key={m.id} activeOpacity={0.85} onPress={() => setProfileMediaIndex(mi)} style={styles.upMediaCell}>
                      <CachedImage uri={m.media_url} style={StyleSheet.absoluteFillObject} />
                      {m.message_type === 'video' && (
                        <View style={styles.upMediaPlayBadge}>
                          <Play color="#FFFFFF" size={10} fill="#FFFFFF" />
                        </View>
                      )}
                      {m.message_type === 'video' && m.media_duration ? (
                        <View style={styles.upMediaDuration}>
                          <Text style={styles.upMediaDurText}>
                            {Math.floor(m.media_duration / 60)}:{(Math.round(m.media_duration) % 60).toString().padStart(2, '0')}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Block / Unblock & Report */}
            <View style={[styles.upInfoCard, { backgroundColor: colors.backgroundSecondary, marginBottom: Math.max(insets.bottom, 20) + 20 }]}>
              <TouchableOpacity style={[styles.upInfoRow, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={isBlocked ? handleUnblockUser : handleBlockUser} activeOpacity={0.6}>
                <View style={[styles.upInfoIcon, { backgroundColor: isBlocked ? `${colors.primary}14` : `${colors.error}12` }]}>
                  {isBlocked ? <UserX color={colors.primary} size={15} /> : <Ban color={colors.error} size={15} />}
                </View>
                <Text style={[styles.upInfoValue, { color: isBlocked ? colors.primary : colors.error }]}>
                  {isBlocked ? 'Разблокировать' : 'Заблокировать'}
                </Text>
              </TouchableOpacity>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 16 }} />
              <TouchableOpacity style={[styles.upInfoRow, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => { setShowUserProfile(false); setShowReportModal(true); }} activeOpacity={0.6}>
                <View style={[styles.upInfoIcon, { backgroundColor: `${colors.error}12` }]}>
                  <AlertCircle color={colors.error} size={15} />
                </View>
                <Text style={[styles.upInfoValue, { color: colors.error }]}>Пожаловаться</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </RNAnimated.View>
      </View>}

      <Modal visible={showPinnedPanel} transparent animationType="slide" onRequestClose={() => setShowPinnedPanel(false)}>
        <View style={[styles.groupInfoModal, { backgroundColor: colors.background }]}>
          <View style={[styles.groupInfoHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowPinnedPanel(false)}>
              <ArrowLeft color={colors.text} size={22} />
            </TouchableOpacity>
            <Text style={[styles.groupInfoTitle, { color: colors.text }]}>Закреплённые сообщения</Text>
            <View style={{ width: 22 }} />
          </View>
          <FlatList
            data={allPinnedMessages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.pinnedPanelItem, { backgroundColor: colors.backgroundSecondary }]}
                activeOpacity={0.7}
                onPress={() => {
                  setShowPinnedPanel(false);
                  const idx = messageIndexMap.get(item.id) ?? -1;
                  if (idx >= 0) setTimeout(() => flatListRef.current?.scrollToIndex({ index: idx, animated: true }), 300);
                }}
              >
                <View style={styles.pinnedPanelItemHeader}>
                  <Text style={[styles.pinnedPanelSender, { color: colors.primary }]}>{item.sender?.display_name || 'Пользователь'}</Text>
                  <Text style={[styles.pinnedPanelTime, { color: colors.textTertiary }]}>{formatTime(item.created_at)}</Text>
                </View>
                <Text style={[styles.pinnedPanelContent, { color: colors.text }]} numberOfLines={3}>
                  {item.message_type === 'voice' ? 'Голосовое сообщение' : item.message_type === 'image' ? 'Фото' : item.content}
                </Text>
                <TouchableOpacity
                  style={styles.pinnedPanelUnpin}
                  onPress={() => { pinMessage(item); }}
                >
                  <Text style={{ color: colors.error, fontSize: 13 }}>Открепить</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 40 }}>Нет закреплённых сообщений</Text>
            }
          />
        </View>
      </Modal>

      {showWallpaperPicker && <Modal visible={showWallpaperPicker} transparent animationType="slide" onRequestClose={() => setShowWallpaperPicker(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <WallpaperPicker
            conversationId={chatId}
            currentConfig={perChatWallpaper}
            onSelect={(cfg) => {
              setPerChatWallpaper(cfg);
              setChatWallpaper(chatId, user!.id, cfg);
              setShowWallpaperPicker(false);
            }}
            onClose={() => setShowWallpaperPicker(false)}
          />
        </View>
      </Modal>}

      {showMediaGallery && <Modal visible={showMediaGallery} transparent animationType="slide" onRequestClose={() => setShowMediaGallery(false)}>
        <SwipeToClose onClose={() => setShowMediaGallery(false)} style={[styles.groupInfoModal, { backgroundColor: colors.background }]}>
          <View style={[styles.groupInfoHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowMediaGallery(false)}>
              <ArrowLeft color={colors.text} size={22} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.groupInfoTitle, { color: colors.text }]}>Медиа и файлы</Text>
            </View>
          </View>

          <View style={[styles.mediaTabBar, { borderBottomColor: colors.border }]}>
            {([
              { key: 'media' as const, label: 'Медиа', icon: ImageIcon },
              { key: 'files' as const, label: 'Файлы', icon: FileIcon },
              { key: 'voice' as const, label: 'Голос', icon: Mic },
              { key: 'links' as const, label: 'Ссылки', icon: ExternalLink },
            ]).map(tab => {
              const isActive = mediaTab === tab.key;
              const TabIcon = tab.icon;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.mediaTabItem, isActive && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
                  onPress={() => setMediaTab(tab.key)}
                >
                  <TabIcon color={isActive ? colors.primary : colors.textTertiary} size={16} />
                  <Text style={[styles.mediaTabLabel, { color: isActive ? colors.primary : colors.textTertiary }]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {mediaTab === 'media' && (() => {
            const mediaItems = sharedMedia.filter(m => m.message_type === 'image' || m.message_type === 'video' || m.message_type === 'video_note');
            return mediaItems.length === 0 ? (
              <View style={styles.mediaEmptyState}>
                <ImageIcon color={colors.textTertiary} size={44} />
                <Text style={[styles.mediaEmptyText, { color: colors.textSecondary }]}>Нет фото и видео</Text>
              </View>
            ) : (
              <FlatList
                data={mediaItems}
                keyExtractor={(item) => item.id}
                numColumns={3}
                contentContainerStyle={{ padding: 2 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.mediaGridItem}
                    onPress={() => {
                      setShowMediaGallery(false);
                      openGalleryViewer(item.id);
                    }}
                    activeOpacity={0.8}
                  >
                    <CachedImage uri={item.media_url!} style={styles.mediaGridImage} />
                    {(item.message_type === 'video' || item.message_type === 'video_note') && (
                      <View style={styles.mediaVideoOverlay}>
                        <Play color="#FFFFFF" size={20} fill="#FFFFFF" />
                      </View>
                    )}
                    {item.message_type === 'video_note' && (
                      <View style={{ position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(224,64,251,0.8)', borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 }}>
                        <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '700' }}>O</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              />
            );
          })()}

          {mediaTab === 'files' && (() => {
            const fileItems = sharedMedia.filter(m => m.message_type === 'file');
            return fileItems.length === 0 ? (
              <View style={styles.mediaEmptyState}>
                <FileIcon color={colors.textTertiary} size={44} />
                <Text style={[styles.mediaEmptyText, { color: colors.textSecondary }]}>Нет файлов</Text>
              </View>
            ) : (
              <FlatList
                data={fileItems}
                keyExtractor={item => item.id}
                contentContainerStyle={{ padding: 12 }}
                renderItem={({ item }) => {
                  const fileName = item.content || item.media_url?.split('/').pop() || 'Файл';
                  return (
                    <TouchableOpacity
                      style={[styles.mediaFileItem, { backgroundColor: colors.backgroundSecondary }]}
                      onPress={() => item.media_url && Linking.openURL(item.media_url)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.mediaFileIcon, { backgroundColor: `${colors.primary}15` }]}>
                        <FileIcon color={colors.primary} size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.mediaFileName, { color: colors.text }]} numberOfLines={1}>{fileName}</Text>
                        <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                          {item.sender_name} · {formatTime(item.created_at)}
                        </Text>
                      </View>
                      <Download color={colors.textTertiary} size={18} />
                    </TouchableOpacity>
                  );
                }}
              />
            );
          })()}

          {mediaTab === 'voice' && (() => {
            const voiceItems = sharedMedia.filter(m => m.message_type === 'voice');
            return voiceItems.length === 0 ? (
              <View style={styles.mediaEmptyState}>
                <Mic color={colors.textTertiary} size={44} />
                <Text style={[styles.mediaEmptyText, { color: colors.textSecondary }]}>Нет голосовых сообщений</Text>
              </View>
            ) : (
              <FlatList
                data={voiceItems}
                keyExtractor={item => item.id}
                contentContainerStyle={{ padding: 12 }}
                renderItem={({ item }) => {
                  const dur = item.media_duration || 0;
                  const mins = Math.floor(dur / 60);
                  const secs = dur % 60;
                  return (
                    <TouchableOpacity
                      style={[styles.mediaFileItem, { backgroundColor: colors.backgroundSecondary }]}
                      onPress={() => {
                        if (item.media_url) {
                          voicePlayer.play({
                            id: item.id,
                            url: item.media_url,
                            duration: dur,
                            senderName: item.sender_name || '',
                            conversationId: id || '',
                          });
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.mediaFileIcon, { backgroundColor: `${colors.accent}15` }]}>
                        <Mic color={colors.accent} size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.mediaFileName, { color: colors.text }]}>
                          Голосовое сообщение · {mins}:{secs.toString().padStart(2, '0')}
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                          {item.sender_name} · {formatTime(item.created_at)}
                        </Text>
                      </View>
                      <Play color={colors.primary} size={18} />
                    </TouchableOpacity>
                  );
                }}
              />
            );
          })()}

          {mediaTab === 'links' && (() => {
            return sharedLinks.length === 0 ? (
              <View style={styles.mediaEmptyState}>
                <ExternalLink color={colors.textTertiary} size={44} />
                <Text style={[styles.mediaEmptyText, { color: colors.textSecondary }]}>Нет ссылок</Text>
              </View>
            ) : (
              <FlatList
                data={sharedLinks}
                keyExtractor={item => item.id}
                contentContainerStyle={{ padding: 12 }}
                renderItem={({ item }) => {
                  const urlMatch = item.content.match(/https?:\/\/[^\s<]+[^<.,:;"')\]\s]/);
                  const url = urlMatch ? urlMatch[0] : '';
                  let domain = '';
                  try { domain = new URL(url).hostname.replace('www.', ''); } catch {}
                  return (
                    <TouchableOpacity
                      style={[styles.mediaFileItem, { backgroundColor: colors.backgroundSecondary }]}
                      onPress={() => url && Linking.openURL(url)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.mediaFileIcon, { backgroundColor: `${colors.secondary}15` }]}>
                        <ExternalLink color={colors.secondary} size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.mediaFileName, { color: colors.primary }]} numberOfLines={1}>{domain || url}</Text>
                        <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={2}>{item.content}</Text>
                        <Text style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
                          {item.sender_name} · {formatTime(item.created_at)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            );
          })()}
        </SwipeToClose>
      </Modal>}

      {showGroupInfo && <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} onPress={() => setShowGroupInfo(false)} />
        <RNAnimated.View style={[styles.upSlidePanel, { backgroundColor: colors.background, transform: [{ translateX: groupInfoSlideAnim }] }]}
          {...groupInfoPanResponder.panHandlers}
        >
          <ScrollView style={{ flex: 1 }} bounces={false} showsVerticalScrollIndicator={false}>
          {/* Header with avatar */}
          <View style={{ alignItems: 'center', paddingTop: 56, paddingBottom: 24, paddingHorizontal: 20 }}>
            <TouchableOpacity
              onPress={() => setShowGroupInfo(false)}
              style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.backgroundSecondary, justifyContent: 'center', alignItems: 'center' }}
              activeOpacity={0.7}
            >
              <ArrowLeft color={colors.text} size={20} />
            </TouchableOpacity>
            {isChannel && isChannelAdmin && (
              <TouchableOpacity
                onPress={() => {
                  setEditChannelName(chatInfo.name || '');
                  setEditChannelDesc(chatInfo.description || '');
                  setEditChannelUsername(chatInfo.username || '');
                  setEditChannelReactions(channelAllowedReactions || QUICK_REACTIONS);
                  setEditChannelModal(true);
                }}
                style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.backgroundSecondary, justifyContent: 'center', alignItems: 'center' }}
                activeOpacity={0.7}
              >
                <Edit3 color={colors.text} size={18} />
              </TouchableOpacity>
            )}
            <View style={styles.groupAvatarWrapper}>
              {chatInfo.avatar_url ? (
                <TouchableOpacity activeOpacity={0.85} onPress={() => {
                  setGalleryViewerOpen(true);
                  setGalleryInitialIndex(0);
                  avatarGalleryRef.current = [{ id: 'channel-avatar', url: chatInfo.avatar_url!, type: 'image' as const, senderName: chatInfo.name || undefined }];
                }}>
                  <CachedImage uri={chatInfo.avatar_url} style={{ width: 100, height: 100, borderRadius: 50 }} />
                </TouchableOpacity>
              ) : (
                <View style={[{ width: 100, height: 100, borderRadius: 50 }, styles.groupAvatarPlaceholder, { backgroundColor: colors.primary }]}>
                  <Text style={styles.groupAvatarLetter}>
                    {(chatInfo.name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              {(isChannelAdmin || groupMembers.find(m => m.user_id === user?.id)?.role === 'admin') && (
                <TouchableOpacity
                  style={[styles.groupCameraButton, { backgroundColor: colors.primary, borderColor: colors.background }]}
                  onPress={handleGroupAvatarUpload}
                >
                  <Camera color="#FFFFFF" size={14} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 14, textAlign: 'center' }}>
              {chatInfo.name || (isChannel ? 'Канал' : 'Группа')}
            </Text>
            {isChannel && chatInfo.username && (
              <TouchableOpacity onPress={handleShareChannel} activeOpacity={0.7}>
                <Text style={{ fontSize: 15, color: colors.primary, fontWeight: '500', marginTop: 4 }}>vaychat.net/@{chatInfo.username}</Text>
              </TouchableOpacity>
            )}
            <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 4 }}>
              {isChannel
                ? `${groupMembers.length} ${groupMembers.length === 1 ? 'подписчик' : 'подписчиков'}`
                : `${groupMembers.length} участник${groupMembers.length === 1 ? '' : 'ов'}`}
            </Text>
            {isChannel && chatInfo.description && (
              <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 21, paddingHorizontal: 8 }}>{chatInfo.description}</Text>
            )}
          </View>

          {/* Quick actions row */}
          {isChannel && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, paddingHorizontal: 20, marginBottom: 20 }}>
              <TouchableOpacity
                style={{ alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 28, backgroundColor: colors.backgroundSecondary }}
                onPress={handleToggleChannelMute}
                activeOpacity={0.7}
              >
                {channelMuted ? <BellOff color={colors.textSecondary} size={22} /> : <Bell color={colors.primary} size={22} />}
              </TouchableOpacity>
              <TouchableOpacity
                style={{ alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 28, backgroundColor: colors.backgroundSecondary }}
                onPress={handleShareChannel}
                activeOpacity={0.7}
              >
                <Share2 color={linkCopied ? colors.online : colors.primary} size={22} />
              </TouchableOpacity>

              <TouchableOpacity
                style={{ alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 28, backgroundColor: colors.backgroundSecondary }}
                onPress={() => router.push({ pathname: '/search', params: { conversationId: id, conversationName: chatInfo.name || 'Канал' } })}
                activeOpacity={0.7}
              >
                <Search color={colors.primary} size={22} />
              </TouchableOpacity>
            </View>
          )}
          {isChannel && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, paddingHorizontal: 20, marginBottom: 20 }}>
              <Text style={{ fontSize: 12, color: colors.textTertiary, width: 56, textAlign: 'center' }}>{channelMuted ? 'Откл.' : 'Звук'}</Text>
              <Text style={{ fontSize: 12, color: linkCopied ? colors.online : colors.textTertiary, width: 56, textAlign: 'center' }}>{linkCopied ? 'Скопировано' : 'Поделиться'}</Text>

              <Text style={{ fontSize: 12, color: colors.textTertiary, width: 56, textAlign: 'center' }}>Поиск</Text>
            </View>
          )}

          {/* Divider */}
          <View style={{ height: 8, backgroundColor: colors.backgroundSecondary }} />

          {/* Actions card */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.backgroundSecondary, marginBottom: 8 }}
              onPress={() => { setShowGroupInfo(false); handleOpenMediaGallery(); }}
              activeOpacity={0.7}
            >
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
                <ImageIcon color={colors.primary} size={20} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '500', color: colors.text, flex: 1 }}>Медиа файлы</Text>
              <ChevronRight color={colors.textTertiary} size={18} />
            </TouchableOpacity>
            {!isChannel && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.backgroundSecondary, marginBottom: 8 }}
                onPress={() => router.push({ pathname: '/search', params: { conversationId: id, conversationName: chatInfo.name || 'Группа' } })}
                activeOpacity={0.7}
              >
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
                  <Search color={colors.primary} size={20} />
                </View>
                <Text style={{ fontSize: 16, fontWeight: '500', color: colors.text, flex: 1 }}>Поиск в чате</Text>
                <ChevronRight color={colors.textTertiary} size={18} />
              </TouchableOpacity>
            )}

          </View>

          {/* Divider */}
          <View style={{ height: 8, backgroundColor: colors.backgroundSecondary }} />

          {/* Subscriber/member section */}
          {isChannel ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, marginBottom: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Подписчики ({groupMembers.length})
                </Text>
                {isChannelAdmin && (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.primary + '12' }}
                    onPress={handleOpenAddMembers}
                    activeOpacity={0.7}
                  >
                    <UserPlus color={colors.primary} size={15} />
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>Добавить</Text>
                  </TouchableOpacity>
                )}
              </View>
              {(() => {
                const myContacts = dataCache.getContacts();
                const contactIds = new Set(myContacts.map(c => c.contact_id));
                const displayMembers = isChannelAdmin
                  ? groupMembers
                  : groupMembers.filter(m => m.user_id === user?.id || contactIds.has(m.user_id));
                const otherCount = isChannelAdmin ? 0 : groupMembers.length - displayMembers.length;
                return (
                  <>
                    {!isChannelAdmin && displayMembers.length > 0 && (
                      <Text style={{ fontSize: 13, color: colors.textTertiary, paddingHorizontal: 20, marginBottom: 10 }}>
                        Ваши контакты среди подписчиков
                      </Text>
                    )}
                    {displayMembers.length > 0 ? (
                      <View style={{ paddingHorizontal: 16 }}>
                        {displayMembers.map((member, idx) => {
                          const isMe = member.user_id === user?.id;
                          const isAdmin = member.role === 'admin' || member.role === 'owner';
                          return (
                            <View key={member.user_id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: idx < displayMembers.length - 1 ? 0.5 : 0, borderBottomColor: colors.border }}>
                              <View style={{ marginRight: 14 }}>
                                <Avatar
                                  uri={member.avatar_url}
                                  name={member.display_name || '?'}
                                  size="sm"
                                  showOnline
                                  isOnline={isUserOnline(member.is_online, member.last_seen)}
                                />
                              </View>
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
                                    {member.display_name}{isMe ? ' (Вы)' : ''}
                                  </Text>
                                  {isAdmin && <Crown color={colors.warning} size={13} />}
                                  {isAdmin && <Text style={{ fontSize: 11, color: colors.warning, fontWeight: '600' }}>Админ</Text>}
                                </View>
                                <Text style={{ fontSize: 13, color: isUserOnline(member.is_online, member.last_seen) ? colors.online : colors.textSecondary, marginTop: 2 }}>
                                  {isUserOnline(member.is_online, member.last_seen) ? 'В сети' : member.last_seen ? `был(а) ${formatLastSeen(member.last_seen)}` : 'Не в сети'}
                                </Text>
                              </View>
                              {isChannelAdmin && !isMe && (
                                <View style={{ flexDirection: 'row', gap: 8 }}>
                                  <TouchableOpacity
                                    style={[styles.memberActionBtn, { backgroundColor: `${colors.primary}12` }]}
                                    onPress={() => handleToggleAdmin(member.user_id, member.role)}
                                  >
                                    <Crown color={isAdmin ? colors.warning : colors.textTertiary} size={14} />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.removeMemberBtn, { backgroundColor: `${colors.error}12` }]}
                                    onPress={() => handleRemoveMember(member.user_id)}
                                  >
                                    <UserMinus color={colors.error} size={15} />
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      <View style={{ paddingHorizontal: 20, paddingVertical: 24, alignItems: 'center' }}>
                        <Users color={colors.textTertiary} size={32} />
                        <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 8 }}>
                          {isChannelAdmin ? 'Пока нет подписчиков' : 'Среди ваших контактов нет подписчиков этого канала'}
                        </Text>
                      </View>
                    )}
                    {otherCount > 0 && (
                      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
                        <Text style={{ fontSize: 13, color: colors.textTertiary }}>
                          и ещё {otherCount} {otherCount === 1 ? 'подписчик' : otherCount < 5 ? 'подписчика' : 'подписчиков'}
                        </Text>
                      </View>
                    )}
                  </>
                );
              })()}

              {/* Divider */}
              <View style={{ height: 8, backgroundColor: colors.backgroundSecondary, marginTop: 16 }} />

              {/* Leave/Delete section */}
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 40 }}>
                {!isChannelAdmin ? (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14 }}
                    onPress={handleUnsubscribeChannel}
                    activeOpacity={0.7}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.error}12`, justifyContent: 'center', alignItems: 'center' }}>
                      <LogOut color={colors.error} size={20} />
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '500', color: colors.error }}>Отписаться от канала</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14 }}
                    onPress={async () => {
                      if (typeof window !== 'undefined' && !window.confirm('Вы уверены, что хотите удалить этот канал? Все сообщения и подписчики будут потеряны.')) return;
                      await supabase.from('channel_subscribers').delete().eq('channel_id', id);
                      await supabase.from('messages').delete().eq('conversation_id', id);
                      await supabase.from('conversation_members').delete().eq('conversation_id', id);
                      await supabase.from('conversations').delete().eq('id', id);
                      router.replace('/');
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.error}12`, justifyContent: 'center', alignItems: 'center' }}>
                      <Trash2 color={colors.error} size={20} />
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '500', color: colors.error }}>Удалить канал</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 }}>
                <Text style={[styles.groupSectionLabel, { color: colors.textSecondary, marginBottom: 0, marginTop: 0, paddingHorizontal: 0 }]}>
                  Участники ({groupMembers.length})
                </Text>
                {(groupMembers.find(m => m.user_id === user?.id)?.role === 'admin' || groupMembers.find(m => m.user_id === user?.id)?.role === 'owner') && (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    onPress={handleOpenAddMembers}
                  >
                    <UserPlus color={colors.primary} size={16} />
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>Добавить</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={{ paddingHorizontal: 20, paddingBottom: 32 }}>
                {groupMembers.map((member) => {
                  const isMe = member.user_id === user?.id;
                  const isAdmin = member.role === 'admin' || member.role === 'owner';
                  const myRole = groupMembers.find(m => m.user_id === user?.id)?.role;
                  return (
                    <View key={member.user_id} style={[styles.groupMemberItem, { backgroundColor: colors.backgroundSecondary }]}>
                      <View style={{ marginRight: 12 }}>
                        <Avatar
                          uri={member.avatar_url}
                          name={member.display_name || '?'}
                          size="sm"
                          showOnline
                          isOnline={isUserOnline(member.is_online, member.last_seen)}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.groupMemberName, { color: colors.text }]}>
                            {member.display_name}{isMe ? ' (Вы)' : ''}
                          </Text>
                          {isAdmin && <Crown color={colors.warning} size={14} />}
                          {isAdmin && <Text style={{ fontSize: 11, color: colors.warning, fontWeight: '600' }}>Админ</Text>}
                        </View>
                        <Text style={{ fontSize: 13, color: isUserOnline(member.is_online, member.last_seen) ? colors.online : colors.textSecondary }}>
                          {isUserOnline(member.is_online, member.last_seen) ? 'В сети' : member.last_seen ? `был(а) ${formatLastSeen(member.last_seen)}` : 'Не в сети'}
                        </Text>
                      </View>
                      {(myRole === 'admin' || myRole === 'owner') && !isMe && (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={[styles.memberActionBtn, { backgroundColor: `${colors.primary}15` }]}
                            onPress={() => handleToggleAdmin(member.user_id, member.role)}
                          >
                            <Crown color={isAdmin ? colors.warning : colors.textTertiary} size={14} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.removeMemberBtn, { backgroundColor: `${colors.error}15` }]}
                            onPress={() => handleRemoveMember(member.user_id)}
                          >
                            <UserMinus color={colors.error} size={16} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
                <TouchableOpacity
                  style={[styles.leaveGroupBtn, { backgroundColor: `${colors.error}10` }]}
                  onPress={handleLeaveGroup}
                >
                  <Text style={[styles.leaveGroupText, { color: colors.error }]}>Покинуть группу</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          </ScrollView>
        </RNAnimated.View>
      </View>}

      {showAddMembers && <Modal visible={showAddMembers} transparent animationType="slide" onRequestClose={() => setShowAddMembers(false)}>
        <SwipeToClose onClose={() => setShowAddMembers(false)} style={[styles.groupInfoModal, { backgroundColor: colors.background }]}>
          <View style={[styles.groupInfoHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowAddMembers(false)}>
              <ArrowLeft color={colors.text} size={22} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.groupInfoTitle, { color: colors.text }]}>Добавить участников</Text>
              <Text style={[styles.groupInfoSubtitle, { color: colors.textSecondary }]}>
                {addMemberContacts.length} доступно
              </Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.backgroundSecondary, borderRadius: 10, paddingHorizontal: 12, height: 38, gap: 8 }}>
              <Search color={colors.textTertiary} size={17} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 }}
                value={addMemberSearch}
                onChangeText={setAddMemberSearch}
                placeholder="Поиск контактов..."
                placeholderTextColor={colors.textTertiary}
              />
              {addMemberSearch.length > 0 && (
                <TouchableOpacity onPress={() => setAddMemberSearch('')} hitSlop={8}>
                  <X color={colors.textSecondary} size={16} />
                </TouchableOpacity>
              )}
            </View>
          </View>
          <FlatList
            data={addMemberContacts.filter(c =>
              !addMemberSearch || c.display_name.toLowerCase().includes(addMemberSearch.toLowerCase())
            )}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}
            renderItem={({ item }) => {
              const letter = item.display_name.charAt(0).toUpperCase();
              const isAdding = addingMemberIds.has(item.id);
              return (
                <TouchableOpacity
                  style={[styles.groupMemberItem, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => handleAddMember(item.id)}
                  disabled={isAdding}
                  activeOpacity={0.7}
                >
                  <View style={{ marginRight: 12 }}>
                    <Avatar
                      uri={item.avatar_url}
                      name={item.display_name || '?'}
                      size="sm"
                      showOnline
                      isOnline={isUserOnline(item.is_online, undefined)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.groupMemberName, { color: colors.text }]}>{item.display_name}</Text>
                    <Text style={{ fontSize: 13, color: isUserOnline(item.is_online, undefined) ? colors.online : colors.textSecondary }}>
                      {isUserOnline(item.is_online, undefined) ? 'В сети' : 'Не в сети'}
                    </Text>
                  </View>
                  {isAdding ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <View style={[styles.memberActionBtn, { backgroundColor: `${colors.primary}15` }]}>
                      <UserPlus color={colors.primary} size={16} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <Text style={{ color: colors.textTertiary, fontSize: 15 }}>
                  {addMemberSearch ? 'Контакты не найдены' : 'Все контакты уже в группе'}
                </Text>
              </View>
            }
          />
        </SwipeToClose>
      </Modal>}

      {/* Read receipts modal */}
      <Modal visible={readReceiptsModal} transparent animationType="slide" onRequestClose={() => setReadReceiptsModal(false)}>
        <Pressable style={styles.chatMenuBackdrop} onPress={() => setReadReceiptsModal(false)}>
          <Pressable style={[styles.readReceiptsPanel, { backgroundColor: colors.backgroundSecondary }]} onPress={e => e.stopPropagation()}>
            <View style={styles.readReceiptsHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <CheckCheck color={colors.primary} size={20} />
                <Text style={[styles.readReceiptsTitle, { color: colors.text }]}>Прочитано</Text>
              </View>
              <TouchableOpacity onPress={() => setReadReceiptsModal(false)}>
                <X color={colors.textSecondary} size={20} />
              </TouchableOpacity>
            </View>
            {readReceipts.length === 0 ? (
              <Text style={[styles.readReceiptsEmpty, { color: colors.textTertiary }]}>
                Никто ещё не прочитал
              </Text>
            ) : (
              readReceipts.map((r, i) => (
                <View key={i} style={[styles.readReceiptRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.readReceiptName, { color: colors.text }]}>{r.name}</Text>
                  <Text style={[styles.readReceiptTime, { color: colors.textTertiary }]}>{r.time}</Text>
                </View>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showSafetyNumber} transparent animationType="fade" onRequestClose={() => setShowSafetyNumber(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSafetyNumber(false)}>
          <Pressable style={[styles.safetyNumberModal, { backgroundColor: colors.surface }]} onPress={e => e.stopPropagation()}>
            <ShieldCheck color="#4CAF50" size={32} />
            <Text style={[styles.safetyNumberTitle, { color: colors.text }]}>Код безопасности</Text>
            {(peerPublicKey && myPublicKey) ? (
              <>
                <Text style={[styles.safetyNumberDesc, { color: colors.textSecondary }]}>
                  Сравните этот код с собеседником для подтверждения шифрования
                </Text>
                <Text style={[styles.safetyNumberCode, { color: colors.text }]}>
                  {computeSafetyNumber(myPublicKey, peerPublicKey)}
                </Text>
              </>
            ) : (
              <Text style={[styles.safetyNumberDesc, { color: colors.warning, marginTop: 12 }]}>
                {!myPublicKey ? 'Ваш ключ ещё не сгенерирован. Перезайдите в аккаунт.' : 'Собеседник ещё не настроил сквозное шифрование.'}
              </Text>
            )}
            <TouchableOpacity style={[styles.safetyNumberBtn, { backgroundColor: colors.primary }]} onPress={() => setShowSafetyNumber(false)}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>Закрыть</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDesktop } = useDesktopLayout();
  if (isDesktop) return <View style={{ flex: 1 }} />;
  return <ChatViewContent chatId={id} onBack={() => router.back()} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 0,
    minHeight: 52,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 6,
  },
  searchInput: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 36,
  },
  searchCount: {
    fontSize: 11,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'center',
    fontVariant: ['tabular-nums'] as any,
  },
  searchNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typingBubbleContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  typingBubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    minWidth: 64,
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
      default: { elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
    }) as any,
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 4,
  },
  headerAvatarContainer: { position: 'relative' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20 },
  headerAvatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  headerAvatarText: { fontSize: 15, fontWeight: '600' },
  headerOnline: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
  },
  headerName: { fontSize: 15, fontWeight: '600', letterSpacing: 0.15 },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1DA1F2',
    justifyContent: 'center',
    alignItems: 'center',
  } as any,
  verifiedCheckmark: {
    width: 6,
    height: 3.5,
    borderLeftWidth: 1.8,
    borderBottomWidth: 1.8,
    borderColor: '#fff',
    transform: [{ rotate: '-45deg' }],
    marginTop: -1,
  } as any,
  headerStatus: { fontSize: 13, marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callPickerBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  callPickerSheet: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    width: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  callPickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 14,
  },
  callPickerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callPickerLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  pinnedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  pinnedContent: { flex: 1 },
  pinnedLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.1 },
  pinnedText: { fontSize: 13, marginTop: 3 },
  messagesList: {
    paddingHorizontal: 8,
    paddingTop: 64,
    paddingBottom: 72,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  dateSeparatorContainer: { alignItems: 'center', marginVertical: 14 },
  unreadSeparatorContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 12, paddingHorizontal: 16, gap: 8 },
  unreadLine: { flex: 1, height: 1 },
  unreadBadge: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14 },
  unreadBadgeText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.4 },
  pinnedPanelItem: { borderRadius: 12, padding: 14, marginBottom: 10 },
  pinnedPanelItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  pinnedPanelSender: { fontSize: 14, fontWeight: '600' },
  pinnedPanelTime: { fontSize: 12 },
  pinnedPanelContent: { fontSize: 15, lineHeight: 20, marginBottom: 8 },
  pinnedPanelUnpin: { alignSelf: 'flex-end' },
  dateBadge: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 16,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
      default: { elevation: 1, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
    }) as any,
  },
  dateSeparator: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  messageBubbleContainer: { maxWidth: '85%', overflow: 'hidden' },
  myMessageContainer: { alignSelf: 'flex-end' },
  otherMessageContainer: { alignSelf: 'flex-start' },
  messageBubble: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  myMessage: {},
  myMessageTail: { borderBottomRightRadius: 4 },
  otherMessage: {},
  otherMessageTail: { borderBottomLeftRadius: 4 },
  forwardedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 6,
    paddingVertical: 2,
  },
  forwardedText: { fontSize: 11, fontStyle: 'italic', letterSpacing: 0.1 },
  storyQuoteCard: {
    borderLeftWidth: 2,
    borderRadius: 6,
    marginBottom: 6,
    overflow: 'hidden',
    minWidth: 200,
  },
  storyQuoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 6,
  },
  storyQuoteThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
    overflow: 'hidden',
  },
  storyQuoteThumbImg: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  storyQuoteInfo: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  storyQuoteLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginBottom: 2,
  },
  storyQuoteText: {
    fontSize: 12,
  },
  storyQuoteColorBlock: {
    borderRadius: 4,
    overflow: 'hidden',
  },

  replyPreview: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 6,
  },
  replyName: { fontSize: 12, fontWeight: '700', letterSpacing: 0.15 },
  replyContent: { fontSize: 12, marginTop: 3, lineHeight: 17, opacity: 0.85 },
  messageText: { lineHeight: 21, fontSize: 15, letterSpacing: 0.1 },
  editedLabel: { fontSize: 10, marginRight: 4, fontStyle: 'italic', opacity: 0.7 },
  messageTime: { fontSize: 10.5, fontVariant: ['tabular-nums'] as any, letterSpacing: 0.3 },
  viewCountContainer: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2 },
  viewCountText: { fontSize: 10.5, fontVariant: ['tabular-nums'] as any, letterSpacing: 0.3 },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    justifyContent: 'flex-end',
    gap: 4,
  },
  mediaTimeOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    ...Platform.select({
      web: { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', backgroundColor: 'rgba(0,0,0,0.4)' },
      default: {},
    }) as any,
  },
  mediaTimeOverlayText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 10.5,
    fontVariant: ['tabular-nums'] as any,
    letterSpacing: 0.2,
  },
  mediaPlaceholder: {
    width: '100%',
    maxWidth: MAX_MEDIA_W,
    aspectRatio: 4 / 3,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 200,
    paddingVertical: 4,
    marginVertical: 0,
  },
  voicePlayButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  voiceRight: {
    flex: 1,
    gap: 5,
  },
  voiceInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceDuration: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] as any, letterSpacing: 0.2 },
  voiceSpeedBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  voiceSpeedText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  replyBannerLine: { width: 3, height: 36, borderRadius: 1.5 },
  replyBannerContent: { flex: 1 },
  replyBannerLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.1 },
  replyBannerText: { fontSize: 13, marginTop: 3 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
    minHeight: 52,
  },
  attachButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginBottom: 0,
  },
  inputFieldWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 20,
    paddingRight: 4,
    minHeight: 40,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.12)',
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'web' ? 9 : 10,
    paddingBottom: Platform.OS === 'web' ? 9 : 10,
    fontSize: 15,
    maxHeight: 120,
    lineHeight: 20,
    textAlignVertical: 'center',
  },
  inputEmojiButton: {
    width: 36,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  fileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    marginBottom: 4,
    minWidth: 220,
  },
  fileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  fileSub: {
    fontSize: 11,
    marginTop: 3,
    opacity: 0.75,
  },
  locationContainer: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 4,
    width: 250,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
      default: { elevation: 1 },
    }) as any,
  },
  locationMapPreview: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  liveBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  liveBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  locationDetails: {
    padding: 12,
  },
  locationLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  locationCoords: {
    fontSize: 11,
    marginTop: 3,
    opacity: 0.7,
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 0.5,
    gap: 12,
  },
  recordingText: { flex: 1, fontSize: 16, fontWeight: '500' },
  sendRecordingButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelRecordingButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  cancelText: { fontSize: 14, fontWeight: '500' },
  actionModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionModalContent: {
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 4,
    width: 270,
    ...Platform.select({
      web: { boxShadow: '0 8px 32px rgba(0,0,0,0.2)' },
      default: { elevation: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
    }) as any,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  actionText: { fontSize: 15, fontWeight: '500', letterSpacing: 0.1 },
  forwardModal: {
    flex: 1,
    paddingTop: 60,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  forwardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  forwardTitle: { fontSize: 18, fontWeight: '700', letterSpacing: 0.1 },
  forwardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  forwardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  forwardAvatarText: { fontSize: 16, fontWeight: '600' },
  forwardName: { fontSize: 16, fontWeight: '500' },
  emptyForward: { textAlign: 'center', marginTop: 40, fontSize: 15 },
  chatMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  chatMenuContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  chatMenuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  chatMenuTitle: { fontSize: 18, fontWeight: '700', letterSpacing: 0.1 },
  chatMenuAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  chatMenuActionText: { fontSize: 16, fontWeight: '500', letterSpacing: 0.1 },
  chatMenuDivider: { height: 1, marginVertical: 8 },
  chatMenuSectionLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.5 },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  reactionsRowLeft: { justifyContent: 'flex-start' },
  reactionsRowRight: { justifyContent: 'flex-end' },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 16,
  },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { fontSize: 12, fontWeight: '700', letterSpacing: 0.1 },
  quickReactionPicker: {
    flexDirection: 'row',
    marginTop: 4,
    paddingVertical: 4,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
    overflow: 'hidden',
  },

  quickReactionItem: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickReactionEmoji: { fontSize: 18 },
  modalReactionsRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
    overflow: 'hidden',
  },
  modalReactionItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalReactionEmoji: { fontSize: 28 },
  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignSelf: 'center',
    marginBottom: 12,
  },
  loadMoreText: { fontSize: 13, fontWeight: '500' },
  conversationStartContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  conversationStartBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  conversationStartText: {
    fontSize: 12,
    fontWeight: '500',
  },
  groupInfoModal: {
    flex: 1,
    paddingTop: 56,
  },
  groupInfoHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  groupInfoTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  groupInfoSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  groupAvatarSection: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  groupAvatarWrapper: {
    position: 'relative',
    marginBottom: 12,
  },
  groupAvatarLarge: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  groupAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupAvatarLetter: {
    fontSize: 42,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  groupCameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  groupAvatarName: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  groupAvatarMembers: {
    fontSize: 14,
    marginTop: 6,
  },
  groupNameInput: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '500',
    borderWidth: 1.5,
  },
  groupNameSaveBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  groupActionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  groupSectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 10,
  },
  memberActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaveGroupBtn: {
    marginTop: 20,
    marginBottom: 40,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    marginHorizontal: 20,
  },
  leaveGroupText: {
    fontSize: 16,
    fontWeight: '600',
  },
  readReceiptsPanel: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  readReceiptsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  readReceiptsTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  readReceiptsEmpty: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  readReceiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  readReceiptName: {
    fontSize: 15,
    fontWeight: '500',
  },
  readReceiptTime: {
    fontSize: 13,
  },
  groupMemberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 8,
  },
  groupMemberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  groupMemberOnline: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  groupMemberName: {
    fontSize: 16,
    fontWeight: '600',
  },
  removeMemberBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upFullModal: {
    flex: 1,
  },
  upSlidePanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    ...Platform.select({
      web: { boxShadow: '-4px 0 24px rgba(0,0,0,0.18)' },
      default: { elevation: 16, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: -4, height: 0 } },
    }),
  },
  upHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 0,
  },
  upHeaderBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upProfileCard: {
    alignItems: 'center',
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  upAvatarWrap: {
    position: 'relative',
    marginBottom: 16,
  },
  upAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  upAvatarLetter: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  upAvatarOnlineBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    borderWidth: 3,
  },
  upName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  upOnlineText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  upActionsCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  upActBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  upActIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upActLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  upInfoCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 16,
    overflow: 'hidden',
  },
  upInfoRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  upInfoIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upInfoLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  upInfoValue: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 21,
  },
  upStoriesCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  upCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  upCardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  upBadge: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 8,
    minWidth: 22,
    alignItems: 'center',
  },
  upBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  upStoriesScroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  upStoryItem: {
    alignItems: 'center',
  },
  upStoryRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2.5,
    padding: 2,
    overflow: 'hidden',
  },
  upStoryImg: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
  },
  upStoryTime: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
  },
  upMediaCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  upMediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    gap: 3,
  },
  upMediaCell: {
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(128,128,128,0.12)',
    aspectRatio: 1,
    flexBasis: '31.5%',
    flexGrow: 1,
    maxWidth: '33%',
  },
  upMediaPlayBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  upMediaDuration: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  upMediaDurText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '600',
  },
  upMediaShowAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.15)',
    marginHorizontal: 12,
    marginTop: 4,
  },
  upMediaShowAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  mvOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 110,
  },
  mvTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  mvTopBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mvTopInfo: {
    flex: 1,
    marginLeft: 4,
  },
  mvTopSender: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  mvTopDate: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  mvCounter: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    marginRight: 8,
  },
  mvContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mvImage: {
    width: '100%',
    height: '100%',
  },
  mvNavRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    zIndex: 5,
  },
  mvNavBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mvThumbStrip: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 10,
    paddingBottom: 14,
  },
  mvThumbScroll: {
    paddingHorizontal: 12,
    gap: 6,
  },
  mvThumb: {
    width: 50,
    height: 50,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  mvThumbActive: {
    borderColor: '#FFFFFF',
  },
  mvThumbImg: {
    width: '100%',
    height: '100%',
  },
  mvThumbPlay: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  upAvatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.95)',
    zIndex: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upOverlayClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 110,
  },
  upAvatarFullImg: {
    width: '92%',
    height: '65%',
  },
  upStoryOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 100,
  },
  upStoryContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 50,
    paddingBottom: 60,
  },
  upStoryMediaImg: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  upStoryTextCard: {
    width: '100%',
    flex: 1,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  upStoryTextContent: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 30,
  },
  upStoryNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  upStoryNavBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  upStoryProgress: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 14,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 3,
    zIndex: 105,
  },
  upStoryProgressDot: {
    height: 3,
    flex: 1,
    borderRadius: 2,
  },
  selectCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    alignSelf: 'center',
  },
  selectionToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 0.5,
  },
  selectionCount: {
    fontSize: 15,
    fontWeight: '600',
  },
  selectionActions: {
    flexDirection: 'row',
    gap: 16,
  },
  selectionAction: {
    padding: 6,
  },
  scrollDownButton: {
    position: 'absolute',
    right: 16,
    bottom: 80,
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
    ...Platform.select({
      web: { boxShadow: '0 2px 12px rgba(0,0,0,0.12)' },
      default: { elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 8 },
    }) as any,
  },
  scrollDownBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollDownBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
  mediaGridItem: {
    flex: 1 / 3,
    aspectRatio: 1,
    padding: 1,
    position: 'relative',
  },
  mediaGridImage: {
    flex: 1,
    borderRadius: 4,
  },
  mediaVideoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 4,
    margin: 1,
  },
  mediaTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
  },
  mediaTabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  mediaTabLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  mediaEmptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    gap: 16,
  },
  mediaEmptyText: {
    fontSize: 15,
    textAlign: 'center',
  },
  mediaFileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 6,
    gap: 12,
  },
  mediaFileIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaFileName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  greetingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 48,
  },
  greetingIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(128,128,128,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  greetingIconEmoji: {
    fontSize: 36,
  },
  greetingTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  greetingSubtitle: {
    fontSize: 14,
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 20,
  },
  greetingStickersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    maxWidth: 340,
  },
  greetingStickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    gap: 6,
  },
  greetingStickerEmoji: {
    fontSize: 20,
  },
  greetingStickerLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  // --- Video Note (circle) styles ---
  videoNoteContainer: {
    alignItems: 'center',
    marginVertical: 2,
    marginHorizontal: -4,
  },
  videoNoteFooter: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    marginTop: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    ...Platform.select({
      web: { backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' },
      default: {},
    }) as any,
  },
  videoNoteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoNoteRecordContainer: {
    alignItems: 'center',
    gap: 28,
  },
  videoNoteRecordRingWrap: {
    width: 280,
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoNoteRecordCircle: {
    width: 268,
    height: 268,
    borderRadius: 134,
    overflow: 'hidden',
  },
  videoNoteTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  videoNoteRecDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E53935',
  },
  videoNoteRecordTimer: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 2,
    fontVariant: ['tabular-nums' as const],
  },
  videoNoteRecordActions: {
    flexDirection: 'row',
    gap: 40,
    marginTop: 4,
  },
  videoNoteCancelBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(229,57,53,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  videoNoteSendBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  videoNoteActionLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  // --- Contact Card styles ---
  contactCardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    minWidth: 210,
  },
  contactCardAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  contactCardAvatarLetter: {
    fontSize: 18,
    fontWeight: '700',
  },
  contactCardInfo: {
    flex: 1,
  },
  contactCardName: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  contactCardPhone: {
    fontSize: 13,
    marginTop: 3,
    opacity: 0.7,
  },
  callSystemMsg: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  callSystemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    width: '100%',
    maxWidth: 340,
  },
  callSystemIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callSystemInfo: {
    flex: 1,
  },
  callSystemLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  callSystemTime: {
    fontSize: 12,
    marginTop: 2,
    opacity: 0.7,
  },
  callSystemAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lastCallBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  lastCallText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Offline banner
  offlineChatBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  offlineChatBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  offlineRetryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  offlineRetryText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Scheduled banner
  scheduledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scheduledBannerDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  scheduledBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  // Schedule picker modal
  scheduleModal: {
    width: '92%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 22,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  scheduleIconBg: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduleTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  scheduleLabel: {
    fontSize: 12,
    marginTop: 1,
  },
  schedulePreview: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'flex-end',
  },
  schedulePreviewBubble: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    maxWidth: '85%',
    alignSelf: 'flex-end',
  },
  schedulePreviewText: {
    fontSize: 14,
    lineHeight: 20,
  },
  scheduleRelativeTime: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    letterSpacing: 0.2,
  },
  scheduleFields: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  scheduleFieldGroup: {
    flex: 1,
  },
  scheduleFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  scheduleInputWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
  },
  scheduleInput: {
    height: 42,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  scheduleErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  scheduleErrorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  schedulePresets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 18,
  },
  schedulePresetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  schedulePresetText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  scheduleActions: {
    flexDirection: 'row',
    gap: 10,
  },
  scheduleCancelBtn: {
    flex: 0.45,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  scheduleCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scheduleConfirmBtn: {
    flex: 0.55,
    flexDirection: 'row',
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  scheduleConfirmText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  scheduleSuccessWrap: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  scheduleSuccessIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  scheduleSuccessTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  scheduleSuccessDetail: {
    fontSize: 14,
  },

  // Scheduled messages list modal
  scheduledListModal: {
    width: '94%',
    maxWidth: 440,
    maxHeight: '72%',
    borderRadius: 24,
    padding: 18,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  scheduledListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  scheduledCount: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 4,
  },
  scheduledCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 4,
  },
  scheduledCountText: {
    fontSize: 13,
    fontWeight: '700',
  },
  scheduledCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduledEmpty: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 8,
  },
  scheduledEmptyIconBg: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  scheduledEmptyTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  scheduledEmptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  scheduledScrollView: {
    marginTop: 8,
  },
  scheduledItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 10,
  },
  scheduledItemTimeline: {
    width: 3,
    height: '80%',
    borderRadius: 2,
    minHeight: 28,
  },
  scheduledItemContent: {
    flex: 1,
  },
  scheduledItemText: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  scheduledItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  scheduledItemTime: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  scheduledItemRelative: {
    fontSize: 11,
    marginLeft: 4,
  },
  scheduledItemActions: {
    flexDirection: 'row',
    gap: 5,
  },
  scheduledActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduleMediaPreview: {
    flexDirection: 'column',
    gap: 2,
  },
  scheduleMediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduledMediaIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  scheduledMediaThumb: {
    width: 32,
    height: 32,
    borderRadius: 6,
    marginLeft: 4,
  },
  scheduledEditWrap: {
    gap: 8,
  },
  scheduledEditInput: {
    fontSize: 14,
    lineHeight: 20,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    maxHeight: 100,
    minHeight: 36,
  },
  scheduledEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  scheduledEditBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rescheduleWrap: {
    marginTop: 6,
    gap: 6,
  },
  rescheduleRow: {
    flexDirection: 'row',
    gap: 6,
  },
  rescheduleInputWrap: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  rescheduleActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  safetyNumberModal: {
    width: 280,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  safetyNumberTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    marginTop: 12,
  },
  safetyNumberDesc: {
    fontSize: 13,
    textAlign: 'center' as const,
    marginTop: 8,
    lineHeight: 18,
  },
  safetyNumberCode: {
    fontSize: 24,
    fontWeight: '700' as const,
    marginTop: 16,
    letterSpacing: 2,
  },
  safetyNumberBtn: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
});

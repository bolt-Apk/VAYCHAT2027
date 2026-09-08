import { Platform } from 'react-native';
import { supabase } from './supabase';

interface CachedProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
  last_seen: string | null;
  phone?: string;
  status_text?: string;
  privacy_settings?: { show_online?: boolean; show_last_seen?: boolean; show_read_receipts?: boolean; show_phone?: boolean } | null;
}

interface CachedConversation {
  id: string;
  type: string;
  name: string | null;
  avatar_url: string | null;
  updated_at: string;
}

interface CachedMembership {
  conversation_id: string;
  user_id: string;
  is_muted: boolean;
  is_archived: boolean;
  last_read_at: string | null;
  role?: string;
  is_pinned?: boolean;
}

export interface CachedLastMessage {
  conversation_id: string;
  content: string;
  message_type: string;
  created_at: string;
  sender_id: string;
  is_read: boolean;
}

export interface CachedCallRecord {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: 'voice' | 'video';
  status: string;
  started_at: string;
  duration: number;
  is_group_call?: boolean;
  group_name?: string;
}

export interface CachedConvMember {
  conversation_id: string;
  user_id: string;
}

export interface CachedMessage {
  id: string;
  sender_id: string;
  content: string;
  message_type: string;
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
  status_snapshot: any;
  media_group_id?: string | null;
}

const ONLINE_FRESHNESS_MS = 300000;

export function isUserOnline(is_online: boolean | undefined, last_seen: string | null | undefined): boolean {
  if (!is_online) return false;
  if (!last_seen) return true;
  return Date.now() - new Date(last_seen).getTime() < ONLINE_FRESHNESS_MS;
}

export function applyPrivacy(
  is_online: boolean | undefined,
  last_seen: string | null | undefined,
  privacy?: { show_online?: boolean; show_last_seen?: boolean } | null,
): { is_online: boolean; last_seen: string | null } {
  return {
    is_online: privacy?.show_online === false ? false : (is_online ?? false),
    last_seen: privacy?.show_last_seen === false ? null : (last_seen ?? null),
  };
}

type Listener = () => void;

export interface CachedContact {
  id: string;
  contact_id: string;
  nickname: string | null;
  profile: {
    display_name: string;
    avatar_url: string | null;
    phone: string;
    is_online: boolean;
    status_text: string;
    last_seen: string | null;
    privacy_settings?: { show_online?: boolean; show_last_seen?: boolean; show_read_receipts?: boolean; show_phone?: boolean } | null;
  };
}

const STORAGE_PROFILES = '@vaychat_cache_profiles';
const STORAGE_CONVERSATIONS = '@vaychat_cache_convs';
const STORAGE_MEMBERSHIPS = '@vaychat_cache_members';
const STORAGE_CONTACTS = '@vaychat_cache_contacts';
const STORAGE_CALLS = '@vaychat_cache_calls';
const STORAGE_LAST_MSGS = '@vaychat_cache_lastmsgs';
const STORAGE_CONV_MEMBERS = '@vaychat_cache_convmembers';
const STORAGE_MESSAGES = '@vaychat_cache_messages';
const STORAGE_META = '@vaychat_cache_meta';

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    return AsyncStorage.getItem(key);
  } catch { return null; }
}

async function storageMultiSet(pairs: [string, string][]) {
  if (Platform.OS === 'web') {
    try { pairs.forEach(([k, v]) => localStorage.setItem(k, v)); } catch {}
    return;
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.multiSet(pairs);
  } catch {}
}

async function storageMultiRemove(keys: string[]) {
  if (Platform.OS === 'web') {
    try { keys.forEach(k => localStorage.removeItem(k)); } catch {}
    return;
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.multiRemove(keys);
  } catch {}
}

const MAX_CACHED_MESSAGES_PER_CONV = 200;
const MAX_CACHED_CONVERSATIONS = 50;

class DataCache {
  private profiles = new Map<string, CachedProfile>();
  private conversations = new Map<string, CachedConversation>();
  private memberships: CachedMembership[] = [];
  private contacts: CachedContact[] = [];
  private contactsFetched = false;
  private calls: CachedCallRecord[] = [];
  private callsFetched = false;
  private lastMessages = new Map<string, CachedLastMessage>();
  private convMembers: CachedConvMember[] = [];
  private messages = new Map<string, CachedMessage[]>();
  private userId: string | null = null;
  private listeners = new Set<Listener>();
  private prefetchDone = false;
  private prefetching = false;
  private lastPrefetchTime = 0;
  private realtimeChannel: any = null;
  private restoredFromDisk = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  isPrefetched(): boolean {
    return this.prefetchDone;
  }

  isRestoredFromDisk(): boolean {
    return this.restoredFromDisk;
  }

  getProfile(id: string): CachedProfile | undefined {
    return this.profiles.get(id);
  }

  getAllProfiles(): CachedProfile[] {
    return [...this.profiles.values()];
  }

  getConversation(id: string): CachedConversation | undefined {
    return this.conversations.get(id);
  }

  getAllConversations(): CachedConversation[] {
    return [...this.conversations.values()];
  }

  getMemberships(): CachedMembership[] {
    return this.memberships;
  }

  getContacts(): CachedContact[] {
    return this.contacts;
  }

  isContactsFetched(): boolean {
    return this.contactsFetched;
  }

  setContacts(contacts: CachedContact[]) {
    this.contacts = contacts;
    this.contactsFetched = true;
    this.notify();
    this.schedulePersist();
  }

  setProfile(profile: CachedProfile) {
    this.profiles.set(profile.id, profile);
    this.schedulePersist();
  }

  // --- Calls ---
  getCalls(): CachedCallRecord[] {
    return this.calls;
  }

  isCallsFetched(): boolean {
    return this.callsFetched;
  }

  setCalls(calls: CachedCallRecord[]) {
    this.calls = calls;
    this.callsFetched = true;
    this.notify();
    this.schedulePersist();
  }

  // --- Last messages ---
  getLastMessage(conversationId: string): CachedLastMessage | undefined {
    return this.lastMessages.get(conversationId);
  }

  getAllLastMessages(): Map<string, CachedLastMessage> {
    return this.lastMessages;
  }

  setLastMessages(msgs: CachedLastMessage[]) {
    msgs.forEach(m => this.lastMessages.set(m.conversation_id, m));
    this.schedulePersist();
  }

  updateLastMessage(msg: CachedLastMessage) {
    this.lastMessages.set(msg.conversation_id, msg);
    this.schedulePersist();
  }

  // --- Conversation members (other users) ---
  getConvMembers(): CachedConvMember[] {
    return this.convMembers;
  }

  setConvMembers(members: CachedConvMember[]) {
    this.convMembers = members;
    this.schedulePersist();
  }

  getConvMembersByConv(convId: string): CachedConvMember[] {
    return this.convMembers.filter(m => m.conversation_id === convId);
  }

  // --- Messages per conversation ---
  getMessages(conversationId: string): CachedMessage[] | undefined {
    return this.messages.get(conversationId);
  }

  setMessages(conversationId: string, msgs: CachedMessage[]) {
    this.messages.set(conversationId, msgs.slice(-MAX_CACHED_MESSAGES_PER_CONV));
    if (this.messages.size > MAX_CACHED_CONVERSATIONS) {
      const keys = [...this.messages.keys()];
      for (let i = 0; i < keys.length - MAX_CACHED_CONVERSATIONS; i++) {
        this.messages.delete(keys[i]);
      }
    }
    this.schedulePersist();
  }

  appendMessage(conversationId: string, msg: CachedMessage) {
    const existing = this.messages.get(conversationId) || [];
    if (existing.some(m => m.id === msg.id)) return;
    const updated = [...existing, msg].slice(-MAX_CACHED_MESSAGES_PER_CONV);
    this.messages.set(conversationId, updated);
    this.schedulePersist();
  }

  // --- Disk persistence ---
  async restoreFromDisk(userId: string) {
    try {
      const meta = await storageGet(STORAGE_META);
      if (!meta) return;
      const { userId: cachedUserId, timestamp } = JSON.parse(meta);
      if (cachedUserId !== userId) return;
      if (Date.now() - timestamp > 72 * 60 * 60 * 1000) return;

      const [profilesRaw, convsRaw, membersRaw, contactsRaw, callsRaw, lastMsgsRaw, convMembersRaw, messagesRaw] = await Promise.all([
        storageGet(STORAGE_PROFILES),
        storageGet(STORAGE_CONVERSATIONS),
        storageGet(STORAGE_MEMBERSHIPS),
        storageGet(STORAGE_CONTACTS),
        storageGet(STORAGE_CALLS),
        storageGet(STORAGE_LAST_MSGS),
        storageGet(STORAGE_CONV_MEMBERS),
        storageGet(STORAGE_MESSAGES),
      ]);

      if (profilesRaw) {
        const entries: [string, CachedProfile][] = JSON.parse(profilesRaw);
        entries.forEach(([k, v]) => this.profiles.set(k, v));
      }
      if (convsRaw) {
        const entries: [string, CachedConversation][] = JSON.parse(convsRaw);
        entries.forEach(([k, v]) => this.conversations.set(k, v));
      }
      if (membersRaw) {
        this.memberships = JSON.parse(membersRaw);
      }
      if (contactsRaw) {
        this.contacts = JSON.parse(contactsRaw);
        this.contactsFetched = true;
      }
      if (callsRaw) {
        this.calls = JSON.parse(callsRaw);
        this.callsFetched = true;
      }
      if (lastMsgsRaw) {
        const entries: [string, CachedLastMessage][] = JSON.parse(lastMsgsRaw);
        entries.forEach(([k, v]) => this.lastMessages.set(k, v));
      }
      if (convMembersRaw) {
        this.convMembers = JSON.parse(convMembersRaw);
      }
      if (messagesRaw) {
        const entries: [string, CachedMessage[]][] = JSON.parse(messagesRaw);
        entries.forEach(([k, v]) => this.messages.set(k, v));
      }

      this.restoredFromDisk = true;
      this.userId = userId;
      this.notify();
    } catch {}
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistToDisk();
    }, 800);
  }

  private async persistToDisk() {
    if (!this.userId) return;
    try {
      await storageMultiSet([
        [STORAGE_PROFILES, JSON.stringify([...this.profiles.entries()])],
        [STORAGE_CONVERSATIONS, JSON.stringify([...this.conversations.entries()])],
        [STORAGE_MEMBERSHIPS, JSON.stringify(this.memberships)],
        [STORAGE_CONTACTS, JSON.stringify(this.contacts)],
        [STORAGE_CALLS, JSON.stringify(this.calls)],
        [STORAGE_LAST_MSGS, JSON.stringify([...this.lastMessages.entries()])],
        [STORAGE_CONV_MEMBERS, JSON.stringify(this.convMembers)],
        [STORAGE_MESSAGES, JSON.stringify([...this.messages.entries()])],
        [STORAGE_META, JSON.stringify({ userId: this.userId, timestamp: Date.now() })],
      ]);
    } catch {}
  }

  async prefetch(userId: string, force = false) {
    if (this.prefetching) return;
    if (!force && this.prefetchDone && this.userId === userId) {
      const elapsed = Date.now() - this.lastPrefetchTime;
      if (elapsed < 30000) return;
    }

    this.prefetching = true;
    this.userId = userId;

    try {
      const [membershipsRes, profileRes, contactsRes, callsRes] = await Promise.all([
        supabase
          .from('conversation_members')
          .select('conversation_id, user_id, is_muted, is_archived, last_read_at, role, is_pinned')
          .eq('user_id', userId),
        supabase
          .from('profiles')
          .select('id, display_name, avatar_url, is_online, last_seen, phone, status_text')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('contacts')
          .select('id, contact_id, nickname, profile:profiles!contacts_contact_id_fkey(display_name, avatar_url, phone, is_online, status_text, last_seen)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('calls')
          .select('id, caller_id, receiver_id, call_type, status, started_at, duration, is_group_call, group_name')
          .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
          .order('started_at', { ascending: false })
          .limit(100),
      ]);

      if (contactsRes.data) {
        const mapped = (contactsRes.data as any[]).map((c: any) => {
          const profile = Array.isArray(c.profile) ? c.profile[0] : c.profile;
          return { id: c.id, contact_id: c.contact_id, nickname: c.nickname, profile };
        }).filter((c: any) => c.profile);
        this.contacts = mapped;
        this.contactsFetched = true;
      }

      if (profileRes.data) {
        this.profiles.set(userId, profileRes.data);
      }

      if (callsRes.data) {
        this.calls = callsRes.data;
        this.callsFetched = true;
      }

      const myMemberships = membershipsRes.data || [];
      this.memberships = myMemberships;

      if (myMemberships.length > 0) {
        const convIds = myMemberships.map(m => m.conversation_id);

        const [convsRes, allMembersRes, ...lastMsgResults] = await Promise.all([
          supabase
            .from('conversations')
            .select('id, type, name, avatar_url, updated_at')
            .in('id', convIds)
            .order('updated_at', { ascending: false }),
          supabase
            .from('conversation_members')
            .select('conversation_id, user_id')
            .in('conversation_id', convIds)
            .neq('user_id', userId),
          ...convIds.map(cid =>
            supabase
              .from('messages')
              .select('conversation_id, content, message_type, created_at, sender_id, is_read')
              .eq('conversation_id', cid)
              .is('deleted_at', null)
              .order('created_at', { ascending: false })
              .limit(1)
          ),
        ]);

        if (convsRes.data) {
          convsRes.data.forEach(c => this.conversations.set(c.id, c));
        }

        if (allMembersRes.data) {
          this.convMembers = allMembersRes.data;
        }

        {
          const lastMsgByConv = new Map<string, CachedLastMessage>();
          for (const res of lastMsgResults) {
            if (res.data && res.data.length > 0) {
              const msg = res.data[0] as any;
              lastMsgByConv.set(msg.conversation_id, msg);
            }
          }
          this.lastMessages = lastMsgByConv;
        }

        const otherUserIds = [...new Set((allMembersRes.data || []).map(m => m.user_id))];
        if (otherUserIds.length > 0) {
          const batchSize = 100;
          const batches: string[][] = [];
          for (let i = 0; i < otherUserIds.length; i += batchSize) {
            batches.push(otherUserIds.slice(i, i + batchSize));
          }
          const results = await Promise.all(batches.map(batch =>
            supabase
              .from('profiles')
              .select('id, display_name, avatar_url, is_online, last_seen, phone, status_text')
              .in('id', batch)
          ));
          results.forEach(({ data: profiles }) => {
            if (profiles) profiles.forEach(p => this.profiles.set(p.id, p));
          });
        }
      }

      this.prefetchDone = true;
      this.lastPrefetchTime = Date.now();
      this.notify();
      this.persistToDisk();
      this.setupRealtimeUpdates(userId);
      this.prefetchTopChatMessages(userId);
    } catch {
    } finally {
      this.prefetching = false;
    }
  }

  private async prefetchTopChatMessages(_userId: string) {
    try {
      const allConvs = [...this.conversations.values()]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      const MSG_COLS = 'id, sender_id, content, message_type, media_url, media_duration, created_at, is_read, reply_to_id, edited_at, is_pinned, expires_at, deleted_at, forwarded_from_id, status_id, status_snapshot, media_group_id';
      const batchSize = 8;
      for (let i = 0; i < allConvs.length; i += batchSize) {
        const batch = allConvs.slice(i, i + batchSize);
        await Promise.all(batch.map(async (conv) => {
          const existing = this.messages.get(conv.id);
          if (existing && existing.length >= 30) return;
          const { data } = await supabase
            .from('messages')
            .select(MSG_COLS)
            .eq('conversation_id', conv.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(50);
          if (data && data.length > 0) {
            this.messages.set(conv.id, data.reverse());
          }
        }));
      }
      this.schedulePersist();
    } catch {}
  }

  private setupRealtimeUpdates(userId: string) {
    if (this.realtimeChannel) {
      supabase.removeChannel(this.realtimeChannel);
    }

    this.realtimeChannel = supabase
      .channel(`cache-sync-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
      }, (payload) => {
        const profile = payload.new as CachedProfile;
        if (profile?.id) {
          this.profiles.set(profile.id, { ...this.profiles.get(profile.id), ...profile } as CachedProfile);
          this.notify();
          this.schedulePersist();
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversations',
      }, (payload) => {
        const conv = payload.new as CachedConversation;
        if (conv?.id) {
          this.conversations.set(conv.id, { ...this.conversations.get(conv.id), ...conv } as CachedConversation);
          this.notify();
          this.schedulePersist();
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const member = payload.new as CachedMembership;
        if (member?.conversation_id) {
          const exists = this.memberships.some(
            m => m.conversation_id === member.conversation_id && m.user_id === member.user_id
          );
          if (!exists) {
            this.memberships = [...this.memberships, member];
          }
          (async () => {
            const { data: conv } = await supabase
              .from('conversations')
              .select('id, type, name, avatar_url, updated_at')
              .eq('id', member.conversation_id)
              .maybeSingle();
            if (conv) {
              this.conversations.set(conv.id, conv);
              this.notify();
              this.schedulePersist();
            }
          })();
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const updated = payload.new as CachedMembership;
        if (updated) {
          this.memberships = this.memberships.map(m =>
            m.conversation_id === updated.conversation_id && m.user_id === updated.user_id
              ? { ...m, ...updated }
              : m
          );
          this.notify();
          this.schedulePersist();
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const old = payload.old as any;
        if (old?.conversation_id) {
          this.memberships = this.memberships.filter(
            m => !(m.conversation_id === old.conversation_id && m.user_id === old.user_id)
          );
          this.conversations.delete(old.conversation_id);
          this.notify();
          this.schedulePersist();
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
      }, (payload) => {
        const call = payload.new as CachedCallRecord;
        if (call && (call.caller_id === userId || call.receiver_id === userId)) {
          this.calls = [call, ...this.calls].slice(0, 100);
          this.notify();
          this.schedulePersist();
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
      }, (payload) => {
        const call = payload.new as CachedCallRecord;
        if (call?.id) {
          this.calls = this.calls.map(c => c.id === call.id ? { ...c, ...call } : c);
          this.notify();
          this.schedulePersist();
        }
      })
      .subscribe();
  }

  getCacheStats(): { conversations: number; messages: number; profiles: number; contacts: number; calls: number } {
    let totalMessages = 0;
    this.messages.forEach(msgs => { totalMessages += msgs.length; });
    return {
      conversations: this.conversations.size,
      messages: totalMessages,
      profiles: this.profiles.size,
      contacts: this.contacts.length,
      calls: this.calls.length,
    };
  }

  async clearMessagesOnly() {
    this.messages.clear();
    this.lastMessages.clear();
    this.notify();
    this.schedulePersist();
  }

  invalidate() {
    this.prefetchDone = false;
    this.lastPrefetchTime = 0;
  }

  clear() {
    this.profiles.clear();
    this.conversations.clear();
    this.memberships = [];
    this.contacts = [];
    this.contactsFetched = false;
    this.calls = [];
    this.callsFetched = false;
    this.lastMessages.clear();
    this.convMembers = [];
    this.messages.clear();
    this.userId = null;
    this.prefetchDone = false;
    this.prefetching = false;
    this.lastPrefetchTime = 0;
    this.restoredFromDisk = false;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.realtimeChannel) {
      supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    storageMultiRemove([
      STORAGE_PROFILES, STORAGE_CONVERSATIONS, STORAGE_MEMBERSHIPS,
      STORAGE_CONTACTS, STORAGE_CALLS, STORAGE_LAST_MSGS,
      STORAGE_CONV_MEMBERS, STORAGE_MESSAGES, STORAGE_META,
    ]);
  }
}

export const dataCache = new DataCache();

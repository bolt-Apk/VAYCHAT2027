import { Platform, AppState } from 'react-native';
import { supabase } from './supabase';

export interface QueuedMessage {
  id: string;
  tempId: string;
  conversationId: string;
  payload: {
    conversation_id: string;
    sender_id: string;
    content: string;
    message_type: string;
    media_url: string | null;
    media_duration: number;
    reply_to_id: string | null;
    is_read: boolean;
    expires_at: string | null;
  };
  retries: number;
  createdAt: number;
  status: 'pending' | 'sending' | 'failed';
}

export type QueueEvent =
  | { type: 'enqueued'; item: QueuedMessage }
  | { type: 'sending'; id: string }
  | { type: 'sent'; id: string; tempId: string; insertedId: string; createdAt: string; conversationId: string }
  | { type: 'failed'; id: string; tempId: string; conversationId: string }
  | { type: 'removed'; id: string; tempId: string; conversationId: string }
  | { type: 'queue_changed'; count: number };

type QueueListener = (event: QueueEvent) => void;

const STORAGE_KEY = Platform.OS === 'web' ? 'msg_queue' : '@vaychat_msg_queue';
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 2000;
const MAX_RETRY_DELAY = 15000;
const STALE_THRESHOLD_MS = 3 * 60 * 1000;

const listeners = new Set<QueueListener>();

export function onQueueEvent(fn: QueueListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(event: QueueEvent) {
  listeners.forEach(fn => { try { fn(event); } catch {} });
}

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    return AsyncStorage.getItem(key);
  } catch { return null; }
}

async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { localStorage.setItem(key, value); } catch {}
    return;
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(key, value);
  } catch {}
}

async function storageRemove(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { localStorage.removeItem(key); } catch {}
    return;
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.removeItem(key);
  } catch {}
}

let cachedQueue: QueuedMessage[] | null = null;

async function loadQueue(): Promise<QueuedMessage[]> {
  if (cachedQueue !== null) return cachedQueue;
  try {
    const raw = await storageGet(STORAGE_KEY);
    const parsed: any[] = raw ? JSON.parse(raw) : [];
    cachedQueue = parsed.map(item => ({
      ...item,
      tempId: item.tempId || item.id,
      status: item.status || 'pending',
    }));
    return cachedQueue;
  } catch {
    cachedQueue = [];
    return [];
  }
}

async function saveQueue(queue: QueuedMessage[]) {
  cachedQueue = queue;
  try {
    if (queue.length === 0) {
      await storageRemove(STORAGE_KEY);
    } else {
      await storageSet(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {}
  emit({ type: 'queue_changed', count: queue.length });
}

let processing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    const queue = await loadQueue();
    if (queue.length === 0) { processing = false; return; }

    const remaining: QueuedMessage[] = [];
    const now = Date.now();

    for (const item of queue) {
      if (now - item.createdAt > STALE_THRESHOLD_MS) {
        emit({ type: 'removed', id: item.id, tempId: item.tempId, conversationId: item.conversationId });
        continue;
      }
      if (item.status === 'sending') {
        item.status = 'failed';
        item.retries = Math.min(item.retries + 1, MAX_RETRIES);
      }
      if (item.status === 'failed') {
        if (item.retries >= MAX_RETRIES) {
          emit({ type: 'removed', id: item.id, tempId: item.tempId, conversationId: item.conversationId });
        } else {
          remaining.push(item);
        }
        continue;
      }
      emit({ type: 'sending', id: item.id });

      const { data: inserted, error } = await supabase.from('messages')
        .insert(item.payload)
        .select('id, created_at')
        .single();

      if (error || !inserted) {
        if (item.retries < MAX_RETRIES) {
          const updated = { ...item, retries: item.retries + 1, status: 'failed' as const };
          remaining.push(updated);
          emit({ type: 'failed', id: item.id, tempId: item.tempId, conversationId: item.conversationId });
        } else {
          emit({ type: 'removed', id: item.id, tempId: item.tempId, conversationId: item.conversationId });
        }
      } else {
        emit({
          type: 'sent',
          id: item.id,
          tempId: item.tempId,
          insertedId: inserted.id,
          createdAt: inserted.created_at,
          conversationId: item.conversationId,
        });
        supabase.from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', item.conversationId)
          .then(() => {});
      }
    }

    await saveQueue(remaining);

    if (remaining.length > 0) {
      const maxRetries = Math.max(...remaining.map(r => r.retries));
      const delay = Math.min(BASE_RETRY_DELAY * Math.pow(1.5, maxRetries), MAX_RETRY_DELAY);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(processQueue, delay);
    }
  } finally {
    processing = false;
  }
}

export function enqueueMessage(conversationId: string, payload: QueuedMessage['payload'], tempId?: string) {
  const queueId = `q-${Date.now()}-${Math.random()}`;
  const item: QueuedMessage = {
    id: queueId,
    tempId: tempId || queueId,
    conversationId,
    payload,
    retries: 0,
    createdAt: Date.now(),
    status: 'pending',
  };

  loadQueue().then(queue => {
    const copy = [...queue, item];
    saveQueue(copy);
    emit({ type: 'enqueued', item });
    setTimeout(processQueue, 100);
  });

  return queueId;
}

export function removeFromQueue(tempId: string) {
  loadQueue().then(queue => {
    const item = queue.find(q => q.tempId === tempId);
    const next = queue.filter(q => q.tempId !== tempId);
    saveQueue(next);
    if (item) emit({ type: 'removed', id: item.id, tempId: item.tempId, conversationId: item.conversationId });
  });
}

export function retryQueueItem(tempId: string) {
  loadQueue().then(queue => {
    const item = queue.find(q => q.tempId === tempId);
    if (item) {
      item.status = 'pending';
      item.retries = 0;
      saveQueue(queue);
      setTimeout(processQueue, 100);
    }
  });
}

export function getQueuedCount(conversationId?: string): number {
  if (cachedQueue === null) return 0;
  if (conversationId) return cachedQueue.filter(q => q.conversationId === conversationId).length;
  return cachedQueue.length;
}

export function getQueuedMessages(conversationId: string): QueuedMessage[] {
  if (cachedQueue === null) return [];
  return cachedQueue.filter(q => q.conversationId === conversationId);
}

export function getTotalQueuedCount(): number {
  return cachedQueue?.length ?? 0;
}

export function startQueueProcessor() {
  loadQueue().then(() => processQueue());

  if (Platform.OS === 'web') {
    window.addEventListener('online', () => {
      setTimeout(processQueue, 500);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        setTimeout(processQueue, 300);
      }
    });
  } else {
    AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        setTimeout(processQueue, 300);
      }
    });
  }
}

export function forceProcessQueue() {
  processing = false;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  processQueue();
}

export async function clearQueue() {
  const queue = await loadQueue();
  for (const item of queue) {
    emit({ type: 'removed', id: item.id, tempId: item.tempId, conversationId: item.conversationId });
  }
  await saveQueue([]);
}

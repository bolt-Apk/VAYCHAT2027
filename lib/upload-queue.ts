import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaType = 'image' | 'video' | 'file' | 'video_note' | 'voice';

export type UploadStatus = 'pending' | 'uploading' | 'retrying' | 'completed' | 'failed';

export interface UploadItem {
  id: string;
  conversationId: string;
  tempMessageId: string;
  uri: string;
  file?: File; // web only
  mediaType: MediaType;
  contentType: string;
  status: UploadStatus;
  progress: number; // 0-100
  publicUrl: string | null;
  caption: string | null;
  retryCount: number;
  error: string | null;
  createdAt: number;
  /** Skip image compression even for images */
  skipCompression?: boolean;
}

export type UploadEventType = 'progress' | 'completed' | 'failed' | 'status_changed';

export interface UploadEvent {
  type: UploadEventType;
  upload: UploadItem;
  /** Bytes loaded so far (progress events only) */
  bytesLoaded?: number;
  /** Total bytes (progress events only) */
  bytesTotal?: number;
}

export interface EnqueueUploadParams {
  conversationId: string;
  tempMessageId: string;
  uri: string;
  file?: File;
  mediaType: MediaType;
  contentType: string;
  caption?: string | null;
  skipCompression?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2_000, 4_000, 8_000]; // exponential backoff
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const BUCKET = 'chat-media';
const MAX_IMAGE_WIDTH = 2560;
const JPEG_QUALITY = 0.85;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes hard limit
const STALL_TIMEOUT_MS = 60 * 1000; // abort if no progress for 60s

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const queue: UploadItem[] = [];
const listeners = new Set<(event: UploadEvent) => void>();
let processing = false;
let activeXhr: XMLHttpRequest | null = null;
let activeUploadId: string | null = null;

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function emit(event: UploadEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // swallow listener errors
    }
  });
}

function emitStatusChange(item: UploadItem): void {
  emit({ type: 'status_changed', upload: { ...item } });
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function extensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-caf': 'caf',
    'application/pdf': 'pdf',
  };
  if (map[contentType]) return map[contentType];
  // fallback: take the subtype
  const parts = contentType.split('/');
  return parts[1]?.split(';')[0] || 'bin';
}

function extensionFromUri(uri: string): string {
  const match = uri.match(/\.(\w+)(\?|$)/);
  return match ? match[1] : 'bin';
}

async function getAccessToken(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
  } catch {
    // fall through
  }
  return SUPABASE_ANON_KEY;
}

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? 'anonymous';
}

// ---------------------------------------------------------------------------
// Image compression
// ---------------------------------------------------------------------------

/**
 * Web-only: compress an image using an off-screen canvas.
 * Returns a Blob of the resized JPEG.
 */
async function compressImageWeb(source: File | string): Promise<Blob> {
  const HtmlImage = (typeof window !== 'undefined' ? window.Image : globalThis.Image) as typeof HTMLImageElement;

  let blob: Blob;
  if (source instanceof Blob) {
    blob = source;
  } else {
    const resp = await fetch(source);
    blob = await resp.blob();
  }

  const blobUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new HtmlImage();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load image for compression'));
      el.src = blobUrl;
    });

    let { width, height } = img;
    if (width > MAX_IMAGE_WIDTH) {
      const ratio = MAX_IMAGE_WIDTH / width;
      width = MAX_IMAGE_WIDTH;
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas 2d context');

    ctx.drawImage(img, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('Canvas toBlob returned null'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Native: compress an image using expo-image-manipulator.
 * Returns the URI of the compressed image and its MIME type.
 */
async function compressImageNative(
  uri: string,
): Promise<{ uri: string; contentType: string }> {
  const ImageManipulator = await import('expo-image-manipulator');
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_IMAGE_WIDTH } }],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );
  return { uri: result.uri, contentType: 'image/jpeg' };
}

// ---------------------------------------------------------------------------
// Upload execution (XHR-based)
// ---------------------------------------------------------------------------

async function executeUpload(item: UploadItem): Promise<string> {
  const token = await getAccessToken();
  const userId = await getCurrentUserId();

  let uri = item.uri;
  let contentType = item.contentType;
  let file = item.file;

  // ---- Image compression ----
  const isImage = item.mediaType === 'image' && contentType.startsWith('image/');
  const shouldCompress = isImage && !item.skipCompression;

  if (shouldCompress) {
    if (Platform.OS === 'web') {
      const source = file ?? uri;
      const compressed = await compressImageWeb(source);
      file = new File([compressed], 'compressed.jpg', { type: 'image/jpeg' });
      contentType = 'image/jpeg';
    } else {
      const compressed = await compressImageNative(uri);
      uri = compressed.uri;
      contentType = compressed.contentType;
    }
  }

  // ---- Build storage path ----
  const ext =
    contentType !== item.contentType
      ? extensionFromContentType(contentType)
      : extensionFromContentType(item.contentType) || extensionFromUri(uri);
  const storagePath = `${userId}/${Date.now()}.${ext}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;

  // ---- Perform XHR upload ----
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeXhr = xhr;
    activeUploadId = item.id;

    let settled = false;
    const cleanup = () => {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
      activeXhr = null;
      activeUploadId = null;
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const succeed = (url: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(url);
    };

    // Stall detector: abort if no progress for STALL_TIMEOUT_MS
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        try { xhr.abort(); } catch {}
        fail(new Error('Upload stalled — no progress for 60s'));
      }, STALL_TIMEOUT_MS);
    };
    resetStallTimer();

    xhr.open('POST', uploadUrl);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-upsert', 'true');

    // Progress tracking
    xhr.upload.onprogress = (e: ProgressEvent) => {
      resetStallTimer();
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        item.progress = pct;
        emit({
          type: 'progress',
          upload: { ...item },
          bytesLoaded: e.loaded,
          bytesTotal: e.total,
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
        succeed(publicUrl);
      } else {
        let msg = `Upload failed with status ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body.message || body.error) msg = body.message || body.error;
        } catch {
          // ignore parse errors
        }
        fail(new Error(msg));
      }
    };

    xhr.onerror = () => {
      fail(new Error('Network error during upload'));
    };

    xhr.ontimeout = () => {
      fail(new Error('Upload timed out'));
    };

    xhr.onabort = () => {
      fail(new Error('Upload aborted'));
    };

    // ---- Build payload ----
    if (Platform.OS === 'web') {
      const sendPayload = (blob: File | Blob) => {
        xhr.setRequestHeader('Content-Type', blob.type || contentType);
        xhr.send(blob);
      };
      if (file) {
        sendPayload(file);
      } else if (uri.startsWith('blob:') || uri.startsWith('data:')) {
        fetch(uri)
          .then(r => r.blob())
          .then(b => {
            if (b.size === 0) {
              fail(new Error('Media blob is empty (0 bytes)'));
              return;
            }
            sendPayload(b);
          })
          .catch((e) => fail(new Error(`Failed to read media blob: ${e?.message || 'unknown'}`)));
      } else {
        fail(new Error('No file or valid URI provided for upload'));
      }
    } else {
      // Native (React Native): use FormData
      let nativeUri = uri;
      if (!nativeUri.startsWith('file://') && !nativeUri.startsWith('http') && !nativeUri.startsWith('content://') && !nativeUri.startsWith('ph://')) {
        nativeUri = 'file://' + nativeUri;
      }
      const formData = new FormData();
      const name = storagePath.split('/').pop() ?? 'file';
      formData.append('', { uri: nativeUri, name, type: contentType } as any);
      xhr.send(formData);
    }
  });
}

// ---------------------------------------------------------------------------
// Queue processor
// ---------------------------------------------------------------------------

async function processNext(): Promise<void> {
  if (processing) return;

  const next = queue.find((u) => u.status === 'pending');
  if (!next) return;

  processing = true;
  next.status = 'uploading';
  next.progress = 0;
  next.error = null;
  emitStatusChange(next);

  try {
    const publicUrl = await executeUpload(next);
    next.status = 'completed';
    next.progress = 100;
    next.publicUrl = publicUrl;
    emitStatusChange(next);
    emit({ type: 'completed', upload: { ...next } });
  } catch (err: any) {
    next.retryCount += 1;
    const message = err?.message ?? 'Unknown upload error';

    const stillQueued = queue.includes(next);
    if (stillQueued && next.retryCount <= MAX_RETRIES) {
      next.status = 'retrying';
      next.error = message;
      emitStatusChange(next);

      const delay = RETRY_DELAYS[next.retryCount - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
      setTimeout(() => {
        next.status = 'pending';
        processing = false;
        processNext();
      }, delay);
      return;
    }

    next.status = 'failed';
    next.error = message;
    emitStatusChange(next);
    if (stillQueued) emit({ type: 'failed', upload: { ...next } });
  } finally {
    processing = false;
  }

  // Process remaining items
  if (queue.some((u) => u.status === 'pending')) {
    // Small gap between sequential uploads to avoid hammering
    setTimeout(processNext, 100);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a media upload to the queue. Processing starts automatically.
 * Returns the upload ID.
 */
export function enqueueUpload(params: EnqueueUploadParams): string {
  const id = generateId();

  const item: UploadItem = {
    id,
    conversationId: params.conversationId,
    tempMessageId: params.tempMessageId,
    uri: params.uri,
    file: params.file,
    mediaType: params.mediaType,
    contentType: params.contentType,
    status: 'pending',
    progress: 0,
    publicUrl: null,
    caption: params.caption ?? null,
    retryCount: 0,
    error: null,
    createdAt: Date.now(),
    skipCompression: params.skipCompression,
  };

  queue.push(item);
  emitStatusChange(item);

  // Kick off processing
  setTimeout(processNext, 0);

  return id;
}

/**
 * Cancel a pending or in-progress upload.
 * If the upload is currently active, the XHR is aborted.
 */
export function cancelUpload(id: string): boolean {
  const idx = queue.findIndex((u) => u.id === id);
  if (idx === -1) return false;

  const item = queue[idx];

  // Abort active XHR if this is the one uploading.
  // The onabort handler in executeUpload will reject the promise,
  // and processNext's finally block will release the processing lock.
  if (activeUploadId === id && activeXhr) {
    activeXhr.abort();
  }

  // Remove from queue
  queue.splice(idx, 1);
  emitStatusChange({ ...item, status: 'failed', error: 'Cancelled' });

  // Continue processing remaining items
  setTimeout(processNext, 0);

  return true;
}

/**
 * Retry a failed upload. Resets its retry counter and re-queues it.
 */
export function retryUpload(id: string): boolean {
  const item = queue.find((u) => u.id === id);
  if (!item || item.status !== 'failed') return false;

  item.status = 'pending';
  item.retryCount = 0;
  item.progress = 0;
  item.error = null;
  emitStatusChange(item);

  setTimeout(processNext, 0);

  return true;
}

/**
 * Get the current status of an upload by ID.
 */
export function getUploadStatus(id: string): UploadItem | null {
  const item = queue.find((u) => u.id === id);
  return item ? { ...item } : null;
}

/**
 * Get all uploads that are not yet completed (pending, uploading, or failed).
 */
export function getActiveUploads(): UploadItem[] {
  return queue
    .filter((u) => u.status !== 'completed')
    .map((u) => ({ ...u }));
}

/**
 * Get all uploads (any status) for a specific conversation.
 */
export function getUploadsForConversation(conversationId: string): UploadItem[] {
  return queue
    .filter((u) => u.conversationId === conversationId)
    .map((u) => ({ ...u }));
}

/**
 * Subscribe to upload events. Returns an unsubscribe function.
 */
export function onUploadEvent(
  callback: (event: UploadEvent) => void,
): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Remove completed uploads from the in-memory queue.
 * Useful for freeing references after the caller has processed the results.
 */
export function clearCompleted(): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].status === 'completed') {
      queue.splice(i, 1);
    }
  }
}

/**
 * Remove all uploads for a conversation (e.g. when leaving the screen).
 * Active uploads are aborted.
 */
export function clearUploadsForConversation(conversationId: string): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if (item.conversationId !== conversationId) continue;

    if (activeUploadId === item.id && activeXhr) {
      activeXhr.abort();
    }
    queue.splice(i, 1);
  }

  // Resume processing if there are remaining items
  setTimeout(processNext, 0);
}

/**
 * Enqueue an upload and return a promise that resolves with the public URL
 * or rejects on final failure. Useful when the caller needs the URL before
 * proceeding (e.g. scheduled messages).
 */
export function uploadAndWait(params: EnqueueUploadParams): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadId = enqueueUpload(params);
    const unsub = onUploadEvent((event) => {
      if (event.upload.id !== uploadId) return;
      if (event.type === 'completed' && event.upload.publicUrl) {
        unsub();
        resolve(event.upload.publicUrl);
      }
      if (event.type === 'failed') {
        unsub();
        reject(new Error(event.upload.error ?? 'Upload failed'));
      }
    });
  });
}

import { supabase } from './supabase';

export interface Draft {
  text: string;
  replyToId: string | null;
  editingMessageId: string | null;
  voiceUri: string | null;
  voiceDuration: number;
  voiceMimeType: string | null;
}

const drafts = new Map<string, Draft>();
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SYNC_DELAY = 1500;

const EMPTY: Draft = {
  text: '',
  replyToId: null,
  editingMessageId: null,
  voiceUri: null,
  voiceDuration: 0,
  voiceMimeType: null,
};

let currentUserId: string | null = null;

export function setDraftsUserId(userId: string | null) {
  currentUserId = userId;
}

function syncToServer(conversationId: string) {
  if (!currentUserId) return;

  const existing = syncTimers.get(conversationId);
  if (existing) clearTimeout(existing);

  syncTimers.set(conversationId, setTimeout(async () => {
    syncTimers.delete(conversationId);
    const draft = drafts.get(conversationId);

    if (!draft) {
      await supabase
        .from('drafts')
        .delete()
        .eq('user_id', currentUserId!)
        .eq('conversation_id', conversationId);
      return;
    }

    await supabase
      .from('drafts')
      .upsert({
        user_id: currentUserId!,
        conversation_id: conversationId,
        text: draft.text,
        reply_to_id: draft.replyToId,
        editing_message_id: draft.editingMessageId,
        voice_uri: draft.voiceUri,
        voice_duration: draft.voiceDuration,
        voice_mime_type: draft.voiceMimeType,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,conversation_id',
      });
  }, SYNC_DELAY));
}

export function saveDraft(conversationId: string, draft: Partial<Draft>) {
  const existing = drafts.get(conversationId) || { ...EMPTY };
  const merged = { ...existing, ...draft };
  const hasContent = merged.text.trim() !== '' || merged.voiceUri !== null;
  if (hasContent) {
    drafts.set(conversationId, merged);
  } else {
    drafts.delete(conversationId);
  }
  syncToServer(conversationId);
}

export function getDraft(conversationId: string): Draft | null {
  return drafts.get(conversationId) || null;
}

export function clearDraft(conversationId: string) {
  drafts.delete(conversationId);
  syncToServer(conversationId);
}

export function hasDraft(conversationId: string): boolean {
  return drafts.has(conversationId);
}

export async function loadDraftsFromServer() {
  if (!currentUserId) return;

  const { data } = await supabase
    .from('drafts')
    .select('*')
    .eq('user_id', currentUserId);

  if (!data) return;

  for (const row of data) {
    const draft: Draft = {
      text: row.text || '',
      replyToId: row.reply_to_id,
      editingMessageId: row.editing_message_id,
      voiceUri: row.voice_uri,
      voiceDuration: row.voice_duration || 0,
      voiceMimeType: row.voice_mime_type,
    };
    const hasContent = draft.text.trim() !== '' || draft.voiceUri !== null;
    if (hasContent) {
      drafts.set(row.conversation_id, draft);
    }
  }
}

export function clearAllDrafts() {
  syncTimers.forEach(t => clearTimeout(t));
  syncTimers.clear();
  drafts.clear();
  currentUserId = null;
}

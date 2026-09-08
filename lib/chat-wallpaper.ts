import { supabase } from './supabase';

export interface ChatWallpaperConfig {
  type: 'gradient' | 'image';
  value: string;
}

export async function getChatWallpaper(conversationId: string, userId: string): Promise<ChatWallpaperConfig | null> {
  try {
    const { data } = await supabase
      .from('conversation_members')
      .select('wallpaper')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (data?.wallpaper) return data.wallpaper as ChatWallpaperConfig;
    return null;
  } catch {
    return null;
  }
}

export async function setChatWallpaper(conversationId: string, userId: string, config: ChatWallpaperConfig | null): Promise<void> {
  try {
    await supabase
      .from('conversation_members')
      .update({ wallpaper: config })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
  } catch {}
}

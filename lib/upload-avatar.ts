import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';

interface UploadResult {
  publicUrl: string | null;
  error: string | null;
}

export async function uploadAvatarNative(
  userId: string,
  uri: string,
  onProgress?: (progress: number) => void,
): Promise<UploadResult> {
  try {
    onProgress?.(10);

    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: 512, height: 512 });
    const imageRef = await context.renderAsync();
    const manipulated = await imageRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });

    onProgress?.(30);

    const response = await fetch(manipulated.uri);
    const blob = await response.blob();

    onProgress?.(50);

    const arrayBuffer = await new Response(blob).arrayBuffer();

    onProgress?.(60);

    const path = `${userId}/avatar.jpg`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

    onProgress?.(85);

    if (error) {
      return { publicUrl: null, error: error.message };
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = data.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;

    onProgress?.(100);

    return { publicUrl, error: null };
  } catch (e: any) {
    return { publicUrl: null, error: e?.message || 'Не удалось загрузить аватар' };
  }
}

export async function uploadAvatarBlob(
  userId: string,
  blob: Blob,
  onProgress?: (progress: number) => void,
): Promise<UploadResult> {
  try {
    onProgress?.(20);

    const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });

    const path = `${userId}/avatar.jpg`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, file, { contentType: 'image/jpeg', upsert: true });

    onProgress?.(70);

    if (error) {
      return { publicUrl: null, error: error.message };
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = data.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;

    onProgress?.(100);

    return { publicUrl, error: null };
  } catch (e: any) {
    return { publicUrl: null, error: e?.message || 'Не удалось загрузить аватар' };
  }
}

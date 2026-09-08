import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView, Dimensions, ActivityIndicator, Platform } from 'react-native';
import { X, ImageIcon, Trash2, Check } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import { useAppearance } from '@/lib/appearance-context';
import { type ChatWallpaperConfig } from '@/lib/chat-wallpaper';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const PREVIEW_W = (SCREEN_W - 64) / 3;
const PREVIEW_H = PREVIEW_W * (16 / 9);

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

const GRADIENT_KEYS = Object.keys(WALLPAPER_GRADIENTS);

interface Props {
  conversationId: string;
  currentConfig: ChatWallpaperConfig | null;
  onSelect: (config: ChatWallpaperConfig | null) => void;
  onClose: () => void;
}

export default function WallpaperPicker({ conversationId, currentConfig, onSelect, onClose }: Props) {
  const { colors, resolvedTheme } = useAppearance();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const pickFromGallery = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });

      if (result.canceled || !result.assets?.[0]) return;

      setLoading(true);
      const asset = result.assets[0];
      const { width, height } = asset;

      const targetRatio = 9 / 16;
      const currentRatio = width / height;

      let cropOriginX = 0;
      let cropOriginY = 0;
      let cropWidth = width;
      let cropHeight = height;

      if (currentRatio > targetRatio) {
        cropWidth = Math.round(height * targetRatio);
        cropOriginX = Math.round((width - cropWidth) / 2);
      } else if (currentRatio < targetRatio) {
        cropHeight = Math.round(width / targetRatio);
        cropOriginY = Math.round((height - cropHeight) / 2);
      }

      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [
          {
            crop: {
              originX: cropOriginX,
              originY: cropOriginY,
              width: cropWidth,
              height: cropHeight,
            },
          },
          { resize: { width: 1080 } },
        ],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );

      const fileExt = 'jpg';
      const filePath = `${user?.id || 'anon'}/${conversationId}/wallpaper.${fileExt}`;

      let uploadBody: ArrayBuffer | Blob;
      if (Platform.OS === 'web') {
        const resp = await fetch(manipulated.uri);
        uploadBody = await resp.blob();
      } else {
        const resp = await fetch(manipulated.uri);
        const blob = await resp.blob();
        uploadBody = await new Response(blob).arrayBuffer();
      }

      const { error: uploadErr } = await supabase.storage
        .from('chat-media')
        .upload(filePath, uploadBody, { contentType: 'image/jpeg', upsert: true });

      if (uploadErr) {
        setLoading(false);
        return;
      }

      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(filePath);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      onSelect({ type: 'image', value: publicUrl });
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [conversationId, onSelect]);

  const isSelected = (key: string) =>
    currentConfig?.type === 'gradient' && currentConfig.value === key;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <X color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Обои чата</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Gallery pick */}
        <TouchableOpacity
          style={[styles.galleryButton, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' }]}
          onPress={pickFromGallery}
          disabled={loading}
          activeOpacity={0.7}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <ImageIcon color={colors.primary} size={20} />
          )}
          <Text style={[styles.galleryText, { color: colors.primary }]}>
            {loading ? 'Обработка...' : 'Выбрать из галереи'}
          </Text>
        </TouchableOpacity>

        {/* Current custom image preview */}
        {currentConfig?.type === 'image' && (
          <View style={styles.currentImageSection}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Текущее фото</Text>
            <View style={styles.currentImageRow}>
              <Image source={{ uri: currentConfig.value }} style={styles.currentImageThumb} />
              <TouchableOpacity
                style={[styles.removeBtn, { backgroundColor: colors.error + '14', borderColor: colors.error + '30' }]}
                onPress={() => onSelect(null)}
              >
                <Trash2 color={colors.error} size={16} />
                <Text style={[styles.removeBtnText, { color: colors.error }]}>Удалить</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Remove button when gradient is set */}
        {currentConfig?.type === 'gradient' && (
          <TouchableOpacity
            style={[styles.removeGradientBtn, { backgroundColor: colors.error + '10', borderColor: colors.error + '25' }]}
            onPress={() => onSelect(null)}
          >
            <Trash2 color={colors.error} size={16} />
            <Text style={[styles.removeBtnText, { color: colors.error }]}>Сбросить обои</Text>
          </TouchableOpacity>
        )}

        {/* Gradient presets */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Градиенты</Text>
        <View style={styles.grid}>
          {GRADIENT_KEYS.map((key) => {
            const gradColors = WALLPAPER_GRADIENTS[key][resolvedTheme];
            const selected = isSelected(key);
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.gradientCard,
                  { borderColor: selected ? colors.primary : colors.border },
                  selected && { borderWidth: 2 },
                ]}
                activeOpacity={0.7}
                onPress={() => onSelect({ type: 'gradient', value: key })}
              >
                <View style={[styles.gradientPreview, { backgroundColor: gradColors[1] }]}>
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: gradColors[0], opacity: 0.5 }]} />
                  {selected && (
                    <View style={[styles.checkCircle, { backgroundColor: colors.primary }]}>
                      <Check color="#fff" size={14} />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  galleryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    marginBottom: 20,
  },
  galleryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  currentImageSection: {
    marginBottom: 20,
  },
  currentImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  currentImageThumb: {
    width: 56,
    height: 100,
    borderRadius: 8,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  removeGradientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
  },
  removeBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gradientCard: {
    width: PREVIEW_W,
    height: PREVIEW_H,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  gradientPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

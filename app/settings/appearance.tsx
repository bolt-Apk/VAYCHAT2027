import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Animated, useWindowDimensions, Switch } from 'react-native';
import { useGoBack } from '@/hooks/useGoBack';
import { ArrowLeft, Check, Type, Maximize, Moon, Sun, Monitor, CheckCheck } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';
import { useRef, useEffect, useState, useCallback } from 'react';

type Theme = 'dark' | 'light' | 'system';

export default function AppearanceScreen() {
  const goBack = useGoBack();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { colors, theme, fontSize, fontSizeStep, useSystemFont, fontScale, bubbleColor, chatWallpaper, resolvedTheme, updateAppearance } = useAppearance();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  const updateTheme = (value: Theme) => updateAppearance({ theme: value });

  const chatPresets: { id: string; label: string; dark: string[] | null; light: string[] | null; bubble: string; bubbleRecvDark: string; bubbleRecvLight: string }[] = [
    { id: '',           label: 'Стандарт',  dark: null,                                   light: null,                                   bubble: '',        bubbleRecvDark: '',        bubbleRecvLight: '' },
    { id: 'night-sky',  label: 'Ночь',      dark: ['#0D1B2A', '#152535', '#1B3044'],       light: ['#D6E8F7', '#C1D9EE', '#B0CCE6'],       bubble: '#0A84FF', bubbleRecvDark: '#1C2C3E', bubbleRecvLight: '#E8F0FA' },
    { id: 'sunset',     label: 'Закат',     dark: ['#1A1A2E', '#2A1840', '#1A1A2E'],       light: ['#F5E6F0', '#EDD6E8', '#E5C8DF'],       bubble: '#BF5AF2', bubbleRecvDark: '#2A1F3A', bubbleRecvLight: '#F3E8FB' },
    { id: 'ocean',      label: 'Океан',     dark: ['#0A2633', '#0D3345', '#0A2633'],       light: ['#D4EDF7', '#C0E3F0', '#B0D8EA'],       bubble: '#64D2FF', bubbleRecvDark: '#142E3C', bubbleRecvLight: '#E4F4FC' },
    { id: 'forest',     label: 'Лес',       dark: ['#0B1F15', '#15312A', '#0B1F15'],       light: ['#DAF0E0', '#C8E6CF', '#BBDFC4'],       bubble: '#30D158', bubbleRecvDark: '#1A2E20', bubbleRecvLight: '#E6F6E8' },
    { id: 'warm',       label: 'Тепло',     dark: ['#201408', '#30220F', '#201408'],        light: ['#F7EDE0', '#F0E2D0', '#EAD8C2'],       bubble: '#FF9F0A', bubbleRecvDark: '#2C2218', bubbleRecvLight: '#FDF3E4' },
    { id: 'slate',      label: 'Камень',    dark: ['#111822', '#1A2536', '#111822'],        light: ['#E8ECF1', '#DDE2EA', '#D3D9E3'],       bubble: '#5E97C8', bubbleRecvDark: '#1E2530', bubbleRecvLight: '#EDF1F5' },
    { id: 'midnight',   label: 'Полночь',   dark: ['#0A0E18', '#121B2E', '#0E1422'],       light: ['#E0E4EE', '#D4D9E6', '#CBCFDC'],       bubble: '#5856D6', bubbleRecvDark: '#1A1B30', bubbleRecvLight: '#EEEDF8' },
    { id: 'sand',       label: 'Песок',     dark: ['#1C1610', '#28201A', '#1C1610'],        light: ['#F5EEE4', '#EFE6D8', '#E8DDCC'],       bubble: '#C4956A', bubbleRecvDark: '#2A2420', bubbleRecvLight: '#F5EFE8' },
    { id: 'moss',       label: 'Мох',       dark: ['#0E180E', '#182818', '#0E180E'],        light: ['#E0EFD8', '#D2E6C8', '#C4DCBA'],       bubble: '#34C759', bubbleRecvDark: '#1C2A1C', bubbleRecvLight: '#E8F4E4' },
    { id: 'aurora',     label: 'Аврора',    dark: ['#0B1628', '#0F2235', '#0A1A30'],        light: ['#D8E8F8', '#CCE0F4', '#C0D8F0'],       bubble: '#32ADE6', bubbleRecvDark: '#162838', bubbleRecvLight: '#E6F0FA' },
    { id: 'terracotta', label: 'Терракот',  dark: ['#1C120D', '#2A1C15', '#1C120D'],        light: ['#F5E8E0', '#EDDED4', '#E6D4C8'],       bubble: '#FF6482', bubbleRecvDark: '#2E1E1E', bubbleRecvLight: '#FAEAE8' },
    { id: 'steel',      label: 'Сталь',     dark: ['#14181C', '#1E2428', '#14181C'],        light: ['#EAECEF', '#E0E3E7', '#D5D9DE'],       bubble: '#8E8E93', bubbleRecvDark: '#22262A', bubbleRecvLight: '#ECEDEF' },
  ];

  const resolvedPresets = chatPresets.map(p => ({
    ...p,
    gradient: p.id ? (resolvedTheme === 'dark' ? p.dark : p.light) : null,
    bubbleRecv: resolvedTheme === 'dark' ? p.bubbleRecvDark : p.bubbleRecvLight,
  }));

  const activePresetId = chatWallpaper || '';

  const themes: { id: Theme; label: string; icon: typeof Moon }[] = [
    { id: 'system', label: 'Системная', icon: Monitor },
    { id: 'light', label: 'Светлая', icon: Sun },
    { id: 'dark', label: 'Тёмная', icon: Moon },
  ];



  const STEP_PREVIEW_SIZES = [13, 14, 16, 17, 19, 21];
  const activeStep = useSystemFont ? 2 : fontSizeStep;
  const previewFontSize = STEP_PREVIEW_SIZES[activeStep] || 16;

  const sentBubbleBg = colors.messageSent;
  const isLightBubble = (() => {
    const hex = sentBubbleBg.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 160;
  })();
  const sentTextColor = isLightBubble ? '#1A1A1A' : '#FFFFFF';
  const sentTimeColor = isLightBubble ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.7)';

  const currentWallpaperGradient = chatWallpaper
    ? resolvedPresets.find(p => p.id === chatWallpaper)?.gradient ?? null
    : null;

  const previewContent = (
    <>
      <View style={[s.previewBubbleReceived, { backgroundColor: colors.messageReceived }]}>
        <Text style={[s.previewText, { color: colors.text, fontSize: previewFontSize }]}>
          Выберите тему, чтобы изменить фон и цвет сообщений
        </Text>
        <Text style={[s.previewTime, { color: colors.textTertiary }]}>00:52</Text>
      </View>
      <View style={[s.previewBubbleSent, { backgroundColor: sentBubbleBg }]}>
        <View>
          <Text style={[s.previewTextSent, { color: sentTextColor, fontSize: previewFontSize }]}>
            Посмотрите, как с ней будут выглядеть ваши чаты
          </Text>
        </View>
        <View style={s.previewTimeSentRow}>
          <Text style={[s.previewTimeSent, { color: sentTimeColor }]}>00:52</Text>
          <CheckCheck color={sentTimeColor} size={14} />
        </View>
      </View>
      <View style={[s.previewBubbleReceived, { backgroundColor: colors.messageReceived }]}>
        <Text style={[s.previewText, { color: colors.text, fontSize: previewFontSize }]}>
          Меняйте тему в любое время
        </Text>
        <Text style={[s.previewTime, { color: colors.textTertiary }]}>00:52</Text>
      </View>
    </>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View style={[s.header, { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: Math.max(insets.top, 12) + 4 }]}>
        <TouchableOpacity style={[s.backBtn, { backgroundColor: colors.backgroundSecondary }]} onPress={() => goBack()} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={20} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>Оформление</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim }}>

          {/* ===== THEME SELECTOR ===== */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>ТЕМА</Text>
            <View style={[s.segmentedContainer, { backgroundColor: colors.backgroundSecondary }]}>
              {themes.map((t) => {
                const sel = theme === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[s.segmentedBtn, sel && [s.segmentedBtnActive, { backgroundColor: colors.primary }]]}
                    onPress={() => updateTheme(t.id)}
                    activeOpacity={0.7}
                    accessibilityLabel={t.label}
                  >
                    <Text style={[s.segmentedLabel, { color: colors.textSecondary }, sel && { color: '#FFFFFF', fontWeight: '600' }]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ===== CHAT PREVIEW ===== */}
          <View style={s.section}>
            <View style={[s.previewCard, { overflow: 'hidden' }]}>
              {currentWallpaperGradient ? (
                <LinearGradient
                  colors={currentWallpaperGradient as [string, string, ...string[]]}
                  style={s.previewInner}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  {previewContent}
                </LinearGradient>
              ) : (
                <View style={[s.previewInner, { backgroundColor: colors.background }]}>
                  {previewContent}
                </View>
              )}
            </View>
          </View>

          {/* ===== FONT SIZE ===== */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>РАЗМЕР ТЕКСТА</Text>
            <View style={[s.card, { backgroundColor: colors.backgroundSecondary }]}>
              {/* System font toggle */}
              <View style={[s.toggleRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}> 
                <Text style={[s.toggleLabel, { color: colors.text }]}>Как в системе</Text>
                <Switch
                  value={useSystemFont}
                  onValueChange={(v) => updateAppearance({ use_system_font: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={'#FFFFFF'}
                />
              </View>
              {/* Slider */}
              <View style={[s.sliderContainer, useSystemFont && { opacity: 0.35 }]}>
                <Text style={[s.sliderLabel, s.sliderLabelSmall, { color: colors.textSecondary }]}>A</Text>
                <View style={s.sliderTrackWrap} pointerEvents={useSystemFont ? 'none' : 'auto'}>
                  <View style={[s.sliderTrack, { backgroundColor: colors.border }]} />
                  <View style={s.sliderDotsRow}>
                    {[0, 1, 2, 3, 4, 5].map((step) => {
                      const sel = activeStep === step;
                      return (
                        <TouchableOpacity
                          key={step}
                          style={s.sliderDotHitArea}
                          onPress={() => updateAppearance({ font_size_step: step as any, use_system_font: false })}
                          activeOpacity={0.7}
                        >
                          <View style={[
                            s.sliderDot,
                            { backgroundColor: sel ? colors.primary : colors.textTertiary },
                            sel && s.sliderDotActive,
                          ]} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                <Text style={[s.sliderLabel, s.sliderLabelLarge, { color: colors.textSecondary }]}>A</Text>
              </View>
            </View>
          </View>


          {/* ===== BUBBLE COLOR ===== */}
          {/* ===== CHAT STYLE (wallpaper + bubble color combined) ===== */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>ОФОРМЛЕНИЕ ЧАТА</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.presetRow}
            >
              {resolvedPresets.map((preset) => {
                const sel = activePresetId === preset.id;
                return (
                  <TouchableOpacity
                    key={preset.id}
                    style={s.presetItem}
                    onPress={() => {
                      updateAppearance({
                        chat_wallpaper: preset.id,
                        bubble_color: preset.bubble,
                        bubble_color_received: preset.bubbleRecv,
                      });
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={[s.presetCard, sel && { borderColor: colors.primary, borderWidth: 2 }]}>
                      {preset.gradient ? (
                        <LinearGradient
                          colors={preset.gradient as [string, string, ...string[]]}
                          style={s.presetGradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                        />
                      ) : (
                        <View style={[s.presetGradient, { backgroundColor: colors.backgroundTertiary }]} />
                      )}
                      <View style={[s.presetBubbleRecv, { backgroundColor: preset.bubbleRecv || colors.messageReceived }]} />
                      <View style={[s.presetBubble, { backgroundColor: preset.bubble || colors.primary }]} />
                      {sel && (
                        <View style={[s.presetCheck, { backgroundColor: colors.primary }]}>
                          <Check color="#FFFFFF" size={10} strokeWidth={3} />
                        </View>
                      )}
                    </View>
                    <Text
                      style={[s.presetLabel, { color: colors.textTertiary }, sel && { color: colors.text, fontWeight: '600' }]}
                      numberOfLines={1}
                    >
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

        </Animated.View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    borderRadius: 14,
    overflow: 'hidden',
  },

  // Segmented theme selector
  segmentedContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedBtnActive: {},
  segmentedLabel: {
    fontSize: 14,
    fontWeight: '500',
  },

  // Chat preview
  previewCard: {
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 2px 12px rgba(0,0,0,0.12)' },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 12 },
      android: { elevation: 4 },
    }),
  },
  previewInner: {
    padding: 14,
    gap: 8,
  },
  previewBubbleReceived: {
    alignSelf: 'flex-start',
    borderRadius: 18,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '85%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  previewBubbleSent: {
    alignSelf: 'flex-end',
    borderRadius: 18,
    borderTopRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '85%',
  },
  previewText: {
    lineHeight: 22,
  },
  previewTextSent: {
    lineHeight: 22,
  },
  previewTime: {
    fontSize: 10,
    marginBottom: 1,
  },
  previewTimeSentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
    marginTop: 4,
  },
  previewTimeSent: {
    fontSize: 10,
  },

  // List items
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBadgeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  listItemLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  listItemSub: {
    fontSize: 12,
    marginTop: 2,
  },

  // Toggle row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
  },

  // Slider
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 12,
  },
  sliderLabel: {
    fontWeight: '700',
  },
  sliderLabelSmall: {
    fontSize: 13,
  },
  sliderLabelLarge: {
    fontSize: 22,
  },
  sliderTrackWrap: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
    position: 'relative' as const,
  },
  sliderTrack: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 1.5,
  },
  sliderDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderDotHitArea: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sliderDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sliderDotActive: {
    width: 18,
    height: 18,
    borderRadius: 9,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.3)' },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 4 },
      android: { elevation: 3 },
    }),
  },

  // Radio
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },

  // Chat style presets
  presetRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
  },
  presetItem: {
    alignItems: 'center',
    width: 64,
  },
  presetCard: {
    width: 56,
    height: 76,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  presetGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  presetBubbleRecv: {
    position: 'absolute',
    bottom: 26,
    left: 6,
    width: 22,
    height: 12,
    borderRadius: 6,
  },
  presetBubble: {
    position: 'absolute',
    bottom: 8,
    right: 6,
    width: 28,
    height: 14,
    borderRadius: 7,
  },
  presetCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetLabel: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
});

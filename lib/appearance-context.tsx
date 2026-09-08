import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { supabase } from './supabase';
import { useAuth } from './auth-context';
import { DarkColors, LightColors, ColorTheme } from '@/constants/colors';

const RECV_BUBBLE_COLORS: Record<string, { dark: string; light: string }> = {
  'night-sky':  { dark: '#1C2C3E', light: '#E8F0FA' },
  'sunset':     { dark: '#2A1F3A', light: '#F3E8FB' },
  'ocean':      { dark: '#142E3C', light: '#E4F4FC' },
  'forest':     { dark: '#1A2E20', light: '#E6F6E8' },
  'warm':       { dark: '#2C2218', light: '#FDF3E4' },
  'slate':      { dark: '#1E2530', light: '#EDF1F5' },
  'midnight':   { dark: '#1A1B30', light: '#EEEDF8' },
  'sand':       { dark: '#2A2420', light: '#F5EFE8' },
  'moss':       { dark: '#1C2A1C', light: '#E8F4E4' },
  'aurora':     { dark: '#162838', light: '#E6F0FA' },
  'terracotta': { dark: '#2E1E1E', light: '#FAEAE8' },
  'steel':      { dark: '#22262A', light: '#ECEDEF' },
};

function getReceivedBubbleColor(wallpaperId: string, theme: 'dark' | 'light'): string {
  const entry = RECV_BUBBLE_COLORS[wallpaperId];
  return entry ? entry[theme] : '';
}

type Theme = 'dark' | 'light' | 'system';
type FontSize = 'small' | 'medium' | 'large';
type FontSizeStep = 0 | 1 | 2 | 3 | 4 | 5;
type ChatDensity = 'compact' | 'normal' | 'spacious';

interface AppearanceSettings {
  theme: Theme;
  font_size: FontSize;
  font_size_step: FontSizeStep;
  use_system_font: boolean;
  chat_density: ChatDensity;
  bubble_color: string;
  bubble_color_received: string;
  chat_wallpaper: string;
}

interface AppearanceContextType {
  colors: ColorTheme;
  fontSize: FontSize;
  fontSizeStep: FontSizeStep;
  useSystemFont: boolean;
  chatDensity: ChatDensity;
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  fontScale: number;
  chatSpacing: number;
  bubbleColor: string;
  chatWallpaper: string;
  updateAppearance: (settings: Partial<AppearanceSettings>) => Promise<void>;
}

const FONT_SCALES: Record<FontSize, number> = {
  small: 0.875,
  medium: 1,
  large: 1.15,
};

const STEP_FONT_SCALES: Record<FontSizeStep, number> = {
  0: 0.8,
  1: 0.875,
  2: 1,
  3: 1.1,
  4: 1.2,
  5: 1.35,
};

const STEP_TO_FONT_SIZE: Record<FontSizeStep, FontSize> = {
  0: 'small',
  1: 'small',
  2: 'medium',
  3: 'medium',
  4: 'large',
  5: 'large',
};

const CHAT_SPACING: Record<ChatDensity, number> = {
  compact: 2,
  normal: 6,
  spacious: 12,
};

const defaultContext: AppearanceContextType = {
  colors: DarkColors,
  fontSize: 'medium',
  fontSizeStep: 2,
  useSystemFont: true,
  chatDensity: 'normal',
  theme: 'system',
  resolvedTheme: 'dark',
  fontScale: 1,
  chatSpacing: 6,
  bubbleColor: '',
  chatWallpaper: '',
  updateAppearance: async () => {},
};

const AppearanceContext = createContext<AppearanceContextType>(defaultContext);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const systemColorScheme = useColorScheme();
  const [settings, setSettings] = useState<AppearanceSettings>({
    theme: 'system',
    font_size: 'medium',
    font_size_step: 2 as FontSizeStep,
    use_system_font: true,
    chat_density: 'normal',
    bubble_color: '',
    bubble_color_received: '',
    chat_wallpaper: '',
  });

  useEffect(() => {
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('appearance_settings')
      .eq('id', user.id)
      .maybeSingle();

    if (data?.appearance_settings) {
      setSettings(data.appearance_settings);
    }
  };

  const updateAppearance = useCallback(async (partial: Partial<AppearanceSettings>) => {
    setSettings(prev => {
      const newSettings = { ...prev, ...partial };
      if (user) {
        supabase
          .from('profiles')
          .update({ appearance_settings: newSettings, updated_at: new Date().toISOString() })
          .eq('id', user.id)
          .then(() => {});
      }
      return newSettings;
    });
  }, [user]);

  const resolvedTheme = useMemo((): 'dark' | 'light' => {
    if (settings.theme === 'system') {
      return systemColorScheme === 'light' ? 'light' : 'dark';
    }
    return settings.theme;
  }, [settings.theme, systemColorScheme]);

  const colors = useMemo(() => {
    const base = resolvedTheme === 'light' ? LightColors : DarkColors;
    let patched = base;
    if (settings.bubble_color) {
      patched = { ...patched, messageSent: settings.bubble_color };
    }
    const recvColor = getReceivedBubbleColor(settings.chat_wallpaper, resolvedTheme);
    if (recvColor) {
      patched = { ...patched, messageReceived: recvColor };
    }
    return patched;
  }, [resolvedTheme, settings.bubble_color, settings.chat_wallpaper]);

  const effectiveStep = (settings.font_size_step ?? 2) as FontSizeStep;
  const effectiveFontSize = settings.use_system_font ? 'medium' : STEP_TO_FONT_SIZE[effectiveStep];
  const effectiveFontScale = settings.use_system_font ? 1 : STEP_FONT_SCALES[effectiveStep];

  const value = useMemo((): AppearanceContextType => ({
    colors,
    fontSize: effectiveFontSize,
    fontSizeStep: effectiveStep,
    useSystemFont: settings.use_system_font ?? true,
    chatDensity: settings.chat_density,
    theme: settings.theme,
    resolvedTheme,
    fontScale: effectiveFontScale,
    chatSpacing: CHAT_SPACING[settings.chat_density],
    bubbleColor: settings.bubble_color || '',
    chatWallpaper: settings.chat_wallpaper || '',
    updateAppearance,
  }), [colors, effectiveFontSize, effectiveStep, effectiveFontScale, settings.use_system_font, settings.chat_density, settings.theme, settings.bubble_color, settings.chat_wallpaper, resolvedTheme, updateAppearance]);

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export const useAppearance = () => useContext(AppearanceContext);

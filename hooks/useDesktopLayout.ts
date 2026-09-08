import { Platform, useWindowDimensions } from 'react-native';

const DESKTOP_BREAKPOINT = 900;

export function useDesktopLayout() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
  return { isDesktop, windowWidth: width };
}

import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useFrameworkReady() {
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      (window as any).frameworkReady?.();
    }
  });
}

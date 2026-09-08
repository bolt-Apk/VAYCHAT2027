import { useRouter } from 'expo-router';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';
import { useDesktopChat } from '@/lib/desktop-chat-context';
import { useCallback } from 'react';

export function useGoBack() {
  const router = useRouter();
  const { isDesktop } = useDesktopLayout();
  const { closeSettings } = useDesktopChat();

  return useCallback(() => {
    if (isDesktop) {
      closeSettings();
    } else {
      router.back();
    }
  }, [isDesktop, closeSettings, router]);
}

import { ReactNode, useMemo, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useAppearance } from '@/lib/appearance-context';
import { useDesktopLayout } from '@/hooks/useDesktopLayout';
import { useDesktopChat } from '@/lib/desktop-chat-context';
import { ChatListContent } from '@/app/(tabs)/index';
import { ContactsListContent } from '@/app/(tabs)/contacts';
import { CallsListContent } from '@/app/(tabs)/calls';
import { ProfileContent } from '@/app/(tabs)/profile';
import DesktopSidebar from '@/components/desktop/DesktopSidebar';
import DesktopMainPanel from '@/components/desktop/DesktopMainPanel';

interface DesktopShellProps {
  children: ReactNode;
}

export default function DesktopShell({ children }: DesktopShellProps) {
  const { isDesktop } = useDesktopLayout();
  const { colors, resolvedTheme } = useAppearance();
  const { activeSidebarTab, openChat, activeChatId } = useDesktopChat();

  const pathname = usePathname();

  const fullscreenRoutes = ['/new-chat', '/channels', '/search', '/qr-code', '/call', '/setup-profile', '/login', '/support', '/terms', '/privacy', '/permissions'];
  const isFullscreenRoute = fullscreenRoutes.some(r => pathname === r || pathname.startsWith(r + '/'));

  useEffect(() => {
    if (Platform.OS !== 'web' || !isDesktop) return;
    const style = document.createElement('style');
    style.id = 'desktop-scrollbar-css';
    const thumbColor = resolvedTheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
    const thumbHover = resolvedTheme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.25)';
    style.textContent = `
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: ${thumbColor}; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: ${thumbHover}; }
      body { overscroll-behavior: none; }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById('desktop-scrollbar-css')?.remove(); };
  }, [isDesktop, resolvedTheme]);

  const sidebarContent = useMemo(() => {
    switch (activeSidebarTab) {
      case 'chats':
        return <ChatListContent onChatPress={openChat} activeChatId={activeChatId} />;
      case 'contacts':
        return <ContactsListContent onContactPress={(conversationId) => openChat(conversationId)} />;
      case 'calls':
        return <CallsListContent />;
      case 'settings':
        return <ProfileContent />;
      default:
        return <ChatListContent onChatPress={openChat} activeChatId={activeChatId} />;
    }
  }, [activeSidebarTab, openChat, activeChatId]);

  if (!isDesktop) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <DesktopSidebar>
        {sidebarContent}
      </DesktopSidebar>
      <DesktopMainPanel />
      <View pointerEvents={isFullscreenRoute ? 'auto' : 'none'} style={isFullscreenRoute ? styles.fullscreenStack : styles.hiddenStack}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  hiddenStack: {
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  fullscreenStack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
});

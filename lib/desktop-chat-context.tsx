import React, { createContext, useContext, useState, useCallback } from 'react';

export type SidebarTab = 'chats' | 'contacts' | 'calls' | 'settings';

interface DesktopChatContextValue {
  activeChatId: string | null;
  openChat: (id: string) => void;
  closeChat: () => void;
  activeSidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  activeSettingsRoute: string | null;
  openSettings: (route: string) => void;
  closeSettings: () => void;
}

const DesktopChatContext = createContext<DesktopChatContextValue>({
  activeChatId: null,
  openChat: () => {},
  closeChat: () => {},
  activeSidebarTab: 'chats',
  setSidebarTab: () => {},
  activeSettingsRoute: null,
  openSettings: () => {},
  closeSettings: () => {},
});

export function DesktopChatProvider({ children }: { children: React.ReactNode }) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('chats');
  const [activeSettingsRoute, setActiveSettingsRoute] = useState<string | null>(null);

  const openChat = useCallback((id: string) => {
    setActiveChatId(id);
    setActiveSettingsRoute(null);
  }, []);

  const closeChat = useCallback(() => {
    setActiveChatId(null);
  }, []);

  const setSidebarTab = useCallback((tab: SidebarTab) => {
    setActiveSidebarTab(tab);
  }, []);

  const openSettings = useCallback((route: string) => {
    setActiveSettingsRoute(route);
    setActiveChatId(null);
  }, []);

  const closeSettings = useCallback(() => {
    setActiveSettingsRoute(null);
  }, []);

  return (
    <DesktopChatContext.Provider value={{
      activeChatId, openChat, closeChat,
      activeSidebarTab, setSidebarTab,
      activeSettingsRoute, openSettings, closeSettings,
    }}>
      {children}
    </DesktopChatContext.Provider>
  );
}

export function useDesktopChat() {
  return useContext(DesktopChatContext);
}

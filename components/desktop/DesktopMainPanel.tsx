import { View, StyleSheet } from 'react-native';
import { useAppearance } from '@/lib/appearance-context';
import { useDesktopChat } from '@/lib/desktop-chat-context';
import { ChatViewContent } from '@/app/chat/[id]';
import DesktopEmptyState from '@/components/desktop/DesktopEmptyState';
import NotificationsScreen from '@/app/settings/notifications';
import PrivacyScreen from '@/app/settings/privacy';
import SecurityScreen from '@/app/settings/security';
import AppearanceScreen from '@/app/settings/appearance';
import StorageScreen from '@/app/settings/storage';
import HelpScreen from '@/app/settings/help';
import StarredMessagesScreen from '@/app/settings/starred';

function SettingsContent({ route, onBack }: { route: string; onBack: () => void }) {
  switch (route) {
    case '/settings/notifications':
      return <NotificationsScreen />;
    case '/settings/privacy':
      return <PrivacyScreen />;
    case '/settings/security':
      return <SecurityScreen />;
    case '/settings/appearance':
      return <AppearanceScreen />;
    case '/settings/storage':
      return <StorageScreen />;
    case '/settings/help':
      return <HelpScreen />;
    case '/settings/starred':
      return <StarredMessagesScreen />;
    default:
      return <DesktopEmptyState />;
  }
}

export default function DesktopMainPanel() {
  const { colors } = useAppearance();
  const { activeChatId, closeChat, activeSettingsRoute, closeSettings } = useDesktopChat();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background },
      ]}
    >
      {activeChatId ? (
        <ChatViewContent key={activeChatId} chatId={activeChatId} onBack={closeChat} />
      ) : activeSettingsRoute ? (
        <SettingsContent key={activeSettingsRoute} route={activeSettingsRoute} onBack={closeSettings} />
      ) : (
        <DesktopEmptyState />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
});

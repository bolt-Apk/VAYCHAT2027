import { Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from './supabase';

let _activeChatId: string | null = null;
let _incomingCallHandledInApp = false;
let _badgeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function setActiveChatId(id: string | null) {
  _activeChatId = id;
}

export function getActiveChatId(): string | null {
  return _activeChatId;
}

export function setCallHandledInApp(handled: boolean) {
  _incomingCallHandledInApp = handled;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    if (data?.type === 'call') {
      const appInForeground = AppState.currentState === 'active';
      if (appInForeground && _incomingCallHandledInApp) {
        return {
          shouldShowAlert: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: false,
          shouldShowList: false,
        };
      }
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    }
    if (data?.conversation_id && data.conversation_id === _activeChatId) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

export async function registerForPushNotifications(userId: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  await Notifications.setNotificationCategoryAsync('message', [
    {
      identifier: 'reply',
      buttonTitle: 'Ответить',
      options: { opensAppToForeground: false },
      textInput: { submitButtonTitle: 'Отправить', placeholder: 'Введите сообщение...' },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('story', [
    { identifier: 'view', buttonTitle: 'Посмотреть', options: { opensAppToForeground: true } },
  ]);

  await Notifications.setNotificationCategoryAsync('story_reply', [
    {
      identifier: 'reply',
      buttonTitle: 'Ответить',
      options: { opensAppToForeground: false },
      textInput: { submitButtonTitle: 'Отправить', placeholder: 'Ответ на статус...' },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('reaction', [
    { identifier: 'view', buttonTitle: 'Посмотреть', options: { opensAppToForeground: true } },
  ]);

  await Notifications.setNotificationCategoryAsync('contact_joined', [
    { identifier: 'view', buttonTitle: 'Посмотреть', options: { opensAppToForeground: true } },
  ]);

  await Notifications.setNotificationCategoryAsync('incoming_call', [
    { identifier: 'accept', buttonTitle: 'Принять', options: { opensAppToForeground: true } },
    { identifier: 'decline', buttonTitle: 'Отклонить', options: { isDestructive: true, opensAppToForeground: false } },
  ]);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('incoming_calls', {
      name: 'Входящие звонки',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 500, 200, 500, 200, 500],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      enableVibrate: true,
      enableLights: true,
    });

    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Сообщения',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      enableVibrate: true,
      enableLights: true,
    });

    await Notifications.setNotificationChannelAsync('reactions', {
      name: 'Реакции',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      enableVibrate: false,
    });

    await Notifications.setNotificationChannelAsync('stories', {
      name: 'Статусы',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      enableVibrate: false,
    });

    await Notifications.setNotificationChannelAsync('contacts', {
      name: 'Контакты',
      importance: Notifications.AndroidImportance.LOW,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      enableVibrate: false,
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? '',
  });

  const token = tokenData.data;

  const platform = Platform.OS;
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token, platform, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' }
    );

  if (error) {
    console.error('Failed to save push token:', error);
  }

  return token;
}

export async function updateBadgeCount(userId: string) {
  if (Platform.OS === 'web') return;

  if (_badgeDebounceTimer) clearTimeout(_badgeDebounceTimer);

  _badgeDebounceTimer = setTimeout(async () => {
    _badgeDebounceTimer = null;
    try {
      const { data, error } = await supabase.rpc('get_unread_counts' as any, {
        p_user_id: userId,
        p_conversation_ids: [],
      });

      if (error) {
        const { data: memberships } = await supabase
          .from('conversation_members')
          .select('conversation_id, last_read_at')
          .eq('user_id', userId);

        if (!memberships?.length) {
          await Notifications.setBadgeCountAsync(0);
          return;
        }

        let total = 0;
        const batchSize = 10;
        for (let i = 0; i < memberships.length; i += batchSize) {
          const chunk = memberships.slice(i, i + batchSize);
          const counts = await Promise.all(
            chunk.map(async (m) => {
              let query = supabase
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('conversation_id', m.conversation_id)
                .neq('sender_id', userId)
                .is('deleted_at', null);
              if (m.last_read_at) query = query.gt('created_at', m.last_read_at);
              const { count } = await query;
              return count || 0;
            })
          );
          total += counts.reduce((a, b) => a + b, 0);
        }
        await Notifications.setBadgeCountAsync(total);
        return;
      }

      let total = 0;
      if (Array.isArray(data)) {
        data.forEach((r: any) => { total += r.cnt || 0; });
      }
      await Notifications.setBadgeCountAsync(total);
    } catch (err) {
      console.warn('updateBadgeCount failed:', err);
    }
  }, 500);
}

export async function dismissChatNotifications(conversationId: string) {
  if (Platform.OS === 'web') return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    const toRemove = presented.filter(
      (n) => n.request.content.data?.conversation_id === conversationId
    );
    await Promise.all(
      toRemove.map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
  } catch (err) {
    console.warn('dismissChatNotifications failed:', err);
  }
}

export async function clearBadge() {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch (err) {
    console.warn('clearBadge failed:', err);
  }
}

export async function unregisterPushToken(userId: string) {
  if (Platform.OS === 'web') return;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? '',
    });

    await supabase
      .from('push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', tokenData.data);
  } catch (err) {
    console.warn('unregisterPushToken failed:', err);
  }
}

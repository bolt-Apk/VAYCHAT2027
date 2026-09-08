import { useState, useEffect } from 'react';
import { Platform } from 'react-native';

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => setIsConnected(navigator.onLine);
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }

    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const NetInfo = (await import('@react-native-community/netinfo')).default;
        unsubscribe = NetInfo.addEventListener((state) => {
          setIsConnected(state.isConnected ?? true);
        });
      } catch {}
    })();
    return () => { unsubscribe?.(); };
  }, []);

  return isConnected;
}

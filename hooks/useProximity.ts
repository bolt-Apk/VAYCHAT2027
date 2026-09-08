import { useEffect, useRef } from 'react';
import { Platform, NativeModules, DeviceEventEmitter } from 'react-native';

export type ProximityState = 'near' | 'far' | 'unknown';

interface ProximityApi {
  addListener: ((cb: (e: { proximity: boolean }) => void) => any) | null;
  removeListener: ((listener: any) => void) | null;
}

let proximityApi: ProximityApi | null = null;

try {
  const RNProximity = NativeModules.RNProximity;
  if (Platform.OS === 'ios' && RNProximity) {
    proximityApi = {
      addListener: (callback) => {
        RNProximity.proximityEnabled(true);
        return DeviceEventEmitter.addListener('proximityStateDidChange', callback);
      },
      removeListener: (listener) => {
        RNProximity.proximityEnabled(false);
        DeviceEventEmitter.removeAllListeners('proximityStateDidChange');
      },
    };
  } else if (Platform.OS === 'android' && RNProximity) {
    proximityApi = {
      addListener: (callback) => {
        RNProximity.addListener();
        return DeviceEventEmitter.addListener(RNProximity.EVENT_ON_SENSOR_CHANGE, (e: any) => callback(e));
      },
      removeListener: () => {
        RNProximity.removeListener();
        DeviceEventEmitter.removeAllListeners(RNProximity.EVENT_ON_SENSOR_CHANGE);
      },
    };
  }
} catch {
  proximityApi = null;
}

export function isProximityAvailable(): boolean {
  return proximityApi !== null;
}

export function useProximity(onProximity: (near: boolean) => void) {
  const callbackRef = useRef(onProximity);
  callbackRef.current = onProximity;

  useEffect(() => {
    if (!proximityApi?.addListener) return;

    let listener: any = null;
    try {
      listener = proximityApi.addListener((e) => {
        try {
          callbackRef.current(!!e.proximity);
        } catch {}
      });
    } catch {
      return;
    }

    return () => {
      if (proximityApi?.removeListener && listener) {
        try {
          proximityApi.removeListener(listener);
        } catch {}
      }
    };
  }, []);
}

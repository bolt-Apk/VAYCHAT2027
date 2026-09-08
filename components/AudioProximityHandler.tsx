import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import { useProximity, isProximityAvailable } from '@/hooks/useProximity';
import { useVoicePlayer } from '@/lib/voice-player';
import { useActiveCall } from '@/app/_layout';

export default function AudioProximityHandler() {
  const { state } = useVoicePlayer();
  const { activeCall } = useActiveCall();
  const playingRef = useRef(state.playing);
  playingRef.current = state.playing;
  const nearRef = useRef(false);
  const inCallRef = useRef(!!activeCall);
  inCallRef.current = !!activeCall;

  const applyRouting = async (near: boolean) => {
    if (Platform.OS === 'web') return;
    try {
      if (near) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          playThroughEarpieceAndroid: true,
        });
      } else {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          playThroughEarpieceAndroid: false,
        });
      }
    } catch (err) {
      console.warn('[AudioProximity] routing failed:', err);
    }
  };

  useProximity((near) => {
    nearRef.current = near;
    if (!playingRef.current) return;
    if (inCallRef.current) return;
    void applyRouting(near);
  });

  useEffect(() => {
    if (!state.playing) {
      if (nearRef.current && !inCallRef.current) {
        void applyRouting(false);
        nearRef.current = false;
      }
    }
  }, [state.playing]);

  useEffect(() => {
    if (activeCall && nearRef.current) {
      void applyRouting(false);
      nearRef.current = false;
    }
  }, [activeCall]);

  return null;
}

export { isProximityAvailable };

import { Platform } from 'react-native';

let AudioModule: any = null;
if (Platform.OS !== 'web') {
  try {
    AudioModule = require('expo-av').Audio;
  } catch {}
}

export type RingtoneType = 'incoming' | 'outgoing' | 'busy' | 'end';

interface RingtoneController {
  start: () => void;
  stop: () => void;
}

export function createRingtone(type: RingtoneType): RingtoneController {
  if (Platform.OS === 'web') {
    return createWebRingtone(type);
  }
  return createNativeRingtone(type);
}

// --------------- Web (AudioContext oscillator synthesis) ---------------

function createWebRingtone(type: RingtoneType): RingtoneController {
  let ctx: AudioContext | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const getCtx = () => {
    if (!ctx || ctx.state === 'closed') {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new Ctor();
    }
    return ctx;
  };

  const playTone = (freq: number, dur: number, vol: number, delay = 0, wave: OscillatorType = 'sine') => {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, c.currentTime + delay);
    gain.gain.setValueAtTime(vol, c.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + dur);
  };

  const playDualTone = (f1: number, f2: number, dur: number, vol: number, delay = 0) => {
    playTone(f1, dur, vol, delay);
    playTone(f2, dur, vol * 0.8, delay);
  };

  const patterns: Record<RingtoneType, { play: () => void; intervalMs: number }> = {
    incoming: {
      play: () => {
        // Two-tone ascending ring (like a classic phone ring)
        playDualTone(440, 480, 0.4, 0.14);
        playDualTone(523, 587, 0.4, 0.14, 0.5);
        playDualTone(440, 480, 0.4, 0.14, 1.2);
        playDualTone(523, 587, 0.4, 0.14, 1.7);
      },
      intervalMs: 3500,
    },
    outgoing: {
      play: () => {
        // Standard ringback tone (ITU recommendation: 440+480 Hz)
        playDualTone(440, 480, 1.0, 0.10);
      },
      intervalMs: 4000,
    },
    busy: {
      play: () => {
        // Busy signal (480+620 Hz, short bursts)
        playDualTone(480, 620, 0.25, 0.12);
        playDualTone(480, 620, 0.25, 0.12, 0.5);
      },
      intervalMs: 1000,
    },
    end: {
      play: () => {
        // Short descending beep signaling call end
        playTone(620, 0.15, 0.10);
        playTone(480, 0.15, 0.10, 0.16);
        playTone(380, 0.25, 0.08, 0.32);
      },
      intervalMs: 0,
    },
  };

  const start = () => {
    if (running) return;
    running = true;
    try {
      const p = patterns[type];
      p.play();
      if (p.intervalMs > 0) {
        interval = setInterval(() => {
          if (running) p.play();
        }, p.intervalMs);
      }
    } catch {}
  };

  const stop = () => {
    running = false;
    if (interval) { clearInterval(interval); interval = null; }
    if (ctx) { ctx.close().catch(() => {}); ctx = null; }
  };

  return { start, stop };
}

// --------------- Native (expo-av WAV generation) ---------------

function generateWavDataUri(frequencies: number[], durationSec: number, volume = 0.3): string {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, Math.min(t * 50, (durationSec - t) * 50));
    let sample = 0;
    for (const freq of frequencies) {
      sample += Math.sin(2 * Math.PI * freq * t);
    }
    sample = (sample / frequencies.length) * volume * envelope;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, intSample, true);
  }

  const bytes = new Uint8Array(buffer);
  return uint8ToBase64DataUri(bytes);
}

function uint8ToBase64DataUri(bytes: Uint8Array): string {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = 'data:audio/wav;base64,';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += CHARS[a >> 2];
    result += CHARS[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < bytes.length ? CHARS[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < bytes.length ? CHARS[c & 63] : '=';
  }
  return result;
}

interface ToneSegment {
  frequencies: number[];
  duration: number;
  volume: number;
}

function generateCompositeToneUri(segments: ToneSegment[]): string {
  const sampleRate = 22050;
  let totalSamples = 0;
  for (const seg of segments) totalSamples += Math.floor(sampleRate * seg.duration);

  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  let sampleOffset = 0;
  for (const seg of segments) {
    const n = Math.floor(sampleRate * seg.duration);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const fadeIn = Math.min(1, t * 80);
      const fadeOut = Math.min(1, (seg.duration - t) * 80);
      const envelope = fadeIn * fadeOut;
      let sample = 0;
      for (const freq of seg.frequencies) {
        if (freq === 0) continue;
        sample += Math.sin(2 * Math.PI * freq * t);
      }
      const divisor = seg.frequencies.filter(f => f > 0).length || 1;
      sample = (sample / divisor) * seg.volume * envelope;
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      view.setInt16(44 + (sampleOffset + i) * 2, intSample, true);
    }
    sampleOffset += n;
  }

  const bytes = new Uint8Array(buffer);
  return uint8ToBase64DataUri(bytes);
}

const toneConfigs: Record<RingtoneType, { uri: string; loopIntervalMs: number }> = {
  incoming: {
    uri: generateCompositeToneUri([
      { frequencies: [440, 480], duration: 0.4, volume: 0.35 },
      { frequencies: [0], duration: 0.1, volume: 0 },
      { frequencies: [523, 587], duration: 0.4, volume: 0.35 },
      { frequencies: [0], duration: 0.3, volume: 0 },
      { frequencies: [440, 480], duration: 0.4, volume: 0.35 },
      { frequencies: [0], duration: 0.1, volume: 0 },
      { frequencies: [523, 587], duration: 0.4, volume: 0.35 },
      { frequencies: [0], duration: 1.0, volume: 0 },
    ]),
    loopIntervalMs: 3100,
  },
  outgoing: {
    uri: generateCompositeToneUri([
      { frequencies: [440, 480], duration: 1.0, volume: 0.25 },
      { frequencies: [0], duration: 3.0, volume: 0 },
    ]),
    loopIntervalMs: 4000,
  },
  busy: {
    uri: generateCompositeToneUri([
      { frequencies: [480, 620], duration: 0.25, volume: 0.30 },
      { frequencies: [0], duration: 0.25, volume: 0 },
      { frequencies: [480, 620], duration: 0.25, volume: 0.30 },
      { frequencies: [0], duration: 0.25, volume: 0 },
    ]),
    loopIntervalMs: 1000,
  },
  end: {
    uri: generateCompositeToneUri([
      { frequencies: [620], duration: 0.15, volume: 0.25 },
      { frequencies: [480], duration: 0.15, volume: 0.25 },
      { frequencies: [380], duration: 0.25, volume: 0.20 },
    ]),
    loopIntervalMs: 0,
  },
};

function createNativeRingtone(type: RingtoneType): RingtoneController {
  let sound: any = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const config = toneConfigs[type];

  const playOnce = async () => {
    if (stopped || !AudioModule) return;
    try {
      await AudioModule.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: type !== 'incoming',
        playThroughEarpieceAndroid: false,
      });

      if (sound) {
        try { await sound.unloadAsync(); } catch {}
        sound = null;
      }

      const { sound: s } = await AudioModule.Sound.createAsync(
        { uri: config.uri },
        {
          shouldPlay: true,
          volume: type === 'incoming' ? 0.9 : type === 'outgoing' ? 0.5 : 0.6,
          isLooping: false,
        }
      );
      sound = s;
    } catch {}
  };

  const start = () => {
    stopped = false;
    playOnce();
    if (config.loopIntervalMs > 0) {
      interval = setInterval(() => {
        if (!stopped) playOnce();
      }, config.loopIntervalMs);
    }
  };

  const stop = () => {
    stopped = true;
    if (interval) { clearInterval(interval); interval = null; }
    if (sound) {
      const s = sound;
      sound = null;
      s.stopAsync().catch(() => {}).finally(() => s.unloadAsync().catch(() => {}));
    }
  };

  return { start, stop };
}

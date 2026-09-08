import { Platform } from 'react-native';
import { Audio } from 'expo-av';

let FileSystem: { cacheDirectory: string | null; getInfoAsync: any; writeAsStringAsync: any; EncodingType: any } | null = null;
if (Platform.OS !== 'web') {
  try { FileSystem = require('expo-file-system'); } catch {}
}

let Haptics: typeof import('expo-haptics') | null = null;
if (Platform.OS !== 'web') {
  try { Haptics = require('expo-haptics'); } catch {}
}

let _vibrationEnabled = true;
let _soundEnabled = true;

export function setVibrationEnabled(enabled: boolean) { _vibrationEnabled = enabled; }
export function setSoundEnabled(enabled: boolean) { _soundEnabled = enabled; }

// ---------------------------------------------------------------------------
// Web AudioContext helpers
// ---------------------------------------------------------------------------

const audioCtxRef: { current: AudioContext | null } = { current: null };

function getAudioCtx(): AudioContext | null {
  if (Platform.OS !== 'web') return null;
  if (!audioCtxRef.current) {
    audioCtxRef.current = new AudioContext();
  }
  if (audioCtxRef.current.state === 'suspended') {
    audioCtxRef.current.resume().catch(() => {});
  }
  return audioCtxRef.current;
}

function playTone(freq: number, duration: number, volume = 0.15, type: OscillatorType = 'sine') {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playMultiTone(tones: { freq: number; dur: number; delay: number; vol?: number; type?: OscillatorType }[]) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  for (const t of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = t.type || 'sine';
    const start = ctx.currentTime + t.delay;
    osc.frequency.setValueAtTime(t.freq, start);
    gain.gain.setValueAtTime(t.vol ?? 0.10, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + t.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + t.dur);
  }
}

// ---------------------------------------------------------------------------
// WAV synthesis (for native playback via expo-av)
// ---------------------------------------------------------------------------

function synthesizeWavBytes(
  tones: { f: number; start: number; end: number; vol?: number; wave?: 'sine' | 'triangle' }[],
  sampleRate = 22050,
): Uint8Array {
  let totalDur = 0;
  for (const t of tones) if (t.end > totalDur) totalDur = t.end;
  const numSamples = Math.ceil(totalDur * sampleRate);
  const samples = new Float32Array(numSamples);

  for (const t of tones) {
    const s0 = Math.floor(t.start * sampleRate);
    const s1 = Math.min(Math.floor(t.end * sampleRate), numSamples);
    const dur = s1 - s0;
    const vol = t.vol ?? 0.12;
    const isTriangle = t.wave === 'triangle';
    for (let i = s0; i < s1; i++) {
      const phase = ((i - s0) / sampleRate) * t.f * 2 * Math.PI;
      const env = 1 - ((i - s0) / dur);
      const envShaped = env * env;
      const raw = isTriangle
        ? (2 / Math.PI) * Math.asin(Math.sin(phase))
        : Math.sin(phase);
      samples[i] += raw * vol * envShaped;
    }
  }

  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// Modern premium sound definitions
// ---------------------------------------------------------------------------

// Send: warm ascending C5-E5-G5 chord with triangle wave, ~180ms
const SEND_TONES = [
  { f: 523, start: 0, end: 0.10, vol: 0.10, wave: 'triangle' as const },
  { f: 659, start: 0.04, end: 0.14, vol: 0.09, wave: 'triangle' as const },
  { f: 784, start: 0.08, end: 0.18, vol: 0.07, wave: 'sine' as const },
];

// Receive: gentle descending G5-E5 bell-like, ~200ms
const RECEIVE_TONES = [
  { f: 784, start: 0, end: 0.10, vol: 0.08, wave: 'triangle' as const },
  { f: 659, start: 0.06, end: 0.18, vol: 0.07, wave: 'sine' as const },
  { f: 523, start: 0.12, end: 0.22, vol: 0.05, wave: 'sine' as const },
];

// Record start: soft ascending blip
const REC_START_TONES = [
  { f: 440, start: 0, end: 0.06, vol: 0.12, wave: 'triangle' as const },
  { f: 660, start: 0.03, end: 0.10, vol: 0.10, wave: 'sine' as const },
  { f: 880, start: 0.06, end: 0.13, vol: 0.07, wave: 'sine' as const },
];

// Record send: bright confirmation chirp
const REC_SEND_TONES = [
  { f: 660, start: 0, end: 0.06, vol: 0.10, wave: 'triangle' as const },
  { f: 880, start: 0.04, end: 0.10, vol: 0.09, wave: 'triangle' as const },
  { f: 1100, start: 0.08, end: 0.16, vol: 0.06, wave: 'sine' as const },
];

// Record cancel: gentle descending swoosh
const REC_CANCEL_TONES = [
  { f: 550, start: 0, end: 0.08, vol: 0.10, wave: 'sine' as const },
  { f: 400, start: 0.04, end: 0.13, vol: 0.09, wave: 'sine' as const },
  { f: 280, start: 0.08, end: 0.18, vol: 0.07, wave: 'sine' as const },
];

// Record lock: short double-tap
const REC_LOCK_TONES = [
  { f: 700, start: 0, end: 0.04, vol: 0.09, wave: 'triangle' as const },
  { f: 700, start: 0.06, end: 0.10, vol: 0.09, wave: 'triangle' as const },
];

// ---------------------------------------------------------------------------
// Native sound playback (write WAV to cache, play via expo-av)
// ---------------------------------------------------------------------------

type SoundKey = 'send' | 'receive' | 'recStart' | 'recSend' | 'recCancel' | 'recLock';

const TONE_DEFS: Record<SoundKey, typeof SEND_TONES> = {
  send: SEND_TONES,
  receive: RECEIVE_TONES,
  recStart: REC_START_TONES,
  recSend: REC_SEND_TONES,
  recCancel: REC_CANCEL_TONES,
  recLock: REC_LOCK_TONES,
};

const nativeSoundCache: Record<string, Audio.Sound | null> = {};
const filePathCache: Record<string, string> = {};
let audioModeSet = false;

async function ensureAudioMode() {
  if (audioModeSet || Platform.OS === 'web') return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: 1,
      interruptionModeAndroid: 1,
    });
    audioModeSet = true;
  } catch {}
}

async function getWavFilePath(key: SoundKey): Promise<string | null> {
  if (filePathCache[key]) return filePathCache[key];
  if (!FileSystem?.cacheDirectory) return null;

  const filePath = `${FileSystem.cacheDirectory}vaychat_${key}.wav`;
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists) {
      filePathCache[key] = filePath;
      return filePath;
    }
  } catch {}

  try {
    const wavBytes = synthesizeWavBytes(TONE_DEFS[key]);
    let binary = '';
    for (let i = 0; i < wavBytes.length; i++) binary += String.fromCharCode(wavBytes[i]);
    const b64 = btoa(binary);
    await FileSystem.writeAsStringAsync(filePath, b64, { encoding: 'base64' as any });
    filePathCache[key] = filePath;
    return filePath;
  } catch {
    return null;
  }
}

async function playNativeSound(key: SoundKey) {
  if (!_soundEnabled) return;

  const cached = nativeSoundCache[key];
  if (cached) {
    try {
      const status = await cached.getStatusAsync();
      if (status.isLoaded) {
        await cached.setPositionAsync(0);
        await cached.playAsync();
        return;
      }
    } catch {}
    nativeSoundCache[key] = null;
  }

  await ensureAudioMode();
  const path = await getWavFilePath(key);
  if (!path) return;

  try {
    const { sound } = await Audio.Sound.createAsync(
      { uri: path },
      { shouldPlay: true, volume: 0.7 },
    );
    nativeSoundCache[key] = sound;
  } catch {}
}

// ---------------------------------------------------------------------------
// Web sound helpers (modern tones)
// ---------------------------------------------------------------------------

function playWebTones(tones: typeof SEND_TONES) {
  if (!_soundEnabled) return;
  const mapped = tones.map(t => ({
    freq: t.f,
    dur: t.end - t.start,
    delay: t.start,
    vol: t.vol,
    type: (t.wave === 'triangle' ? 'triangle' : 'sine') as OscillatorType,
  }));
  playMultiTone(mapped);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function playSendSound() {
  if (!_soundEnabled) return;
  if (Platform.OS === 'web') {
    playWebTones(SEND_TONES);
  } else {
    playNativeSound('send');
  }
}

export function playReceiveSound() {
  if (!_soundEnabled) return;
  if (Platform.OS === 'web') {
    playWebTones(RECEIVE_TONES);
  } else {
    playNativeSound('receive');
  }
}

export function playRecordStartSound() {
  if (!_soundEnabled) return;
  if (Platform.OS === 'web') {
    playWebTones(REC_START_TONES);
  } else {
    playNativeSound('recStart');
  }
  hapticMedium();
}

export function playRecordSendSound() {
  if (!_soundEnabled) return;
  if (Platform.OS === 'web') {
    playWebTones(REC_SEND_TONES);
  } else {
    playNativeSound('recSend');
  }
  hapticLight();
}

export function playRecordCancelSound() {
  if (!_soundEnabled) return;
  if (Platform.OS === 'web') {
    playWebTones(REC_CANCEL_TONES);
  } else {
    playNativeSound('recCancel');
  }
  hapticHeavy();
}

export function playRecordLockSound() {
  if (!_soundEnabled) return;
  if (Platform.OS === 'web') {
    playWebTones(REC_LOCK_TONES);
  } else {
    playNativeSound('recLock');
  }
  hapticLight();
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

export function hapticLight() {
  if (!_vibrationEnabled) return;
  if (Platform.OS === 'web') {
    try { if (navigator.vibrate) navigator.vibrate(8); } catch {}
  } else if (Haptics) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

export function hapticMedium() {
  if (!_vibrationEnabled) return;
  if (Platform.OS === 'web') {
    try { if (navigator.vibrate) navigator.vibrate(15); } catch {}
  } else if (Haptics) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }
}

export function hapticHeavy() {
  if (!_vibrationEnabled) return;
  if (Platform.OS === 'web') {
    try { if (navigator.vibrate) navigator.vibrate([20, 30, 20]); } catch {}
  } else if (Haptics) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }
}

let lastKeyHaptic = 0;
export function hapticKeypress() {
  if (!_vibrationEnabled) return;
  const now = Date.now();
  if (now - lastKeyHaptic < 60) return;
  lastKeyHaptic = now;
  if (Platform.OS === 'web') {
    try { if (navigator.vibrate) navigator.vibrate(4); } catch {}
  } else if (Haptics) {
    Haptics.selectionAsync().catch(() => {});
  }
}

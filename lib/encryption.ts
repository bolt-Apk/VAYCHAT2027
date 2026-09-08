import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as ExpoCrypto from 'expo-crypto';

const PRIVATE_KEY_STORAGE = '@vaychat_e2e_private_key';
const PUBLIC_KEY_STORAGE = '@vaychat_e2e_public_key';
const E2E_ENABLED_KEY = '@vaychat_e2e_enabled';
const SHARED_SECRET_CACHE = new Map<string, CryptoKey>();

function getSubtleCrypto(): SubtleCrypto | null {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    return globalThis.crypto.subtle;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  return null;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += BASE64_CHARS[a >> 2];
    result += BASE64_CHARS[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < bytes.length ? BASE64_CHARS[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < bytes.length ? BASE64_CHARS[c & 63] : '=';
  }
  return result;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64_CHARS.indexOf(clean[i]);
    const b = BASE64_CHARS.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? BASE64_CHARS.indexOf(clean[i + 2]) : 0;
    const d = i + 3 < clean.length ? BASE64_CHARS.indexOf(clean[i + 3]) : 0;
    bytes[p++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes.buffer;
}

export interface E2EKeyPair {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export async function generateKeyPair(): Promise<E2EKeyPair | null> {
  const subtle = getSubtleCrypto();
  if (!subtle) return null;

  const keyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await subtle.exportKey('jwk', keyPair.privateKey);

  return { publicKeyJwk, privateKeyJwk };
}

export async function saveKeyPair(pair: E2EKeyPair): Promise<void> {
  await AsyncStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify(pair.privateKeyJwk));
  await AsyncStorage.setItem(PUBLIC_KEY_STORAGE, JSON.stringify(pair.publicKeyJwk));
}

export async function getStoredPublicKey(): Promise<JsonWebKey | null> {
  const stored = await AsyncStorage.getItem(PUBLIC_KEY_STORAGE);
  if (!stored) return null;
  return JSON.parse(stored);
}

export async function getStoredPrivateKey(): Promise<JsonWebKey | null> {
  const stored = await AsyncStorage.getItem(PRIVATE_KEY_STORAGE);
  if (!stored) return null;
  return JSON.parse(stored);
}

export async function hasKeyPair(): Promise<boolean> {
  const pk = await AsyncStorage.getItem(PRIVATE_KEY_STORAGE);
  return pk !== null;
}

async function deriveSharedSecret(myPrivateJwk: JsonWebKey, theirPublicJwk: JsonWebKey): Promise<CryptoKey | null> {
  const subtle = getSubtleCrypto();
  if (!subtle) return null;

  const privateKey = await subtle.importKey(
    'jwk',
    myPrivateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );

  const publicKey = await subtle.importKey(
    'jwk',
    theirPublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );

  const aesKey = await subtle.importKey(
    'raw',
    sharedBits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return aesKey;
}

async function getSharedKey(theirPublicKeyJwk: JsonWebKey): Promise<CryptoKey | null> {
  const cacheKey = theirPublicKeyJwk.x! + theirPublicKeyJwk.y!;
  const cached = SHARED_SECRET_CACHE.get(cacheKey);
  if (cached) return cached;

  const myPrivateJwk = await getStoredPrivateKey();
  if (!myPrivateJwk) return null;

  const key = await deriveSharedSecret(myPrivateJwk, theirPublicKeyJwk);
  if (key) {
    SHARED_SECRET_CACHE.set(cacheKey, key);
  }
  return key;
}

export function clearSharedSecretCache(): void {
  SHARED_SECRET_CACHE.clear();
}

export async function isE2EEnabled(): Promise<boolean> {
  const val = await AsyncStorage.getItem(E2E_ENABLED_KEY);
  return val === 'true';
}

export async function setE2EEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(E2E_ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function encryptMessage(theirPublicKeyJwk: JsonWebKey, plaintext: string): Promise<string> {
  const subtle = getSubtleCrypto();
  if (!subtle) return plaintext;

  try {
    const aesKey = await getSharedKey(theirPublicKeyJwk);
    if (!aesKey) return plaintext;

    const iv = new Uint8Array(ExpoCrypto.getRandomBytes(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);

    const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return `e2e:${arrayBufferToBase64(combined.buffer)}`;
  } catch {
    return plaintext;
  }
}

export async function decryptMessage(theirPublicKeyJwk: JsonWebKey, content: string): Promise<string> {
  if (!content.startsWith('e2e:')) return content;

  const subtle = getSubtleCrypto();
  if (!subtle) return '\u{1f512} Зашифрованное сообщение (нет ключа)';

  try {
    const aesKey = await getSharedKey(theirPublicKeyJwk);
    if (!aesKey) return '\u{1f512} Зашифрованное сообщение (нет ключа)';

    const combined = new Uint8Array(base64ToArrayBuffer(content.slice(4)));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return '\u{1f512} Не удалось расшифровать';
  }
}

export function isEncryptedMessage(content: string): boolean {
  return content.startsWith('e2e:');
}

export function computeSafetyNumber(myPublicJwk: JsonWebKey, theirPublicJwk: JsonWebKey): string {
  const myPart = (myPublicJwk.x || '') + (myPublicJwk.y || '');
  const theirPart = (theirPublicJwk.x || '') + (theirPublicJwk.y || '');
  const sorted = [myPart, theirPart].sort();
  const combined = sorted[0] + sorted[1];

  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  const digits = Math.abs(hash).toString().padStart(12, '0').slice(0, 12);
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`;
}

export async function exportKeyBackup(password: string): Promise<string | null> {
  const subtle = getSubtleCrypto();
  if (!subtle) return null;

  const privateJwk = await getStoredPrivateKey();
  const publicJwk = await getStoredPublicKey();
  if (!privateJwk || !publicJwk) return null;

  try {
    const payload = JSON.stringify({ privateKey: privateJwk, publicKey: publicJwk });
    const salt = new Uint8Array(ExpoCrypto.getRandomBytes(16));
    const iv = new Uint8Array(ExpoCrypto.getRandomBytes(12));

    const keyMaterial = await subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const derivedKey = await subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      new TextEncoder().encode(payload)
    );

    const result = new Uint8Array(salt.length + iv.length + new Uint8Array(encrypted).length);
    result.set(salt);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);

    return `vay-backup:${arrayBufferToBase64(result.buffer)}`;
  } catch {
    return null;
  }
}

export async function importKeyBackup(backup: string, password: string): Promise<boolean> {
  const subtle = getSubtleCrypto();
  if (!subtle || !backup.startsWith('vay-backup:')) return false;

  try {
    const data = new Uint8Array(base64ToArrayBuffer(backup.slice(11)));
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const ciphertext = data.slice(28);

    const keyMaterial = await subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const derivedKey = await subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      ciphertext
    );

    const payload = JSON.parse(new TextDecoder().decode(decrypted));
    if (!payload.privateKey || !payload.publicKey) return false;

    await saveKeyPair({ privateKeyJwk: payload.privateKey, publicKeyJwk: payload.publicKey });
    clearSharedSecretCache();
    return true;
  } catch {
    return false;
  }
}

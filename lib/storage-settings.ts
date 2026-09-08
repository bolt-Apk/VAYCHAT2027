import AsyncStorage from '@react-native-async-storage/async-storage';

export interface NetworkDownloadCfg {
  photos: boolean;
  videos: boolean;
  files: boolean;
  maxPhotoMb: number;
  maxVideoMb: number;
  maxFileMb: number;
}

export interface StorageSettings {
  autoDownloadMobile: NetworkDownloadCfg;
  autoDownloadWifi: NetworkDownloadCfg;
  reducedCallTraffic: boolean;
}

const STORAGE_KEY = 'storage_settings';

const DEFAULTS: StorageSettings = {
  autoDownloadMobile: { photos: true, videos: false, files: false, maxPhotoMb: 10, maxVideoMb: 10, maxFileMb: 1 },
  autoDownloadWifi: { photos: true, videos: true, files: true, maxPhotoMb: 50, maxVideoMb: 50, maxFileMb: 10 },
  reducedCallTraffic: false,
};

let _cached: StorageSettings | null = null;

export async function getStorageSettings(): Promise<StorageSettings> {
  if (_cached) return _cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const result: StorageSettings = {
        ...DEFAULTS,
        ...parsed,
        autoDownloadMobile: { ...DEFAULTS.autoDownloadMobile, ...parsed.autoDownloadMobile },
        autoDownloadWifi: { ...DEFAULTS.autoDownloadWifi, ...parsed.autoDownloadWifi },
      };
      _cached = result;
      return result;
    }
  } catch {}
  _cached = DEFAULTS;
  return _cached;
}

export function invalidateStorageSettingsCache() {
  _cached = null;
}

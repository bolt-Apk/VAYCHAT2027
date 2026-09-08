import { createContext, useContext, useMemo, useEffect, useState, ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';

export type PerformanceTier = 'low' | 'medium' | 'high';

export interface DeviceCapabilities {
  tier: PerformanceTier;
  cores: number;
  memoryMb: number | null;
  isLowEnd: boolean;
  isHighEnd: boolean;
  platform: 'ios' | 'android' | 'web';
  isMobileWeb: boolean;
  reducedMotion: boolean;
  imageQuality: number;
  enableBlur: boolean;
  enableShimmer: boolean;
  maxConcurrentDecoders: number;
  videoPreload: 'auto' | 'metadata' | 'none';
  listInitialRender: number;
  listWindowRender: number;
}

const defaults: DeviceCapabilities = {
  tier: 'medium',
  cores: 4,
  memoryMb: null,
  isLowEnd: false,
  isHighEnd: true,
  platform: Platform.OS as any,
  isMobileWeb: false,
  reducedMotion: false,
  imageQuality: 0.85,
  enableBlur: true,
  enableShimmer: true,
  maxConcurrentDecoders: 4,
  videoPreload: 'auto',
  listInitialRender: 12,
  listWindowRender: 6,
};

const PerformanceContext = createContext<DeviceCapabilities>(defaults);

function detectWebTier(): PerformanceTier {
  if (typeof navigator === 'undefined') return 'medium';
  const mem = (navigator as any).deviceMemory as number | undefined;
  const cores = navigator.hardwareConcurrency || 4;
  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|YaBrowser.*Mobile/i.test(ua);
  const slowCores = cores <= 2;
  const lowMem = typeof mem === 'number' && mem <= 2;
  if (isMobile && (slowCores || lowMem)) return 'low';
  if (isMobile) return 'medium';
  if (cores >= 8 && (mem === undefined || mem >= 8)) return 'high';
  if (slowCores || lowMem) return 'low';
  return 'medium';
}

function detectNativeTier(): PerformanceTier {
  const cores = (Device as any).cpuCount || 4;
  const mem = Device.totalMemory;
  const lowMem = mem !== null && mem < 3 * 1024;
  if (cores <= 2 || lowMem) return 'low';
  if (cores >= 6 && (mem === null || mem >= 6 * 1024)) return 'high';
  return 'medium';
}

function tierToCapabilities(tier: PerformanceTier, platform: string, reducedMotion: boolean): DeviceCapabilities {
  const isMobileWeb = platform === 'web' && typeof navigator !== 'undefined' &&
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  const cores = platform === 'web'
    ? (navigator.hardwareConcurrency || 4)
    : ((Device as any).cpuCount || 4);
  const memoryMb = platform === 'web'
    ? ((navigator as any).deviceMemory ? (navigator as any).deviceMemory * 1024 : null)
    : Device.totalMemory;

  const base = {
    tier,
    cores,
    memoryMb,
    platform: platform as any,
    isMobileWeb,
    reducedMotion,
  };

  switch (tier) {
    case 'low':
      return {
        ...base,
        isLowEnd: true,
        isHighEnd: false,
        imageQuality: 0.55,
        enableBlur: false,
        enableShimmer: false,
        maxConcurrentDecoders: 2,
        videoPreload: 'metadata',
        listInitialRender: 6,
        listWindowRender: 4,
      };
    case 'medium':
      return {
        ...base,
        isLowEnd: false,
        isHighEnd: false,
        imageQuality: 0.7,
        enableBlur: platform === 'ios' || platform === 'android',
        enableShimmer: true,
        maxConcurrentDecoders: 3,
        videoPreload: 'metadata',
        listInitialRender: 10,
        listWindowRender: 5,
      };
    case 'high':
    default:
      return {
        ...base,
        isLowEnd: false,
        isHighEnd: true,
        imageQuality: 0.85,
        enableBlur: true,
        enableShimmer: true,
        maxConcurrentDecoders: 5,
        videoPreload: 'auto',
        listInitialRender: 14,
        listWindowRender: 7,
      };
  }
}

export function PerformanceProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mq.matches);
      const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, []);

  const value = useMemo<DeviceCapabilities>(() => {
    const tier = Platform.OS === 'web' ? detectWebTier() : detectNativeTier();
    const withMotion = reducedMotion ? 'low' as PerformanceTier : tier;
    return tierToCapabilities(withMotion, Platform.OS, reducedMotion);
  }, [reducedMotion]);

  return (
    <PerformanceContext.Provider value={value}>
      {children}
    </PerformanceContext.Provider>
  );
}

export function usePerformance() {
  return useContext(PerformanceContext);
}

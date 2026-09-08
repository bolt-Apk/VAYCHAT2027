import { useState, useEffect, useRef, memo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Platform, Linking, Animated } from 'react-native';
import { ExternalLink, Globe } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';

interface LinkPreviewData {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  url: string;
}

const previewCache = new Map<string, LinkPreviewData | null>();

interface Props {
  url: string;
  bubbleColor: string;
  textColor: string;
}

function SkeletonLoader({ textColor }: { textColor: string }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.16] });
  const barColor = textColor === '#FFFFFF' ? '#FFFFFF' : '#000000';

  return (
    <View style={sk.container}>
      <Animated.View style={[sk.imagePlaceholder, { backgroundColor: barColor, opacity }]} />
      <View style={sk.lines}>
        <Animated.View style={[sk.lineHost, { backgroundColor: barColor, opacity }]} />
        <Animated.View style={[sk.lineTitle, { backgroundColor: barColor, opacity }]} />
        <Animated.View style={[sk.lineDesc, { backgroundColor: barColor, opacity }]} />
      </View>
    </View>
  );
}

export default memo(function LinkPreviewCard({ url, bubbleColor, textColor }: Props) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url) || null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.functions.invoke('link-preview', {
          body: { url },
        });

        if (cancelled || !mountedRef.current) return;

        if (data && !data.error && (data.title || data.image)) {
          previewCache.set(url, data);
          setPreview(data);
        } else {
          previewCache.set(url, null);
        }
      } catch {
        previewCache.set(url, null);
      }
      if (mountedRef.current) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (preview) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }
  }, [preview, fadeAnim]);

  if (!loading && !preview) return null;

  if (loading) {
    return (
      <View style={[styles.container, { borderColor: textColor === '#FFFFFF' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }]}>
        <SkeletonLoader textColor={textColor} />
      </View>
    );
  }

  const router = useRouter();

  const openUrl = () => {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      if (parsed.hostname === 'vaychat.net' || parsed.hostname === 'www.vaychat.net') {
        const path = parsed.pathname;
        const usernameMatch = path.match(/^\/@([a-zA-Z0-9_]+)$/);
        if (usernameMatch) {
          router.push({ pathname: '/@[username]', params: { username: usernameMatch[1] } });
          return;
        }
        const channelIdMatch = path.match(/^\/channel\/([a-f0-9-]+)$/i);
        if (channelIdMatch) {
          router.push({ pathname: '/channel/[id]', params: { id: channelIdMatch[1] } });
          return;
        }
        const userMatch = path.match(/^\/u\/([a-f0-9-]+)$/i);
        if (userMatch) {
          router.push({ pathname: '/u/[userId]', params: { userId: userMatch[1] } });
          return;
        }
      }
    } catch {}
    if (Platform.OS === 'web') window.open(url, '_blank');
    else Linking.openURL(url);
  };

  const hostname = (() => {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
  })();

  const subtleColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)';
  const borderColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
  const accentColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)';

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <TouchableOpacity onPress={openUrl} activeOpacity={0.75} style={[styles.container, { borderColor, backgroundColor: accentColor }]} accessibilityLabel={preview!.title || url} accessibilityRole="link">
        {preview!.image ? (
          <View style={styles.imageWrap}>
            <Image
              source={{ uri: preview!.image }}
              style={styles.image}
              resizeMode="cover"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageLoaded(true)}
            />
            {!imageLoaded && (
              <View style={styles.imageSkeleton} />
            )}
          </View>
        ) : preview!.favicon ? (
          <View style={styles.faviconBanner}>
            <Image
              source={{ uri: preview!.favicon }}
              style={styles.faviconImage}
              resizeMode="contain"
            />
          </View>
        ) : null}
        <View style={styles.textContent}>
          {hostname ? (
            <View style={styles.hostRow}>
              <Globe color={subtleColor} size={10} />
              <Text style={[styles.hostname, { color: subtleColor }]} numberOfLines={1}>{hostname}</Text>
              <ExternalLink color={subtleColor} size={10} style={{ marginLeft: 'auto' }} />
            </View>
          ) : null}
          {preview!.title && (
            <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>{preview!.title}</Text>
          )}
          {preview!.description && (
            <Text style={[styles.description, { color: subtleColor }]} numberOfLines={2}>{preview!.description}</Text>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

const sk = StyleSheet.create({
  container: {
    gap: 8,
  },
  imagePlaceholder: {
    width: '100%',
    height: 100,
    borderRadius: 8,
  },
  lines: {
    gap: 6,
    paddingHorizontal: 2,
  },
  lineHost: {
    width: 80,
    height: 8,
    borderRadius: 4,
  },
  lineTitle: {
    width: '85%',
    height: 10,
    borderRadius: 5,
  },
  lineDesc: {
    width: '60%',
    height: 8,
    borderRadius: 4,
  },
});

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 6,
    overflow: 'hidden',
  },
  imageWrap: {
    position: 'relative',
    overflow: 'hidden',
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
  },
  image: {
    width: '100%',
    height: 130,
  },
  imageSkeleton: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(120,120,140,0.12)',
  },
  faviconBanner: {
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,120,140,0.06)',
  },
  faviconImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  textContent: {
    padding: 10,
    gap: 3,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  hostname: {
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
});

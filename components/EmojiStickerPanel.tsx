import { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput,
  Animated, Dimensions, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Clock, Smile, Heart, Coffee, Plane, Lightbulb, Flag,
  Search, X, Cat, Music, Hash, Sticker, ChevronLeft,
} from 'lucide-react-native';

let SCREEN_W = Dimensions.get('window').width;
Dimensions.addEventListener('change', ({ window }) => { SCREEN_W = window.width; });
const EMOJI_SIZE = 36;
const EMOJI_COLS = Math.floor((SCREEN_W - 24) / (EMOJI_SIZE + 4));
const PANEL_HEIGHT = 280;

// --- Emoji data organized by category ---
const EMOJI_CATEGORIES: { key: string; icon: any; label: string; emojis: string[] }[] = [
  {
    key: 'recent', icon: Clock, label: 'Недавние',
    emojis: [],
  },
  {
    key: 'smileys', icon: Smile, label: 'Смайлики',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊',
      '😇','🥰','😍','🤩','😘','😗','😚','😋','😛','😜',
      '🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨',
      '😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌',
      '😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴',
      '😵','🤯','🥳','🥸','😎','🤓','🧐','😕','🫤','😟',
      '🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨',
      '😰','😥','😢','😭','😱','😖','😣','😞','😓','😩',
      '😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡',
      '👹','👺','👻','👽','👾','🤖','🫠','😮‍💨','🫶','🫰',
    ],
  },
  {
    key: 'gestures', icon: () => <Text style={{ fontSize: 16 }}>👋</Text>, label: 'Жесты',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
      '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
      '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
      '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪','🦾',
      '🫸','🫷',
    ],
  },
  {
    key: 'love', icon: Heart, label: 'Любовь',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟',
      '♥️','💋','💌','💐','🌹','🌷','🫂','💑','👩‍❤️‍👨','💏',
    ],
  },
  {
    key: 'nature', icon: Cat, label: 'Природа',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨',
      '🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔',
      '🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄',
      '🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🐢','🐍',
      '🦎','🐙','🦑','🦐','🦀','🐠','🐟','🐡','🐬','🦈',
      '🐳','🐋','🌸','🌺','🌻','🌼','🌷','🌱','🌿','☘️',
      '🍀','🎋','🎍','🍃','🍂','🍁','🌾','🌵','🎄','🌳',
    ],
  },
  {
    key: 'food', icon: Coffee, label: 'Еда',
    emojis: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐',
      '🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆',
      '🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧅','🧄','🥔',
      '🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓',
      '🍔','🍟','🌭','🍕','🥪','🌮','🌯','🫔','🥙','🧆',
      '🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘',
      '☕','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃',
      '🍸','🍹','🧉','🍾','🧊','🍰','🎂','🍩','🍪','🍫',
    ],
  },
  {
    key: 'travel', icon: Plane, label: 'Путешествия',
    emojis: [
      '🚗','🚕','🚌','🏎️','🚑','🚒','🚐','🛻','🚚','🚛',
      '🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','✈️','🛫',
      '🛬','🛩️','🚀','🛸','🚁','⛵','🚤','⛴️','🛳️','🗼',
      '🏰','🗽','⛪','🕌','🛕','⛩️','🕋','⛲','⛺','🌁',
      '🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🌅','🌄',
    ],
  },
  {
    key: 'objects', icon: Lightbulb, label: 'Объекты',
    emojis: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱',
      '🪀','🏓','🏸','🏒','🥅','⛳','🪁','🏹','🎣','🤿',
      '🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️',
      '🎮','🕹️','🎲','🧩','🎯','🎳','🎰','🎪','🎭','🎨',
      '🎼','🎵','🎶','🎤','🎧','📻','🎷','🪗','🎸','🎹',
      '🎺','🎻','🪕','🥁','📱','💻','⌨️','🖥️','💡','🔦',
      '📷','📹','🎥','📽️','🎬','📺','📡','🔭','🔬','💎',
      '💰','💳','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎁',
    ],
  },
  {
    key: 'symbols', icon: Hash, label: 'Символы',
    emojis: [
      '💯','🔥','✨','⭐','🌟','💫','⚡','💥','💢','💦',
      '💨','🕳️','💣','💬','🗨️','🗯️','💭','💤','✅','❌',
      '❓','❗','‼️','⁉️','💲','♻️','⚜️','🔱','📛','🔰',
      '⭕','✳️','❇️','🔴','🟠','🟡','🟢','🔵','🟣','⚫',
      '⚪','🟤','🔶','🔷','🔸','🔹','▪️','▫️','◾','◽',
      '🔲','🔳','🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','☮️',
    ],
  },
  {
    key: 'flags', icon: Flag, label: 'Флаги',
    emojis: [
      '🇷🇺','🇺🇸','🇬🇧','🇩🇪','🇫🇷','🇪🇸','🇮🇹','🇯🇵','🇰🇷','🇨🇳',
      '🇧🇷','🇮🇳','🇦🇺','🇨🇦','🇲🇽','🇦🇷','🇹🇷','🇸🇦','🇦🇪','🇪🇬',
      '🇿🇦','🇳🇬','🇰🇪','🇹🇭','🇻🇳','🇮🇩','🇲🇾','🇵🇭','🇸🇬','🇳🇿',
    ],
  },
];

// Sticker packs
const STICKER_PACKS = [
  {
    id: 'greetings',
    name: 'Приветствия',
    stickers: [
      { id: 'hi', emoji: '👋', label: 'Привет!' },
      { id: 'glad', emoji: '😊', label: 'Рад знакомству!' },
      { id: 'party', emoji: '🎉', label: 'Ура!' },
      { id: 'coffee', emoji: '☕', label: 'Как дела?' },
      { id: 'handshake', emoji: '🤝', label: 'Приятно познакомиться!' },
      { id: 'peace', emoji: '✌️', label: 'Здарова!' },
      { id: 'salute', emoji: '🫡', label: 'Приветствую!' },
      { id: 'love', emoji: '❤️', label: 'С любовью' },
    ],
  },
  {
    id: 'emotions',
    name: 'Эмоции',
    stickers: [
      { id: 'laugh', emoji: '🤣', label: 'Ахахаха!' },
      { id: 'cry', emoji: '😭', label: 'Печалька' },
      { id: 'angry', emoji: '😤', label: 'Злюсь!' },
      { id: 'shock', emoji: '😱', label: 'Шок!' },
      { id: 'think', emoji: '🤔', label: 'Хмм...' },
      { id: 'cool', emoji: '😎', label: 'Круто!' },
      { id: 'sick', emoji: '🤢', label: 'Фу...' },
      { id: 'sleepy', emoji: '😴', label: 'Сплю...' },
    ],
  },
  {
    id: 'reactions',
    name: 'Реакции',
    stickers: [
      { id: 'thumbsup', emoji: '👍', label: 'Лайк!' },
      { id: 'thumbsdown', emoji: '👎', label: 'Дизлайк' },
      { id: 'clap', emoji: '👏', label: 'Аплодисменты!' },
      { id: 'fire', emoji: '🔥', label: 'Огонь!' },
      { id: 'hundred', emoji: '💯', label: 'Сотка!' },
      { id: 'star', emoji: '⭐', label: 'Звезда!' },
      { id: 'muscle', emoji: '💪', label: 'Силища!' },
      { id: 'pray', emoji: '🙏', label: 'Спасибо!' },
    ],
  },
  {
    id: 'animals',
    name: 'Зверушки',
    stickers: [
      { id: 'cat', emoji: '🐱', label: 'Мяу!' },
      { id: 'dog', emoji: '🐶', label: 'Гав!' },
      { id: 'bear', emoji: '🐻', label: 'Обнимашки!' },
      { id: 'monkey', emoji: '🙈', label: 'Ой!' },
      { id: 'bunny', emoji: '🐰', label: 'Зайка!' },
      { id: 'fox', emoji: '🦊', label: 'Хитрюга!' },
      { id: 'unicorn', emoji: '🦄', label: 'Волшебно!' },
      { id: 'owl', emoji: '🦉', label: 'Умник!' },
    ],
  },
];

const RECENT_STORAGE_KEY = 'emoji_recent';

interface EmojiStickerPanelProps {
  visible: boolean;
  onEmojiSelect: (emoji: string) => void;
  onStickerSend: (text: string) => void;
  onClose: () => void;
  colors: {
    background: string;
    backgroundSecondary: string;
    backgroundTertiary: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    primary: string;
    border: string;
  };
}

function EmojiStickerPanel({
  visible, onEmojiSelect, onStickerSend, onClose, colors,
}: EmojiStickerPanelProps) {
  const [activeTab, setActiveTab] = useState<'emoji' | 'stickers'>('emoji');
  const [activeCategory, setActiveCategory] = useState('smileys');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [activeStickerPack, setActiveStickerPack] = useState(STICKER_PACKS[0].id);

  const slideAnim = useRef(new Animated.Value(PANEL_HEIGHT)).current;
  const categoryListRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(PANEL_HEIGHT);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    }
  }, [visible]);

  useEffect(() => {
    loadRecentEmojis();
  }, []);

  const loadRecentEmojis = async () => {
    try {
      if (Platform.OS === 'web') {
        const stored = localStorage.getItem(RECENT_STORAGE_KEY);
        if (stored) setRecentEmojis(JSON.parse(stored));
      } else {
        const stored = await AsyncStorage.getItem(RECENT_STORAGE_KEY);
        if (stored) setRecentEmojis(JSON.parse(stored));
      }
    } catch {}
  };

  const saveRecentEmoji = useCallback((emoji: string) => {
    setRecentEmojis(prev => {
      const filtered = prev.filter(e => e !== emoji);
      const updated = [emoji, ...filtered].slice(0, 30);
      try {
        if (Platform.OS === 'web') {
          localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
        } else {
          AsyncStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
        }
      } catch {}
      return updated;
    });
  }, []);

  const handleEmojiPress = useCallback((emoji: string) => {
    saveRecentEmoji(emoji);
    onEmojiSelect(emoji);
  }, [saveRecentEmoji, onEmojiSelect]);

  const handleStickerPress = useCallback((emoji: string, label: string) => {
    onStickerSend(`${emoji} ${label}`);
  }, [onStickerSend]);

  const currentCategory = EMOJI_CATEGORIES.find(c => c.key === activeCategory);
  const displayEmojis = activeCategory === 'recent'
    ? recentEmojis
    : (currentCategory?.emojis || []);

  const filteredEmojis = searchQuery
    ? EMOJI_CATEGORIES.flatMap(c => c.emojis)
        .filter((e, i, arr) => arr.indexOf(e) === i)
        .filter(e => e.includes(searchQuery))
    : displayEmojis;

  if (!visible) return null;

  return (
    <Animated.View style={[
      es.container,
      { backgroundColor: colors.backgroundSecondary, borderTopColor: colors.border, transform: [{ translateY: slideAnim }] },
    ]}>
      {/* Top tabs: Emoji / Stickers */}
      <View style={[es.topTabs, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[es.topTab, activeTab === 'emoji' && { borderBottomColor: colors.primary }]}
          onPress={() => setActiveTab('emoji')}
          activeOpacity={0.7}
          accessibilityLabel="Эмодзи"
        >
          <Smile color={activeTab === 'emoji' ? colors.primary : colors.textTertiary} size={20} />
          <Text style={[es.topTabText, { color: activeTab === 'emoji' ? colors.primary : colors.textTertiary }]}>
            Эмодзи
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[es.topTab, activeTab === 'stickers' && { borderBottomColor: colors.primary }]}
          onPress={() => setActiveTab('stickers')}
          activeOpacity={0.7}
          accessibilityLabel="Стикеры"
        >
          <Sticker color={activeTab === 'stickers' ? colors.primary : colors.textTertiary} size={20} />
          <Text style={[es.topTabText, { color: activeTab === 'stickers' ? colors.primary : colors.textTertiary }]}>
            Стикеры
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'emoji' ? (
        <View style={es.emojiSection}>
          {/* Search bar */}
          <View style={[es.searchBar, { backgroundColor: colors.backgroundTertiary }]}>
            <Search color={colors.textTertiary} size={16} />
            <TextInput
              style={[es.searchInput, { color: colors.text }]}
              placeholder="Поиск эмодзи..."
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Очистить поиск">
                <X color={colors.textTertiary} size={16} />
              </TouchableOpacity>
            )}
          </View>

          {/* Category tabs */}
          {!searchQuery && (
            <ScrollView
              ref={categoryListRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={es.categoryBar}
              contentContainerStyle={es.categoryContent}
            >
              {EMOJI_CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isActive = activeCategory === cat.key;
                const isRecent = cat.key === 'recent';
                return (
                  <TouchableOpacity
                    key={cat.key}
                    style={[
                      es.categoryBtn,
                      isActive && { backgroundColor: `${colors.primary}20` },
                    ]}
                    onPress={() => setActiveCategory(cat.key)}
                    activeOpacity={0.7}
                    accessibilityLabel={cat.label}
                  >
                    {typeof Icon === 'function' && Icon.toString().includes('Text') ? (
                      <Icon />
                    ) : (
                      <Icon
                        color={isActive ? colors.primary : colors.textTertiary}
                        size={18}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Emoji grid */}
          <ScrollView style={es.emojiGrid} showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag">
            {activeCategory === 'recent' && recentEmojis.length === 0 ? (
              <View style={es.emptyState}>
                <Clock color={colors.textTertiary} size={32} />
                <Text style={[es.emptyText, { color: colors.textTertiary }]}>
                  Недавние эмодзи появятся здесь
                </Text>
              </View>
            ) : (
              <View style={es.emojiWrap}>
                {filteredEmojis.map((emoji, idx) => (
                  <TouchableOpacity
                    key={`${emoji}-${idx}`}
                    style={es.emojiBtn}
                    onPress={() => handleEmojiPress(emoji)}
                    activeOpacity={0.6}
                  >
                    <Text style={es.emojiBtnText}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      ) : (
        <View style={es.stickerSection}>
          {/* Sticker pack tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={es.stickerPackBar}
            contentContainerStyle={es.stickerPackContent}
          >
            {STICKER_PACKS.map(pack => (
              <TouchableOpacity
                key={pack.id}
                style={[
                  es.stickerPackBtn,
                  activeStickerPack === pack.id && { backgroundColor: `${colors.primary}20`, borderColor: colors.primary },
                  { borderColor: colors.border },
                ]}
                onPress={() => setActiveStickerPack(pack.id)}
                activeOpacity={0.7}
              >
                <Text style={es.stickerPackEmoji}>
                  {pack.stickers[0].emoji}
                </Text>
                <Text style={[
                  es.stickerPackName,
                  { color: activeStickerPack === pack.id ? colors.primary : colors.textSecondary },
                ]} numberOfLines={1}>
                  {pack.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Sticker grid */}
          <ScrollView style={es.stickerGrid} showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag">
            <View style={es.stickerWrap}>
              {(STICKER_PACKS.find(p => p.id === activeStickerPack)?.stickers || []).map(sticker => (
                <TouchableOpacity
                  key={sticker.id}
                  style={[es.stickerItem, { backgroundColor: colors.backgroundTertiary }]}
                  onPress={() => handleStickerPress(sticker.emoji, sticker.label)}
                  activeOpacity={0.7}
                >
                  <Text style={es.stickerEmoji}>{sticker.emoji}</Text>
                  <Text style={[es.stickerLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                    {sticker.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </Animated.View>
  );
}

export default memo(EmojiStickerPanel);

const es = StyleSheet.create({
  container: {
    height: PANEL_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  topTabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  topTabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Emoji section
  emojiSection: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 34,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  categoryBar: {
    maxHeight: 38,
  },
  categoryContent: {
    paddingHorizontal: 8,
    gap: 2,
    alignItems: 'center',
  },
  categoryBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiGrid: {
    flex: 1,
    paddingHorizontal: 8,
  },
  emojiWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 12,
  },
  emojiBtn: {
    width: EMOJI_SIZE + 4,
    height: EMOJI_SIZE + 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  emojiBtnText: {
    fontSize: 26,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
  },
  // Sticker section
  stickerSection: {
    flex: 1,
  },
  stickerPackBar: {
    maxHeight: 56,
    borderBottomWidth: 0,
  },
  stickerPackContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  stickerPackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  stickerPackEmoji: {
    fontSize: 18,
  },
  stickerPackName: {
    fontSize: 12,
    fontWeight: '600',
  },
  stickerGrid: {
    flex: 1,
    paddingHorizontal: 10,
  },
  stickerWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 12,
    paddingTop: 4,
  },
  stickerItem: {
    width: (SCREEN_W - 56) / 4,
    aspectRatio: 1,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  stickerEmoji: {
    fontSize: 36,
  },
  stickerLabel: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
});

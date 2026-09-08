import { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Platform, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/hooks/useGoBack';
import { ArrowLeft, MessageCircle, FileText, Shield, ChevronRight, ExternalLink, Search, HelpCircle, ChevronDown } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useAppearance } from '@/lib/appearance-context';

interface FaqItem {
  question: string;
  answer: string;
  category: string;
}

const faqData: FaqItem[] = [
  { category: 'Чаты', question: 'Как начать новый чат?', answer: 'Нажмите на кнопку "+" в правом верхнем углу экрана чатов. Выберите контакт или введите номер телефона собеседника.' },
  { category: 'Чаты', question: 'Как создать групповой чат?', answer: 'При создании нового чата выберите несколько контактов. Вам будет предложено дать название группе и выбрать аватар.' },
  { category: 'Чаты', question: 'Как переслать или ответить на сообщение?', answer: 'Нажмите и удерживайте сообщение, чтобы вызвать меню действий. Там доступны ответ, пересылка, копирование и другие действия.' },
  { category: 'Чаты', question: 'Как удалить сообщение?', answer: 'Нажмите и удерживайте сообщение, затем выберите "Удалить". Свои сообщения можно удалить для всех участников.' },
  { category: 'Чаты', question: 'Как найти сообщение в чате?', answer: 'Откройте чат, нажмите на три точки в правом верхнем углу и выберите "Поиск". Введите ключевое слово для поиска.' },
  { category: 'Профиль', question: 'Как изменить имя профиля?', answer: 'Перейдите в раздел "Профиль" и нажмите кнопку "Редактировать". Измените имя и нажмите "Сохранить".' },
  { category: 'Профиль', question: 'Как удалить фото профиля?', answer: 'На экране профиля нажмите "Удалить фото" рядом с кнопкой "Редактировать".' },
  { category: 'Безопасность', question: 'Безопасны ли мои сообщения?', answer: 'Да, все сообщения хранятся в защищённой базе данных. Только участники беседы имеют доступ к сообщениям.' },
  { category: 'Безопасность', question: 'Как заблокировать пользователя?', answer: 'Откройте профиль контакта через долгое нажатие в списке контактов и выберите "Заблокировать". Управлять заблокированными можно в Профиль > Заблокированные.' },
  { category: 'Аккаунт', question: 'Как удалить аккаунт?', answer: 'Перейдите в Настройки > Конфиденциальность, прокрутите вниз до раздела "Опасная зона" и нажмите "Удалить аккаунт". Потребуется подтверждение.' },
  { category: 'Аккаунт', question: 'Забыл код-пароль, что делать?', answer: 'К сожалению, восстановить код-пароль невозможно. Необходимо создать новый аккаунт с другим номером телефона.' },
  { category: 'Звонки', question: 'Как совершить звонок?', answer: 'Откройте контакт и нажмите на иконку телефона для аудио-звонка или иконку камеры для видео-звонка.' },
  { category: 'Медиа', question: 'Как просмотреть все медиа в чате?', answer: 'Откройте чат, нажмите три точки и выберите "Медиа файлы". Там доступны вкладки: фото/видео, файлы, голосовые и ссылки.' },
];

export default function HelpScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFaq = useMemo(() => {
    if (!searchQuery.trim()) return faqData;
    const q = searchQuery.toLowerCase();
    return faqData.filter(item =>
      item.question.toLowerCase().includes(q) ||
      item.answer.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const groupedFaq = useMemo(() => {
    const groups: { category: string; items: { item: FaqItem; globalIdx: number }[] }[] = [];
    const catMap = new Map<string, { item: FaqItem; globalIdx: number }[]>();
    filteredFaq.forEach((item, idx) => {
      const globalIdx = faqData.indexOf(item);
      if (!catMap.has(item.category)) catMap.set(item.category, []);
      catMap.get(item.category)!.push({ item, globalIdx });
    });
    catMap.forEach((items, category) => groups.push({ category, items }));
    return groups;
  }, [filteredFaq]);

  const toggleFaq = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const openLink = (url: string) => {
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const handleSupport = () => {
    const email = 'support@vaychat.net';
    if (Platform.OS === 'web') {
      window.open(`mailto:${email}`, '_blank');
    } else {
      Linking.openURL(`mailto:${email}`);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]} onPress={() => goBack()} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Помощь</Text>
        <View style={styles.backButton} />
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.backgroundSecondary, marginHorizontal: 20, marginBottom: 16 }]}>
        <Search color={colors.textTertiary} size={17} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Поиск по вопросам"
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} keyboardDismissMode="on-drag">
        {searchQuery && filteredFaq.length === 0 ? (
          <View style={styles.emptySearch}>
            <HelpCircle color={colors.textTertiary} size={40} />
            <Text style={[styles.emptySearchText, { color: colors.textSecondary }]}>
              Ничего не найдено по запросу "{searchQuery}"
            </Text>
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Очистить поиск">
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600', marginTop: 8 }}>Очистить поиск</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {groupedFaq.map((group) => (
              <View key={group.category} style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{group.category}</Text>
                {group.items.map(({ item, globalIdx }) => (
                  <TouchableOpacity
                    key={globalIdx}
                    style={[styles.faqItem, { backgroundColor: colors.backgroundSecondary }]}
                    onPress={() => toggleFaq(globalIdx)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.faqHeader}>
                      <Text style={[styles.faqQuestion, { color: colors.text }]}>
                        {searchQuery ? highlightText(item.question, searchQuery, colors) : item.question}
                      </Text>
                      <ChevronDown
                        color={colors.textTertiary}
                        size={16}
                        style={expandedIndex === globalIdx ? { transform: [{ rotate: '180deg' }] } : undefined}
                      />
                    </View>
                    {expandedIndex === globalIdx && (
                      <Text style={[styles.faqAnswer, { color: colors.textSecondary, borderTopColor: colors.border }]}>
                        {searchQuery ? highlightText(item.answer, searchQuery, colors) : item.answer}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </>
        )}

        {!searchQuery && (
          <>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Связаться с нами</Text>

              <TouchableOpacity style={[styles.contactItem, { backgroundColor: colors.backgroundSecondary }]} onPress={handleSupport}>
                <View style={[styles.contactIcon, { backgroundColor: colors.primary }]}>
                  <MessageCircle color="#FFFFFF" size={18} />
                </View>
                <View style={styles.contactInfo}>
                  <Text style={[styles.contactLabel, { color: colors.text }]}>Написать в поддержку</Text>
                  <Text style={[styles.contactDescription, { color: colors.textTertiary }]}>Ответим в течение 24 часов</Text>
                </View>
                <ExternalLink color={colors.textTertiary} size={16} />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.contactItem, { backgroundColor: colors.backgroundSecondary }]} onPress={() => router.push('/terms')}>
                <View style={[styles.contactIcon, { backgroundColor: colors.secondary }]}>
                  <FileText color="#FFFFFF" size={18} />
                </View>
                <View style={styles.contactInfo}>
                  <Text style={[styles.contactLabel, { color: colors.text }]}>Пользовательское соглашение</Text>
                  <Text style={[styles.contactDescription, { color: colors.textTertiary }]}>Условия использования сервиса</Text>
                </View>
                <ExternalLink color={colors.textTertiary} size={16} />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.contactItem, { backgroundColor: colors.backgroundSecondary }]} onPress={() => router.push('/privacy')}>
                <View style={[styles.contactIcon, { backgroundColor: colors.accent }]}>
                  <Shield color="#FFFFFF" size={18} />
                </View>
                <View style={styles.contactInfo}>
                  <Text style={[styles.contactLabel, { color: colors.text }]}>Политика конфиденциальности</Text>
                  <Text style={[styles.contactDescription, { color: colors.textTertiary }]}>Как мы обрабатываем данные</Text>
                </View>
                <ExternalLink color={colors.textTertiary} size={16} />
              </TouchableOpacity>
            </View>

            <View style={[styles.versionCard, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.versionLabel, { color: colors.textTertiary }]}>Версия приложения</Text>
              <Text style={[styles.versionNumber, { color: colors.text }]}>{Constants.expoConfig?.version || '1.0.0'}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function highlightText(text: string, query: string, colors: any) {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part)
      ? <Text key={i} style={{ backgroundColor: 'rgba(255,213,0,0.35)', color: colors.text, fontWeight: '600' }}>{part}</Text>
      : part
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  faqItem: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  faqQuestion: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  faqAnswer: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
  },
  contactIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  contactInfo: {
    flex: 1,
  },
  contactLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  contactDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  versionCard: {
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  versionLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  versionNumber: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptySearch: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptySearchText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});

import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, TextInput, Alert, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Mail, HelpCircle, FileText, Shield, ChevronRight, Send, MessageSquare, Clock } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';

const EMAIL = 'support@vaychat.net';

export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppearance();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const categories = [
    { id: 'bug', label: 'Ошибка в приложении' },
    { id: 'account', label: 'Проблема с аккаунтом' },
    { id: 'privacy', label: 'Конфиденциальность' },
    { id: 'feature', label: 'Предложение' },
    { id: 'other', label: 'Другое' },
  ];

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSending(true);
    const subject = category ? `[${categories.find(c => c.id === category)?.label}] Обращение из VayChat` : 'Обращение из VayChat';
    const body = `${name ? `Имя: ${name}\n` : ''}${email ? `Email: ${email}\n` : ''}Категория: ${categories.find(c => c.id === category)?.label || 'Не указана'}\n\n${message}`;
    const mailtoUrl = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      const supported = await Linking.canOpenURL(mailtoUrl);
      if (supported) {
        await Linking.openURL(mailtoUrl);
      } else {
        await Linking.openURL(`mailto:${EMAIL}`);
      }
      setSubmitted(true);
    } catch {
      if (Platform.OS === 'web') {
        window.open(mailtoUrl, '_blank');
        setSubmitted(true);
      }
    } finally {
      setSending(false);
    }
  };

  if (submitted) {
    return (
      <View style={[s.root, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12} accessibilityLabel="Назад">
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.text }]}>Поддержка</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.successContainer}>
          <View style={s.successIcon}>
            <Send color={colors.primary} size={40} />
          </View>
          <Text style={[s.successTitle, { color: colors.text }]}>Спасибо за обращение!</Text>
          <Text style={[s.successSub, { color: colors.textSecondary }]}>Мы получили ваше сообщение и ответим на почту {email || 'в ближайшее время'}.</Text>
          <Text style={[s.successTime, { color: colors.primary }]}>Обычно мы отвечаем в течение 24 часов</Text>
          <TouchableOpacity style={[s.successBtn, { backgroundColor: colors.primary }]} onPress={() => { setSubmitted(false); setMessage(''); setCategory(null); }}>
            <Text style={s.successBtnText}>Отправить ещё</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.successBtnOutline, { borderColor: colors.border }]} onPress={() => router.back()}>
            <Text style={[s.successBtnOutlineText, { color: colors.textSecondary }]}>Вернуться</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12} accessibilityLabel="Назад">
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>Поддержка</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <View style={[s.iconWrap, { backgroundColor: colors.primary + '18' }]}>
            <HelpCircle color={colors.primary} size={40} />
          </View>
          <Text style={[s.heroTitle, { color: colors.text }]}>Как мы можем помочь?</Text>
          <Text style={[s.heroSub, { color: colors.textSecondary }]}>Заполните форму ниже или напишите на почту — мы ответим как можно скорее</Text>
        </View>

        <View style={[s.responseInfo, { backgroundColor: colors.primary + '14' }]}>
          <Clock color={colors.primary} size={16} />
          <Text style={[s.responseText, { color: colors.primary }]}>Среднее время ответа: до 24 часов</Text>
        </View>

        <TouchableOpacity style={[s.emailRow, { backgroundColor: colors.surface }]} onPress={() => Linking.openURL(`mailto:${EMAIL}`)} accessibilityLabel="Написать на email" accessibilityRole="link">
          <View style={[s.rowIcon, { backgroundColor: colors.primary + '1F' }]}>
            <Mail color={colors.primary} size={20} />
          </View>
          <View style={s.rowText}>
            <Text style={[s.rowTitle, { color: colors.text }]}>Написать на почту</Text>
            <Text style={[s.rowSub, { color: colors.textSecondary }]}>{EMAIL}</Text>
          </View>
          <ChevronRight color={colors.textTertiary} size={18} />
        </TouchableOpacity>

        <View style={s.divider}>
          <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[s.dividerText, { color: colors.textTertiary }]}>или заполните форму</Text>
          <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <Text style={[s.label, { color: colors.textSecondary }]}>Тема обращения</Text>
        <View style={s.categories}>
          {categories.map(cat => (
            <TouchableOpacity
              key={cat.id}
              style={[s.catChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }, category === cat.id && { backgroundColor: colors.primary + '26', borderColor: colors.primary }]}
              onPress={() => setCategory(cat.id === category ? null : cat.id)}
              accessibilityLabel={cat.label}
            >
              <Text style={[s.catChipText, { color: colors.textSecondary }, category === cat.id && { color: colors.primary }]}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.label, { color: colors.textSecondary }]}>Ваше имя (необязательно)</Text>
        <TextInput
          style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Имя"
          placeholderTextColor={colors.textTertiary}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        <Text style={[s.label, { color: colors.textSecondary }]}>Email для ответа (необязательно)</Text>
        <TextInput
          style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="email@example.com"
          placeholderTextColor={colors.textTertiary}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={[s.label, { color: colors.textSecondary }]}>Опишите проблему или вопрос *</Text>
        <TextInput
          style={[s.input, s.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Расскажите подробнее, что произошло..."
          placeholderTextColor={colors.textTertiary}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[s.submitBtn, { backgroundColor: colors.primary }, !message.trim() && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!message.trim() || sending}
          activeOpacity={0.8}
          accessibilityLabel="Отправить"
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Send color="#fff" size={18} />
              <Text style={s.submitBtnText}>Отправить обращение</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={[s.section, { color: colors.textSecondary }]}>Частые вопросы</Text>
        <View style={[s.card, { backgroundColor: colors.surface }]}>
          {FAQ.map((item, i) => (
            <View key={i}>
              {i > 0 && <View style={[s.sep, { backgroundColor: colors.border }]} />}
              <View style={s.faq}>
                <Text style={[s.faqQ, { color: colors.text }]}>{item.q}</Text>
                <Text style={[s.faqA, { color: colors.textSecondary }]}>{item.a}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={[s.section, { color: colors.textSecondary }]}>Полезные ссылки</Text>
        <View style={[s.card, { backgroundColor: colors.surface }]}>
          <TouchableOpacity style={s.row} onPress={() => router.push('/terms')}>
            <View style={[s.rowIcon, { backgroundColor: colors.success + '1F' }]}>
              <FileText color={colors.success} size={20} />
            </View>
            <View style={s.rowText}>
              <Text style={[s.rowTitle, { color: colors.text }]}>Условия использования</Text>
            </View>
            <ChevronRight color={colors.textTertiary} size={18} />
          </TouchableOpacity>
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <TouchableOpacity style={s.row} onPress={() => router.push('/privacy')}>
            <View style={[s.rowIcon, { backgroundColor: colors.primary + '1F' }]}>
              <Shield color={colors.primary} size={20} />
            </View>
            <View style={s.rowText}>
              <Text style={[s.rowTitle, { color: colors.text }]}>Политика конфиденциальности</Text>
            </View>
            <ChevronRight color={colors.textTertiary} size={18} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const FAQ = [
  { q: 'Как создать аккаунт?', a: 'Откройте приложение, введите номер телефона и пароль. Аккаунт создаётся автоматически при первом входе.' },
  { q: 'Как начать чат?', a: 'Нажмите на значок нового сообщения, выберите контакт из списка или найдите пользователя по номеру телефона.' },
  { q: 'Как заблокировать пользователя?', a: 'Откройте чат, нажмите на меню (три точки) в правом верхнем углу и выберите «Заблокировать».' },
  { q: 'Как пожаловаться на контент?', a: 'Откройте чат, нажмите на меню и выберите «Пожаловаться». Выберите причину и отправьте.' },
  { q: 'Как удалить аккаунт?', a: `Напишите на ${EMAIL} с просьбой об удалении. Мы обработаем запрос в течение 30 дней.` },
];

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  body: { padding: 20 },
  hero: { alignItems: 'center', marginBottom: 20 },
  iconWrap: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  heroTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  heroSub: { fontSize: 14, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  responseInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, alignSelf: 'center' },
  responseText: { fontSize: 13, fontWeight: '500' },
  emailRow: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, marginBottom: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 16, paddingHorizontal: 4 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  catChipText: { fontSize: 13, fontWeight: '500' },
  input: { borderRadius: 12, padding: 14, fontSize: 15, borderWidth: 1 },
  textarea: { minHeight: 120, paddingTop: 14 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14, marginTop: 24 },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 28, paddingHorizontal: 4 },
  card: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  rowIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  rowSub: { fontSize: 13, marginTop: 2 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 70 },
  faq: { padding: 16 },
  faqQ: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  faqA: { fontSize: 14, lineHeight: 20 },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  successIcon: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  successTitle: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  successSub: { fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 300, marginBottom: 8 },
  successTime: { fontSize: 13, marginBottom: 32 },
  successBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 12, minWidth: 200, alignItems: 'center' },
  successBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  successBtnOutline: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, borderWidth: 1, minWidth: 200, alignItems: 'center' },
  successBtnOutlineText: { fontSize: 16, fontWeight: '500' },
});

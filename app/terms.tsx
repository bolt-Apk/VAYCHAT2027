import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';

export default function TermsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppearance();

  return (
    <View style={[s.root, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12}>
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>Условия использования</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={[s.updated, { color: colors.textTertiary }]}>Последнее обновление: 15 июля 2026 г.</Text>

        <Text style={[s.h2, { color: colors.text }]}>1. Принятие условий</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Используя мессенджер VayChat (далее — «Приложение»), вы соглашаетесь с настоящими Условиями использования (далее — «Условия»). Если вы не согласны с какой-либо частью Условий, вы не вправе использовать Приложение.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>2. Описание сервиса</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          VayChat — мессенджер для обмена текстовыми и голосовыми сообщениями, фотографиями, видео, файлами, а также для совершения голосовых и видеозвонков. Приложение предоставляется «как есть» (as is).
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>3. Регистрация и аккаунт</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Для использования Приложения необходимо создать аккаунт, указав номер телефона и пароль. Вы обязуетесь предоставить достоверную информацию и обеспечить безопасность учётных данных. Вы несёте полную ответственность за все действия, совершённые через ваш аккаунт. Регистрация бесплатна.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>4. Правила поведения</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>При использовании Приложения запрещается:</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Публиковать или отправлять незаконный, оскорбительный, угрожающий, порнографический или иной неприемлемый контент</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Рассылать спам, массовые нежелательные сообщения</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Притворяться другими лицами или организациями</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Нарушать права интеллектуальной собственности третьих лиц</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Использовать Приложение для любой незаконной деятельности</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Пытаться получить несанкционированный доступ к системам Приложения</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Отправлять вирусы или вредоносный код</Text>

        <Text style={[s.h2, { color: colors.text }]}>5. Пользовательский контент</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Вы сохраняете права на контент, который отправляете через Приложение. Предоставляя контент, вы даёте нам ограниченную лицензию на его передачу получателям сообщений. Мы оставляем за собой право удалять контент, нарушающий настоящие Условия, без предварительного уведомления.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>6. Модерация контента</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Приложение предоставляет механизмы для защиты пользователей от нежелательного контента:
        </Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Возможность пожаловаться на пользователя или сообщение через меню чата</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Возможность заблокировать нежелательных пользователей</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Фильтрация контента на основе жалоб пользователей</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Мы рассматриваем все жалобы и принимаем меры, включая удаление контента и блокировку аккаунтов нарушителей.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>7. Интеллектуальная собственность</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Все права на Приложение, включая дизайн, логотипы, код и товарные знаки, принадлежат VayChat. Вам предоставляется ограниченная, неисключительная, непередаваемая лицензия на использование Приложения в личных некоммерческих целях.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>8. Ограничение ответственности</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Приложение предоставляется без каких-либо гарантий. Мы не несём ответственности за любые прямые, косвенные, случайные убытки, связанные с использованием или невозможностью использования Приложения, включая потерю данных или сообщений.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>9. Прекращение доступа</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Мы вправе приостановить или прекратить доступ к вашему аккаунту в случае нарушения настоящих Условий. Вы можете удалить свой аккаунт в любое время, обратившись в службу поддержки по адресу support@vaychat.net.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>10. Изменение условий</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Мы оставляем за собой право изменять настоящие Условия. О существенных изменениях мы уведомим через Приложение. Продолжение использования Приложения после внесения изменений означает согласие с обновлёнными Условиями.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>11. Применимое право</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Настоящие Условия регулируются и толкуются в соответствии с действующим законодательством. Все споры подлежат разрешению в установленном законом порядке.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>12. Контакты</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          По всем вопросам, связанным с настоящими Условиями, обращайтесь по адресу: support@vaychat.net
        </Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  body: { padding: 20 },
  updated: { fontSize: 13, marginBottom: 24 },
  h2: { fontSize: 17, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  p: { fontSize: 14, lineHeight: 22, marginBottom: 8 },
  li: { fontSize: 14, lineHeight: 22, paddingLeft: 8, marginBottom: 4 },
});

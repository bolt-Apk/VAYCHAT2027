import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';

export default function PrivacyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppearance();

  return (
    <View style={[s.root, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12}>
          <ArrowLeft color={colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>Политика конфиденциальности</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={[s.updated, { color: colors.textTertiary }]}>Последнее обновление: 15 июля 2026 г.</Text>

        <Text style={[s.h2, { color: colors.text }]}>1. Введение</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Настоящая Политика конфиденциальности описывает, как VayChat (далее — «мы», «нас», «Приложение») собирает, использует и защищает вашу личную информацию при использовании мессенджера VayChat.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>2. Какие данные мы собираем</Text>
        <Text style={[s.h3, { color: colors.text }]}>2.1 Данные, предоставленные вами</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Номер телефона (для регистрации и идентификации)</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Имя профиля и фотография (по вашему выбору)</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Содержимое сообщений, фотографии, видео, голосовые сообщения и файлы, которые вы отправляете</Text>

        <Text style={[s.h3, { color: colors.text }]}>2.2 Данные, собираемые автоматически</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Информация об устройстве (модель, ОС, версия приложения)</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Данные об использовании (время последнего посещения, статус онлайн)</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Push-токены для доставки уведомлений</Text>

        <Text style={[s.h3, { color: colors.text }]}>2.3 Контакты</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          При предоставлении доступа к контактам, приложение проверяет номера телефонов из вашей адресной книги для поиска других пользователей VayChat. Номера телефонов ваших контактов обрабатываются в хешированном виде и не сохраняются на наших серверах в открытом виде. Мы не загружаем и не храним вашу адресную книгу целиком.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>3. Как мы используем данные</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Предоставление и поддержание работы сервиса обмена сообщениями</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Доставка сообщений и уведомлений</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Обеспечение безопасности и предотвращение злоупотреблений</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Улучшение качества и функциональности Приложения</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Техническая поддержка пользователей</Text>

        <Text style={[s.h2, { color: colors.text }]}>4. Хранение и защита данных</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Данные хранятся на защищённых серверах с использованием стандартных мер безопасности, включая шифрование при передаче (TLS) и контроль доступа. Сообщения хранятся на серверах для обеспечения доставки и синхронизации между устройствами.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>5. Передача данных третьим лицам</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Мы не продаём и не передаём ваши персональные данные третьим лицам, за исключением следующих случаев:
        </Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— По требованию закона или в ответ на юридически обязательные запросы органов власти</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Для защиты прав, безопасности и собственности VayChat и его пользователей</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— С привлечением подрядчиков, которые обрабатывают данные от нашего имени (облачные провайдеры) и обязаны соблюдать конфиденциальность</Text>

        <Text style={[s.h2, { color: colors.text }]}>6. Ваши права</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>Вы имеете право:</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Запросить доступ к своим персональным данным</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Запросить исправление неточных данных</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Запросить удаление вашего аккаунта и связанных данных</Text>
        <Text style={[s.li, { color: colors.textSecondary }]}>— Отозвать согласие на обработку данных (путём удаления аккаунта)</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Для реализации этих прав обратитесь по адресу: support@vaychat.net
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>7. Сроки хранения</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Мы храним данные столько, сколько необходимо для предоставления сервиса. Сообщения с функцией автоудаления удаляются автоматически. При удалении аккаунта все данные удаляются в течение 30 дней, за исключением случаев, когда законодательство требует более длительного хранения.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>8. Дети</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Приложение не предназначено для лиц младше 13 лет. Мы не собираем сознательно данные детей младше этого возраста. Если вы узнали, что ребёнок предоставил нам свои данные, свяжитесь с нами для их удаления.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>9. Push-уведомления</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Для доставки push-уведомлений мы используем Apple Push Notification Service (APNs) и Firebase Cloud Messaging (FCM). Токены устройств хранятся на наших серверах и автоматически удаляются при выходе из аккаунта или неактивности более 60 дней.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>10. Изменения политики</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          Мы оставляем за собой право обновлять настоящую Политику. О существенных изменениях мы уведомим через Приложение. Актуальная версия всегда доступна в самом Приложении.
        </Text>

        <Text style={[s.h2, { color: colors.text }]}>11. Контакты</Text>
        <Text style={[s.p, { color: colors.textSecondary }]}>
          По вопросам, связанным с конфиденциальностью, обращайтесь:{'\n'}support@vaychat.net
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
  h3: { fontSize: 15, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  p: { fontSize: 14, lineHeight: 22, marginBottom: 8 },
  li: { fontSize: 14, lineHeight: 22, paddingLeft: 8, marginBottom: 4 },
});

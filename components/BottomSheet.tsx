import React from 'react';
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '@/lib/appearance-context';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  scrollable?: boolean;
  maxHeight?: string | number;
  avoidKeyboard?: boolean;
}

export default function BottomSheet({
  visible,
  onClose,
  children,
  scrollable = false,
  maxHeight,
  avoidKeyboard = false,
}: BottomSheetProps) {
  const { colors } = useAppearance();
  const insets = useSafeAreaInsets();

  const sheet = (
    <View
      style={[
        styles.sheet,
        { backgroundColor: colors.backgroundElevated, paddingBottom: Math.max(insets.bottom, 20) },
        maxHeight ? { maxHeight: maxHeight as any } : undefined,
      ]}
    >
      {scrollable ? (
        <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <Pressable style={styles.backdrop} onPress={onClose}>
            <Pressable onPress={() => {}}>
              {sheet}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      ) : (
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable onPress={() => {}}>
            {sheet}
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 0,
  },
});

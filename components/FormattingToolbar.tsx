import { View, TouchableOpacity, StyleSheet, TextInput, Text, Modal, Pressable } from 'react-native';
import { Bold, Italic, Strikethrough, Code, Link2, Quote, X } from 'lucide-react-native';
import { useState } from 'react';

interface Props {
  inputRef: React.RefObject<TextInput | null>;
  input: string;
  onChangeText: (text: string) => void;
  colors: any;
  visible: boolean;
  onClose: () => void;
  selectionRef: React.MutableRefObject<{ start: number; end: number }>;
}

export default function FormattingToolbar({ inputRef, input, onChangeText, colors, visible, onClose, selectionRef }: Props) {
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');

  if (!visible) return null;

  const getSelection = (): { start: number; end: number } => {
    return selectionRef.current;
  };

  const wrapSelection = (prefix: string, suffix: string) => {
    const sel = getSelection();
    const start = sel.start;
    const end = sel.end;

    if (start === end) {
      const newText = input.slice(0, start) + prefix + suffix + input.slice(start);
      onChangeText(newText);
      setTimeout(() => {
        inputRef.current?.setNativeProps?.({ selection: { start: start + prefix.length, end: start + prefix.length } });
      }, 50);
    } else {
      const selectedText = input.slice(start, end);
      const newText = input.slice(0, start) + prefix + selectedText + suffix + input.slice(end);
      onChangeText(newText);
    }
  };

  const applyBold = () => wrapSelection('**', '**');
  const applyItalic = () => wrapSelection('__', '__');
  const applyStrikethrough = () => wrapSelection('~~', '~~');
  const applyMono = () => wrapSelection('`', '`');
  const applyQuote = () => {
    const sel = getSelection();
    const start = sel.start;
    const end = sel.end;

    const lineStart = input.lastIndexOf('\n', start - 1) + 1;
    const selectedText = start === end ? '' : input.slice(start, end);

    if (start === end) {
      const before = input.slice(0, lineStart);
      const lineEnd = input.indexOf('\n', start);
      const currentLine = input.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      const rest = lineEnd === -1 ? '' : input.slice(lineEnd);
      if (currentLine.startsWith('> ')) {
        onChangeText(before + currentLine.slice(2) + rest);
      } else {
        onChangeText(before + '> ' + currentLine + rest);
      }
    } else {
      const lines = selectedText.split('\n');
      const allQuoted = lines.every(l => l.startsWith('> '));
      const transformed = allQuoted
        ? lines.map(l => l.slice(2)).join('\n')
        : lines.map(l => '> ' + l).join('\n');
      onChangeText(input.slice(0, start) + transformed + input.slice(end));
    }
  };

  const openLinkModal = () => {
    const sel = getSelection();
    const selectedText = input.slice(sel.start, sel.end);
    setLinkText(selectedText);
    setLinkUrl('');
    setLinkModalVisible(true);
  };

  const applyLink = () => {
    if (!linkUrl.trim()) {
      setLinkModalVisible(false);
      return;
    }
    const sel = getSelection();
    const start = sel.start;
    const end = sel.end;
    const text = linkText || linkUrl;
    const markdown = `[${text}](${linkUrl.trim()})`;
    const newInput = input.slice(0, start) + markdown + input.slice(end);
    onChangeText(newInput);
    setLinkModalVisible(false);
  };

  const buttons = [
    { icon: Bold, action: applyBold, label: 'Bold' },
    { icon: Italic, action: applyItalic, label: 'Italic' },
    { icon: Strikethrough, action: applyStrikethrough, label: 'Strikethrough' },
    { icon: Code, action: applyMono, label: 'Monospace' },
    { icon: Link2, action: openLinkModal, label: 'Link' },
    { icon: Quote, action: applyQuote, label: 'Quote' },
  ];

  return (
    <>
      <View style={[styles.container, { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border }]}>
        <View style={styles.buttons}>
          {buttons.map(({ icon: Icon, action, label }) => (
            <TouchableOpacity key={label} onPress={action} style={styles.button} accessibilityLabel={label}>
              <Icon color={colors.text} size={18} />
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <X color={colors.textTertiary} size={16} />
        </TouchableOpacity>
      </View>

      <Modal visible={linkModalVisible} transparent animationType="fade" onRequestClose={() => setLinkModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setLinkModalVisible(false)}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.backgroundSecondary }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Вставить ссылку</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
              placeholder="Текст ссылки"
              placeholderTextColor={colors.textTertiary}
              value={linkText}
              onChangeText={setLinkText}
              autoFocus
            />
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
              placeholder="https://example.com"
              placeholderTextColor={colors.textTertiary}
              value={linkUrl}
              onChangeText={setLinkUrl}
              keyboardType="url"
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, { backgroundColor: colors.backgroundTertiary }]} onPress={() => setLinkModalVisible(false)}>
                <Text style={{ color: colors.text, fontWeight: '500' }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, { backgroundColor: colors.primary }]} onPress={applyLink}>
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Добавить</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}


const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  buttons: {
    flexDirection: 'row',
    flex: 1,
    gap: 2,
  },
  button: {
    width: 36,
    height: 32,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalInput: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    borderWidth: 1,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

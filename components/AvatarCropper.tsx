import { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform, ActivityIndicator } from 'react-native';
import { X, ZoomIn, ZoomOut, RotateCw, Check } from 'lucide-react-native';

interface AvatarCropperProps {
  visible: boolean;
  imageUri: string;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
  colors: Record<string, string>;
}

const CROP_SIZE = 280;
const CANVAS_SIZE = 400;

export default function AvatarCropper({ visible, imageUri, onCrop, onCancel, colors }: AvatarCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [baseScale, setBaseScale] = useState(1);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setImageLoaded(false);

    const img = new window.Image();
    const isObjectUrl = imageUri.startsWith('blob:');
    if (!isObjectUrl) img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      const minDim = Math.min(img.width, img.height);
      const s = CROP_SIZE / minDim;
      setBaseScale(s);
      setImageLoaded(true);
    };
    img.onerror = () => {
      onCancel();
    };
    img.src = imageUri;
  }, [visible, imageUri]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.save();
    ctx.translate(CANVAS_SIZE / 2 + offset.x, CANVAS_SIZE / 2 + offset.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(baseScale * scale, baseScale * scale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [offset, scale, rotation, baseScale]);

  useEffect(() => {
    if (imageLoaded) {
      requestAnimationFrame(draw);
    }
  }, [imageLoaded, draw]);

  const handleCrop = () => {
    const img = imageRef.current;
    if (!img) return;

    const outputSize = 512;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outputSize;
    outCanvas.height = outputSize;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return;

    const cropScale = outputSize / CROP_SIZE;

    ctx.translate(outputSize / 2, outputSize / 2);

    ctx.translate(offset.x * cropScale, offset.y * cropScale);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(baseScale * scale * cropScale, baseScale * scale * cropScale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    outCanvas.toBlob((blob) => {
      if (blob) {
        onCrop(blob);
      } else {
        try {
          const dataUrl = outCanvas.toDataURL('image/jpeg', 0.9);
          const byteString = atob(dataUrl.split(',')[1]);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
          const fallbackBlob = new Blob([ab], { type: 'image/jpeg' });
          onCrop(fallbackBlob);
        } catch {
          onCancel();
        }
      }
    }, 'image/jpeg', 0.9);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handlePointerUp = () => {
    setDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setScale((s) => Math.max(0.3, Math.min(5, s + delta)));
  };

  if (Platform.OS !== 'web') return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.92)' }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
            <X color="#FFFFFF" size={22} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Обрезать фото</Text>
          <TouchableOpacity onPress={handleCrop} style={[styles.headerBtn, styles.doneBtn, { backgroundColor: colors.primary }]}>
            <Check color="#FFFFFF" size={20} />
          </TouchableOpacity>
        </View>

        <View style={styles.canvasContainer}>
          {!imageLoaded ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#FFFFFF" size="large" />
            </View>
          ) : (
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              style={{
                width: CANVAS_SIZE,
                height: CANVAS_SIZE,
                borderRadius: 8,
                cursor: dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                userSelect: 'none',
              }}
              onPointerDown={handlePointerDown as any}
              onPointerMove={handlePointerMove as any}
              onPointerUp={handlePointerUp as any}
              onPointerLeave={handlePointerUp as any}
              onWheel={handleWheel as any}
            />
          )}
        </View>

        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => setScale((s) => Math.max(0.3, s - 0.15))}
          >
            <ZoomOut color="#FFFFFF" size={22} />
          </TouchableOpacity>

          <View style={styles.scaleIndicator}>
            <View style={[styles.scaleTrack, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <View
                style={[
                  styles.scaleFill,
                  { backgroundColor: colors.primary, width: `${Math.min(100, ((scale - 0.3) / 4.7) * 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.scaleText}>{Math.round(scale * 100)}%</Text>
          </View>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => setScale((s) => Math.min(5, s + 0.15))}
          >
            <ZoomIn color="#FFFFFF" size={22} />
          </TouchableOpacity>

          <View style={styles.controlDivider} />

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => setRotation((r) => (r + 90) % 360)}
          >
            <RotateCw color="#FFFFFF" size={22} />
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>
          Перетащите для перемещения. Прокрутите для масштабирования.
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 440,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  doneBtn: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  canvasContainer: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    marginBottom: 16,
  },
  controlBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  scaleIndicator: {
    alignItems: 'center',
    gap: 4,
    minWidth: 100,
  },
  scaleTrack: {
    width: 100,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  scaleFill: {
    height: '100%',
    borderRadius: 2,
  },
  scaleText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '500',
  },
  controlDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  hint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    textAlign: 'center',
  },
});

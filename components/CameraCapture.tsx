import { useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { ClothingImageInput } from '../services/clothingAnalysisService';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCapture: (image: ClothingImageInput) => void;
};

export function CameraCapture({ visible, onClose, onCapture }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission, visible]);

  const takePhoto = async () => {
    if (!cameraRef.current || !ready || capturing) return;
    setCapturing(true);
    try {
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      onCapture({
        uri: picture.uri,
        width: picture.width,
        height: picture.height,
        source: 'camera',
      });
      onClose();
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Photograph Item</Text>
          <View style={styles.headerSpacer} />
        </View>

        {permission?.granted ? (
          <View style={styles.cameraFrame}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              mode="picture"
              onCameraReady={() => setReady(true)}
            />
            <View pointerEvents="none" style={styles.guide}>
              <View style={styles.guideBox} />
              <Text style={styles.guideText}>Center one clothing item</Text>
            </View>
          </View>
        ) : (
          <View style={styles.permissionState}>
            <Text style={styles.permissionTitle}>Camera permission needed</Text>
            <Text style={styles.permissionText}>
              ClosetAI needs camera access to photograph wardrobe pieces.
            </Text>
            <Pressable onPress={requestPermission} style={styles.permissionButton}>
              <Text style={styles.permissionButtonText}>Enable camera</Text>
            </Pressable>
          </View>
        )}

        {permission?.granted && (
          <View style={styles.controls}>
            <Pressable
              accessibilityLabel="Take photo"
              onPress={takePhoto}
              disabled={!ready || capturing}
              style={[styles.shutter, (!ready || capturing) && styles.shutterDisabled]}
            >
              <View style={styles.shutterCenter} />
            </Pressable>
            <Text style={styles.captureLabel}>
              {capturing ? 'Capturing...' : 'Tap to capture'}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: '#0C100E' },
  header: {
    paddingTop: 54,
    paddingHorizontal: 18,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: { width: 70, paddingVertical: 8 },
  headerButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  headerSpacer: { width: 70 },
  cameraFrame: { flex: 1, marginHorizontal: 14, overflow: 'hidden', borderRadius: 28 },
  camera: { flex: 1 },
  guide: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBox: {
    width: '72%',
    height: '65%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    borderRadius: 26,
  },
  guideText: {
    marginTop: 16,
    paddingHorizontal: 13,
    paddingVertical: 7,
    overflow: 'hidden',
    borderRadius: 12,
    color: '#FFFFFF',
    backgroundColor: 'rgba(12,16,14,0.7)',
    fontSize: 12,
    fontWeight: '800',
  },
  permissionState: {
    flex: 1,
    margin: 20,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: colors.card,
  },
  permissionTitle: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  permissionText: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: 22,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.green,
  },
  permissionButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  controls: { height: 150, alignItems: 'center', justifyContent: 'center' },
  shutter: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    borderRadius: 40,
  },
  shutterDisabled: { opacity: 0.45 },
  shutterCenter: { width: 56, height: 56, borderRadius: 30, backgroundColor: '#FFFFFF' },
  captureLabel: { marginTop: 10, color: '#CDD3CF', fontSize: 11, fontWeight: '700' },
});

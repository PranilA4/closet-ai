import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraCapture } from '../components/CameraCapture';
import { ClothingEditor } from '../components/ClothingEditor';
import { ScreenEntrance } from '../components/ScreenEntrance';
import { analyzeClothingWithAI } from '../services/aiClothingService';
import { analyzeClothingImage, ClothingImageInput } from '../services/clothingAnalysisService';
import { colors, shadows } from '../theme';
import { titleCase } from '../utils/text';
import { NewClothingItem, ProductMatch } from '../types';

type Props = {
  onCancel: () => void;
  onSave: (item: NewClothingItem) => void | Promise<void>;
};

export function AddClothingScreen({ onCancel, onSave }: Props) {
  const [item, setItem] = useState<NewClothingItem | null>(null);
  const [originalItem, setOriginalItem] = useState<NewClothingItem | null>(null);
  const [matches, setMatches] = useState<ProductMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysisNote, setAnalysisNote] = useState('');

  const openProduct = async (url: string) => {
    if (!(await Linking.canOpenURL(url))) {
      Alert.alert('Product unavailable', 'This verified retailer link can no longer be opened.');
      return;
    }
    await Linking.openURL(url);
  };

  const applyMatch = (match: ProductMatch, base = item ?? originalItem) => {
    if (!base) return;
    setSelectedMatchId(match.id);
    setItem({
      ...base,
      name: match.name || base.name,
      imageUri: match.imageUrl || base.imageUri,
      imageSource: 'retailer',
      cutoutStatus: 'retailer',
      sourceUrl: match.productUrl,
      retailer: match.retailer,
      productUrl: match.productUrl,
      priceCad: match.priceCad,
    });
  };

  const useOriginal = () => {
    if (!originalItem) return;
    setSelectedMatchId(null);
    setItem({
      ...originalItem,
      name: item?.name ?? originalItem.name,
      color: item?.color ?? originalItem.color,
      category: item?.category ?? originalItem.category,
      style: item?.style ?? originalItem.style,
      occasions: item?.occasions ?? originalItem.occasions,
      formality: item?.formality ?? originalItem.formality,
      imageSource: 'local',
    });
  };

  const processImage = async (image: ClothingImageInput) => {
    setAnalyzing(true);
    setMatches([]);
    setSelectedMatchId(null);
    try {
      const local = await analyzeClothingImage(image);
      setOriginalItem(local);
      setItem(local);
      try {
        const result = await analyzeClothingWithAI(image);
        const aiOriginal = {
          ...result.item,
          imageUri: image.uri,
          imageSource: 'local' as const,
        };
        setOriginalItem(aiOriginal);
        setItem(aiOriginal);
        setMatches(result.matches);
        const providerName = result.diagnostics?.analysisProvider === 'gemini' ? 'Gemini' : 'Cloudflare';
        setAnalysisNote(
          result.aiProcessed
            ? `${providerName} verified the item${result.colorConfidence ? ` / ${Math.round(result.colorConfidence * 100)}% colour confidence` : ''}.${result.matches.length ? ' A retailer image is selected; choose Your Photo to keep the original instead.' : ' No verified Canadian product match was found, so your original photo is kept.'}`
            : `Local fallback used${result.warning ? `: ${result.warning}` : '.'}`,
        );
        if (result.matches[0]) applyMatch(result.matches[0], aiOriginal);
      } catch (error) {
        setItem(local);
        setAnalysisNote(
          error instanceof Error
            ? `Local fallback used: ${error.message}`
            : 'Local fallback used. Live recognition or product search is unavailable.',
        );
      }
    } catch {
      const fallback: NewClothingItem = {
        imageUri: image.uri,
        imageSource: 'local',
        cutoutStatus: 'original',
        analysisSource: 'local',
        analysisConfidence: 0,
        name: 'Everyday Top',
        category: 'top',
        garmentType: 't-shirt',
        color: 'Neutral',
        style: 'casual',
        occasions: ['casual', 'school'],
        formality: 'relaxed',
      };
      setOriginalItem(fallback);
      setItem(fallback);
    } finally {
      setAnalyzing(false);
    }
  };

  const choosePhoto = async () => {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access needed', 'Allow photo access to choose a clothing image.');
        return;
      }
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.82 });
      if (!result.canceled) {
        const asset = result.assets[0];
        await processImage({ uri: asset.uri, fileName: asset.fileName, width: asset.width, height: asset.height, source: 'library' });
      }
    } catch {
      Alert.alert('Photo could not open', 'Please try choosing the photo again.');
    }
  };

  const takePhoto = async () => {
    if (Platform.OS === 'web') {
      setCameraOpen(true);
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera access needed',
        'Allow camera access in your phone settings, then try again.',
      );
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.82,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        await processImage({
          uri: asset.uri,
          fileName: asset.fileName,
          width: asset.width,
          height: asset.height,
          source: 'camera',
        });
      }
    } catch (error) {
      Alert.alert(
        'Camera could not open',
        error instanceof Error ? error.message : 'Close Expo Go, reopen it, and try again.',
      );
    }
  };

  const save = async () => {
    if (!item || saving) return;
    setSaving(true);
    try {
      await onSave(item);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <CameraCapture visible={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={processImage} />
      <ScreenEntrance>
        <Pressable onPress={onCancel}><Text style={styles.cancel}>&lt;- Back to closet</Text></Pressable>
        <Text style={styles.eyebrow}>SMART IMPORT</Text>
        <Text style={styles.title}>Add One Piece.</Text>
        <Text style={styles.subtitle}>ClosetAI identifies it, checks verified Canadian store results, and pre-fills the useful details.</Text>

        <View style={[styles.photoBox, shadows.card]}>
          {item ? <Image source={{ uri: item.imageUri }} style={styles.preview} resizeMode="contain" /> : (
            <View style={styles.photoPlaceholder}>
              <View style={styles.cameraGraphic}><View style={styles.cameraLens} /></View>
              <Text style={styles.photoText}>{analyzing ? 'ClosetAI is finding your piece...' : 'Choose a clear clothing photo'}</Text>
            </View>
          )}
          {analyzing && <View style={styles.loadingCover}><ActivityIndicator color={colors.green} /><Text style={styles.loadingText}>ANALYSING AND SEARCHING CANADA</Text></View>}
        </View>

        <View style={styles.photoActions}>
          <Pressable style={styles.secondaryButton} onPress={choosePhoto}><Text style={styles.secondaryText}>Choose photo</Text></Pressable>
          <Pressable style={[styles.secondaryButton, styles.cameraButton]} onPress={takePhoto}><Text style={styles.cameraButtonText}>Open camera</Text></Pressable>
        </View>

        {!!matches.length && (
          <View style={styles.matchesSection}>
            <View style={styles.sectionHeading}>
              <View><Text style={styles.sectionEyebrow}>ONLINE MATCHES</Text><Text style={styles.sectionTitle}>Closest Products</Text></View>
              <Text style={styles.caBadge}>CANADA</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
              {matches.map((match, index) => (
                <Pressable key={match.id} onPress={() => applyMatch(match)} style={[styles.matchCard, selectedMatchId === match.id && styles.matchCardActive]}>
                  <Image source={{ uri: match.imageUrl || originalItem?.imageUri }} style={styles.matchImage} resizeMode="contain" />
                  <Text style={styles.matchRank}>{index === 0 ? 'BEST MATCH' : `${Math.round(match.confidence * 100)}% MATCH`}</Text>
                  <Text style={styles.matchName} numberOfLines={2}>{titleCase(match.name)}</Text>
                  <Text style={styles.matchMeta}>{match.retailer}{match.priceCad ? ` / ${match.priceCad}` : ''}</Text>
                  <Pressable onPress={() => openProduct(match.productUrl)} style={styles.sourceButton}><Text style={styles.sourceText}>View product</Text></Pressable>
                </Pressable>
              ))}
              <Pressable onPress={useOriginal} style={[styles.matchCard, selectedMatchId === null && styles.matchCardActive, styles.originalCard]}>
                {originalItem && <Image source={{ uri: originalItem.imageUri }} style={styles.matchImage} resizeMode="contain" />}
                <Text style={styles.matchRank}>YOUR PHOTO</Text><Text style={styles.matchName}>Use my original</Text><Text style={styles.matchMeta}>Always available</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}

        {item && !analyzing && (
          <>
            <View style={styles.scanCard}>
              <View><Text style={styles.scanEyebrow}>AUTO-DETECTED</Text><Text style={styles.itemName}>{titleCase(item.name)}</Text></View>
              <View style={styles.readyBadge}><Text style={styles.readyText}>READY</Text></View>
            </View>
            {!!analysisNote && <Text style={styles.analysisNote}>{analysisNote}</Text>}
            <ClothingEditor item={item} onChange={setItem} />
          </>
        )}

        <Pressable style={[styles.saveButton, (!item || saving) && styles.saveButtonDisabled]} onPress={save} disabled={!item || saving}>
          <Text style={styles.saveText}>{saving ? 'Saving to your closet...' : 'Add to wardrobe'}</Text>
        </Pressable>
      </ScreenEntrance>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 22, paddingBottom: 60 },
  cancel: { marginTop: 10, color: colors.green, fontSize: 12, fontWeight: '800' },
  eyebrow: { marginTop: 24, color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  title: { marginTop: 6, color: colors.ink, fontSize: 38, fontWeight: '900', letterSpacing: -1.5 },
  subtitle: { marginTop: 8, maxWidth: 430, color: colors.muted, fontSize: 13, lineHeight: 20 },
  photoBox: { marginTop: 22, height: 280, overflow: 'hidden', padding: 12, borderRadius: 28, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFFFF' },
  preview: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#E8D2B5' },
  cameraGraphic: { width: 58, height: 43, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.green, borderRadius: 11 },
  cameraLens: { width: 19, height: 19, borderWidth: 3, borderColor: colors.green, borderRadius: 12 },
  photoText: { marginTop: 13, color: colors.muted, fontSize: 12, fontWeight: '700' },
  loadingCover: { position: 'absolute', top: 12, right: 12, bottom: 12, left: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: 'rgba(255,252,247,0.88)' },
  loadingText: { marginTop: 12, color: colors.green, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  photoActions: { marginTop: 10, flexDirection: 'row', gap: 10 },
  secondaryButton: { flex: 1, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card },
  cameraButton: { borderColor: colors.ink, backgroundColor: colors.ink },
  secondaryText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  cameraButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  matchesSection: { marginTop: 26 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionEyebrow: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  sectionTitle: { marginTop: 4, color: colors.ink, fontSize: 21, fontWeight: '900' },
  caBadge: { color: colors.green, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  matchRow: { paddingVertical: 12, gap: 10 },
  matchCard: { width: 150, padding: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.card },
  matchCardActive: { borderWidth: 2, borderColor: colors.green, backgroundColor: '#F7FBF6' },
  originalCard: { marginRight: 4 },
  matchImage: { width: '100%', height: 105, borderRadius: 12, backgroundColor: '#EAD8C0' },
  matchRank: { marginTop: 9, color: colors.gold, fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  matchName: { marginTop: 4, minHeight: 32, color: colors.ink, fontSize: 12, fontWeight: '900', lineHeight: 15 },
  matchMeta: { marginTop: 5, color: colors.muted, fontSize: 9 },
  sourceButton: { marginTop: 8, paddingVertical: 7, alignItems: 'center', borderRadius: 9, backgroundColor: colors.ink },
  sourceText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' },
  scanCard: { marginTop: 20, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#C8D9CC', borderRadius: 20, backgroundColor: colors.greenSoft },
  scanEyebrow: { color: colors.green, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  itemName: { marginTop: 5, maxWidth: 270, color: colors.ink, fontSize: 19, fontWeight: '900' },
  readyBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.green },
  readyText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  analysisNote: { marginTop: 9, color: colors.muted, fontSize: 10, lineHeight: 15 },
  saveButton: { marginTop: 24, paddingVertical: 18, alignItems: 'center', borderRadius: 17, backgroundColor: colors.greenDark },
  saveButtonDisabled: { opacity: 0.45 },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});

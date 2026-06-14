import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { OutfitPreview } from '../components/OutfitPreview';
import { ScreenEntrance } from '../components/ScreenEntrance';
import { requestOutfitImage } from '../services/outfitImageService';
import { generateOutfit, getOutfitAvailability, outfitSignature } from '../services/outfitService';
import { colors, shadows } from '../theme';
import { ClothingItem, Outfit, OutfitBodyShape, OutfitFeedback, OutfitHistory, OutfitMode } from '../types';
import { titleCase } from '../utils/text';

type Props = {
  wardrobe: ClothingItem[];
  history: OutfitHistory[];
  onFeedback: (outfit: Outfit, feedback: OutfitFeedback) => void;
  onWorn: (outfit: Outfit) => void;
  onPreviewGenerated: (outfit: Outfit) => void;
};

const modes: { label: string; value: OutfitMode }[] = [
  { label: 'Best match', value: 'any' },
  { label: 'Casual', value: 'casual' },
  { label: 'Formal', value: 'formal' },
  { label: 'Semi-formal', value: 'semi-formal' },
  { label: 'School', value: 'school' },
  { label: 'Work', value: 'work' },
  { label: 'Date night', value: 'date-night' },
  { label: 'Active', value: 'active' },
  { label: 'Streetwear', value: 'streetwear' },
];

const bodyShapes: { label: string; value: OutfitBodyShape }[] = [
  { label: 'Lean', value: 'lean' },
  { label: 'Average', value: 'average' },
  { label: 'Athletic', value: 'athletic' },
  { label: 'Curvy', value: 'curvy' },
  { label: 'Plus-size', value: 'plus-size' },
];
const bodyShapeWidths: Record<OutfitBodyShape, number> = {
  lean: 10,
  average: 15,
  athletic: 20,
  curvy: 20,
  'plus-size': 24,
};

export function OutfitScreen({ wardrobe, history, onFeedback, onWorn, onPreviewGenerated }: Props) {
  const [mode, setMode] = useState<OutfitMode>('any');
  const [bodyShape, setBodyShape] = useState<OutfitBodyShape>('average');
  const [tab, setTab] = useState<'studio' | 'history'>('studio');
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [notice, setNotice] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const generatedSignatures = useRef<string[]>([]);
  const transition = useRef(new Animated.Value(1)).current;
  const wardrobeFingerprint = useMemo(() => wardrobe.map((item) => [
    item.id,
    item.clean,
    item.category,
    item.style,
    item.garmentType,
    item.formality,
    [...item.occasions].sort().join(','),
  ].join(':')).sort().join('|'), [wardrobe]);

  const buildOutfit = (previous: Outfit | null = outfit, requestedMode = mode) => {
    const next = generateOutfit(wardrobe, previous, requestedMode, history, generatedSignatures.current);
    setOutfit(next ? { ...next, previewBodyShape: bodyShape } : null);
    setNotice('');
    setPreviewError('');
    setPreviewLoading(false);
    if (next) {
      generatedSignatures.current = [outfitSignature(next), ...generatedSignatures.current].slice(0, 30);
      transition.setValue(0);
      Animated.spring(transition, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 120 }).start();
    }
  };

  useEffect(() => { buildOutfit(null, mode); }, [mode, wardrobeFingerprint]);

  const generatePreview = async () => {
    if (!outfit || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const result = await requestOutfitImage(outfit);
      const generatedOutfit: Outfit = {
        ...outfit,
        previewImageUri: result.imageUri,
        previewImageProvider: result.provider,
        previewBodyShape: bodyShape,
      };
      setOutfit((current) => current?.id === outfit.id ? generatedOutfit : current);
      onPreviewGenerated(generatedOutfit);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'AI preview unavailable.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const currentFeedback = history.find((entry) => entry.id === outfit?.id)?.feedback ?? null;
  const availability = getOutfitAvailability(wardrobe, mode);
  const missing = Object.entries(availability).filter(([, ready]) => !ready).map(([category]) => category);
  const feedback = (value: Exclude<OutfitFeedback, null>) => {
    if (!outfit) return;
    const next = currentFeedback === value ? null : value;
    onFeedback(outfit, next);
    setNotice(next === 'like' ? 'More looks like this will move up.' : next === 'dislike' ? 'We will steer away from this combination.' : 'Feedback cleared.');
  };
  const wore = () => {
    if (!outfit) return;
    onWorn(outfit);
    setNotice('Outfit saved to history and all three pieces marked worn.');
  };
  const chooseBodyShape = (value: OutfitBodyShape) => {
    setBodyShape(value);
    setPreviewError('');
    setOutfit((current) => current ? {
      ...current,
      previewBodyShape: value,
      previewImageUri: undefined,
      previewImageProvider: undefined,
    } : current);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenEntrance>
        <View style={styles.headingRow}><View><Text style={styles.eyebrow}>PERSONAL STYLIST</Text><Text style={styles.title}>The Outfit Studio</Text></View><View style={styles.tabs}><Pressable onPress={() => setTab('studio')} style={[styles.tab, tab === 'studio' && styles.tabActive]}><Text style={[styles.tabText, tab === 'studio' && styles.tabTextActive]}>Studio</Text></Pressable><Pressable onPress={() => setTab('history')} style={[styles.tab, tab === 'history' && styles.tabActive]}><Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>History</Text></Pressable></View></View>

        {tab === 'studio' ? (
          <>
            <Text style={styles.subtitle}>Choose the moment. ClosetAI balances colour, dress code, recent outfits, and your feedback.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modes}>
              {modes.map((option) => <Pressable key={option.value} onPress={() => setMode(option.value)} style={[styles.mode, mode === option.value && styles.modeActive]}><Text style={[styles.modeText, mode === option.value && styles.modeTextActive]}>{option.label}</Text></Pressable>)}
            </ScrollView>
            <View style={styles.bodyHeading}><View><Text style={styles.bodyTitle}>Preview Body Shape</Text><Text style={styles.bodySubtitle}>Choose the proportions used for the AI outfit image.</Text></View><Text style={styles.bodyValue}>{bodyShape.replace('-', ' ')}</Text></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bodyShapes}>
              {bodyShapes.map((option) => <Pressable key={option.value} onPress={() => chooseBodyShape(option.value)} style={[styles.bodyShape, bodyShape === option.value && styles.bodyShapeActive]}><View style={[styles.bodyIcon, { width: bodyShapeWidths[option.value] }]} /><Text style={[styles.bodyShapeText, bodyShape === option.value && styles.bodyShapeTextActive]}>{option.label}</Text></Pressable>)}
            </ScrollView>
            {outfit ? (
              <>
                <Animated.View style={{ opacity: transition, transform: [{ translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}><OutfitPreview outfit={outfit} loading={previewLoading} error={previewError} onGenerate={generatePreview} /></Animated.View>
                <View style={styles.feedbackRow}>
                  <Pressable onPress={() => feedback('like')} style={({ pressed }) => [styles.feedback, currentFeedback === 'like' && styles.likeActive, pressed && styles.pressed]}><Text style={[styles.feedbackText, currentFeedback === 'like' && styles.activeText]}>Like</Text></Pressable>
                  <Pressable onPress={() => feedback('dislike')} style={({ pressed }) => [styles.feedback, currentFeedback === 'dislike' && styles.dislikeActive, pressed && styles.pressed]}><Text style={[styles.feedbackText, currentFeedback === 'dislike' && styles.activeText]}>Dislike</Text></Pressable>
                  <Pressable onPress={() => buildOutfit()} style={({ pressed }) => [styles.feedback, styles.another, pressed && styles.pressed]}><Text style={styles.anotherText}>Another</Text></Pressable>
                </View>
                <Pressable onPress={wore} style={({ pressed }) => [styles.woreButton, pressed && styles.pressed]}><Text style={styles.woreText}>I wore this outfit</Text><Text style={styles.woreSub}>Save it and send all pieces to laundry</Text></Pressable>
                {!!notice && <Text style={styles.notice}>{notice}</Text>}
              </>
            ) : (
              <View style={styles.empty}><View style={styles.emptyIcon} /><Text style={styles.emptyTitle}>{titleCase(`No Complete ${mode === 'any' ? 'Clean' : mode.replace('-', ' ')} Outfit`)}</Text><Text style={styles.emptyText}>{missing.length ? `Add or clean an eligible ${missing.join(', ')}. Dress-code rules exclude pieces such as T-shirts, hoodies, shorts, sweatpants, and athletic shoes from work and formal looks.` : 'You need at least one clean top, bottom, and pair of shoes.'}</Text></View>
            )}
          </>
        ) : (
          <View style={styles.historyList}>
            <Text style={styles.historyIntro}>Only outfits you liked, disliked, or wore are saved here.</Text>
            {history.length ? history.map((entry) => (
              <View key={entry.id} style={[styles.historyCard, shadows.card]}>
                {entry.outfit.previewImageUri ? <Image source={{ uri: entry.outfit.previewImageUri }} style={styles.historyPreview} resizeMode="cover" /> : <View style={styles.historyImages}>{[entry.outfit.top, entry.outfit.bottom, entry.outfit.shoes].map((item) => <View key={item.id} style={styles.historyImageWrap}><Image source={{ uri: item.imageUri }} style={styles.historyImage} resizeMode="contain" /></View>)}</View>}
                <View style={styles.historyCopy}><View style={styles.historyTop}><Text style={styles.historyTitle}>{titleCase(entry.outfit.trend)}</Text><Text style={styles.historyBadge}>{entry.wornAt ? 'WORN' : entry.feedback?.toUpperCase() ?? 'SAVED'}</Text></View><Text style={styles.historyMeta}>{titleCase(entry.occasion === 'any' ? 'Best Match' : entry.occasion.replace('-', ' '))} / {titleCase(entry.outfit.previewBodyShape?.replace('-', ' ') ?? 'Source Pieces')} / {new Date(entry.generatedAt).toLocaleDateString()}</Text><Text style={styles.historyReason} numberOfLines={2}>{entry.outfit.reason}</Text></View>
              </View>
            )) : <View style={styles.empty}><Text style={styles.emptyTitle}>No Outfit History Yet</Text><Text style={styles.emptyText}>Like, dislike, or wear a look to save it here.</Text></View>}
          </View>
        )}
      </ScreenEntrance>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 60 },
  headingRow: { marginTop: 20, gap: 14 },
  eyebrow: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  title: { marginTop: 5, color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1.3 },
  subtitle: { marginTop: 8, color: colors.muted, fontSize: 12, lineHeight: 18 },
  tabs: { alignSelf: 'flex-start', padding: 3, flexDirection: 'row', borderRadius: 14, backgroundColor: colors.canvasDeep },
  tab: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 11 },
  tabActive: { backgroundColor: colors.ink },
  tabText: { color: colors.muted, fontSize: 10, fontWeight: '900' },
  tabTextActive: { color: '#FFFFFF' },
  modes: { paddingVertical: 17, gap: 7 },
  mode: { paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 17, backgroundColor: colors.card },
  modeActive: { borderColor: colors.green, backgroundColor: colors.green },
  modeText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  modeTextActive: { color: '#FFFFFF' },
  bodyHeading: { marginTop: 2, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  bodyTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  bodySubtitle: { marginTop: 3, color: colors.muted, fontSize: 9 },
  bodyValue: { color: colors.gold, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  bodyShapes: { paddingTop: 11, paddingBottom: 16, gap: 8 },
  bodyShape: { minWidth: 72, paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.card },
  bodyShapeActive: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  bodyShapeText: { color: colors.muted, fontSize: 8, fontWeight: '900' },
  bodyShapeTextActive: { color: colors.green },
  bodyIcon: { height: 28, borderRadius: 12, backgroundColor: colors.peach },
  feedbackRow: { marginTop: 12, flexDirection: 'row', gap: 8 },
  feedback: { flex: 1, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.card },
  feedbackText: { color: colors.ink, fontSize: 11, fontWeight: '900' },
  likeActive: { borderColor: colors.green, backgroundColor: colors.green },
  dislikeActive: { borderColor: colors.dirty, backgroundColor: colors.dirty },
  activeText: { color: '#FFFFFF' },
  another: { borderColor: colors.ink, backgroundColor: colors.ink },
  anotherText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  woreButton: { marginTop: 10, paddingVertical: 16, alignItems: 'center', borderRadius: 16, backgroundColor: colors.goldSoft },
  woreText: { color: '#6B4D19', fontSize: 13, fontWeight: '900' },
  woreSub: { marginTop: 3, color: '#806838', fontSize: 9 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  notice: { marginTop: 10, color: colors.green, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  empty: { marginTop: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 24, backgroundColor: colors.card },
  emptyIcon: { width: 44, height: 44, borderWidth: 8, borderColor: colors.peach, transform: [{ rotate: '45deg' }] },
  emptyTitle: { marginTop: 20, color: colors.ink, fontSize: 19, fontWeight: '900' },
  emptyText: { marginTop: 8, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  historyList: { marginTop: 16, gap: 12 },
  historyIntro: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  historyCard: { overflow: 'hidden', borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.card },
  historyImages: { height: 105, padding: 8, flexDirection: 'row', gap: 6, backgroundColor: '#EAD6BB' },
  historyPreview: { width: '100%', height: 180, backgroundColor: '#EAD6BB' },
  historyImageWrap: { flex: 1, padding: 5, borderRadius: 12, backgroundColor: '#FFFFFF' },
  historyImage: { width: '100%', height: '100%' },
  historyCopy: { padding: 14 },
  historyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  historyTitle: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '900' },
  historyBadge: { color: colors.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  historyMeta: { marginTop: 4, color: colors.gold, fontSize: 9, fontWeight: '800', textTransform: 'capitalize' },
  historyReason: { marginTop: 7, color: colors.muted, fontSize: 10, lineHeight: 15 },
});

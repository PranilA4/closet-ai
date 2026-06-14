import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ClothingEditor } from '../components/ClothingEditor';
import { MotionPressable } from '../components/MotionPressable';
import { loadCachedClothingPairings, productImageUri, requestClothingPairings } from '../services/clothingPairingService';
import { colors, shadows } from '../theme';
import {
  ClothingItem,
  ClothingPairingResult,
  NewClothingItem,
  RecommendationDislikeReason,
  RecommendationFeedbackValue,
  ShoppingRecommendation,
  UserPreferences,
} from '../types';
import { titleCase } from '../utils/text';

type Props = {
  userId: string;
  item: ClothingItem;
  wardrobe: ClothingItem[];
  preferences: UserPreferences;
  onCancel: () => void;
  onSave: (item: ClothingItem) => void;
  onRecommendationFeedback: (item: ShoppingRecommendation, value: RecommendationFeedbackValue, reasons: RecommendationDislikeReason[]) => Promise<void>;
  onAddRecommendation: (item: ShoppingRecommendation) => Promise<'added' | 'exists' | 'unavailable'>;
};

export function EditClothingScreen({ userId, item, wardrobe, preferences, onCancel, onSave, onRecommendationFeedback, onAddRecommendation }: Props) {
  const [draft, setDraft] = useState<NewClothingItem>({
    name: item.name,
    category: item.category,
    color: item.color,
    style: item.style,
    garmentType: item.garmentType,
    occasions: item.occasions,
    formality: item.formality,
    imageUri: item.imageUri,
    imageSource: item.imageSource,
    cutoutStatus: item.cutoutStatus,
    analysisSource: item.analysisSource,
    analysisConfidence: item.analysisConfidence,
    objectKey: item.objectKey,
    sourceUrl: item.sourceUrl,
    retailer: item.retailer,
    productUrl: item.productUrl,
    priceCad: item.priceCad,
  });
  const [pairings, setPairings] = useState<ClothingPairingResult | null>(null);
  const [pairingsLoading, setPairingsLoading] = useState(false);
  const [pairingNotice, setPairingNotice] = useState('');
  const reveal = useRef(new Animated.Value(0)).current;
  const lastForceRefreshAt = useRef(0);

  const currentItem = (): ClothingItem => ({ ...item, ...draft });
  const showPairings = (result: ClothingPairingResult) => {
    setPairings(result);
    reveal.setValue(0);
    Animated.spring(reveal, { toValue: 1, useNativeDriver: true, damping: 17, stiffness: 120 }).start();
  };

  useEffect(() => {
    let active = true;
    void loadCachedClothingPairings(userId, currentItem(), wardrobe, preferences).then((result) => {
      if (active && result) showPairings(result);
    });
    return () => { active = false; };
  }, [item.id, userId]);

  const findPairings = async (forceRefresh = false) => {
    if (pairingsLoading) return;
    if (forceRefresh && Date.now() - lastForceRefreshAt.current < 30_000) {
      const seconds = Math.ceil((30_000 - (Date.now() - lastForceRefreshAt.current)) / 1000);
      setPairingNotice(`Please wait ${seconds} seconds before another fresh search. Saved matches are still available.`);
      return;
    }
    if (forceRefresh) lastForceRefreshAt.current = Date.now();
    setPairingNotice('');
    const previous = pairings;
    const previousShopping = previous?.shoppingMatches ?? [];
    setPairingsLoading(true);
    try {
      const result = await requestClothingPairings(
        userId,
        currentItem(),
        wardrobe,
        preferences,
        forceRefresh,
        forceRefresh ? previousShopping.map((match) => match.productUrl).filter((url): url is string => Boolean(url)) : [],
      );
      if (!forceRefresh) {
        showPairings(result);
        return;
      }
      const freshCount = result.shoppingMatches.filter((match) =>
        !previousShopping.some((existing) => (existing.productUrl ?? existing.id) === (match.productUrl ?? match.id)),
      ).length;
      const seen = new Set<string>();
      const shoppingMatches = [...result.shoppingMatches, ...previousShopping].filter((match) => {
        const key = match.productUrl ?? match.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      showPairings({ ...result, shoppingMatches });
      setPairingNotice(freshCount
        ? `Added ${freshCount} new verified clothing ${freshCount === 1 ? 'match' : 'matches'}.`
        : 'No new verified clothing matches were found. Your saved matches were kept.');
    } catch (error) {
      setPairingNotice(error instanceof Error ? error.message : 'Fresh matching products are temporarily unavailable.');
    } finally {
      setPairingsLoading(false);
    }
  };

  const feedback = async (suggestion: ShoppingRecommendation, value: RecommendationFeedbackValue, reasons: RecommendationDislikeReason[]) => {
    await onRecommendationFeedback(suggestion, value, reasons);
    if (value === 'dislike') {
      setPairings((current) => current ? {
        ...current,
        shoppingMatches: current.shoppingMatches.filter((entry) => entry.id !== suggestion.id),
      } : current);
    }
  };

  const addSuggestion = async (suggestion: ShoppingRecommendation) => {
    const result = await onAddRecommendation(suggestion);
    if (result === 'added') Alert.alert('Added to your closet', `${suggestion.title} is now in your wardrobe.`);
    if (result === 'exists') Alert.alert('Already saved', 'This exact product is already in your closet.');
    if (result === 'unavailable') Alert.alert('Could not add', 'This product is no longer available.');
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onCancel}><Text style={styles.cancel}>&lt;- Back to closet</Text></Pressable>
      <Text style={styles.eyebrow}>PIECE PROFILE</Text>
      <Text style={styles.title}>{titleCase(draft.name)}</Text>
      <Text style={styles.subtitle}>Edit its details, then ask ClosetAI what already works with it and what would complete the look.</Text>

      <View style={styles.heroRow}>
        <View style={[styles.photoBox, shadows.card]}>
          <View style={[styles.colorWash, { backgroundColor: colorWash(draft.color) }]} />
          <Image source={{ uri: draft.imageUri }} style={styles.image} resizeMode="contain" />
        </View>
        <View style={styles.quickFacts}>
          <Text style={styles.factLabel}>STYLE</Text><Text style={styles.factValue}>{draft.style}</Text>
          <Text style={styles.factLabel}>FORMALITY</Text><Text style={styles.factValue}>{draft.formality.replace('-', ' ')}</Text>
          <Text style={styles.factLabel}>COLOUR</Text><Text style={styles.factValue}>{draft.color}</Text>
        </View>
      </View>

      <ClothingEditor item={draft} onChange={setDraft} />

      <MotionPressable onPress={() => onSave(currentItem())} containerStyle={styles.saveMotion}>
        <View style={styles.saveButton}><Text style={styles.saveText}>Save changes</Text></View>
      </MotionPressable>

      <View style={[styles.matchStudio, shadows.card]}>
        <View style={styles.matchDecorOne} /><View style={styles.matchDecorTwo} />
        <Text style={styles.matchEyebrow}>ON-DEMAND STYLING</Text>
        <Text style={styles.matchTitle}>What Matches This Piece?</Text>
        <Text style={styles.matchText}>This only uses AI and product-search credits when you press the button. Closet items are shown before things to buy.</Text>
        <MotionPressable onPress={() => findPairings(Boolean(pairings))} disabled={pairingsLoading} containerStyle={styles.matchButtonMotion} hoverScale={1.02}>
          <View style={styles.matchButton}>{pairingsLoading ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.matchButtonText}>{pairings ? 'Search fresh products' : 'Find matching pieces'}</Text><Text style={styles.spark}>*</Text></>}</View>
        </MotionPressable>
        {pairings?.cached ? <Text style={styles.cacheNote}>SAVED RESULTS / NO AI OR SEARCH CREDITS USED</Text> : pairings ? <Text style={styles.cacheNote}>RESULTS SAVED FOR NEXT TIME</Text> : null}
      </View>

      {pairings ? (
        <Animated.View style={{ opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
          <View style={styles.resultSummaryRow}>
            <Text style={styles.resultSummary}>{pairings.summary}</Text>
            <MotionPressable onPress={() => findPairings(true)} disabled={pairingsLoading} hoverLift={2}>
              <View style={styles.forceButton}>{pairingsLoading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.forceButtonText}>Find More Anyway</Text>}</View>
            </MotionPressable>
          </View>
          <Text style={styles.forceNote}>Runs a fresh AI and product search, excluding suggestions you have already rejected.</Text>
          {!!pairingNotice && <Text style={styles.pairingNotice}>{pairingNotice}</Text>}
          {!!pairings.ownedMatches.length && <>
            <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Wear It With What You Own</Text><Text style={styles.sourceBadge}>NO SHOPPING</Text></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRail}>
              {pairings.ownedMatches.map(({ item: match, reason }) => <View key={match.id} style={[styles.ownedCard, shadows.card]}><View style={styles.ownedImageWrap}><Image source={{ uri: match.imageUri }} style={styles.ownedImage} resizeMode="contain" /></View><Text style={styles.ownedName} numberOfLines={2}>{match.name}</Text><Text style={styles.ownedMeta}>{match.color} / {match.clean ? 'clean' : 'worn'}</Text><Text style={styles.ownedReason} numberOfLines={3}>{reason}</Text></View>)}
            </ScrollView>
          </>}
          {!!pairings.shoppingMatches.length && <>
            <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Pieces You Could Add</Text><Text style={styles.sourceBadge}>{pairings.provider.toUpperCase()}</Text></View>
            <View style={styles.shoppingList}>
              {pairings.shoppingMatches.map((suggestion) => <PairingProductCard key={suggestion.id} suggestion={suggestion} preferences={preferences} onAdd={addSuggestion} onFeedback={feedback} />)}
            </View>
          </>}
          {!pairings.ownedMatches.length && !pairings.shoppingMatches.length && <View style={styles.noMatches}><Text style={styles.noMatchesTitle}>No verified matches yet</Text><Text style={styles.noMatchesText}>The local wardrobe matcher did not find another category, and the product search did not return a verified direct listing.</Text></View>}
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}

const dislikeReasons: { label: string; value: RecommendationDislikeReason }[] = [
  { label: 'Too expensive', value: 'too-expensive' },
  { label: 'Wrong audience', value: 'wrong-audience' },
  { label: 'Not my style', value: 'not-my-style' },
  { label: 'Wrong colour', value: 'wrong-color' },
  { label: 'Already own it', value: 'already-own' },
];

function PairingProductCard({ suggestion, preferences, onAdd, onFeedback }: {
  suggestion: ShoppingRecommendation;
  preferences: UserPreferences;
  onAdd: (item: ShoppingRecommendation) => Promise<void>;
  onFeedback: (item: ShoppingRecommendation, value: RecommendationFeedbackValue, reasons: RecommendationDislikeReason[]) => Promise<void>;
}) {
  const [showReasons, setShowReasons] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<RecommendationDislikeReason[]>([]);
  const saved = preferences.recommendationFeedback.find((entry) =>
    (suggestion.productUrl && entry.productUrl === suggestion.productUrl) || entry.recommendationId === suggestion.id,
  );
  const toggleReason = (reason: RecommendationDislikeReason) => setSelectedReasons((current) =>
    current.includes(reason) ? current.filter((entry) => entry !== reason) : [...current, reason],
  );

  return <View style={[styles.shopCard, shadows.card]}>
    <ProductImage recommendation={suggestion} />
    <View style={styles.shopCopy}>
      <Text style={styles.shopKicker}>{suggestion.color.toUpperCase()} / {suggestion.garmentType.replace('-', ' ').toUpperCase()}</Text>
      <Text style={styles.shopTitle}>{titleCase(suggestion.title)}</Text>
      <Text style={styles.shopMeta}>{suggestion.priceCad} / {suggestion.retailer}</Text>
      <Text style={styles.shopReason}>{suggestion.reason}</Text>
      <View style={styles.feedbackRow}>
        <MotionPressable onPress={() => onFeedback(suggestion, 'like', [])} hoverLift={1}><View style={[styles.feedbackButton, saved?.value === 'like' && styles.likeActive]}><Text style={[styles.feedbackText, saved?.value === 'like' && styles.feedbackTextActive]}>Like</Text></View></MotionPressable>
        <MotionPressable onPress={() => setShowReasons((value) => !value)} hoverLift={1}><View style={styles.feedbackButton}><Text style={styles.feedbackText}>Dislike</Text></View></MotionPressable>
        <MotionPressable onPress={() => onFeedback(suggestion, 'dislike', ['other'])} hoverLift={1}><View style={styles.removeButton}><Text style={styles.removeText}>Remove</Text></View></MotionPressable>
      </View>
      {showReasons ? <View style={styles.reasonPanel}>
        <Text style={styles.reasonTitle}>What should ClosetAI learn?</Text>
        <View style={styles.reasonRow}>{dislikeReasons.map((reason) => <Pressable key={reason.value} onPress={() => toggleReason(reason.value)} style={[styles.reasonChip, selectedReasons.includes(reason.value) && styles.reasonChipActive]}><Text style={[styles.reasonChipText, selectedReasons.includes(reason.value) && styles.reasonChipTextActive]}>{reason.label}</Text></Pressable>)}</View>
        <Pressable disabled={!selectedReasons.length} onPress={() => onFeedback(suggestion, 'dislike', selectedReasons)} style={[styles.submitReason, !selectedReasons.length && styles.submitReasonDisabled]}><Text style={styles.submitReasonText}>Save feedback and remove</Text></Pressable>
      </View> : null}
      <View style={styles.shopActions}><MotionPressable onPress={() => onAdd(suggestion)} containerStyle={styles.shopActionGrow} hoverLift={1}><View style={styles.addButton}><Text style={styles.addText}>Add to closet</Text></View></MotionPressable><MotionPressable onPress={() => suggestion.productUrl && Linking.openURL(suggestion.productUrl)} hoverLift={1}><View style={styles.linkButton}><Text style={styles.linkText}>View product</Text></View></MotionPressable></View>
    </View>
  </View>;
}

function ProductImage({ recommendation }: { recommendation: ShoppingRecommendation }) {
  const [attempt, setAttempt] = useState(0);
  const proxied = productImageUri(recommendation.imageUrl, recommendation.productUrl);
  const uri = attempt === 0 ? proxied : attempt === 1 ? recommendation.imageUrl : undefined;
  if (!uri) {
    return <View style={[styles.shopImage, styles.imageFallback]}><View style={[styles.garmentGlyph, { backgroundColor: colorWash(recommendation.color) }]} /><Text style={styles.imageFallbackText}>{recommendation.color}{'\n'}{recommendation.garmentType.replace('-', ' ')}</Text></View>;
  }
  return <Image source={{ uri }} style={styles.shopImage} resizeMode="contain" onError={() => setAttempt((value) => value + 1)} />;
}

function colorWash(color: string) {
  const value = color.toLowerCase();
  if (/blue|navy|indigo/.test(value)) return '#DCE8F1';
  if (/green|olive|sage/.test(value)) return '#DDE9DD';
  if (/red|burgundy|pink/.test(value)) return '#F0DDE1';
  if (/brown|tan|beige|cream/.test(value)) return '#EDE0CF';
  return '#E7D2B7';
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 920, alignSelf: 'center', padding: 22, paddingBottom: 70 },
  cancel: { marginTop: 10, color: colors.green, fontSize: 12, fontWeight: '800' },
  eyebrow: { marginTop: 22, color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  title: { marginTop: 6, color: colors.ink, fontSize: 36, fontWeight: '900', letterSpacing: -1.3 },
  subtitle: { marginTop: 8, maxWidth: 600, color: colors.muted, fontSize: 13, lineHeight: 20 },
  heroRow: { marginTop: 20, flexDirection: 'row', gap: 12 },
  photoBox: { flex: 1, height: 260, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, borderRadius: 25, backgroundColor: '#FFFFFF' },
  colorWash: { position: 'absolute', left: -40, bottom: -90, width: 260, height: 260, borderRadius: 140, opacity: 0.7 },
  image: { width: '100%', height: '100%' },
  quickFacts: { width: 126, padding: 15, justifyContent: 'center', borderRadius: 22, backgroundColor: colors.ink },
  factLabel: { marginTop: 12, color: colors.peach, fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  factValue: { marginTop: 4, color: '#FFFFFF', fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  saveMotion: { marginTop: 26 },
  saveButton: { paddingVertical: 17, alignItems: 'center', borderRadius: 16, backgroundColor: colors.green },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  matchStudio: { marginTop: 16, overflow: 'hidden', padding: 22, borderWidth: 1, borderColor: '#D8C5E0', borderRadius: 24, backgroundColor: colors.plumSoft },
  matchDecorOne: { position: 'absolute', right: -20, top: -35, width: 130, height: 130, borderWidth: 24, borderColor: 'rgba(112,76,94,0.10)', borderRadius: 70 },
  matchDecorTwo: { position: 'absolute', right: 70, bottom: -55, width: 100, height: 100, borderRadius: 55, backgroundColor: 'rgba(195,138,59,0.10)' },
  matchEyebrow: { color: colors.plum, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  matchTitle: { marginTop: 6, color: colors.ink, fontSize: 24, fontWeight: '900' },
  matchText: { maxWidth: 570, marginTop: 7, color: colors.inkSoft, fontSize: 11, lineHeight: 17 },
  matchButtonMotion: { marginTop: 16, alignSelf: 'flex-start' },
  matchButton: { minWidth: 210, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 14, backgroundColor: colors.plum },
  matchButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  spark: { color: colors.peach, fontSize: 18, fontWeight: '900' },
  cacheNote: { marginTop: 9, color: colors.plum, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  resultSummaryRow: { marginTop: 22, padding: 14, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderLeftWidth: 3, borderLeftColor: colors.green, backgroundColor: colors.greenSoft },
  resultSummary: { minWidth: 210, flex: 1, color: colors.inkSoft, fontSize: 11, lineHeight: 17 },
  forceButton: { minWidth: 142, paddingHorizontal: 13, paddingVertical: 10, alignItems: 'center', borderRadius: 11, backgroundColor: colors.green },
  forceButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  forceNote: { marginTop: 6, color: colors.muted, fontSize: 8, lineHeight: 12 },
  pairingNotice: { marginTop: 7, padding: 9, color: colors.greenDark, fontSize: 9, lineHeight: 14, borderRadius: 10, backgroundColor: colors.greenSoft },
  sectionHeading: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  sourceBadge: { color: colors.gold, fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  matchRail: { gap: 10, paddingBottom: 8 },
  ownedCard: { width: 150, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.card },
  ownedImageWrap: { height: 125, padding: 8, backgroundColor: '#EAD6BB' },
  ownedImage: { width: '100%', height: '100%' },
  ownedName: { minHeight: 36, paddingHorizontal: 10, paddingTop: 10, color: colors.ink, fontSize: 12, fontWeight: '900' },
  ownedMeta: { paddingHorizontal: 10, color: colors.gold, fontSize: 8, fontWeight: '800', textTransform: 'capitalize' },
  ownedReason: { padding: 10, paddingTop: 6, color: colors.muted, fontSize: 8, lineHeight: 12 },
  shoppingList: { gap: 10 },
  shopCard: { padding: 12, flexDirection: 'row', gap: 13, borderWidth: 1, borderColor: colors.line, borderRadius: 19, backgroundColor: colors.card },
  shopImage: { width: 100, height: 120, borderRadius: 13, backgroundColor: '#F1EDE6' },
  imageFallback: { padding: 10, alignItems: 'center', justifyContent: 'center' },
  garmentGlyph: { width: 52, height: 48, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, borderWidth: 1, borderColor: colors.line },
  imageFallbackText: { marginTop: 7, color: colors.inkSoft, fontSize: 7, lineHeight: 10, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' },
  shopCopy: { flex: 1 },
  shopKicker: { color: colors.green, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  shopTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  shopMeta: { marginTop: 4, color: colors.gold, fontSize: 9, fontWeight: '800' },
  shopReason: { marginTop: 7, color: colors.muted, fontSize: 9, lineHeight: 14 },
  feedbackRow: { marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  feedbackButton: { paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: colors.line, borderRadius: 9, backgroundColor: colors.canvasDeep },
  likeActive: { borderColor: colors.green, backgroundColor: colors.green },
  feedbackText: { color: colors.inkSoft, fontSize: 8, fontWeight: '900' },
  feedbackTextActive: { color: '#FFFFFF' },
  removeButton: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: colors.dirtySoft },
  removeText: { color: colors.dirty, fontSize: 8, fontWeight: '900' },
  reasonPanel: { marginTop: 9, padding: 10, borderRadius: 12, backgroundColor: colors.goldSoft },
  reasonTitle: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  reasonRow: { marginTop: 7, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  reasonChip: { paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: '#D7C4A4', borderRadius: 8, backgroundColor: colors.card },
  reasonChipActive: { borderColor: colors.dirty, backgroundColor: colors.dirtySoft },
  reasonChipText: { color: colors.muted, fontSize: 7, fontWeight: '800' },
  reasonChipTextActive: { color: colors.dirty },
  submitReason: { marginTop: 8, paddingVertical: 8, alignItems: 'center', borderRadius: 8, backgroundColor: colors.dirty },
  submitReasonDisabled: { opacity: 0.38 },
  submitReasonText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' },
  shopActions: { marginTop: 10, flexDirection: 'row', gap: 7 },
  shopActionGrow: { flex: 1 },
  addButton: { paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: colors.green },
  addText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  linkButton: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 10 },
  linkText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  noMatches: { marginTop: 20, padding: 24, alignItems: 'center', borderRadius: 18, backgroundColor: colors.card },
  noMatchesTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  noMatchesText: { marginTop: 7, color: colors.muted, fontSize: 10, lineHeight: 16, textAlign: 'center' },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MotionPressable } from '../components/MotionPressable';
import { ScreenEntrance } from '../components/ScreenEntrance';
import { analyzeWardrobeLocally, requestWardrobeInsights } from '../services/insightService';
import { productImageUri } from '../services/clothingPairingService';
import { colors, shadows } from '../theme';
import { titleCase } from '../utils/text';
import {
  ClothingItem,
  OutfitHistory,
  OutfitOccasion,
  RecommendationDislikeReason,
  RecommendationFeedbackValue,
  ShoppingRecommendation,
  UserPreferences,
  WardrobeAnalysis,
} from '../types';

type Props = {
  wardrobe: ClothingItem[];
  history: OutfitHistory[];
  preferences: UserPreferences;
  onFeedback: (
    item: ShoppingRecommendation,
    value: RecommendationFeedbackValue,
    reasons: RecommendationDislikeReason[],
  ) => Promise<void>;
  onAdd: (item: ShoppingRecommendation) => Promise<'added' | 'exists' | 'unavailable'>;
};
type SortMode = 'recommended' | 'price-low' | 'price-high' | 'outfits';
type OccasionFilter = 'all' | OutfitOccasion;

const sortModes: { label: string; value: SortMode }[] = [
  { label: 'Recommended', value: 'recommended' },
  { label: 'Price low', value: 'price-low' },
  { label: 'Price high', value: 'price-high' },
  { label: 'Most outfits', value: 'outfits' },
];
const dislikeReasons: { label: string; value: RecommendationDislikeReason }[] = [
  { label: 'Too expensive', value: 'too-expensive' },
  { label: 'Wrong gender / audience', value: 'wrong-audience' },
  { label: 'Not my style', value: 'not-my-style' },
  { label: 'Wrong colour', value: 'wrong-color' },
  { label: 'Already own similar', value: 'already-own' },
  { label: 'Other', value: 'other' },
];
const forceRefreshCooldownMs = 30_000;

function mergeRecommendations(
  fresh: ShoppingRecommendation[],
  existing: ShoppingRecommendation[],
) {
  const seen = new Set<string>();
  return [...fresh, ...existing].filter((item) => {
    const key = item.productUrl ?? item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function InsightsScreen({ wardrobe, history, preferences, onFeedback, onAdd }: Props) {
  const [analysis, setAnalysis] = useState<WardrobeAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState('');
  const [sort, setSort] = useState<SortMode>('recommended');
  const [occasion, setOccasion] = useState<OccasionFilter>('all');
  const progress = useRef(new Animated.Value(0)).current;
  const requestInFlight = useRef(false);
  const lastForceRefreshAt = useRef(0);
  const wardrobeFingerprint = useMemo(() => wardrobe.map((item) => [item.id, item.updatedAt, item.clean].join(':')).sort().join('|'), [wardrobe]);
  const historyFingerprint = useMemo(() => history.map((entry) => [entry.id, entry.feedback, entry.wornAt ?? ''].join(':')).sort().join('|'), [history]);
  const preferenceFingerprint = preferences.updatedAt;

  const refresh = async (forceExpansion = false) => {
    if (requestInFlight.current) return;
    if (forceExpansion && Date.now() - lastForceRefreshAt.current < forceRefreshCooldownMs) {
      const seconds = Math.ceil((forceRefreshCooldownMs - (Date.now() - lastForceRefreshAt.current)) / 1000);
      setRefreshNotice(`Please wait ${seconds} seconds before another fresh search. Your saved results are still shown.`);
      return;
    }
    requestInFlight.current = true;
    if (forceExpansion) lastForceRefreshAt.current = Date.now();
    setRefreshNotice('');
    const previous = analysis;
    const previousRecommendations = previous?.recommendations ?? [];
    const local = analyzeWardrobeLocally(wardrobe, history, preferences);
    if (!forceExpansion || !previous) setAnalysis(local);
    setLoading(false);
    progress.setValue(0);
    Animated.spring(progress, { toValue: local.score / 100, useNativeDriver: false, damping: 16 }).start();
    if (!wardrobe.length) {
      requestInFlight.current = false;
      return;
    }
    setProductsLoading(true);
    try {
      const next = await requestWardrobeInsights(wardrobe, history, preferences, {
        forceExpansion,
        excludedProductUrls: forceExpansion
          ? previousRecommendations.map((item) => item.productUrl).filter((url): url is string => Boolean(url))
          : [],
      });
      const newRecommendations = forceExpansion
        ? next.recommendations.filter((item) => !previousRecommendations.some((existing) => (existing.productUrl ?? existing.id) === (item.productUrl ?? item.id)))
        : next.recommendations;
      const resolved = forceExpansion
        ? { ...next, recommendations: mergeRecommendations(next.recommendations, previousRecommendations) }
        : next;
      setAnalysis(resolved);
      if (forceExpansion) {
        setRefreshNotice(newRecommendations.length
          ? `Added ${newRecommendations.length} new verified clothing ${newRecommendations.length === 1 ? 'piece' : 'pieces'}.`
          : 'No new verified clothing products were found. Your previous recommendations were kept.');
      }
      progress.setValue(0);
      Animated.spring(progress, { toValue: resolved.score / 100, useNativeDriver: false, damping: 16 }).start();
    } catch (error) {
      setRefreshNotice(error instanceof Error ? error.message : 'Fresh recommendations are temporarily unavailable.');
    } finally {
      requestInFlight.current = false;
      setProductsLoading(false);
    }
  };

  useEffect(() => { void refresh(false); }, [wardrobeFingerprint, historyFingerprint, preferenceFingerprint]);

  const completeRecommendations = useMemo(() => {
    const declined = new Set(preferences.recommendationFeedback
      .filter((entry) => entry.value === 'dislike')
      .map((entry) => entry.productUrl ?? entry.recommendationId));
    return (analysis?.recommendations ?? []).filter((item) =>
      item.linkStatus === 'verified' && item.productUrl && item.imageUrl && item.retailer && item.priceCad &&
      typeof item.priceCadAmount === 'number' && !declined.has(item.productUrl ?? item.id),
    );
  }, [analysis, preferences.recommendationFeedback]);
  const occasions = useMemo(() => [...new Set(completeRecommendations.flatMap((item) => item.occasions))], [completeRecommendations]);
  const recommendations = useMemo(() => {
    const filtered = completeRecommendations.filter((item) => occasion === 'all' || item.occasions.includes(occasion));
    return [...filtered].sort((a, b) => {
      if (sort === 'price-low') return (a.priceCadAmount ?? Infinity) - (b.priceCadAmount ?? Infinity);
      if (sort === 'price-high') return (b.priceCadAmount ?? 0) - (a.priceCadAmount ?? 0);
      if (sort === 'outfits') return b.combinationsUnlocked - a.combinationsUnlocked;
      return 0;
    });
  }, [completeRecommendations, occasion, sort]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenEntrance>
        <LinearGradient colors={['#E7C9A4', '#F2D9B7', '#E5BFA9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.reportHero}>
          <View style={styles.heroCircle} /><View style={styles.heroLine} /><Text style={styles.eyebrow}>WARDROBE INTELLIGENCE</Text>
          <Text style={styles.title}>Your Style Report</Text>
          <Text style={styles.subtitle}>ClosetAI looks for missing categories, colour balance, repeat patterns, and pieces that unlock more outfits.</Text>
          <View style={styles.heroLegend}><View style={[styles.legendDot, { backgroundColor: colors.green }]} /><Text style={styles.legendText}>Closet data</Text><View style={[styles.legendDot, { backgroundColor: colors.gold }]} /><Text style={styles.legendText}>Verified products</Text><View style={[styles.legendDot, { backgroundColor: colors.plum }]} /><Text style={styles.legendText}>Your feedback</Text></View>
        </LinearGradient>

        <View style={[styles.scoreCard, shadows.card]}>
          <View><Text style={styles.scoreLabel}>VERSATILITY SCORE</Text><Text style={styles.score}>{loading ? '--' : analysis?.score}</Text></View>
          <View style={styles.scoreVisual}><View style={styles.scoreTrack}><Animated.View style={[styles.scoreFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} /></View><Text style={styles.scoreNote}>Built from your categories, colours, and saved outfit decisions</Text></View>
        </View>

        <View style={[styles.efficiencyCard, shadows.card]}>
          <View style={styles.efficiencyTop}><View><Text style={styles.efficiencyLabel}>WARDROBE EFFICIENCY</Text><Text style={styles.efficiencyTitle}>You Have Worn {analysis?.efficiency?.wornPercentage ?? 0}% of Your Strongest Outfit Options</Text></View><Text style={styles.efficiencyPercent}>{analysis?.efficiency?.wornPercentage ?? 0}%</Text></View>
          <View style={styles.efficiencyTrack}><View style={[styles.efficiencyFill, { width: `${analysis?.efficiency?.wornPercentage ?? 0}%` as `${number}%` }]} /></View>
          <View style={styles.efficiencyStats}><Text style={styles.efficiencyStat}><Text style={styles.efficiencyNumber}>{analysis?.efficiency?.possibleOutfits ?? 0}</Text>{'\n'}POSSIBLE GOOD OUTFITS</Text><Text style={styles.efficiencyStat}><Text style={styles.efficiencyNumber}>{analysis?.efficiency?.wornOutfits ?? 0}</Text>{'\n'}UNIQUE OUTFITS WORN</Text></View>
        </View>

        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>What Your Closet Says</Text><MotionPressable onPress={() => refresh(false)} hoverLift={1}><View style={styles.refreshButton}><Text style={styles.refresh}>{productsLoading ? 'Finding Products...' : 'Refresh'}</Text></View></MotionPressable></View>
        <View style={styles.insights}>
          {(analysis?.insights ?? []).map((insight, index) => (
            <View key={insight.id} style={[styles.insightCard, insight.tone === 'positive' ? styles.positive : insight.tone === 'warning' ? styles.warning : styles.opportunity]}>
              <Text style={styles.insightNumber}>0{index + 1}</Text><View style={styles.insightCopy}><Text style={styles.insightTitle}>{titleCase(insight.title)}</Text><Text style={styles.insightDetail}>{insight.detail}</Text></View>
            </View>
          ))}
        </View>

        <Text style={styles.shopEyebrow}>SMART ADDITIONS / VERIFIED CANADA</Text>
        <Text style={styles.sectionTitle}>Pieces Worth Adding</Text>
        <View style={styles.shopIntroRow}>
          <Text style={styles.shopIntro}>{analysis?.summary}</Text>
          <MotionPressable disabled={productsLoading || !wardrobe.length} onPress={() => refresh(true)} hoverLift={2}>
            <View style={[styles.forceExploreButton, (productsLoading || !wardrobe.length) && styles.disabled]}>{productsLoading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.forceExploreText}>Find More Anyway</Text>}</View>
          </MotionPressable>
        </View>
        <Text style={styles.forceExploreNote}>Optional: spend fresh AI and search credits to explore additions beyond the current versatility score.</Text>
        {!!refreshNotice && <Text style={styles.refreshNotice}>{refreshNotice}</Text>}

        <Text style={styles.controlLabel}>SORT</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controls}>
          {sortModes.map((option) => <FilterChip key={option.value} label={option.label} active={sort === option.value} onPress={() => setSort(option.value)} />)}
        </ScrollView>
        {!!occasions.length && <><Text style={styles.controlLabel}>OCCASION</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controls}><FilterChip label="All" active={occasion === 'all'} onPress={() => setOccasion('all')} />{occasions.map((value) => <FilterChip key={value} label={value.replace('-', ' ')} active={occasion === value} onPress={() => setOccasion(value)} />)}</ScrollView></>}

        <View style={styles.recommendations}>
          {productsLoading && !recommendations.length ? [0, 1, 2].map((value) => <View key={value} style={styles.skeleton} />) : recommendations.length ? recommendations.map((item, index) => <RecommendationCard key={item.id} item={item} index={index} preferences={preferences} onFeedback={onFeedback} onAdd={onAdd} />) : <View style={styles.noProducts}><Text style={styles.noProductsTitle}>No verified products available</Text><Text style={styles.noProductsText}>ClosetAI only shows direct product pages with an image and numeric CAD price. Your declined products are also hidden.</Text></View>}
        </View>
      </ScreenEntrance>
    </ScrollView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <MotionPressable onPress={onPress} hoverLift={2}><View style={[styles.filterChip, active && styles.filterChipActive]}><Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text></View></MotionPressable>;
}

function RecommendationCard({
  item,
  index,
  preferences,
  onFeedback,
  onAdd,
}: {
  item: ShoppingRecommendation;
  index: number;
  preferences: UserPreferences;
  onFeedback: Props['onFeedback'];
  onAdd: Props['onAdd'];
}) {
  const reveal = useRef(new Animated.Value(0)).current;
  const [showReasons, setShowReasons] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<RecommendationDislikeReason[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { Animated.spring(reveal, { toValue: 1, delay: index * 90, useNativeDriver: true, damping: 17, stiffness: 125 }).start(); }, [index, reveal]);
  const savedFeedback = preferences.recommendationFeedback.find((entry) =>
    (item.productUrl && entry.productUrl === item.productUrl) || entry.recommendationId === item.id,
  );
  const open = async () => {
    if (!item.productUrl || !(await Linking.canOpenURL(item.productUrl))) { Alert.alert('Product unavailable', 'This retailer link can no longer be opened.'); return; }
    await Linking.openURL(item.productUrl);
  };
  const like = async () => {
    setSubmitting(true);
    await onFeedback(item, 'like', []);
    setSubmitting(false);
  };
  const dislike = async () => {
    if (!selectedReasons.length) return;
    setSubmitting(true);
    await onFeedback(item, 'dislike', selectedReasons);
    setSubmitting(false);
    setShowReasons(false);
  };
  const add = async () => {
    setSubmitting(true);
    const result = await onAdd(item);
    setSubmitting(false);
    if (result === 'exists') Alert.alert('Already in your closet', 'This exact product is already saved.');
    if (result === 'unavailable') Alert.alert('Could not add item', 'The verified product image or link is unavailable.');
  };
  const toggleReason = (value: RecommendationDislikeReason) => setSelectedReasons((current) =>
    current.includes(value) ? current.filter((reason) => reason !== value) : [...current, value],
  );
  return <Animated.View style={[styles.recommendation, shadows.card, { opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }] }]}> 
    <View style={styles.recGraphic}>{imageFailed ? <><View style={styles.recFallbackGlyph} /><Text style={styles.recFallbackText}>{item.color}{'\n'}{item.garmentType.replace('-', ' ')}</Text></> : <Image source={{ uri: productImageUri(item.imageUrl, item.productUrl) }} style={styles.recImage} resizeMode="contain" onError={() => setImageFailed(true)} />}</View>
    <View style={styles.recCopy}><Text style={styles.recTitle}>{titleCase(item.title)}</Text><Text style={styles.recMeta}>{item.color} / {item.audience} / +{item.combinationsUnlocked} new outfits</Text><Text style={styles.recOccasions}>{item.occasions.map((value) => titleCase(value.replace('-', ' '))).join(' / ')}</Text><Text style={styles.recReason}>{item.reason}</Text>
      <MotionPressable onPress={open} hoverLift={2}><View style={styles.shopButton}><Text style={styles.shopButtonText}>{item.priceCad} at {item.retailer}</Text></View></MotionPressable>
      <View style={styles.recActions}>
        <MotionPressable disabled={submitting} onPress={add} containerStyle={styles.addMotion} hoverLift={2}><View style={styles.addButton}><Text style={styles.addButtonText}>Add to closet</Text></View></MotionPressable>
        <MotionPressable disabled={submitting} onPress={like} hoverLift={2}><View style={[styles.reactionButton, savedFeedback?.value === 'like' && styles.reactionLike]}><Text style={[styles.reactionText, savedFeedback?.value === 'like' && styles.reactionTextActive]}>Like</Text></View></MotionPressable>
        <MotionPressable disabled={submitting} onPress={() => setShowReasons((value) => !value)} hoverLift={2}><View style={[styles.reactionButton, showReasons && styles.reactionDislike]}><Text style={[styles.reactionText, showReasons && styles.reactionTextActive]}>Dislike</Text></View></MotionPressable>
      </View>
      {showReasons ? <View style={styles.reasonPanel}><Text style={styles.reasonTitle}>Why is this not for you?</Text><View style={styles.reasonChips}>{dislikeReasons.map((reason) => <Pressable key={reason.value} onPress={() => toggleReason(reason.value)} style={[styles.reasonChip, selectedReasons.includes(reason.value) && styles.reasonChipActive]}><Text style={[styles.reasonChipText, selectedReasons.includes(reason.value) && styles.reasonChipTextActive]}>{reason.label}</Text></Pressable>)}</View><Pressable disabled={!selectedReasons.length || submitting} onPress={dislike} style={[styles.submitDislike, (!selectedReasons.length || submitting) && styles.disabled]}><Text style={styles.submitDislikeText}>Use this feedback</Text></Pressable></View> : null}
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 60 }, reportHero: { marginTop: 16, overflow: 'hidden', padding: 22, borderRadius: 28 }, heroCircle: { position: 'absolute', right: -35, top: -55, width: 190, height: 190, borderWidth: 30, borderColor: 'rgba(255,255,255,0.27)', borderRadius: 100 }, heroLine: { position: 'absolute', right: 90, top: -20, width: 2, height: 260, backgroundColor: 'rgba(49,95,73,0.12)', transform: [{ rotate: '24deg' }] }, eyebrow: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 }, title: { marginTop: 6, color: colors.ink, fontSize: 36, fontWeight: '900', letterSpacing: -1.4 }, subtitle: { marginTop: 8, maxWidth: 480, color: colors.inkSoft, fontSize: 13, lineHeight: 20 }, heroLegend: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendText: { marginRight: 7, color: colors.inkSoft, fontSize: 8, fontWeight: '800' },
  scoreCard: { marginTop: 22, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 22, borderWidth: 1, borderColor: colors.line, borderRadius: 24, backgroundColor: colors.card }, scoreLabel: { color: colors.green, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, score: { marginTop: 3, color: colors.ink, fontSize: 42, fontWeight: '900', letterSpacing: -2 }, scoreVisual: { flex: 1 }, scoreTrack: { height: 9, overflow: 'hidden', borderRadius: 6, backgroundColor: colors.canvasDeep }, scoreFill: { height: '100%', borderRadius: 6, backgroundColor: colors.green }, scoreNote: { marginTop: 8, color: colors.muted, fontSize: 9, lineHeight: 13 },
  efficiencyCard: { marginTop: 12, padding: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 22, backgroundColor: colors.card }, efficiencyTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }, efficiencyLabel: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, efficiencyTitle: { maxWidth: 520, marginTop: 5, color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '900' }, efficiencyPercent: { color: colors.green, fontSize: 28, fontWeight: '900' }, efficiencyTrack: { height: 8, marginTop: 15, overflow: 'hidden', borderRadius: 5, backgroundColor: colors.canvasDeep }, efficiencyFill: { height: '100%', borderRadius: 5, backgroundColor: colors.gold }, efficiencyStats: { marginTop: 14, flexDirection: 'row', gap: 28 }, efficiencyStat: { color: colors.muted, fontSize: 7, lineHeight: 13, fontWeight: '900' }, efficiencyNumber: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  sectionHeading: { marginTop: 28, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }, refreshButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.greenSoft }, refresh: { color: colors.green, fontSize: 10, fontWeight: '900' }, insights: { gap: 10 }, insightCard: { padding: 16, flexDirection: 'row', gap: 13, borderRadius: 17, borderLeftWidth: 4 }, positive: { borderLeftColor: colors.green, backgroundColor: colors.greenSoft }, opportunity: { borderLeftColor: colors.gold, backgroundColor: colors.goldSoft }, warning: { borderLeftColor: colors.dirty, backgroundColor: colors.dirtySoft }, insightNumber: { color: colors.muted, fontSize: 10, fontWeight: '900' }, insightCopy: { flex: 1 }, insightTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' }, insightDetail: { marginTop: 4, color: colors.inkSoft, fontSize: 11, lineHeight: 17 },
  shopEyebrow: { marginTop: 32, color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, shopIntroRow: { marginTop: 7, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, shopIntro: { minWidth: 220, flex: 1, color: colors.muted, fontSize: 11, lineHeight: 17 }, forceExploreButton: { minWidth: 142, paddingHorizontal: 13, paddingVertical: 10, alignItems: 'center', borderRadius: 11, backgroundColor: colors.green }, forceExploreText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' }, forceExploreNote: { marginTop: 6, color: colors.muted, fontSize: 8, lineHeight: 12 }, refreshNotice: { marginTop: 7, padding: 9, color: colors.greenDark, fontSize: 9, lineHeight: 14, borderRadius: 10, backgroundColor: colors.greenSoft }, controlLabel: { marginTop: 16, color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, controls: { paddingVertical: 8, gap: 7 }, filterChip: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card }, filterChipActive: { borderColor: colors.green, backgroundColor: colors.green }, filterChipText: { color: colors.muted, fontSize: 9, fontWeight: '900', textTransform: 'capitalize' }, filterChipTextActive: { color: '#FFFFFF' },
  recommendations: { marginTop: 8, gap: 12 }, recommendation: { padding: 14, flexDirection: 'row', gap: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.card }, recGraphic: { width: 88, height: 108, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.canvasDeep }, recImage: { width: '100%', height: '100%', borderRadius: 15 }, recFallbackGlyph: { width: 45, height: 41, borderWidth: 1, borderColor: colors.line, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, backgroundColor: colors.goldSoft }, recFallbackText: { marginTop: 6, color: colors.inkSoft, fontSize: 6, lineHeight: 9, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' }, recCopy: { flex: 1 }, recTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' }, recMeta: { marginTop: 4, color: colors.gold, fontSize: 9, fontWeight: '800', textTransform: 'capitalize' }, recOccasions: { marginTop: 4, color: colors.green, fontSize: 8, fontWeight: '800', textTransform: 'capitalize' }, recReason: { marginTop: 7, color: colors.muted, fontSize: 10, lineHeight: 15 }, shopButton: { marginTop: 10, paddingVertical: 9, alignItems: 'center', borderRadius: 10, backgroundColor: colors.ink }, shopButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  recActions: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, addMotion: { flexGrow: 1 }, addButton: { paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', borderRadius: 10, backgroundColor: colors.green }, addButtonText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' }, reactionButton: { paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.card }, reactionLike: { borderColor: colors.green, backgroundColor: colors.green }, reactionDislike: { borderColor: colors.dirty, backgroundColor: colors.dirty }, reactionText: { color: colors.inkSoft, fontSize: 8, fontWeight: '900' }, reactionTextActive: { color: '#FFFFFF' },
  reasonPanel: { width: '100%', marginTop: 9, padding: 10, borderRadius: 13, backgroundColor: colors.dirtySoft }, reasonTitle: { color: colors.ink, fontSize: 10, fontWeight: '900' }, reasonChips: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 5 }, reasonChip: { paddingHorizontal: 8, paddingVertical: 7, borderWidth: 1, borderColor: colors.line, borderRadius: 9, backgroundColor: colors.card }, reasonChipActive: { borderColor: colors.dirty, backgroundColor: colors.dirty }, reasonChipText: { color: colors.inkSoft, fontSize: 7, fontWeight: '800' }, reasonChipTextActive: { color: '#FFFFFF' }, submitDislike: { marginTop: 9, paddingVertical: 9, alignItems: 'center', borderRadius: 10, backgroundColor: colors.dirty }, submitDislikeText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' }, disabled: { opacity: 0.45 },
  skeleton: { height: 136, borderRadius: 20, backgroundColor: colors.canvasDeep, opacity: 0.7 }, noProducts: { padding: 24, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.card }, noProductsTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' }, noProductsText: { marginTop: 7, color: colors.muted, fontSize: 10, lineHeight: 16, textAlign: 'center' }, pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from './components/AppHeader';
import { firebaseReady, firestoreReady } from './firebase/config';
import { AddClothingScreen } from './screens/AddClothingScreen';
import { AuthScreen } from './screens/AuthScreen';
import { EditClothingScreen } from './screens/EditClothingScreen';
import { HomeScreen } from './screens/HomeScreen';
import { InsightsScreen } from './screens/InsightsScreen';
import { OutfitScreen } from './screens/OutfitScreen';
import { WardrobeScreen } from './screens/WardrobeScreen';
import { demoUser, observeAuth, signOutUser } from './services/authService';
import {
  markOutfitWorn,
  markAllClean,
  deleteHistory,
  defaultUserPreferences,
  pruneGeneratedHistory,
  removeClothing,
  saveClothing,
  saveHistory,
  savePreferences,
  subscribeHistory,
  subscribePreferences,
  subscribeWardrobe,
} from './services/closetRepository';
import { deleteStoredImage, persistClothingImage, refreshStoredImage } from './services/imageStorageService';
import { initialWardrobe } from './services/mockWardrobe';
import { outfitSignature } from './services/outfitService';
import { colors } from './theme';
import {
  ClosetUser,
  ClothingItem,
  NewClothingItem,
  Outfit,
  OutfitFeedback,
  OutfitHistory,
  RecommendationDislikeReason,
  RecommendationFeedback,
  RecommendationFeedbackValue,
  ScreenName,
  ShoppingRecommendation,
  UserPreferences,
} from './types';

const backgroundDots = Array.from({ length: 54 }, (_, index) => ({
  id: index,
  layer: index % 3,
  left: `${(index * 37 + 7) % 98}%` as `${number}%`,
  top: `${(index * 61 + 11) % 96}%` as `${number}%`,
  size: 3 + (index % 4),
}));

const wardrobeFingerprint = (items: ClothingItem[]) => items.map((item) => [item.id, item.updatedAt, item.imageUri, item.clean].join(':')).sort().join('|');
const historyFingerprint = (items: OutfitHistory[]) => items.map((item) => [item.id, item.feedback, item.wornAt ?? '', item.outfit.previewImageUri ?? ''].join(':')).sort().join('|');

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('home');
  const [user, setUser] = useState<ClosetUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [wardrobe, setWardrobe] = useState<ClothingItem[]>([]);
  const [history, setHistory] = useState<OutfitHistory[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>(defaultUserPreferences);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cloudPersistence, setCloudPersistence] = useState<boolean | null>(null);
  const activeUserUid = useRef<string | null>(null);
  const pointerX = useRef(new Animated.Value(0)).current;
  const pointerY = useRef(new Animated.Value(0)).current;

  useEffect(() => observeAuth((nextUser) => { setUser(nextUser); setAuthLoading(false); }), []);
  useEffect(() => { activeUserUid.current = user?.uid ?? null; }, [user]);

  useEffect(() => {
    if (!user || user.demo) { setCloudPersistence(null); return; }
    setCloudPersistence(firestoreReady);
  }, [user]);

  useEffect(() => {
    if (!user) { setWardrobe([]); setHistory([]); setPreferences(defaultUserPreferences); return; }
    const stopWardrobe = subscribeWardrobe(user.uid, user.demo ? initialWardrobe : [], async (items) => {
      const refreshed = await Promise.all(items.map((item) => refreshStoredImage(user, item)));
      setWardrobe((current) => wardrobeFingerprint(current) === wardrobeFingerprint(refreshed) ? current : refreshed);
    });
    const stopHistory = subscribeHistory(user.uid, (items) => setHistory((current) => historyFingerprint(current) === historyFingerprint(items) ? current : items));
    const stopPreferences = subscribePreferences(user.uid, (next) => setPreferences((current) => current.updatedAt === next.updatedAt ? current : next));
    pruneGeneratedHistory(user.uid).catch(() => undefined);
    return () => { stopWardrobe(); stopHistory(); stopPreferences(); };
  }, [user]);

  const editingItem = useMemo(() => wardrobe.find((item) => item.id === editingId), [editingId, wardrobe]);

  const addClothing = async (draft: NewClothingItem) => {
    if (!user) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const now = new Date().toISOString();
    const item: ClothingItem = { ...draft, id, clean: true, createdAt: now, updatedAt: now };
    setWardrobe((current) => [item, ...current]);
    const local = await saveClothing(user.uid, item);
    setWardrobe(local);
    setScreen('wardrobe');

    void persistClothingImage(user, id, draft).then(async (storedImage) => {
      if (activeUserUid.current !== user.uid) return;
      if (storedImage.imageUri === item.imageUri && !storedImage.objectKey) return;
      const storedItem = { ...item, ...storedImage, updatedAt: new Date().toISOString() };
      setWardrobe((current) => current.map((entry) => entry.id === id ? storedItem : entry));
      const synced = await saveClothing(user.uid, storedItem);
      setWardrobe(synced);
    });
  };

  const updateClothing = async (updatedItem: ClothingItem) => {
    if (!user) return;
    const item = { ...updatedItem, updatedAt: new Date().toISOString() };
    setWardrobe((current) => current.map((entry) => entry.id === item.id ? item : entry));
    const local = await saveClothing(user.uid, item);
    setWardrobe(local);
    setEditingId(null);
    setScreen('wardrobe');
  };

  const toggleClean = async (id: string) => {
    if (!user) return;
    const existing = wardrobe.find((item) => item.id === id);
    if (!existing) return;
    const item = { ...existing, clean: !existing.clean, updatedAt: new Date().toISOString() };
    setWardrobe((current) => current.map((entry) => entry.id === id ? item : entry));
    const local = await saveClothing(user.uid, item);
    setWardrobe(local);
  };

  const cleanAll = async () => {
    if (!user || !wardrobe.some((item) => !item.clean)) return;
    const cleanedAt = new Date().toISOString();
    setWardrobe((current) => current.map((item) => ({ ...item, clean: true, updatedAt: cleanedAt })));
    const local = await markAllClean(user.uid, wardrobe);
    setWardrobe(local);
  };

  const deleteClothing = async (item: ClothingItem) => {
    if (!user) return;
    setWardrobe((current) => current.filter((entry) => entry.id !== item.id));
    const [local] = await Promise.all([
      removeClothing(user.uid, item.id),
      deleteStoredImage(user, item.objectKey).catch((error) => {
        console.warn('[storage] Clothing image cleanup deferred:', error instanceof Error ? error.message : error);
      }),
    ]);
    setWardrobe(local);
  };

  const historyFor = (outfit: Outfit, feedback: OutfitFeedback = null): OutfitHistory => ({
    id: outfit.id,
    outfit,
    signature: outfitSignature(outfit),
    occasion: outfit.occasion,
    feedback,
    generatedAt: new Date().toISOString(),
  });

  const recordFeedback = async (outfit: Outfit, feedback: OutfitFeedback) => {
    if (!user) return;
    const existing = history.find((entry) => entry.id === outfit.id) ?? historyFor(outfit);
    if (!feedback && !existing.wornAt) {
      setHistory((current) => current.filter((item) => item.id !== outfit.id));
      const local = await deleteHistory(user.uid, outfit.id);
      setHistory(local);
      return;
    }
    const entry = { ...existing, outfit, feedback };
    setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
    const local = await saveHistory(user.uid, entry);
    setHistory(local);
  };

  const recordWorn = async (outfit: Outfit) => {
    if (!user) return;
    const wornAt = new Date().toISOString();
    const existing = history.find((entry) => entry.id === outfit.id) ?? historyFor(outfit);
    const entry = { ...existing, outfit, wornAt };
    const ids = new Set([outfit.top.id, outfit.bottom.id, outfit.shoes.id]);
    setWardrobe((current) => current.map((item) => ids.has(item.id) ? { ...item, clean: false, updatedAt: wornAt } : item));
    setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
    const local = await markOutfitWorn(user.uid, [outfit.top, outfit.bottom, outfit.shoes], entry);
    setWardrobe(local);
  };

  const recordPreviewGenerated = async (outfit: Outfit) => {
    if (!user) return;
    const existing = history.find((entry) => entry.id === outfit.id);
    if (!existing) return;
    const entry = { ...existing, outfit };
    setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
    const local = await saveHistory(user.uid, entry);
    setHistory(local);
  };

  const recordRecommendationFeedback = async (
    recommendation: ShoppingRecommendation,
    value: RecommendationFeedbackValue,
    reasons: RecommendationDislikeReason[],
  ) => {
    if (!user) return;
    const now = new Date().toISOString();
    const stableId = recommendation.productUrl ?? recommendation.id;
    const feedback: RecommendationFeedback = {
      id: stableId,
      recommendationId: recommendation.id,
      productUrl: recommendation.productUrl,
      title: recommendation.title,
      category: recommendation.category,
      garmentType: recommendation.garmentType,
      color: recommendation.color,
      style: recommendation.style,
      audience: recommendation.audience,
      retailer: recommendation.retailer,
      priceCadAmount: recommendation.priceCadAmount,
      occasions: recommendation.occasions,
      value,
      reasons: value === 'dislike' ? reasons : [],
      createdAt: now,
    };
    const next: UserPreferences = {
      ...preferences,
      recommendationFeedback: [
        feedback,
        ...preferences.recommendationFeedback.filter((entry) => entry.id !== stableId),
      ].slice(0, 120),
      updatedAt: now,
    };
    setPreferences(next);
    setPreferences(await savePreferences(user.uid, next));
  };

  const addRecommendation = async (recommendation: ShoppingRecommendation) => {
    if (!recommendation.imageUrl || !recommendation.productUrl) return 'unavailable' as const;
    if (wardrobe.some((item) => item.productUrl === recommendation.productUrl)) return 'exists' as const;
    await recordRecommendationFeedback(recommendation, 'like', []);
    await addClothing({
      name: recommendation.title,
      category: recommendation.category,
      color: recommendation.color,
      style: recommendation.style,
      garmentType: recommendation.garmentType,
      occasions: recommendation.occasions,
      formality: recommendation.formality,
      imageUri: recommendation.imageUrl,
      imageSource: 'retailer',
      cutoutStatus: 'retailer',
      analysisSource: 'manual',
      analysisConfidence: 1,
      sourceUrl: recommendation.productUrl,
      retailer: recommendation.retailer,
      productUrl: recommendation.productUrl,
      priceCad: recommendation.priceCad,
    });
    return 'added' as const;
  };

  const logOut = async () => {
    if (user?.demo) setUser(null);
    else await signOutUser();
    setScreen('home');
  };

  if (authLoading) return <View style={styles.loading}><ActivityIndicator color={colors.green} /></View>;
  if (!user) return <AuthScreen firebaseConfigured={firebaseReady} onDemo={() => setUser(demoUser)} />;

  return (
    <View
      style={styles.app}
      onPointerMove={Platform.OS === 'web' ? (event) => {
        const native = event.nativeEvent as typeof event.nativeEvent & { pageX?: number; pageY?: number; clientX?: number; clientY?: number };
        pointerX.setValue(native.pageX ?? native.clientX ?? 600);
        pointerY.setValue(native.pageY ?? native.clientY ?? 450);
      } : undefined}
    >
      {[0, 1, 2].map((layer) => <Animated.View key={layer} pointerEvents="none" style={[styles.dotLayer, {
        transform: [
          { translateX: pointerX.interpolate({ inputRange: [0, 1200], outputRange: layer === 1 ? [12, -12] : [-7 - layer * 4, 7 + layer * 4], extrapolate: 'clamp' }) },
          { translateY: pointerY.interpolate({ inputRange: [0, 900], outputRange: layer === 1 ? [-9, 9] : [6 + layer * 3, -6 - layer * 3], extrapolate: 'clamp' }) },
        ],
      }]}>{backgroundDots.filter((dot) => dot.layer === layer).map((dot) => <View key={dot.id} style={[styles.backgroundDot, layer === 1 ? styles.dotGold : layer === 2 ? styles.dotDark : styles.dotLight, { left: dot.left, top: dot.top, width: dot.size, height: dot.size, borderRadius: dot.size / 2 }]} />)}</Animated.View>)}
      <StatusBar style="dark" />
      <AppHeader screen={screen} email={user.email} onNavigate={setScreen} onSignOut={logOut} />
      {cloudPersistence === false && <View style={styles.persistenceNotice}><Text style={styles.persistenceText}>Firebase is not configured in this build. Changes are saved on this device only.</Text></View>}
      {screen === 'home' && <HomeScreen wardrobe={wardrobe} history={history} onNavigate={setScreen} />}
      {screen === 'wardrobe' && <WardrobeScreen wardrobe={wardrobe} onAdd={() => setScreen('add')} onToggleClean={toggleClean} onCleanAll={cleanAll} onEdit={(item) => { setEditingId(item.id); setScreen('edit'); }} onDelete={deleteClothing} />}
      {screen === 'add' && <AddClothingScreen onCancel={() => setScreen('wardrobe')} onSave={addClothing} />}
      {screen === 'edit' && editingItem && <EditClothingScreen userId={user.uid} item={editingItem} wardrobe={wardrobe} preferences={preferences} onCancel={() => setScreen('wardrobe')} onSave={updateClothing} onRecommendationFeedback={recordRecommendationFeedback} onAddRecommendation={addRecommendation} />}
      {screen === 'outfit' && <OutfitScreen wardrobe={wardrobe} history={history} onFeedback={recordFeedback} onWorn={recordWorn} onPreviewGenerated={recordPreviewGenerated} />}
      {screen === 'insights' && <InsightsScreen wardrobe={wardrobe} history={history} preferences={preferences} onFeedback={recordRecommendationFeedback} onAdd={addRecommendation} />}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, overflow: 'hidden', paddingTop: Platform.OS === 'android' ? 30 : 48, backgroundColor: colors.canvas },
  dotLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.58 },
  backgroundDot: { position: 'absolute' },
  dotLight: { backgroundColor: '#C79B69' },
  dotGold: { backgroundColor: '#A86D35', opacity: 0.72 },
  dotDark: { backgroundColor: '#71492F', opacity: 0.38 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  persistenceNotice: { paddingHorizontal: 18, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.goldSoft },
  persistenceText: { color: colors.inkSoft, fontSize: 9, lineHeight: 14, textAlign: 'center', fontWeight: '700' },
});

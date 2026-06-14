import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, firestoreReady } from '../firebase/config';
import { ClothingItem, OutfitHistory, OutfitOccasion, UserPreferences } from '../types';
import { titleCase } from '../utils/text';

const wardrobeKey = (uid: string) => `closetai:${uid}:wardrobe`;
const wardrobeTombstonesKey = (uid: string) => `closetai:${uid}:wardrobe-tombstones`;
const historyKey = (uid: string) => `closetai:${uid}:history`;
const preferencesKey = (uid: string) => `closetai:${uid}:preferences`;
const CLOUD_MUTATION_WINDOW_MS = 60_000;
const MAX_CLOUD_MUTATIONS_PER_WINDOW = 100;
const MAX_CLOUD_MUTATIONS_PER_SESSION = 500;
const cloudMutationUsage = new Map<string, {
  windowStartedAt: number;
  windowMutations: number;
  sessionMutations: number;
  warned: boolean;
}>();

export const defaultUserPreferences: UserPreferences = {
  preferredOccasions: [],
  likedStyles: [],
  dislikedStyles: [],
  market: 'CA',
  recommendationFeedback: [],
  updatedAt: new Date(0).toISOString(),
};

async function cloudEnabledFor(uid: string) {
  // Firestore is a hosted service and does not depend on ClosetAI's local AI
  // server. Keeping these independent lets account data sync even when a phone
  // cannot reach the development machine on port 8787.
  return firestoreReady && Boolean(db) && uid !== 'closetai-demo-user';
}

async function readLocal<T>(key: string, fallback: T): Promise<T> {
  const value = await AsyncStorage.getItem(key);
  return value ? (JSON.parse(value) as T) : fallback;
}

async function writeLocal<T>(key: string, value: T) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function readWardrobeTombstones(uid: string) {
  const stored = await readLocal<Record<string, string>>(wardrobeTombstonesKey(uid), {});
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 45;
  return Object.fromEntries(Object.entries(stored).filter(([, deletedAt]) => timestamp(deletedAt) >= cutoff));
}

async function markWardrobeDeleted(uid: string, id: string) {
  const tombstones = await readWardrobeTombstones(uid);
  tombstones[id] = new Date().toISOString();
  await writeLocal(wardrobeTombstonesKey(uid), tombstones);
}

async function clearWardrobeTombstone(uid: string, id: string) {
  const tombstones = await readWardrobeTombstones(uid);
  if (!tombstones[id]) return;
  delete tombstones[id];
  await writeLocal(wardrobeTombstonesKey(uid), tombstones);
}

function queueCloudWrite(label: string, operation: () => Promise<unknown>) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out.`)), 5000);
  });
  void Promise.race([Promise.resolve().then(operation), timeout]).catch((error) => {
    console.warn(`[persistence] ${label} deferred:`, error instanceof Error ? error.message : error);
  });
}

function reserveCloudMutations(uid: string, label: string, estimatedMutations: number) {
  const now = Date.now();
  const existing = cloudMutationUsage.get(uid) ?? {
    windowStartedAt: now,
    windowMutations: 0,
    sessionMutations: 0,
    warned: false,
  };
  if (now - existing.windowStartedAt >= CLOUD_MUTATION_WINDOW_MS) {
    existing.windowStartedAt = now;
    existing.windowMutations = 0;
  }
  const exceedsWindow = existing.windowMutations + estimatedMutations > MAX_CLOUD_MUTATIONS_PER_WINDOW;
  const exceedsSession = existing.sessionMutations + estimatedMutations > MAX_CLOUD_MUTATIONS_PER_SESSION;
  if (exceedsWindow || exceedsSession) {
    if (!existing.warned) {
      console.error(
        `[persistence] Cloud mutation safety limit blocked "${label}". ` +
        'Local data is preserved; restart only after checking for a repeated-write bug.',
      );
      existing.warned = true;
    }
    cloudMutationUsage.set(uid, existing);
    return false;
  }
  existing.windowMutations += estimatedMutations;
  existing.sessionMutations += estimatedMutations;
  cloudMutationUsage.set(uid, existing);
  return true;
}

function queueCloudForUser(
  uid: string,
  label: string,
  estimatedMutations: number,
  operation: () => Promise<unknown>,
) {
  void cloudEnabledFor(uid).then((ready) => {
    if (ready && reserveCloudMutations(uid, label, Math.max(1, estimatedMutations))) {
      queueCloudWrite(label, operation);
    }
  });
}

const timestamp = (value?: string) => {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

export function normalizeClothingItem(item: ClothingItem): ClothingItem {
  const name = item.name.toLowerCase();
  const garmentType = item.garmentType ?? (
    /t-?shirt|\btee\b/.test(name) ? 't-shirt' :
    /hoodie/.test(name) ? 'hoodie' :
    /blazer/.test(name) ? 'blazer' :
    /blouse/.test(name) ? 'blouse' :
    /sweater|crewneck/.test(name) ? 'sweater' :
    /jacket|overshirt/.test(name) ? 'jacket' :
    /shirt|oxford/.test(name) ? 'shirt' :
    /short/.test(name) ? 'shorts' :
    /sweat|jogger/.test(name) ? 'sweatpants' :
    /chino/.test(name) ? 'chinos' :
    /trouser|pant/.test(name) ? 'trousers' :
    /jean|denim/.test(name) ? 'jeans' :
    /skirt/.test(name) ? 'skirt' :
    /loafer/.test(name) ? 'loafers' :
    /dress shoe|oxford shoe/.test(name) ? 'dress-shoes' :
    /boot/.test(name) ? 'boots' :
    /runner|running|athletic/.test(name) ? 'athletic-shoes' :
    /sneaker|shoe/.test(name) ? 'sneakers' : 'other'
  );
  let occasions: OutfitOccasion[] = [...new Set<OutfitOccasion>(item.occasions ?? ['casual'])];
  const description = `${item.name} ${item.color}`.toLowerCase();
  if (garmentType === 'jeans') {
    occasions = [...new Set<OutfitOccasion>([...occasions, 'casual', 'school', 'date-night'])];
    if (/black|dark|deep|indigo|navy|raw/.test(description) && !/rip|distress|acid|baggy|washed/.test(description)) occasions = [...new Set<OutfitOccasion>([...occasions, 'work'])];
  }
  if (['t-shirt', 'hoodie', 'shorts', 'sweatpants', 'athletic-shoes'].includes(garmentType)) {
    occasions = occasions.filter((occasion) => !['work', 'formal', 'semi-formal'].includes(occasion));
  }
  return {
    ...item,
    name: titleCase(item.name),
    garmentType,
    occasions,
    cutoutStatus: item.cutoutStatus ?? (item.imageSource === 'retailer' ? 'retailer' : 'original'),
    analysisSource: item.analysisSource ?? 'manual',
    analysisConfidence: item.analysisConfidence ?? 0,
  };
}

function normalizePreferences(value?: Partial<UserPreferences> | null): UserPreferences {
  return {
    ...defaultUserPreferences,
    ...value,
    preferredOccasions: value?.preferredOccasions ?? [],
    likedStyles: value?.likedStyles ?? [],
    dislikedStyles: value?.dislikedStyles ?? [],
    recommendationFeedback: (value?.recommendationFeedback ?? []).slice(0, 120),
    updatedAt: value?.updatedAt ?? defaultUserPreferences.updatedAt,
  };
}

export function subscribeWardrobe(
  uid: string,
  fallback: ClothingItem[],
  callback: (items: ClothingItem[]) => void,
) {
  let active = true;
  void Promise.all([
    readLocal<ClothingItem[]>(wardrobeKey(uid), fallback),
    readWardrobeTombstones(uid),
  ]).then(async ([items, tombstones]) => {
    const visible = items.filter((item) => !tombstones[item.id]);
    if (!visible.length && fallback.length) await writeLocal(wardrobeKey(uid), fallback);
    if (active) callback(visible.map(normalizeClothingItem));
  });

  let unsubscribe: () => void = () => undefined;
  void cloudEnabledFor(uid).then((ready) => {
    if (!ready || !active || !db) return;
    const firestore = db;
    void readWardrobeTombstones(uid).then((tombstones) => {
      Object.keys(tombstones).forEach((id) => {
        queueCloudForUser(uid, 'wardrobe deletion recovery', 1, () =>
          deleteDoc(doc(firestore, 'users', uid, 'wardrobe', id)));
      });
    });
    const wardrobeQuery = query(collection(firestore, 'users', uid, 'wardrobe'), orderBy('updatedAt', 'desc'));
    unsubscribe = onSnapshot(wardrobeQuery, (snapshot) => {
      void (async () => {
        const tombstones = await readWardrobeTombstones(uid);
        const rawRemote = snapshot.docs.map((entry) => normalizeClothingItem(entry.data() as ClothingItem));
        const remote = rawRemote.filter((item) => !tombstones[item.id]);
        const remoteIds = new Set(rawRemote.map((item) => item.id));
        const pendingTombstones = Object.fromEntries(
          Object.entries(tombstones).filter(([id]) => remoteIds.has(id)),
        );

        // Once cloud sync is active, Firestore is authoritative. Re-uploading a
        // locally cached document that disappeared remotely can resurrect a
        // deletion and create an endless write/delete loop between devices.
        await Promise.all([
          writeLocal(wardrobeKey(uid), remote),
          writeLocal(wardrobeTombstonesKey(uid), pendingTombstones),
        ]);
        if (active) callback(remote);
      })();
    }, (error) => {
      console.warn('[persistence] Firestore wardrobe unavailable; using this device.', error.message);
    });
  });
  return () => { active = false; unsubscribe(); };
}

export function subscribeHistory(uid: string, callback: (items: OutfitHistory[]) => void) {
  let active = true;
  void readLocal<OutfitHistory[]>(historyKey(uid), []).then((items) => {
    if (active) callback(items.filter((item) => item.feedback || item.wornAt));
  });
  let unsubscribe: () => void = () => undefined;
  void cloudEnabledFor(uid).then((ready) => {
    if (!ready || !active || !db) return;
    const firestore = db;
    const historyQuery = query(collection(firestore, 'users', uid, 'outfitHistory'), orderBy('generatedAt', 'desc'));
    unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      void (async () => {
        const remote = snapshot.docs.map((entry) => entry.data() as OutfitHistory);
        const visible = remote.filter((item) => item.feedback || item.wornAt);
        await writeLocal(historyKey(uid), visible);
        if (active) callback(visible);
      })();
    }, (error) => {
      console.warn('[persistence] Firestore history unavailable; using this device.', error.message);
    });
  });
  return () => { active = false; unsubscribe(); };
}

export function subscribePreferences(uid: string, callback: (preferences: UserPreferences) => void) {
  let active = true;
  void readLocal<Partial<UserPreferences>>(preferencesKey(uid), defaultUserPreferences).then((stored) => {
    if (active) callback(normalizePreferences(stored));
  });
  let unsubscribe: () => void = () => undefined;
  void cloudEnabledFor(uid).then((ready) => {
    if (!ready || !active || !db) return;
    const firestore = db;
    const preferenceDoc = doc(firestore, 'users', uid, 'preferences', 'recommendations');
    unsubscribe = onSnapshot(preferenceDoc, (snapshot) => {
      void (async () => {
        const local = normalizePreferences(await readLocal<Partial<UserPreferences>>(preferencesKey(uid), defaultUserPreferences));
        const remote = snapshot.exists() ? normalizePreferences(snapshot.data() as Partial<UserPreferences>) : null;
        const next = remote ?? local;
        await writeLocal(preferencesKey(uid), next);
        if (active) callback(next);
      })();
    }, (error) => {
      console.warn('[persistence] Firestore preferences unavailable; using this device.', error.message);
    });
  });
  return () => { active = false; unsubscribe(); };
}

export async function saveClothing(uid: string, item: ClothingItem) {
  await clearWardrobeTombstone(uid, item.id);
  const items = await readLocal<ClothingItem[]>(wardrobeKey(uid), []);
  const next = [item, ...items.filter((entry) => entry.id !== item.id)];
  await writeLocal(wardrobeKey(uid), next);
  if (db) {
    const firestore = db;
    queueCloudForUser(uid, 'wardrobe save', 1, () => setDoc(
      doc(firestore, 'users', uid, 'wardrobe', item.id),
      JSON.parse(JSON.stringify(item)),
    ));
  }
  return next;
}

export async function removeClothing(uid: string, id: string) {
  await markWardrobeDeleted(uid, id);
  const items = await readLocal<ClothingItem[]>(wardrobeKey(uid), []);
  const next = items.filter((entry) => entry.id !== id);
  await writeLocal(wardrobeKey(uid), next);
  if (db) {
    const firestore = db;
    queueCloudForUser(uid, 'wardrobe delete', 1, () => deleteDoc(doc(firestore, 'users', uid, 'wardrobe', id)));
  }
  return next;
}

export async function saveHistory(uid: string, entry: OutfitHistory) {
  const history = await readLocal<OutfitHistory[]>(historyKey(uid), []);
  const next = [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, 75);
  await writeLocal(historyKey(uid), next);
  if (db) {
    const firestore = db;
    queueCloudForUser(uid, 'outfit history save', 1, () => setDoc(
      doc(firestore, 'users', uid, 'outfitHistory', entry.id),
      JSON.parse(JSON.stringify(entry)),
    ));
  }
  return next;
}

export async function savePreferences(uid: string, preferences: UserPreferences) {
  const next = normalizePreferences(preferences);
  await writeLocal(preferencesKey(uid), next);
  if (db) {
    const firestore = db;
    queueCloudForUser(uid, 'preferences save', 1, () => setDoc(
      doc(firestore, 'users', uid, 'preferences', 'recommendations'),
      JSON.parse(JSON.stringify(next)),
    ));
  }
  return next;
}

export async function deleteHistory(uid: string, id: string) {
  const history = await readLocal<OutfitHistory[]>(historyKey(uid), []);
  const next = history.filter((item) => item.id !== id);
  await writeLocal(historyKey(uid), next);
  if (db) {
    const firestore = db;
    queueCloudForUser(uid, 'outfit history delete', 1, () => deleteDoc(doc(firestore, 'users', uid, 'outfitHistory', id)));
  }
  return next;
}

export async function pruneGeneratedHistory(uid: string) {
  const history = await readLocal<OutfitHistory[]>(historyKey(uid), []);
  const next = history.filter((item) => item.feedback || item.wornAt);
  await writeLocal(historyKey(uid), next);
  return next;
}

export async function markAllClean(uid: string, wardrobe: ClothingItem[]) {
  const cleanedAt = new Date().toISOString();
  const next = wardrobe.map((item) => ({ ...item, clean: true, updatedAt: cleanedAt }));
  await writeLocal(wardrobeKey(uid), next);
  if (db) {
    const firestore = db;
    queueCloudForUser(uid, 'clean all', next.length, async () => {
      const batch = writeBatch(firestore);
      next.forEach((item) => batch.set(
        doc(firestore, 'users', uid, 'wardrobe', item.id),
        JSON.parse(JSON.stringify(item)),
      ));
      await batch.commit();
    });
  }
  return next;
}

export async function markOutfitWorn(
  uid: string,
  clothing: ClothingItem[],
  historyEntry: OutfitHistory,
) {
  const wornAt = historyEntry.wornAt ?? new Date().toISOString();
  const current = await readLocal<ClothingItem[]>(wardrobeKey(uid), []);
  const ids = new Set(clothing.map((item) => item.id));
  const wardrobe = current.map((item) =>
    ids.has(item.id) ? { ...item, clean: false, updatedAt: wornAt } : item,
  );
  const history = await readLocal<OutfitHistory[]>(historyKey(uid), []);
  const savedHistory = { ...historyEntry, wornAt };
  await Promise.all([
    writeLocal(wardrobeKey(uid), wardrobe),
    writeLocal(historyKey(uid), [savedHistory, ...history.filter((item) => item.id !== savedHistory.id)].slice(0, 75)),
  ]);

  if (db) {
    const firestore = db;
    queueCloudForUser(uid, 'worn outfit save', clothing.length + 1, async () => {
      const batch = writeBatch(firestore);
      clothing.forEach((item) => batch.set(
        doc(firestore, 'users', uid, 'wardrobe', item.id),
        JSON.parse(JSON.stringify({ ...item, clean: false, updatedAt: wornAt })),
      ));
      batch.set(
        doc(firestore, 'users', uid, 'outfitHistory', historyEntry.id),
        JSON.parse(JSON.stringify(savedHistory)),
      );
      await batch.commit();
    });
  }
  return wardrobe;
}

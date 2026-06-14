import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClothingItem, ClothingPairingResult, ShoppingRecommendation, UserPreferences } from '../types';
import { apiUrl } from './aiClothingService';
import { getAuthToken } from './authService';

const neutralColors = ['black', 'white', 'cream', 'beige', 'gray', 'grey', 'navy', 'brown', 'tan', 'stone'];
const cacheKey = (uid: string, itemId: string) => `closetai:${uid}:pairings:${itemId}`;
const cacheTtl = 1000 * 60 * 60 * 24 * 7;

type PairingCache = {
  fingerprint: string;
  expiresAt: number;
  result: ClothingPairingResult;
};

const itemFingerprint = (item: ClothingItem) => JSON.stringify([
  item.name,
  item.category,
  item.color,
  item.style,
  item.garmentType,
  [...item.occasions].sort(),
  item.formality,
]);

function visibleShoppingMatches(matches: ShoppingRecommendation[], preferences: UserPreferences) {
  const declined = new Set(preferences.recommendationFeedback
    .filter((entry) => entry.value === 'dislike')
    .map((entry) => entry.productUrl ?? entry.recommendationId));
  return matches.filter((match) => !declined.has(match.productUrl ?? match.id));
}

export function productImageUri(imageUrl?: string, productUrl?: string) {
  if (!imageUrl || !apiUrl || imageUrl.startsWith(`${apiUrl}/api/products/image`)) return imageUrl;
  const product = productUrl ? `&product=${encodeURIComponent(productUrl)}` : '';
  return `${apiUrl}/api/products/image?url=${encodeURIComponent(imageUrl)}${product}`;
}

function localPairingScore(item: ClothingItem, candidate: ClothingItem) {
  if (item.id === candidate.id || item.category === candidate.category) return -1;
  const sharedOccasions = candidate.occasions.filter((occasion) => item.occasions.includes(occasion)).length;
  const styleScore = item.style === candidate.style ? 2 : item.formality === candidate.formality ? 1 : 0;
  const itemNeutral = neutralColors.some((color) => item.color.toLowerCase().includes(color));
  const candidateNeutral = neutralColors.some((color) => candidate.color.toLowerCase().includes(color));
  const colorScore = itemNeutral || candidateNeutral ? 2 : item.color.toLowerCase() !== candidate.color.toLowerCase() ? 1 : 0;
  return sharedOccasions * 3 + styleScore + colorScore + (candidate.clean ? 1 : 0);
}

function localFallback(item: ClothingItem, wardrobe: ClothingItem[]): ClothingPairingResult {
  const ownedMatches = wardrobe
    .map((candidate) => ({ item: candidate, score: localPairingScore(item, candidate) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => ({
      ...entry,
      reason: `${entry.item.color} ${entry.item.garmentType.replace('-', ' ')} shares the right dress code and balances this piece.`,
    }));
  return {
    summary: ownedMatches.length
      ? `These pieces already in your closet work best with ${item.name}.`
      : `Add another category to build complete looks around ${item.name}.`,
    ownedMatches,
    shoppingMatches: [],
    generatedAt: new Date().toISOString(),
    provider: 'local',
  };
}

export async function loadCachedClothingPairings(
  uid: string,
  item: ClothingItem,
  wardrobe: ClothingItem[],
  preferences: UserPreferences,
) {
  try {
    const value = await AsyncStorage.getItem(cacheKey(uid, item.id));
    if (!value) return null;
    const cached = JSON.parse(value) as PairingCache;
    if (cached.expiresAt < Date.now() || cached.fingerprint !== itemFingerprint(item)) {
      await AsyncStorage.removeItem(cacheKey(uid, item.id));
      return null;
    }
    const owned = localFallback(item, wardrobe).ownedMatches;
    return {
      ...cached.result,
      ownedMatches: owned,
      shoppingMatches: visibleShoppingMatches(cached.result.shoppingMatches, preferences),
      cached: true,
    };
  } catch {
    return null;
  }
}

async function cacheClothingPairings(uid: string, item: ClothingItem, result: ClothingPairingResult) {
  const cached: PairingCache = {
    fingerprint: itemFingerprint(item),
    expiresAt: Date.now() + (result.shoppingMatches.length ? cacheTtl : 1000 * 60 * 20),
    result: { ...result, cached: false },
  };
  await AsyncStorage.setItem(cacheKey(uid, item.id), JSON.stringify(cached));
}

export async function requestClothingPairings(
  uid: string,
  item: ClothingItem,
  wardrobe: ClothingItem[],
  preferences: UserPreferences,
  forceRefresh = false,
  excludedProductUrls: string[] = [],
) {
  const cached = await loadCachedClothingPairings(uid, item, wardrobe, preferences);
  if (!forceRefresh && cached) return cached;
  const fallback = localFallback(item, wardrobe);
  if (!apiUrl) {
    await cacheClothingPairings(uid, item, fallback);
    return fallback;
  }
  const token = await getAuthToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${apiUrl}/api/clothing/pairings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        item,
        wardrobe,
        preferences,
        forceDiscovery: forceRefresh,
        explorationSeed: forceRefresh ? Date.now() : undefined,
        excludedProductUrls: forceRefresh
          ? [
              ...excludedProductUrls,
              ...preferences.recommendationFeedback.map((entry) => entry.productUrl).filter((url): url is string => Boolean(url)),
            ]
          : [],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (forceRefresh) {
        const payload = await response.json().catch(() => ({})) as { error?: string; retryAfterSeconds?: number };
        const wait = payload.retryAfterSeconds ? ` Try again in ${payload.retryAfterSeconds} seconds.` : '';
        throw new Error(`${payload.error ?? 'Fresh matching products are temporarily unavailable.'}${wait}`);
      }
      await cacheClothingPairings(uid, item, fallback);
      return fallback;
    }
    const result = (await response.json()) as ClothingPairingResult;
    const seen = new Set<string>();
    const resolved = forceRefresh && cached
      ? {
          ...result,
          shoppingMatches: [...result.shoppingMatches, ...cached.shoppingMatches].filter((match) => {
            const key = match.productUrl ?? match.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
        }
      : result;
    await cacheClothingPairings(uid, item, resolved);
    return resolved;
  } catch (error) {
    if (forceRefresh) throw error;
    await cacheClothingPairings(uid, item, fallback);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

import {
  ClothingItem,
  OutfitHistory,
  ShoppingRecommendation,
  UserPreferences,
  WardrobeAnalysis,
  WardrobeInsight,
} from '../types';
import { apiUrl } from './aiClothingService';
import { getAuthToken } from './authService';
import { countGoodOutfits, getOutfitAvailability } from './outfitService';

const darkNames = ['black', 'navy', 'charcoal', 'dark', 'brown', 'indigo'];
const lightNames = ['white', 'cream', 'beige', 'tan', 'pastel', 'sky'];

export function analyzeWardrobeLocally(
  wardrobe: ClothingItem[],
  history: OutfitHistory[],
  preferences?: UserPreferences,
): WardrobeAnalysis {
  const counts = {
    top: wardrobe.filter((item) => item.category === 'top').length,
    bottom: wardrobe.filter((item) => item.category === 'bottom').length,
    shoes: wardrobe.filter((item) => item.category === 'shoes').length,
  };
  const dark = wardrobe.filter((item) =>
    darkNames.some((name) => item.color.toLowerCase().includes(name)),
  ).length;
  const light = wardrobe.filter((item) =>
    lightNames.some((name) => item.color.toLowerCase().includes(name)),
  ).length;
  const formal = wardrobe.filter(
    (item) => item.formality === 'formal' || item.formality === 'semi-formal',
  ).length;
  const insights: WardrobeInsight[] = [];
  const recommendations: ShoppingRecommendation[] = [];
  const uniqueWorn = new Set(history.filter((entry) => entry.wornAt).map((entry) => entry.signature));
  const possibleOutfits = countGoodOutfits(wardrobe);
  const wornOutfits = Math.min(possibleOutfits, uniqueWorn.size);
  const efficiency = {
    possibleOutfits,
    wornOutfits,
    wornPercentage: possibleOutfits ? Math.round((wornOutfits / possibleOutfits) * 100) : 0,
  };

  if (wardrobe.length >= 6) {
    insights.push({
      id: 'foundation',
      title: 'Strong foundation',
      detail: `${wardrobe.length} pieces can create up to ${counts.top * counts.bottom * counts.shoes} complete three-piece combinations.`,
      tone: 'positive',
    });
  }
  if (wardrobe.length >= 24) {
    const colors = new Set(wardrobe.map((item) => item.color.toLowerCase()));
    const garmentTypes = new Set(wardrobe.map((item) => item.garmentType));
    insights.push({
      id: 'catalog-depth',
      title: 'A large closet can still grow strategically',
      detail: `${wardrobe.length} pieces cover ${colors.size} colours and ${garmentTypes.size} garment types. Recommendations now prioritize new textures, silhouettes, and use cases instead of basic quantity.`,
      tone: 'positive',
    });
  }
  if (dark > wardrobe.length * 0.6 && light < 2) {
    insights.push({
      id: 'colour-balance',
      title: 'Your closet leans dark',
      detail: 'A cream, stone, or light-blue piece would add contrast without fighting your existing style.',
      tone: 'opportunity',
    });
    recommendations.push({
      id: 'light-layer',
      title: 'Cream overshirt',
      category: 'top',
      garmentType: 'jacket',
      color: 'Cream',
      style: 'classic',
      formality: 'smart-casual',
      audience: 'unisex',
      reason: 'It brightens your darker base pieces and works for school, work, and casual outfits.',
      combinationsUnlocked: Math.max(1, counts.bottom * counts.shoes),
      occasions: ['casual', 'school', 'work'],
      linkStatus: 'unavailable',
    });
  }
  const weakest = (Object.entries(counts) as [keyof typeof counts, number][]).sort(
    (a, b) => a[1] - b[1],
  )[0];
  if (weakest[1] < 2) {
    const label = weakest[0] === 'shoes' ? 'versatile shoes' : `another ${weakest[0]}`;
    insights.push({
      id: 'category-gap',
      title: `Add ${label}`,
      detail: `Your ${weakest[0]} selection is the main limit on how many outfits ClosetAI can build.`,
      tone: 'warning',
    });
    recommendations.push({
      id: `gap-${weakest[0]}`,
      title: weakest[0] === 'shoes' ? 'Minimal leather sneakers' : `Versatile ${weakest[0]}`,
      category: weakest[0],
      garmentType: weakest[0] === 'shoes' ? 'sneakers' : weakest[0] === 'bottom' ? 'chinos' : 'shirt',
      color: weakest[0] === 'shoes' ? 'Off-white' : 'Mid blue',
      style: 'classic',
      formality: 'smart-casual',
      audience: 'unisex',
      reason: `This fills your smallest category and creates the largest immediate increase in outfit options.`,
      combinationsUnlocked:
        weakest[0] === 'top'
          ? counts.bottom * counts.shoes
          : weakest[0] === 'bottom'
            ? counts.top * counts.shoes
            : counts.top * counts.bottom,
      occasions: ['casual', 'school', 'date-night'],
      linkStatus: 'unavailable',
    });
  }
  if (formal < 2) {
    insights.push({
      id: 'formal-gap',
      title: 'Formal options are limited',
      detail: 'One structured layer and one polished shoe would make work and semi-formal requests much stronger.',
      tone: 'opportunity',
    });
  }
  if (history.length > 3) {
    insights.push({
      id: 'learning',
      title: 'Personalization is active',
      detail: `${history.length} saved outfit decisions now help reduce repeats and tune future suggestions.`,
      tone: 'positive',
    });
  }
  const recommendationDecisions = preferences?.recommendationFeedback.length ?? 0;
  if (recommendationDecisions >= 2) {
    insights.push({
      id: 'shopping-learning',
      title: 'Shopping suggestions are learning',
      detail: `${recommendationDecisions} product decisions are now shaping audience, style, colour, and price recommendations.`,
      tone: 'positive',
    });
  }

  if (!insights.length) {
    insights.push({
      id: 'start',
      title: 'Add a few more pieces',
      detail: 'ClosetAI needs a little more variety before it can identify meaningful wardrobe gaps.',
      tone: 'opportunity',
    });
  }

  const colorCount = new Set(wardrobe.map((item) => item.color.toLowerCase())).size;
  const typeCount = new Set(wardrobe.map((item) => item.garmentType)).size;
  const styleCount = new Set(wardrobe.map((item) => item.style)).size;
  const formalityCount = new Set(wardrobe.map((item) => item.formality)).size;
  const allAvailable = wardrobe.map((item) => ({ ...item, clean: true }));
  const occasionCoverage = ['casual', 'formal', 'semi-formal', 'school', 'work', 'date-night', 'active', 'streetwear']
    .filter((occasion) => Object.values(getOutfitAvailability(allAvailable, occasion as Parameters<typeof getOutfitAvailability>[1])).every(Boolean)).length;
  const categoryDepth = (Math.min(counts.top, 8) + Math.min(counts.bottom, 8) + Math.min(counts.shoes, 8)) / 24;
  const coverage = Math.min(100, Math.round(
    categoryDepth * 30 +
    Math.min(colorCount / 10, 1) * 15 +
    Math.min(typeCount / 12, 1) * 20 +
    (occasionCoverage / 8) * 20 +
    Math.min(formalityCount / 4, 1) * 10 +
    Math.min(styleCount / 5, 1) * 5,
  ));
  return {
    summary: wardrobe.length
      ? 'Your wardrobe has a usable core. The biggest opportunities are the suggestions below.'
      : 'Add clothing to unlock a personalized wardrobe analysis.',
    score: coverage,
    efficiency,
    insights,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

export async function requestWardrobeInsights(
  wardrobe: ClothingItem[],
  history: OutfitHistory[],
  preferences: UserPreferences,
  options: { forceExpansion?: boolean; excludedProductUrls?: string[] } = {},
) {
  const fallback = analyzeWardrobeLocally(wardrobe, history, preferences);
  if (!apiUrl || !wardrobe.length) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
  try {
    const token = await getAuthToken();
    const response = await fetch(`${apiUrl}/api/insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        wardrobe: wardrobe.map(({ id, name, category, color, style, garmentType, occasions, formality, clean, createdAt, updatedAt }) => ({ id, name, category, color, style, garmentType, occasions, formality, clean, createdAt, updatedAt })),
        history: history.slice(0, 20).map(({ id, signature, occasion, feedback, generatedAt, wornAt }) => ({ id, signature, occasion, feedback, generatedAt, wornAt })),
        preferences,
        market: 'CA',
        forceExpansion: options.forceExpansion === true,
        explorationSeed: options.forceExpansion ? Date.now() : undefined,
        excludedProductUrls: options.excludedProductUrls ?? [],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (options.forceExpansion) {
        const payload = await response.json().catch(() => ({})) as { error?: string; retryAfterSeconds?: number };
        const wait = payload.retryAfterSeconds ? ` Try again in ${payload.retryAfterSeconds} seconds.` : '';
        throw new Error(`${payload.error ?? 'Fresh recommendations are temporarily unavailable.'}${wait}`);
      }
      return fallback;
    }
    return (await response.json()) as WardrobeAnalysis;
  } catch (error) {
    if (options.forceExpansion) throw error;
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

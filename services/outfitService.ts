import {
  ClothingItem,
  ClothingStyle,
  Outfit,
  OutfitHistory,
  OutfitMode,
  OutfitOccasion,
} from '../types';

type ColorFamily = 'neutral' | 'earth' | 'cool' | 'warm' | 'unknown';

const colorFamilies: Record<ColorFamily, string[]> = {
  neutral: ['black', 'white', 'gray', 'grey', 'cream', 'beige', 'tan', 'neutral'],
  earth: ['green', 'olive', 'brown', 'rust', 'khaki', 'sand'],
  cool: ['blue', 'navy', 'indigo', 'purple', 'teal'],
  warm: ['red', 'orange', 'yellow', 'pink', 'burgundy'],
  unknown: [],
};

const stylePairs: Record<ClothingStyle, ClothingStyle[]> = {
  casual: ['casual', 'classic', 'sport', 'street'],
  business: ['business', 'classic'],
  sport: ['sport', 'casual', 'street'],
  street: ['street', 'casual', 'sport'],
  classic: ['classic', 'business', 'casual'],
};

const occasionStyleMap: Record<OutfitOccasion, ClothingStyle[]> = {
  casual: ['casual', 'classic', 'street', 'sport'],
  formal: ['business', 'classic'],
  'semi-formal': ['business', 'classic', 'casual'],
  school: ['casual', 'classic', 'street', 'sport'],
  work: ['business', 'classic', 'casual'],
  'date-night': ['classic', 'business', 'casual', 'street'],
  active: ['sport', 'casual'],
  streetwear: ['street', 'casual', 'sport'],
};

const blockedByDressCode = new Set([
  't-shirt',
  'hoodie',
  'shorts',
  'sweatpants',
  'athletic-shoes',
]);

export const isEligibleForOccasion = (item: ClothingItem, mode: OutfitMode) => {
  if (mode === 'any') return true;
  if (!item.occasions.includes(mode)) return false;
  if ((mode === 'work' || mode === 'formal') && blockedByDressCode.has(item.garmentType)) {
    return false;
  }
  if (mode === 'formal' && item.formality !== 'formal' && item.formality !== 'semi-formal') {
    return false;
  }
  return true;
};

export function getOutfitAvailability(wardrobe: ClothingItem[], mode: OutfitMode) {
  const eligible = wardrobe.filter((item) => item.clean && isEligibleForOccasion(item, mode));
  return {
    top: eligible.some((item) => item.category === 'top'),
    bottom: eligible.some((item) => item.category === 'bottom'),
    shoes: eligible.some((item) => item.category === 'shoes'),
  };
}

const colorFamily = (color: string): ColorFamily => {
  const normalized = color.toLowerCase();
  return (
    (Object.entries(colorFamilies).find(([, names]) =>
      names.some((name) => normalized.includes(name)),
    )?.[0] as ColorFamily | undefined) ?? 'unknown'
  );
};

const colorPairScore = (first: ClothingItem, second: ClothingItem) => {
  const a = colorFamily(first.color);
  const b = colorFamily(second.color);
  if (a === 'neutral' || b === 'neutral') return 4;
  if (a === b) return 3;
  if ((a === 'earth' && b === 'cool') || (a === 'cool' && b === 'earth')) return 2;
  if ((a === 'warm' && b === 'cool') || (a === 'cool' && b === 'warm')) return 2;
  return 0;
};

const stylePairScore = (first: ClothingItem, second: ClothingItem) => {
  if (first.style === second.style) return 5;
  return stylePairs[first.style].includes(second.style) ? 3 : -2;
};

export const outfitSignature = (outfit: Pick<Outfit, 'top' | 'bottom' | 'shoes'>) =>
  [outfit.top.id, outfit.bottom.id, outfit.shoes.id].sort().join(':');

const pairKeys = (outfit: Pick<Outfit, 'top' | 'bottom' | 'shoes'>) => [
  [outfit.top.id, outfit.bottom.id].sort().join(':'),
  [outfit.top.id, outfit.shoes.id].sort().join(':'),
  [outfit.bottom.id, outfit.shoes.id].sort().join(':'),
];

const scoreHistory = (
  outfit: Pick<Outfit, 'top' | 'bottom' | 'shoes'>,
  history: OutfitHistory[],
) => {
  const signature = outfitSignature(outfit);
  const pairs = new Set(pairKeys(outfit));
  let score = 0;

  history.slice(0, 5).forEach((entry, index) => {
    if (entry.signature === signature) score -= 42 - index * 5;
  });

  history.forEach((entry) => {
    const sharedPairs = pairKeys(entry.outfit).filter((pair) => pairs.has(pair)).length;
    if (entry.feedback === 'like') score += sharedPairs * 4;
    if (entry.feedback === 'dislike') score -= sharedPairs * 8;
    if (entry.wornAt && entry.signature === signature) score -= 12;
  });
  return score;
};

const scoreCombination = (
  top: ClothingItem,
  bottom: ClothingItem,
  shoes: ClothingItem,
  mode: OutfitMode,
  history: OutfitHistory[],
) => {
  let score = 0;
  score += colorPairScore(top, bottom) * 2;
  score += colorPairScore(bottom, shoes);
  score += stylePairScore(top, bottom) * 2;
  score += stylePairScore(bottom, shoes);

  const items = [top, bottom, shoes];
  const families = items.map((item) => colorFamily(item.color));
  const nonNeutralFamilies = new Set(families.filter((family) => family !== 'neutral'));
  if (families.includes('neutral')) score += 3;
  if (nonNeutralFamilies.size > 2) score -= 5;
  if (colorFamily(shoes.color) === 'neutral') score += 2;

  if (mode !== 'any') {
    const preferredStyles = occasionStyleMap[mode];
    items.forEach((item) => {
      if (item.occasions.includes(mode)) score += 12;
      else if (preferredStyles.includes(item.style)) score += 4;
      else score -= 9;
    });
  }

  return score + scoreHistory({ top, bottom, shoes }, history);
};

const sharedOccasions = (items: ClothingItem[]) => items.reduce<OutfitOccasion[]>(
  (shared, item, index) => index === 0
    ? [...item.occasions]
    : shared.filter((occasion) => item.occasions.includes(occasion)),
  [],
);

export function isGoodOutfitCombination(top: ClothingItem, bottom: ClothingItem, shoes: ClothingItem) {
  const compatibility = colorPairScore(top, bottom) * 2 + colorPairScore(bottom, shoes) +
    stylePairScore(top, bottom) * 2 + stylePairScore(bottom, shoes);
  return compatibility >= 10 && sharedOccasions([top, bottom, shoes]).length > 0;
}

export function countGoodOutfits(wardrobe: ClothingItem[]) {
  const tops = wardrobe.filter((item) => item.category === 'top');
  const bottoms = wardrobe.filter((item) => item.category === 'bottom');
  const shoes = wardrobe.filter((item) => item.category === 'shoes');
  let count = 0;
  tops.forEach((top) => bottoms.forEach((bottom) => shoes.forEach((shoe) => {
    if (isGoodOutfitCombination(top, bottom, shoe)) count += 1;
  })));
  return count;
}

const outfitCopy = (top: ClothingItem, bottom: ClothingItem, shoes: ClothingItem) => {
  const styles = [top.style, bottom.style, shoes.style];
  const families = [top, bottom, shoes].map((item) => colorFamily(item.color));

  if (families.includes('warm') && families.includes('cool')) {
    return {
      trend: 'Confident colour story',
      reason: 'A warm-cool contrast adds energy while the most neutral piece keeps the look grounded.',
    };
  }
  if (styles.filter((style) => style === 'business' || style === 'classic').length >= 2) {
    return {
      trend: 'Modern tailoring',
      reason: 'The polished pieces share a similar formality level, with the third piece keeping the outfit wearable.',
    };
  }
  if (styles.filter((style) => style === 'sport').length >= 2) {
    return {
      trend: 'Sport-led everyday',
      reason: 'Athletic pieces stay intentional through a simple palette and practical proportions.',
    };
  }
  if (styles.includes('street')) {
    return {
      trend: 'Relaxed streetwear',
      reason: 'Compatible casual silhouettes make this easy to layer without looking accidental.',
    };
  }
  if (families.filter((family) => family === 'earth').length >= 2) {
    return {
      trend: 'Earth-tone layering',
      reason: 'Natural shades work together while the shoes keep the palette balanced.',
    };
  }
  return {
    trend: 'Clean everyday',
    reason: 'A neutral anchor and compatible style level make these three pieces easy to wear together.',
  };
};

export function generateOutfit(
  wardrobe: ClothingItem[],
  previousOutfit: Outfit | null = null,
  mode: OutfitMode = 'any',
  history: OutfitHistory[] = [],
  sessionSignatures: string[] = [],
): Outfit | null {
  const cleanItems = wardrobe.filter((item) => item.clean && isEligibleForOccasion(item, mode));
  const tops = cleanItems.filter((item) => item.category === 'top');
  const bottoms = cleanItems.filter((item) => item.category === 'bottom');
  const shoes = cleanItems.filter((item) => item.category === 'shoes');
  if (!tops.length || !bottoms.length || !shoes.length) return null;

  const previousSignature = previousOutfit ? outfitSignature(previousOutfit) : null;
  const combinations = tops.flatMap((top) =>
    bottoms.flatMap((bottom) =>
      shoes.map((shoe) => {
        const copy = outfitCopy(top, bottom, shoe);
        const base = { top, bottom, shoes: shoe };
        const score = scoreCombination(top, bottom, shoe, mode, history);
        return {
          outfit: {
            id: `outfit-${Date.now()}-${top.id}-${bottom.id}-${shoe.id}`,
            ...base,
            ...copy,
            occasion: mode,
            score,
          } satisfies Outfit,
          score: score + Math.random() * 1.25,
        };
      }),
    ),
  );

  combinations.sort((a, b) => b.score - a.score);
  const fresh = previousSignature
    ? combinations.filter(({ outfit }) => outfitSignature(outfit) !== previousSignature)
    : combinations;
  const unseen = fresh.filter(({ outfit }) => !sessionSignatures.includes(outfitSignature(outfit)));
  const shortlist = (unseen.length ? unseen : fresh.length ? fresh : combinations).slice(0, 4);
  return shortlist[Math.floor(Math.random() * shortlist.length)].outfit;
}

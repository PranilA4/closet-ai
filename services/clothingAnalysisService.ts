import {
  Category,
  ClothingStyle,
  Formality,
  GarmentType,
  NewClothingItem,
  OutfitOccasion,
} from '../types';

export type ClothingImageInput = {
  uri: string;
  fileName?: string | null;
  width?: number;
  height?: number;
  source: 'camera' | 'library';
};

type KeywordGroup<T> = { value: T; words: string[] };

const categoryKeywords: KeywordGroup<Category>[] = [
  {
    value: 'shoes',
    words: ['shoe', 'shoes', 'sneaker', 'trainer', 'boot', 'loafer', 'heel'],
  },
  {
    value: 'bottom',
    words: ['pant', 'pants', 'jean', 'denim', 'trouser', 'short', 'skirt', 'chino'],
  },
  {
    value: 'top',
    words: ['shirt', 'tee', 'tshirt', 'hoodie', 'sweater', 'jacket', 'top', 'blouse'],
  },
];

const styleKeywords: KeywordGroup<ClothingStyle>[] = [
  { value: 'sport', words: ['sport', 'running', 'runner', 'trainer', 'athletic', 'gym'] },
  { value: 'business', words: ['oxford', 'dress', 'formal', 'business', 'blazer', 'loafer', 'trouser'] },
  { value: 'street', words: ['street', 'oversized', 'cargo', 'graphic', 'high-top'] },
  { value: 'classic', words: ['classic', 'denim', 'chino', 'leather', 'timeless'] },
];

const colorKeywords = [
  'black',
  'white',
  'gray',
  'grey',
  'navy',
  'blue',
  'green',
  'olive',
  'brown',
  'tan',
  'beige',
  'cream',
  'red',
  'orange',
  'yellow',
  'pink',
  'purple',
];

const itemNames: Record<Category, string> = {
  top: 'Everyday Top',
  bottom: 'Everyday Bottom',
  shoes: 'Everyday Shoes',
};

const garmentDefaults = {
  top: 't-shirt',
  bottom: 'trousers',
  shoes: 'sneakers',
} as const;

const garmentKeywords: KeywordGroup<GarmentType>[] = [
  { value: 't-shirt', words: ['t-shirt', 'tshirt', 'tee'] },
  { value: 'hoodie', words: ['hoodie'] },
  { value: 'sweater', words: ['sweater', 'crewneck', 'knit'] },
  { value: 'blazer', words: ['blazer'] },
  { value: 'jacket', words: ['jacket', 'overshirt'] },
  { value: 'shirt', words: ['shirt', 'oxford', 'button down'] },
  { value: 'jeans', words: ['jean', 'denim'] },
  { value: 'chinos', words: ['chino'] },
  { value: 'shorts', words: ['short'] },
  { value: 'sweatpants', words: ['sweatpant', 'jogger'] },
  { value: 'trousers', words: ['trouser', 'pant'] },
  { value: 'loafers', words: ['loafer'] },
  { value: 'boots', words: ['boot'] },
  { value: 'athletic-shoes', words: ['running shoe', 'trainer', 'athletic shoe'] },
  { value: 'sneakers', words: ['sneaker', 'shoe'] },
];

function inferOccasions(garmentType: GarmentType, style: ClothingStyle, color: string, name: string) {
  const base = [...styleDefaults[style].occasions];
  const add = (...values: OutfitOccasion[]) => values.forEach((value) => { if (!base.includes(value)) base.push(value); });
  if (garmentType === 'jeans') {
    add('casual', 'school', 'date-night');
    const polished = /black|dark|deep|indigo|navy|raw/.test(`${color} ${name}`) && !/rip|distress|acid|baggy|washed/.test(name);
    if (polished) add('work');
  }
  const blockedFormal = ['t-shirt', 'hoodie', 'shorts', 'sweatpants', 'athletic-shoes'].includes(garmentType);
  return blockedFormal ? base.filter((occasion) => !['work', 'formal', 'semi-formal'].includes(occasion)) : base;
}

const styleDefaults: Record<ClothingStyle, { occasions: OutfitOccasion[]; formality: Formality }> = {
  casual: { occasions: ['casual', 'school', 'date-night'], formality: 'relaxed' },
  business: { occasions: ['work', 'semi-formal', 'formal'], formality: 'semi-formal' },
  sport: { occasions: ['active', 'casual', 'school'], formality: 'relaxed' },
  street: { occasions: ['streetwear', 'casual', 'school'], formality: 'relaxed' },
  classic: { occasions: ['work', 'date-night', 'semi-formal'], formality: 'smart-casual' },
};

const findKeywordValue = <T>(text: string, groups: KeywordGroup<T>[]) =>
  groups.find((group) => group.words.some((word) => text.includes(word)))?.value;

const titleCase = (value: string) =>
  value.replace(/\b\w/g, (letter) => letter.toUpperCase());

export async function analyzeClothingImage(
  input: ClothingImageInput,
): Promise<NewClothingItem> {
  const rawName = (input.fileName ?? '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();

  const namedCategory = findKeywordValue(rawName, categoryKeywords);
  const ratio = input.width && input.height ? input.width / input.height : 1;
  const category =
    namedCategory ?? (ratio > 1.35 ? 'shoes' : ratio < 0.72 ? 'bottom' : 'top');
  const style = findKeywordValue(rawName, styleKeywords) ?? 'casual';
  const defaults = styleDefaults[style];
  const matchedColor = colorKeywords.find((candidate) => rawName.includes(candidate));
  const color = matchedColor ? titleCase(matchedColor === 'grey' ? 'gray' : matchedColor) : 'Neutral';
  const usefulName = rawName
    .replace(/\b(img|image|photo|camera|scan|dsc|pxl)\b/g, '')
    .replace(/\b\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const garmentType = findKeywordValue(rawName, garmentKeywords) ?? garmentDefaults[category];
  const colorForRules = matchedColor ?? '';
  const occasions = inferOccasions(garmentType, style, colorForRules, rawName);
  const polishedJeans = garmentType === 'jeans' && occasions.includes('work');

  // Keep the local fallback asynchronous so the screen can swap to cloud
  // recognition without changing its loading flow.
  await Promise.resolve();

  return {
    imageUri: input.uri,
    category,
    garmentType,
    color,
    style,
    occasions,
    formality: polishedJeans ? 'smart-casual' : defaults.formality,
    imageSource: 'local',
    cutoutStatus: 'original',
    analysisSource: 'local',
    analysisConfidence: 0.2,
    name: usefulName.length > 2 ? titleCase(usefulName) : itemNames[category],
  };
}

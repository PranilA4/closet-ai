export type Category = 'top' | 'bottom' | 'shoes';

export type ClothingStyle =
  | 'casual'
  | 'business'
  | 'sport'
  | 'street'
  | 'classic';

export type OutfitOccasion =
  | 'casual'
  | 'formal'
  | 'semi-formal'
  | 'school'
  | 'work'
  | 'date-night'
  | 'active'
  | 'streetwear';

export type OutfitMode = 'any' | OutfitOccasion;
export type Formality = 'relaxed' | 'smart-casual' | 'semi-formal' | 'formal';
export type ImageSource = 'local' | 'cloudinary' | 'vultr' | 'retailer' | 'sample';
export type OutfitFeedback = 'like' | 'dislike' | null;
export type OutfitBodyShape = 'lean' | 'average' | 'athletic' | 'curvy' | 'plus-size';
export type AnalysisSource = 'cloudflare' | 'gemini' | 'local' | 'manual';
export type CutoutStatus = 'processed' | 'original' | 'retailer';
export type LinkStatus = 'verified' | 'unavailable';
export type ProductAudience = 'men' | 'women' | 'unisex' | 'unknown';
export type RecommendationFeedbackValue = 'like' | 'dislike';
export type RecommendationDislikeReason =
  | 'too-expensive'
  | 'wrong-audience'
  | 'not-my-style'
  | 'wrong-color'
  | 'already-own'
  | 'other';
export type GarmentType =
  | 't-shirt'
  | 'shirt'
  | 'blouse'
  | 'sweater'
  | 'hoodie'
  | 'jacket'
  | 'blazer'
  | 'jeans'
  | 'trousers'
  | 'chinos'
  | 'shorts'
  | 'skirt'
  | 'sweatpants'
  | 'sneakers'
  | 'athletic-shoes'
  | 'boots'
  | 'loafers'
  | 'dress-shoes'
  | 'heels'
  | 'other';

export type ScreenName =
  | 'home'
  | 'wardrobe'
  | 'add'
  | 'edit'
  | 'outfit'
  | 'insights';

export type ClothingItem = {
  id: string;
  name: string;
  category: Category;
  color: string;
  style: ClothingStyle;
  garmentType: GarmentType;
  occasions: OutfitOccasion[];
  formality: Formality;
  clean: boolean;
  imageUri: string;
  imageSource: ImageSource;
  cutoutStatus: CutoutStatus;
  analysisSource: AnalysisSource;
  analysisConfidence: number;
  objectKey?: string;
  sourceUrl?: string;
  retailer?: string;
  productUrl?: string;
  priceCad?: string;
  createdAt: string;
  updatedAt: string;
};

export type NewClothingItem = Omit<
  ClothingItem,
  'id' | 'clean' | 'createdAt' | 'updatedAt'
>;

export type ProductMatch = {
  id: string;
  name: string;
  imageUrl: string;
  retailer: string;
  productUrl: string;
  priceCad?: string;
  priceCadAmount?: number;
  occasions: OutfitOccasion[];
  verifiedAt: string;
  linkStatus: LinkStatus;
  confidence: number;
  exact: boolean;
  reason: string;
  audience: ProductAudience;
};

export type Outfit = {
  id: string;
  top: ClothingItem;
  bottom: ClothingItem;
  shoes: ClothingItem;
  trend: string;
  reason: string;
  occasion: OutfitMode;
  score?: number;
  previewImageUri?: string;
  previewImageProvider?: 'cloudflare';
  previewBodyShape?: OutfitBodyShape;
};

export type OutfitHistory = {
  id: string;
  outfit: Outfit;
  signature: string;
  occasion: OutfitMode;
  feedback: OutfitFeedback;
  generatedAt: string;
  wornAt?: string;
};

export type UserPreferences = {
  preferredOccasions: OutfitOccasion[];
  likedStyles: ClothingStyle[];
  dislikedStyles: ClothingStyle[];
  market: 'CA';
  recommendationFeedback: RecommendationFeedback[];
  updatedAt: string;
};

export type RecommendationFeedback = {
  id: string;
  recommendationId: string;
  productUrl?: string;
  title: string;
  category: Category;
  garmentType: GarmentType;
  color: string;
  style: ClothingStyle;
  audience: ProductAudience;
  retailer?: string;
  priceCadAmount?: number;
  occasions: OutfitOccasion[];
  value: RecommendationFeedbackValue;
  reasons: RecommendationDislikeReason[];
  createdAt: string;
};

export type ShoppingRecommendation = {
  id: string;
  title: string;
  category: Category;
  garmentType: GarmentType;
  color: string;
  style: ClothingStyle;
  formality: Formality;
  audience: ProductAudience;
  reason: string;
  combinationsUnlocked: number;
  imageUrl?: string;
  retailer?: string;
  productUrl?: string;
  priceCad?: string;
  priceCadAmount?: number;
  occasions: OutfitOccasion[];
  verifiedAt?: string;
  linkStatus: LinkStatus;
};

export type WardrobeInsight = {
  id: string;
  title: string;
  detail: string;
  tone: 'positive' | 'opportunity' | 'warning';
};

export type WardrobeAnalysis = {
  summary: string;
  score: number;
  efficiency: WardrobeEfficiency;
  insights: WardrobeInsight[];
  recommendations: ShoppingRecommendation[];
  generatedAt: string;
};

export type WardrobeEfficiency = {
  possibleOutfits: number;
  wornOutfits: number;
  wornPercentage: number;
};

export type OwnedClothingMatch = {
  item: ClothingItem;
  reason: string;
  score: number;
};

export type ClothingPairingResult = {
  summary: string;
  ownedMatches: OwnedClothingMatch[];
  shoppingMatches: ShoppingRecommendation[];
  generatedAt: string;
  provider: 'cloudflare+tavily' | 'cloudflare' | 'local+tavily' | 'local';
  cached?: boolean;
};

export type ClosetUser = {
  uid: string;
  email: string | null;
  demo?: boolean;
};

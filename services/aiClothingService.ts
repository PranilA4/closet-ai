import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { NewClothingItem, ProductMatch } from '../types';
import { ClothingImageInput } from './clothingAnalysisService';
import { getAuthToken } from './authService';
import { appendImageFile } from './formDataImage';

export type ClothingMatchResult = {
  apiVersion: string;
  item: NewClothingItem;
  originalImageUri: string;
  matches: ProductMatch[];
  aiProcessed: boolean;
  processedImage?: string | null;
  colorConfidence?: number;
  warning?: string;
  diagnostics?: {
    analysisProvider: 'cloudflare' | 'gemini' | 'local';
    productProvider: 'tavily' | 'unavailable';
    cutoutStatus: 'processed' | 'original';
    imageProvider: 'retailer-or-original' | 'original';
  };
};

const configuredApiUrl = process.env.EXPO_PUBLIC_CLOTHING_AI_URL ?? 'http://localhost:8787';

function resolveApiUrl(value: string) {
  if (Platform.OS === 'web') return value;
  try {
    const configured = new URL(value);
    if (!['localhost', '127.0.0.1', '::1'].includes(configured.hostname)) return value;
    const hostUri = Constants.expoConfig?.hostUri ?? '';
    const expoHost = hostUri.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    if (expoHost && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(expoHost)) {
      configured.hostname = expoHost;
      return configured.toString().replace(/\/$/, '');
    }
    if (expoHost && /(?:\.exp\.direct|\.ngrok(?:-free)?\.app|\.ngrok\.io)$/i.test(expoHost)) {
      return `https://${expoHost}/closet-api`;
    }
  } catch {
    return value;
  }
  return value;
}

export const apiUrl = resolveApiUrl(configuredApiUrl);

const appendImage = async (formData: FormData, image: ClothingImageInput) => {
  const fileName = image.fileName || `closet-photo-${Date.now()}.jpg`;
  await appendImageFile(formData, 'image', image.uri, fileName);
};

export async function analyzeClothingWithAI(
  image: ClothingImageInput,
): Promise<ClothingMatchResult> {
  if (!apiUrl) throw new Error('Clothing AI server URL is not configured.');
  const formData = new FormData();
  await appendImage(formData, image);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const token = await getAuthToken();
    const response = await fetch(`${apiUrl}/api/clothing/match`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Clothing AI request failed (${response.status}).`);
    const result = (await response.json()) as Omit<ClothingMatchResult, 'originalImageUri'>;
    if (!['closetai-cloudflare-v4', 'closetai-cloudflare-v5', 'closetai-cloudflare-v6'].includes(result.apiVersion) || !result.diagnostics) {
      throw new Error('The ClosetAI API server is outdated. Stop the old server and restart npm start.');
    }
    return { ...result, originalImageUri: image.uri };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Live recognition timed out. Your photo is still available to add manually.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

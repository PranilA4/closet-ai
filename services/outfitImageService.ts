import { Outfit } from '../types';
import { apiUrl } from './aiClothingService';
import { getAuthToken } from './authService';
import { outfitSignature } from './outfitService';

type OutfitImageResult = {
  imageUri: string;
  provider: 'cloudflare';
  model: string;
};

const requests = new Map<string, Promise<OutfitImageResult>>();

export function requestOutfitImage(outfit: Outfit) {
  const key = `${outfitSignature(outfit)}:${outfit.occasion}:${outfit.previewBodyShape ?? 'average'}`;
  const existing = requests.get(key);
  if (existing) return existing;

  const request = (async () => {
    if (!apiUrl) throw new Error('The ClosetAI API is not configured.');
    const token = await getAuthToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 125000);
    try {
      const response = await fetch(`${apiUrl}/api/outfits/visualize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ outfit }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.imageUri) {
        throw new Error(payload.error ?? 'AI outfit preview is unavailable.');
      }
      return payload as OutfitImageResult;
    } finally {
      clearTimeout(timer);
    }
  })();
  requests.set(key, request);
  void request.catch(() => requests.delete(key));
  return request;
}

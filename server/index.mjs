import 'dotenv/config';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import cors from 'cors';
import express from 'express';
import { cert, getApps as getAdminApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';

const port = Number(process.env.PORT ?? 8787);
const apiVersion = 'closetai-cloudflare-v6';

const readCredential = (name) => {
  const value = process.env[name]?.trim();
  if (!value || /^(your_|replace_|example)/i.test(value)) return '';
  return value;
};

const cloudflareAccountId = readCredential('CLOUDFLARE_ACCOUNT_ID');
const cloudflareApiToken = readCredential('CLOUDFLARE_API_TOKEN');
const cloudflareModel =
  readCredential('CLOUDFLARE_VISION_MODEL') ||
  '@cf/meta/llama-4-scout-17b-16e-instruct';
const cloudflareImageModel =
  readCredential('CLOUDFLARE_IMAGE_MODEL') ||
  '@cf/black-forest-labs/flux-2-klein-4b';
const geminiApiKey = readCredential('GEMINI_API_KEY');
const geminiVisionModel = readCredential('GEMINI_VISION_MODEL') || 'gemini-2.5-flash-lite';
const tavilyApiKey = readCredential('TAVILY_API_KEY');
const cloudinaryCloudName = readCredential('CLOUDINARY_CLOUD_NAME');
const cloudinaryApiKey = readCredential('CLOUDINARY_API_KEY');
const cloudinaryApiSecret = readCredential('CLOUDINARY_API_SECRET');

const requiredCredentials = {
  firebase: ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  gemini: ['GEMINI_API_KEY'],
  tavily: ['TAVILY_API_KEY'],
  cloudinary: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
};

const credentialStatus = (service) => {
  const missing = requiredCredentials[service].filter((name) => !readCredential(name));
  return { configured: missing.length === 0, missing };
};

let firebaseAdminReady = false;
let firebaseAdminError = '';
if (credentialStatus('firebase').configured && !getAdminApps().length) {
  try {
    initializeAdminApp({
      credential: cert({
        projectId: readCredential('FIREBASE_PROJECT_ID'),
        clientEmail: readCredential('FIREBASE_CLIENT_EMAIL'),
        privateKey: readCredential('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      }),
    });
    firebaseAdminReady = true;
  } catch (error) {
    firebaseAdminError = error instanceof Error ? error.message : 'Invalid Firebase Admin credentials.';
  }
} else if (getAdminApps().length) {
  firebaseAdminReady = true;
}

const cloudflareReady = credentialStatus('cloudflare').configured;
const geminiReady = credentialStatus('gemini').configured;
const tavilyReady = credentialStatus('tavily').configured;
const cloudinaryReady = credentialStatus('cloudinary').configured;
const liveServiceStatus = {
  cloudinary: { validated: false, valid: null, error: '' },
  firestoreDatabase: { validated: false, ready: false, error: '' },
};

async function validateFirestoreDatabase() {
  if (!firebaseAdminReady) return liveServiceStatus.firestoreDatabase;
  try {
    await getAdminFirestore().listCollections();
    liveServiceStatus.firestoreDatabase = { validated: true, ready: true, error: '' };
  } catch (error) {
    liveServiceStatus.firestoreDatabase = {
      validated: true,
      ready: false,
      error: error instanceof Error ? error.message : 'Firestore database is unavailable.',
    };
  }
  return liveServiceStatus.firestoreDatabase;
}

async function validateCloudinaryConfig() {
  if (!cloudinaryReady) return liveServiceStatus.cloudinary;
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryCloudName)}/ping`, {
      headers: { Authorization: `Basic ${Buffer.from(`${cloudinaryApiKey}:${cloudinaryApiSecret}`).toString('base64')}` },
      signal: AbortSignal.timeout(7000),
    });
    const payload = await response.json().catch(() => ({}));
    liveServiceStatus.cloudinary = {
      validated: true,
      valid: response.ok,
      error: response.ok ? '' : (payload?.error?.message ?? `Cloudinary validation failed (${response.status}).`),
    };
  } catch (error) {
    liveServiceStatus.cloudinary = { validated: true, valid: false, error: error.message };
  }
  return liveServiceStatus.cloudinary;
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_request, file, done) =>
    done(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const clothingStyles = ['casual', 'business', 'sport', 'street', 'classic'];
const occasions = [
  'casual',
  'formal',
  'semi-formal',
  'school',
  'work',
  'date-night',
  'active',
  'streetwear',
];
const formalities = ['relaxed', 'smart-casual', 'semi-formal', 'formal'];
const garmentTypes = [
  't-shirt', 'shirt', 'blouse', 'sweater', 'hoodie', 'jacket', 'blazer',
  'jeans', 'trousers', 'chinos', 'shorts', 'skirt', 'sweatpants',
  'sneakers', 'athletic-shoes', 'boots', 'loafers', 'dress-shoes', 'heels', 'other',
];

const ClothingMetadata = z.object({
  name: z.string().min(3).max(70),
  category: z.enum(['top', 'bottom', 'shoes']),
  color: z.string().min(3).max(40),
  style: z.enum(clothingStyles),
  garmentType: z.enum(garmentTypes),
  occasions: z.array(z.enum(occasions)).min(1).max(6),
  formality: z.enum(formalities),
  boundingBox: z.object({
    x: z.coerce.number().min(0).max(1),
    y: z.coerce.number().min(0).max(1),
    width: z.coerce.number().min(0.05).max(1),
    height: z.coerce.number().min(0.05).max(1),
  }),
  confidence: z.coerce.number().min(0).max(1),
});

const ProductMatch = z.object({
  name: z.string().min(2),
  imageUrl: z.string().url(),
  retailer: z.string().min(2),
  productUrl: z.string().url(),
  priceCad: z.string().optional(),
  priceCadAmount: z.coerce.number().positive().optional(),
  occasions: z.array(z.enum(occasions)),
  verifiedAt: z.string(),
  linkStatus: z.literal('verified'),
  confidence: z.coerce.number().min(0).max(1),
  exact: z.boolean(),
  reason: z.string().min(3),
  audience: z.enum(['men', 'women', 'unisex', 'unknown']),
});

const SuggestionBlueprint = z.object({
  title: z.string().min(3).max(90),
  category: z.enum(['top', 'bottom', 'shoes']),
  color: z.string().min(3).max(40),
  style: z.enum(clothingStyles),
  garmentType: z.enum(garmentTypes),
  occasions: z.array(z.enum(occasions)).min(1).max(6),
  formality: z.enum(formalities),
  reason: z.string().min(8).max(180),
});
const SuggestionList = z.array(SuggestionBlueprint).min(1).max(12);

const normalizedValue = (value) => String(value ?? '').toLowerCase().trim().replace(/[_\s]+/g, '-');
function normalizeSuggestionList(value) {
  const entries = Array.isArray(value) ? value : value?.suggestions ?? value?.recommendations ?? value?.items ?? [];
  const normalized = entries.map((entry) => {
    const rawGarment = normalizedValue(entry.garmentType ?? entry.garment_type ?? entry.type ?? entry.itemType ?? entry.item_type);
    const garmentType = garmentTypes.includes(rawGarment)
      ? rawGarment
      : garmentTypes.find((type) => rawGarment.includes(type)) ??
        (/tee|tshirt/.test(rawGarment) ? 't-shirt' : /pant/.test(rawGarment) ? 'trousers' : /shoe|trainer/.test(rawGarment) ? 'sneakers' : 'other');
    const inferredCategory = ['jeans', 'trousers', 'chinos', 'shorts', 'skirt', 'sweatpants'].includes(garmentType)
      ? 'bottom'
      : ['sneakers', 'athletic-shoes', 'boots', 'loafers', 'dress-shoes', 'heels'].includes(garmentType)
        ? 'shoes'
        : 'top';
    const rawCategory = normalizedValue(entry.category ?? entry.clothingCategory ?? entry.clothing_category);
    const category = ['top', 'bottom', 'shoes'].includes(rawCategory) ? rawCategory : inferredCategory;
    const rawStyle = normalizedValue(entry.style ?? entry.aesthetic);
    const style = clothingStyles.includes(rawStyle)
      ? rawStyle
      : /business|formal|professional/.test(rawStyle) ? 'business'
        : /sport|athletic|active/.test(rawStyle) ? 'sport'
          : /street/.test(rawStyle) ? 'street'
            : /classic|minimal|smart/.test(rawStyle) ? 'classic' : 'casual';
    const rawFormality = normalizedValue(entry.formality ?? entry.dressCode ?? entry.dress_code);
    const formality = formalities.includes(rawFormality)
      ? rawFormality
      : /semi/.test(rawFormality) ? 'semi-formal'
        : /formal/.test(rawFormality) ? 'formal'
          : /smart|business/.test(rawFormality) ? 'smart-casual' : 'relaxed';
    const rawOccasions = Array.isArray(entry.occasions) ? entry.occasions : [entry.occasion ?? 'casual'];
    const normalizedOccasions = rawOccasions.map(normalizedValue).filter((occasion) => occasions.includes(occasion));
    return {
      title: entry.title ?? entry.name ?? entry.product ?? entry.item ?? `${entry.color ?? 'Versatile'} ${String(garmentType).replace('-', ' ')}`,
      category,
      color: entry.color ?? entry.colour ?? 'Neutral',
      style,
      garmentType,
      occasions: normalizedOccasions.length ? normalizedOccasions : ['casual'],
      formality,
      reason: entry.reason ?? entry.rationale ?? entry.explanation ?? entry.why ?? 'Adds a complementary option and expands the number of wearable outfits.',
    };
  });
  return SuggestionList.parse(normalized);
}

const palette = [
  ['Black', [28, 30, 31]], ['White', [238, 238, 232]], ['Gray', [135, 139, 137]],
  ['Cream', [225, 217, 188]], ['Beige', [196, 178, 145]], ['Tan', [173, 133, 91]],
  ['Brown', [103, 70, 48]], ['Navy Blue', [31, 49, 76]], ['Blue', [54, 104, 153]],
  ['Teal', [34, 111, 111]], ['Sage Green', [167, 176, 128]], ['Olive Green', [98, 105, 55]],
  ['Green', [54, 119, 73]], ['Burgundy', [105, 38, 54]], ['Red', [180, 50, 47]],
  ['Orange', [205, 112, 45]], ['Yellow', [218, 190, 66]], ['Pink', [205, 128, 146]],
  ['Purple', [112, 76, 137]],
];

const distance = (pixel, target) =>
  Math.sqrt(pixel.reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0));
const isSkinTone = ([red, green, blue]) =>
  red > 95 && green > 40 && blue > 20 && red > green && red > blue &&
  red - Math.min(green, blue) > 18;
const sha = (value) => createHash('sha256').update(value).digest('hex');

class TimedCache {
  constructor(maxEntries = 150) {
    this.maxEntries = maxEntries;
    this.values = new Map();
  }

  get(key) {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.values.size >= this.maxEntries) {
      this.values.delete(this.values.keys().next().value);
    }
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }
}

const analysisCache = new TimedCache(100);
const productCache = new TimedCache(150);
const insightCache = new TimedCache(80);
const outfitImageCache = new TimedCache(80);
const suggestionCache = new TimedCache(80);
const productImageCache = new TimedCache(120);
const providerCooldownUntil = { cloudflare: 0, gemini: 0, tavily: 0 };
const providerDailyUsage = new Map();
const providerDailyLimits = {
  cloudflareText: 60,
  cloudflareImage: 10,
  gemini: 40,
  tavily: 100,
};

function consumeProviderDailyBudget(provider) {
  const max = providerDailyLimits[provider];
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const current = providerDailyUsage.get(provider);
  if (!current || current.day !== day) {
    providerDailyUsage.set(provider, { day, count: 1 });
    return;
  }
  if (current.count >= max) {
    throw new Error(`${provider} reached ClosetAI's daily safety limit (${max}). Cached and local features remain available.`);
  }
  current.count += 1;
}

function providerCooldownMessage(provider) {
  const remaining = providerCooldownUntil[provider] - Date.now();
  if (remaining <= 0) return '';
  return `${provider} is cooling down for ${Math.ceil(remaining / 1000)} more seconds after a quota or rate-limit response.`;
}

function assertProviderAvailable(provider) {
  const message = providerCooldownMessage(provider);
  if (message) throw new Error(message);
}

function registerProviderFailure(provider, status, detail = '') {
  if (status !== 429 && !/quota|rate.?limit|allocation|too many requests|neuron/i.test(detail)) return;
  const dailyLimit = /daily|allocation|neuron/i.test(detail);
  const now = new Date();
  const nextUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5);
  providerCooldownUntil[provider] = dailyLimit ? nextUtcDay : Date.now() + 5 * 60 * 1000;
}

async function detectDominantColor(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(72, 72, { fit: 'contain' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scores = new Map(palette.map(([name]) => [name, 0]));
  let considered = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] < 100) continue;
    const pixel = [data[offset], data[offset + 1], data[offset + 2]];
    if (isSkinTone(pixel)) continue;
    const nearest = palette.reduce((best, entry) =>
      distance(pixel, entry[1]) < distance(pixel, best[1]) ? entry : best);
    scores.set(nearest[0], scores.get(nearest[0]) + 1);
    considered += 1;
  }
  const winner = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    color: winner?.[0] ?? 'Gray',
    confidence: considered ? (winner?.[1] ?? 0) / considered : 0,
  };
}

function fallbackMetadata(color, width, height) {
  const ratio = width && height ? width / height : 1;
  const category = ratio > 1.35 ? 'shoes' : ratio < 0.7 ? 'bottom' : 'top';
  const itemType = category === 'shoes'
    ? 'Everyday Sneakers'
    : category === 'bottom'
      ? 'Casual Trousers'
      : 'Crewneck Tee';
  return {
    name: `${color} ${itemType}`,
    category,
    color,
    style: 'casual',
    garmentType: category === 'shoes' ? 'sneakers' : category === 'bottom' ? 'trousers' : 't-shirt',
    occasions: category === 'shoes' ? ['casual', 'school', 'active'] : ['casual', 'school'],
    formality: 'relaxed',
    boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    confidence: 0.25,
  };
}

function parseJson(text) {
  const cleaned = String(text ?? '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = Math.min(...['{', '['].map((character) => {
    const index = cleaned.indexOf(character);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  }));
  if (!Number.isFinite(start)) throw new Error('AI provider did not return JSON.');
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  return JSON.parse(cleaned.slice(start, end + 1));
}

function cloudflareResponseText(payload) {
  return payload?.result?.response ??
    payload?.result?.choices?.[0]?.message?.content ??
    payload?.response ??
    '';
}

function parseProviderJson(value) {
  if (value && typeof value === 'object') return value;
  return parseJson(value);
}

async function cloudflareRequest(prompt, image) {
  if (!cloudflareReady) throw new Error('Cloudflare Workers AI is not configured.');
  assertProviderAvailable('cloudflare');
  consumeProviderDailyBudget('cloudflareText');
  const content = image
    ? [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:${image.mimetype};base64,${image.buffer.toString('base64')}`,
          },
        },
      ]
    : prompt;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/ai/run/${cloudflareModel}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cloudflareApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Return only valid JSON. Do not use markdown fences.' },
          { role: 'user', content },
        ],
        max_tokens: 900,
        temperature: 0.15,
      }),
      signal: AbortSignal.timeout(25000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const detail = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    registerProviderFailure('cloudflare', response.status, detail);
    throw new Error(`Cloudflare Workers AI failed: ${detail}`);
  }
  return parseProviderJson(cloudflareResponseText(payload));
}

async function geminiRequest(prompt, image) {
  if (!geminiReady) throw new Error('Gemini is not configured.');
  assertProviderAvailable('gemini');
  consumeProviderDailyBudget('gemini');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiVisionModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: image.mimetype, data: image.buffer.toString('base64') } },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 900,
          temperature: 0.15,
        },
      }),
      signal: AbortSignal.timeout(25000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message ?? `HTTP ${response.status}`;
    registerProviderFailure('gemini', response.status, detail);
    throw new Error(`Gemini failed: ${detail}`);
  }
  return parseProviderJson(payload?.candidates?.[0]?.content?.parts?.[0]?.text);
}

function normalizeProviderGarment(value, fallback) {
  const rawGarment = normalizedValue(
    value?.garmentType ?? value?.garment_type ?? value?.type ?? value?.category ?? '',
  );
  const garmentType = garmentTypes.includes(rawGarment)
    ? rawGarment
    : garmentTypes.find((type) => rawGarment.includes(type)) ?? fallback.garmentType;
  const inferredCategory = ['jeans', 'trousers', 'chinos', 'shorts', 'skirt', 'sweatpants'].includes(garmentType)
    ? 'bottom'
    : ['sneakers', 'athletic-shoes', 'boots', 'loafers', 'dress-shoes', 'heels'].includes(garmentType)
      ? 'shoes'
      : 'top';
  const rawCategory = normalizedValue(value?.category);
  const category = ['top', 'bottom', 'shoes'].includes(rawCategory) ? rawCategory : inferredCategory;
  const rawStyle = normalizedValue(value?.style);
  const style = clothingStyles.includes(rawStyle) ? rawStyle : fallback.style;
  const rawFormality = normalizedValue(value?.formality);
  const formality = formalities.includes(rawFormality) ? rawFormality : fallback.formality;
  const rawOccasions = Array.isArray(value?.occasions) ? value.occasions : [value?.occasion];
  const normalizedOccasions = rawOccasions.map(normalizedValue).filter((occasion) => occasions.includes(occasion));
  const bounds = value?.boundingBox ?? value?.bounding_box ?? fallback.boundingBox;
  const clamp = (number, minimum, maximum, fallbackValue) => {
    const parsed = Number(number);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallbackValue;
  };
  const color = String(value?.color ?? value?.colour ?? fallback.color).trim() || fallback.color;
  return ClothingMetadata.parse({
    name: String(value?.name ?? `${color} ${garmentType.replace('-', ' ')}`).slice(0, 70),
    category,
    garmentType,
    color: color.slice(0, 40),
    style,
    occasions: normalizedOccasions.length ? normalizedOccasions : fallback.occasions,
    formality,
    boundingBox: {
      x: clamp(bounds?.x, 0, 1, 0),
      y: clamp(bounds?.y, 0, 1, 0),
      width: clamp(bounds?.width, 0.05, 1, 1),
      height: clamp(bounds?.height, 0.05, 1, 1),
    },
    confidence: clamp(value?.confidence, 0, 1, fallback.confidence),
  });
}

async function inspectGarment(file, fallback) {
  const cacheKey = `analysis:${sha(file.buffer)}`;
  const cached = analysisCache.get(cacheKey);
  if (cached) return cached;
  const prompt = `Identify the single garment intentionally presented in this image. Ignore people, hands, furniture, backgrounds, and clothes worn by a person behind the featured garment. Use a specific useful product name and visually accurate dominant garment colour. Category must be top, bottom, or shoes. Garment type must be one of ${garmentTypes.join(', ')}. Style must be one of ${clothingStyles.join(', ')}. Occasions must use only ${occasions.join(', ')}. Formality must be one of ${formalities.join(', ')}. Judge occasions from the garment's actual wash, structure, material, distressing, silhouette, and finish. Clean dark or black straight jeans can suit casual, school, date-night, and many smart-casual workplaces; distressed, ripped, very light, or baggy jeans should not be workwear. T-shirts, hoodies, athletic tops, shorts, sweatpants, and athletic shoes are never formal or semi-formal. Return a normalized boundingBox around only the featured garment, where x/y/width/height range from 0 to 1, plus confidence from 0 to 1. Return exactly {"name":"...","category":"top|bottom|shoes","garmentType":"...","color":"...","style":"...","occasions":["..."],"formality":"...","boundingBox":{"x":0,"y":0,"width":1,"height":1},"confidence":0.0}. Local estimate: ${JSON.stringify(fallback)}.`;
  const optimized = await sharp(file.buffer)
    .rotate()
    .resize(900, 900, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  const image = { mimetype: 'image/jpeg', buffer: optimized };
  const errors = [];
  if (cloudflareReady) {
    try {
      const result = normalizeGarmentMetadata(normalizeProviderGarment(await cloudflareRequest(prompt, image), fallback));
      return analysisCache.set(cacheKey, { ...result, analysisProvider: 'cloudflare' }, 1000 * 60 * 60 * 24 * 14);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (geminiReady) {
    try {
      const result = normalizeGarmentMetadata(normalizeProviderGarment(await geminiRequest(prompt, image), fallback));
      return analysisCache.set(cacheKey, { ...result, analysisProvider: 'gemini' }, 1000 * 60 * 60 * 24 * 14);
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join(' | ') || 'No vision AI provider is configured.');
}

function normalizeGarmentMetadata(metadata) {
  const next = { ...metadata, occasions: [...new Set(metadata.occasions ?? [])] };
  const description = `${next.name} ${next.color}`.toLowerCase();
  const add = (...values) => { next.occasions = [...new Set([...next.occasions, ...values])]; };
  if (next.garmentType === 'jeans') {
    add('casual', 'school', 'date-night');
    const polished = /black|dark|deep|indigo|navy|raw/.test(description) && !/rip|distress|acid|baggy|washed/.test(description);
    if (polished) {
      add('work');
      if (next.formality === 'relaxed') next.formality = 'smart-casual';
    }
  }
  if (['chinos', 'trousers', 'shirt', 'blouse', 'sweater', 'jacket', 'blazer', 'loafers', 'dress-shoes', 'heels'].includes(next.garmentType)) add('date-night');
  if (['t-shirt', 'hoodie', 'shorts', 'sweatpants', 'athletic-shoes'].includes(next.garmentType)) {
    next.occasions = next.occasions.filter((occasion) => !['formal', 'semi-formal'].includes(occasion));
  }
  return next;
}

function isSafePublicUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host) &&
      !host.startsWith('10.') && !host.startsWith('192.168.') &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}

const absoluteUrl = (candidate, base) => {
  try {
    const resolved = new URL(candidate, base).toString();
    return isSafePublicUrl(resolved) ? resolved : '';
  } catch {
    return '';
  }
};

const priceFromText = (value) => {
  const match = String(value ?? '').match(/(?:CA\$|CAD\s*\$?|\$)\s?([1-9]\d{0,3}(?:[.,]\d{2})?)/i);
  return match ? `CA$${match[1].replace(',', '.')}` : undefined;
};

const priceAmount = (value) => {
  const match = String(value ?? '').replace(',', '.').match(/([1-9]\d{0,3}(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : undefined;
};

const garmentKeywords = {
  't-shirt': ['t-shirt', 't shirt', 'tee'],
  shirt: ['oxford', 'button-down', 'button down', 'dress shirt', 'woven shirt', 'shirt'],
  blouse: ['blouse'], sweater: ['sweater', 'knit', 'pullover'], hoodie: ['hoodie', 'hooded'],
  jacket: ['jacket', 'overshirt', 'coat'], blazer: ['blazer', 'sport coat'],
  jeans: ['jeans', 'denim'], trousers: ['trousers', 'dress pants', 'straight-leg pants', 'straight leg pants'],
  chinos: ['chinos', 'chino pants'], shorts: ['shorts'], skirt: ['skirt'], sweatpants: ['sweatpants', 'joggers'],
  sneakers: ['sneakers', 'trainers', 'court shoes'], 'athletic-shoes': ['running shoes', 'training shoes', 'athletic shoes'],
  boots: ['boots'], loafers: ['loafers', 'slip-ons', 'slip ons'], 'dress-shoes': ['dress shoes', 'oxfords', 'derby shoes'], heels: ['heels', 'pumps'],
};
const clothingProductPattern = /\b(t-?shirts?|tees?|shirts?|blouses?|sweaters?|knits?|pullovers?|hoodies?|jackets?|overshirts?|coats?|blazers?|jeans|denim|trousers?|pants?|chinos?|shorts?|skirts?|sweatpants?|joggers?|sneakers?|trainers?|shoes?|boots?|loafers?|oxfords?|heels?|pumps?)\b/i;
const nonClothingProductPattern = /\b(ice cream (maker|machine)|coffee maker|blender|stand mixer|food processor|air fryer|toaster|cookware|furniture|lamp|smartphone|phone case|headphones?|speaker|television|video game|board game|toy|book|perfume|cologne|makeup|skin care|power tool|replacement part)\b/i;

function isClothingProduct(searchable) {
  return clothingProductPattern.test(searchable) && !nonClothingProductPattern.test(searchable);
}

function matchesRequestedGarment(searchable, garmentType) {
  const normalized = searchable.toLowerCase();
  if (!isClothingProduct(normalized)) return false;
  const words = garmentKeywords[garmentType];
  if (!words) return true;
  if (garmentType === 'shirt' && /t-?shirt|\btee\b/.test(normalized)) return false;
  if ((garmentType === 'trousers' || garmentType === 'chinos') && /shorts|sweatpants|joggers/.test(normalized)) return false;
  if ((garmentType === 'loafers' || garmentType === 'dress-shoes') && /sneaker|running|athletic/.test(normalized)) return false;
  return words.some((word) => normalized.includes(word));
}

function inferProductAudience(value) {
  const normalized = String(value ?? '').toLowerCase().replace(/[_-]+/g, ' ');
  if (/\bunisex\b|gender neutral/.test(normalized)) return 'unisex';
  if (/\bwomen'?s\b|\bwoman\b|\bfemale\b|\/women\b/.test(normalized)) return 'women';
  if (/\bmen'?s\b|\bman\b|\bmale\b|\/men\b/.test(normalized)) return 'men';
  return 'unknown';
}

function recommendationPreferenceProfile(preferences = {}) {
  const feedback = Array.isArray(preferences.recommendationFeedback)
    ? preferences.recommendationFeedback.slice(0, 120)
    : [];
  const dislikedUrls = new Set();
  const audienceScores = new Map();
  const styleScores = new Map();
  const garmentScores = new Map();
  const colorScores = new Map();
  const expensiveThresholds = [];
  const change = (map, key, amount) => {
    if (!key || key === 'unknown') return;
    map.set(key, (map.get(key) ?? 0) + amount);
  };
  feedback.forEach((entry) => {
    const direction = entry.value === 'like' ? 1 : -1;
    const reasons = Array.isArray(entry.reasons) ? entry.reasons : [];
    if (entry.value === 'dislike' && entry.productUrl) dislikedUrls.add(entry.productUrl);
    change(audienceScores, entry.audience, direction * (reasons.includes('wrong-audience') ? 2 : 1));
    change(styleScores, entry.style, direction * (reasons.includes('not-my-style') ? 2 : 1));
    change(garmentScores, entry.garmentType, direction * (reasons.includes('already-own') || reasons.includes('not-my-style') ? 2 : 1));
    change(colorScores, String(entry.color ?? '').toLowerCase(), direction * (reasons.includes('wrong-color') ? 2 : 1));
    if (entry.value === 'dislike' && reasons.includes('too-expensive') && Number.isFinite(entry.priceCadAmount)) {
      expensiveThresholds.push(Number(entry.priceCadAmount) * 0.85);
    }
  });
  return {
    feedbackCount: feedback.length,
    dislikedUrls: [...dislikedUrls],
    audienceScores: Object.fromEntries(audienceScores),
    styleScores: Object.fromEntries(styleScores),
    garmentScores: Object.fromEntries(garmentScores),
    colorScores: Object.fromEntries(colorScores),
    blockedAudiences: [...audienceScores.entries()].filter(([, score]) => score <= -4).map(([value]) => value),
    blockedStyles: [...styleScores.entries()].filter(([, score]) => score <= -3).map(([value]) => value),
    blockedGarments: [...garmentScores.entries()].filter(([, score]) => score <= -4).map(([value]) => value),
    blockedColors: [...colorScores.entries()].filter(([, score]) => score <= -2).map(([value]) => value),
    maxPriceCad: expensiveThresholds.length >= 2 ? Math.min(...expensiveThresholds) : undefined,
  };
}

function productPreferenceScore(match, metadata, profile) {
  return match.confidence +
    (profile.audienceScores[match.audience] ?? 0) * 0.08 +
    (profile.styleScores[metadata.style] ?? 0) * 0.06 +
    (profile.garmentScores[metadata.garmentType] ?? 0) * 0.06 +
    (profile.colorScores[String(metadata.color ?? '').toLowerCase()] ?? 0) * 0.04;
}

function structuredProductFrom($) {
  const products = [];
  const visit = (value) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some((type) => String(type).toLowerCase() === 'product')) products.push(value);
    if (value['@graph']) visit(value['@graph']);
  };
  $('script[type="application/ld+json"]').each((_index, element) => {
    try { visit(JSON.parse($(element).text())); } catch { /* Ignore malformed retailer metadata. */ }
  });
  const product = products.find((entry) => entry.name && entry.offers) ?? products[0];
  if (!product) return null;
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  const offer = offers.find((entry) => entry?.price || entry?.lowPrice) ?? offers[0] ?? {};
  const rawImage = Array.isArray(product.image) ? product.image[0] : product.image;
  const image = typeof rawImage === 'string' ? rawImage : rawImage?.url;
  return {
    name: String(product.name ?? '').trim(),
    image,
    price: offer.price ?? offer.lowPrice,
    currency: offer.priceCurrency,
    url: offer.url ?? product.url,
  };
}

function isGenericShoppingPage(url, title) {
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase().replace(/\/$/, '');
  if (/\/(search|collections?|categories?|catalog|shop-all)(\/|$)/.test(path)) return true;
  if (/[?&](q|query|search)=/i.test(parsed.search)) return true;
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return /^(shop )?(men s |women s )?(shirts|t shirts|tops|bottoms|pants|shoes|clothing|fashion)( canada)?$/.test(normalizedTitle) ||
    /custom printed|design your own|personalized|bulk order|wholesale|shop all|collection of/i.test(title);
}

async function verifyProductPage(candidate, metadata) {
  if (!isSafePublicUrl(candidate.url)) return null;
  try {
    if (/(^|\.)ssense\.com$/i.test(new URL(candidate.url).hostname)) return null;
    const response = await fetch(candidate.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 ClosetAI/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok || !isSafePublicUrl(response.url)) return null;
    if (/cookiefailure|access-denied|captcha|challenge/i.test(new URL(response.url).pathname)) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return null;
    const html = (await response.text()).slice(0, 1_750_000);
    const $ = load(html);
    const structured = structuredProductFrom($);
    const title = structured?.name || $('meta[property="og:title"]').attr('content') ||
      $('title').first().text().trim() || candidate.title;
    if (!structured || isGenericShoppingPage(response.url, title)) return null;
    const imageUrl = absoluteUrl(
      structured.image || $('meta[property="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') ||
        candidate.thumbnail?.src || '',
      response.url,
    );
    const amount = structured.price || $('meta[property="product:price:amount"]').attr('content') ||
      $('[itemprop="price"]').first().attr('content') ||
      $('[itemprop="price"]').first().text();
    const currency = structured.currency || $('meta[property="product:price:currency"]').attr('content') ||
      $('[itemprop="priceCurrency"]').first().attr('content');
    const currencyCode = String(currency ?? '').toUpperCase();
    const pricePrefix = !currencyCode || currencyCode === 'CAD'
      ? 'CA$'
      : currencyCode === 'USD'
        ? 'US$'
        : `${currencyCode} `;
    const priceCad = amount
      ? `${pricePrefix}${String(amount).replace(/[^\d.,]/g, '')}`
      : priceFromText(`${candidate.title} ${candidate.description} ${html.slice(0, 120000)}`);
    const retailer = $('meta[property="og:site_name"]').attr('content') ||
      new URL(response.url).hostname.replace(/^www\./, '').split('.')[0].replace(/[-_]/g, ' ');
    if (!title || !imageUrl || !retailer || !amount) return null;
    const queryWords = `${metadata.color} ${metadata.name}`.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
    const searchable = `${title} ${candidate.description} ${structured.name ?? ''} ${response.url}`.toLowerCase();
    if (!matchesRequestedGarment(searchable, metadata.garmentType)) return null;
    const audience = inferProductAudience(`${title} ${candidate.description} ${response.url}`);
    const numericPrice = priceAmount(priceCad);
    const overlap = queryWords.filter((word) => searchable.includes(word)).length;
    const confidence = Math.min(0.94, 0.42 + overlap * 0.09);
    return ProductMatch.parse({
      name: title.slice(0, 110),
      imageUrl,
      retailer: retailer.slice(0, 60),
      productUrl: response.url,
      priceCad,
      priceCadAmount: numericPrice,
      occasions: metadata.occasions ?? ['casual'],
      verifiedAt: new Date().toISOString(),
      linkStatus: 'verified',
      confidence,
      exact: confidence >= 0.82,
      reason: confidence >= 0.82
        ? 'Strong colour and garment-name match from a verified retailer page.'
        : 'Closest verified Canadian retailer result for this garment.',
      audience,
    });
  } catch {
    return null;
  }
}

async function tavilySearch(query, count = 8) {
  if (!tavilyReady) return [];
  assertProviderAvailable('tavily');
  consumeProviderDailyBudget('tavily');
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tavilyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: query.slice(0, 390),
      topic: 'general',
      search_depth: 'basic',
      max_results: Math.min(20, count),
      country: 'canada',
      include_images: true,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload?.detail?.error ?? payload?.detail ?? payload?.error ?? `HTTP ${response.status}`;
    registerProviderFailure('tavily', response.status, String(detail));
    throw new Error(`Tavily Search failed: ${String(detail)}`);
  }
  const payload = await response.json();
  const imageUrls = (Array.isArray(payload?.images) ? payload.images : [])
    .map((image) => typeof image === 'string' ? image : image?.url)
    .filter(isSafePublicUrl);
  return Array.isArray(payload?.results)
    ? payload.results.map((result) => ({
        title: result.title,
        url: result.url,
        description: result.content,
        thumbnail: { src: result.images?.[0]?.url ?? result.images?.[0] ?? imageUrls[0] },
      }))
    : [];
}

async function searchCanadianProducts(metadata, { requirePrice = false, preferenceProfile, excludedUrls = [], explorationKey = '' } = {}) {
  const profile = preferenceProfile ?? recommendationPreferenceProfile();
  const excluded = new Set([...profile.dislikedUrls, ...excludedUrls].filter(isSafePublicUrl));
  const cacheKey = `product-pool:${sha(JSON.stringify({ metadata, requirePrice, explorationKey }))}`;
  let pool = productCache.get(cacheKey);
  const specificName = metadata.title ?? metadata.name;
  const audienceHint = profile.blockedAudiences.includes('women')
    ? "men's or unisex"
    : profile.blockedAudiences.includes('men')
      ? "women's or unisex"
      : '';
  if (!pool) {
    const query = explorationKey
      ? `alternative distinctive "${specificName}" ${metadata.color} ${metadata.garmentType ?? metadata.category} new arrival Canada CAD direct product`
      : `buy "${specificName}" ${metadata.color} ${metadata.garmentType ?? metadata.category} Canada CAD`;
    const raw = await tavilySearch(query, 12).catch(() => []);
    const settled = await Promise.all(raw.slice(0, 12).map((candidate) => verifyProductPage(candidate, metadata)));
    pool = settled
      .filter(Boolean)
      .filter((match) => !requirePrice || (match.priceCad?.startsWith('CA$') && typeof match.priceCadAmount === 'number'))
      .slice(0, 8)
      .map((match, index) => ({ ...match, id: `match-${sha(match.productUrl).slice(0, 12)}-${index}` }));
    productCache.set(cacheKey, pool, 1000 * 60 * 60 * 12);
  }
  let filtered = pool
    .filter((match) => !excluded.has(match.productUrl))
    .filter((match) => !profile.blockedAudiences.includes(match.audience))
    .filter((match) => !profile.maxPriceCad || !match.priceCadAmount || match.priceCadAmount <= profile.maxPriceCad)
    .sort((a, b) => productPreferenceScore(b, metadata, profile) - productPreferenceScore(a, metadata, profile))
    .slice(0, 4);
  if (!filtered.length && profile.dislikedUrls.length && tavilyReady) {
    const refreshBucket = Math.floor(profile.dislikedUrls.length / 2);
    const alternateKey = `${cacheKey}:alternatives:${sha(JSON.stringify({ refreshBucket, blockedAudiences: profile.blockedAudiences, maxPriceCad: profile.maxPriceCad })).slice(0, 12)}`;
    let alternatives = productCache.get(alternateKey);
    if (!alternatives) {
      const query = `alternative ${specificName} ${metadata.color} ${metadata.garmentType ?? metadata.category} ${audienceHint} Canada CAD direct product`;
      const raw = await tavilySearch(query, 12).catch(() => []);
      const settled = await Promise.all(raw.slice(0, 12).map((candidate) => verifyProductPage(candidate, metadata)));
      alternatives = settled.filter(Boolean).slice(0, 8);
      productCache.set(alternateKey, alternatives, 1000 * 60 * 60 * 12);
    }
    filtered = alternatives
      .filter((match) => !excluded.has(match.productUrl))
      .filter((match) => !profile.blockedAudiences.includes(match.audience))
      .filter((match) => !requirePrice || (match.priceCad?.startsWith('CA$') && typeof match.priceCadAmount === 'number'))
      .filter((match) => !profile.maxPriceCad || !match.priceCadAmount || match.priceCadAmount <= profile.maxPriceCad)
      .sort((a, b) => productPreferenceScore(b, metadata, profile) - productPreferenceScore(a, metadata, profile))
      .slice(0, 4);
  }
  return filtered;
}

const sanitizeId = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);

function cloudinarySignature(parameters) {
  const serialized = Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha256').update(`${serialized}${cloudinaryApiSecret}`).digest('hex');
}

function cloudinaryDeliveryUrl(publicId) {
  return `https://res.cloudinary.com/${encodeURIComponent(cloudinaryCloudName)}/image/upload/f_auto,q_auto/${publicId}`;
}

async function uploadCloudinaryBuffer(publicId, buffer, fileName) {
  if (!cloudinaryReady) throw new Error('Cloudinary is not configured.');
  const timestamp = Math.floor(Date.now() / 1000);
  const fields = { overwrite: 'true', public_id: publicId, timestamp: String(timestamp) };
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'image/webp' }), fileName);
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  form.append('api_key', cloudinaryApiKey);
  form.append('signature', cloudinarySignature(fields));
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryCloudName)}/image/upload`,
    { method: 'POST', body: form, signal: AbortSignal.timeout(30000) },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.secure_url) {
    throw new Error(payload?.error?.message ?? `Cloudinary upload failed (${response.status}).`);
  }
  return { imageUri: payload.secure_url, objectKey: payload.public_id };
}

async function storeImage(userId, itemId, buffer) {
  const publicId = `closetai/users/${sanitizeId(userId)}/wardrobe/${sanitizeId(itemId)}-${Date.now()}`;
  const optimized = await sharp(buffer)
    .rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  const uploaded = await uploadCloudinaryBuffer(publicId, optimized, `${sanitizeId(itemId)}.webp`);
  return { ...uploaded, imageSource: 'cloudinary' };
}

async function deleteCloudinaryImage(publicId) {
  if (!cloudinaryReady) throw new Error('Cloudinary is not configured.');
  const timestamp = Math.floor(Date.now() / 1000);
  const fields = { invalidate: 'true', public_id: publicId, timestamp: String(timestamp) };
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  form.append('api_key', cloudinaryApiKey);
  form.append('signature', cloudinarySignature(fields));
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryCloudName)}/image/destroy`,
    { method: 'POST', body: form, signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error(`Cloudinary deletion failed (${response.status}).`);
}

async function fetchOutfitReference(piece, index) {
  if (!isSafePublicUrl(piece?.imageUri)) throw new Error(`${piece?.name ?? 'Garment'} does not have a public image yet.`);
  const response = await fetch(piece.imageUri, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 ClosetAI/1.0' },
    signal: AbortSignal.timeout(12000),
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.startsWith('image/')) throw new Error(`Reference image ${index + 1} is unavailable.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) throw new Error(`Reference image ${index + 1} is too large.`);
  const normalized = await sharp(buffer)
    .rotate()
    .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return normalized;
}

const outfitBodyDescriptions = {
  lean: 'lean proportions with a narrow torso and limbs',
  average: 'average balanced proportions',
  athletic: 'athletic proportions with broader shoulders and a strong build',
  curvy: 'curvy proportions with a defined waist and fuller hips',
  'plus-size': 'plus-size proportions with a fuller torso, arms, and legs',
};

const safeOutfitFitDescriptions = {
  lean: 'a slim garment-fit profile',
  average: 'a standard garment-fit profile',
  athletic: 'a broad-shouldered garment-fit profile',
  curvy: 'a softly rounded garment-fit profile',
  'plus-size': 'a full garment-fit profile',
};

const outfitPrompt = (outfit) => `Create one polished, photorealistic editorial fashion image of a neutral faceless mannequin wearing exactly these three referenced garments together:
1. Top: ${outfit.top.color} ${outfit.top.name} (${outfit.top.garmentType})
2. Bottom: ${outfit.bottom.color} ${outfit.bottom.name} (${outfit.bottom.garmentType})
3. Shoes: ${outfit.shoes.color} ${outfit.shoes.name} (${outfit.shoes.garmentType})
The three input images are reference images in that same order. Preserve their colours, patterns, silhouettes, and important details. Show one full-body front-facing mannequin with ${outfitBodyDescriptions[outfit.previewBodyShape] ?? outfitBodyDescriptions.average}. Keep the body realistic, neutral, non-sexualized, and fully clothed, and make each garment fit naturally on those proportions. Use a warm white seamless fashion-studio background. No extra garments, accessories, text, collage panels, people, hands, hangers, boxes, or product photography. The intended occasion is ${outfit.occasion === 'any' ? 'versatile everyday wear' : outfit.occasion}.`;

const safeOutfitPrompt = (outfit) => `Create one polished fashion-catalog image of an inanimate retail dress form displaying this coordinated outfit:
1. ${outfit.top.color} ${outfit.top.garmentType}
2. ${outfit.bottom.color} ${outfit.bottom.garmentType}
3. ${outfit.shoes.color} ${outfit.shoes.garmentType}
Use ${safeOutfitFitDescriptions[outfit.previewBodyShape] ?? safeOutfitFitDescriptions.average}. The dress form must have no face, skin, anatomical detail, or resemblance to an identifiable person. Keep every garment opaque and show the complete outfit from the front on a warm white studio background. No text, accessories, hands, people, collage panels, hangers, boxes, or extra garments. The intended occasion is ${outfit.occasion === 'any' ? 'versatile everyday wear' : outfit.occasion}.`;

const isFlaggedImageError = (message) => /flagged|safety|moderation|prompt\s*\/\s*input image/i.test(message);

async function runCloudflareOutfit(prompt, references = []) {
  assertProviderAvailable('cloudflare');
  consumeProviderDailyBudget('cloudflareImage');
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', '768');
  form.append('height', '1024');
  form.append('guidance', '4');
  references.forEach((reference, index) => {
    form.append(`input_image_${index}`, new Blob([reference], { type: 'image/png' }), `reference-${index + 1}.png`);
  });
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/ai/run/${cloudflareImageModel}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${cloudflareApiToken}` },
      body: form,
      signal: AbortSignal.timeout(120000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  const encoded = payload?.result?.image ?? payload?.image;
  if (!response.ok || !encoded) {
    const message = payload?.errors?.[0]?.message ?? payload?.error ?? `Cloudflare outfit image failed (${response.status}).`;
    registerProviderFailure('cloudflare', response.status, String(message));
    throw new Error(message);
  }
  return Buffer.from(encoded, 'base64');
}

async function generateCloudflareOutfit(outfit) {
  if (!cloudflareReady) throw new Error('Cloudflare image generation is not configured.');
  const pieces = [outfit.top, outfit.bottom, outfit.shoes];
  const references = await Promise.all(pieces.map(fetchOutfitReference));
  try {
    return await runCloudflareOutfit(outfitPrompt(outfit), references);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isFlaggedImageError(message)) throw error;
    console.warn('Cloudflare flagged outfit references; retrying with a text-only dress-form prompt.');
    return runCloudflareOutfit(safeOutfitPrompt(outfit));
  }
}

async function storeOutfitImage(userId, signature, buffer) {
  const publicId = `closetai/users/${sanitizeId(userId)}/outfits/${sanitizeId(signature)}-${Date.now()}`;
  const optimized = await sharp(buffer)
    .resize(1024, 1536, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  return uploadCloudinaryBuffer(publicId, optimized, `${sanitizeId(signature)}.webp`);
}

async function authenticate(request, response, next) {
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (firebaseAdminReady) {
    if (!bearer) {
      response.status(401).json({ error: 'A Firebase session is required.' });
      return;
    }
    try {
      const decoded = await getAdminAuth().verifyIdToken(bearer);
      request.closetUserId = decoded.uid;
      next();
    } catch {
      response.status(401).json({ error: 'Invalid Firebase session.' });
    }
    return;
  }
  const developmentUser = request.headers['x-closet-user'];
  if (developmentUser && typeof developmentUser === 'string') {
    request.closetUserId = developmentUser;
    next();
    return;
  }
  response.status(401).json({ error: 'Sign in is required.' });
}

const serverStylePairs = {
  casual: ['casual', 'classic', 'sport', 'street'], business: ['business', 'classic'],
  sport: ['sport', 'casual', 'street'], street: ['street', 'casual', 'sport'],
  classic: ['classic', 'business', 'casual'],
};
const serverColorFamilies = {
  neutral: ['black', 'white', 'gray', 'grey', 'cream', 'beige', 'tan', 'neutral'],
  earth: ['green', 'olive', 'brown', 'rust', 'khaki', 'sand'],
  cool: ['blue', 'navy', 'indigo', 'purple', 'teal'],
  warm: ['red', 'orange', 'yellow', 'pink', 'burgundy'],
};
const serverColorFamily = (color) => Object.entries(serverColorFamilies)
  .find(([, values]) => values.some((value) => String(color).toLowerCase().includes(value)))?.[0] ?? 'unknown';
const serverColorPairScore = (first, second) => {
  const a = serverColorFamily(first.color);
  const b = serverColorFamily(second.color);
  if (a === 'neutral' || b === 'neutral') return 4;
  if (a === b) return 3;
  if ((a === 'earth' && b === 'cool') || (a === 'cool' && b === 'earth')) return 2;
  if ((a === 'warm' && b === 'cool') || (a === 'cool' && b === 'warm')) return 2;
  return 0;
};
const serverStylePairScore = (first, second) => first.style === second.style
  ? 5
  : serverStylePairs[first.style]?.includes(second.style) ? 3 : -2;
const serverEligibleForOccasion = (item, occasion) => {
  if (!item.occasions?.includes(occasion)) return false;
  if ((occasion === 'work' || occasion === 'formal') && ['t-shirt', 'hoodie', 'shorts', 'sweatpants', 'athletic-shoes'].includes(item.garmentType)) return false;
  if (occasion === 'formal' && !['formal', 'semi-formal'].includes(item.formality)) return false;
  return true;
};
function serverGoodOutfitCount(wardrobe) {
  const tops = wardrobe.filter((item) => item.category === 'top');
  const bottoms = wardrobe.filter((item) => item.category === 'bottom');
  const shoes = wardrobe.filter((item) => item.category === 'shoes');
  let count = 0;
  tops.forEach((top) => bottoms.forEach((bottom) => shoes.forEach((shoe) => {
    const compatibility = serverColorPairScore(top, bottom) * 2 + serverColorPairScore(bottom, shoe) +
      serverStylePairScore(top, bottom) * 2 + serverStylePairScore(bottom, shoe);
    const shared = top.occasions?.some((occasion) => bottom.occasions?.includes(occasion) && shoe.occasions?.includes(occasion));
    if (compatibility >= 10 && shared) count += 1;
  })));
  return count;
}
function serverWardrobeMetrics(wardrobe, history, counts) {
  const possibleOutfits = serverGoodOutfitCount(wardrobe);
  const wornOutfits = Math.min(possibleOutfits, new Set(history.filter((entry) => entry.wornAt).map((entry) => entry.signature)).size);
  const occasionCoverage = occasions.filter((occasion) => ['top', 'bottom', 'shoes'].every((category) =>
    wardrobe.some((item) => item.category === category && serverEligibleForOccasion(item, occasion)))).length;
  const categoryDepth = (Math.min(counts.top, 8) + Math.min(counts.bottom, 8) + Math.min(counts.shoes, 8)) / 24;
  const score = Math.min(100, Math.round(
    categoryDepth * 30 +
    Math.min(new Set(wardrobe.map((item) => String(item.color).toLowerCase())).size / 10, 1) * 15 +
    Math.min(new Set(wardrobe.map((item) => item.garmentType)).size / 12, 1) * 20 +
    (occasionCoverage / occasions.length) * 20 +
    Math.min(new Set(wardrobe.map((item) => item.formality)).size / 4, 1) * 10 +
    Math.min(new Set(wardrobe.map((item) => item.style)).size / 5, 1) * 5,
  ));
  return {
    score,
    efficiency: { possibleOutfits, wornOutfits, wornPercentage: possibleOutfits ? Math.round((wornOutfits / possibleOutfits) * 100) : 0 },
  };
}

function localWardrobeAnalysis(wardrobe, history, preferences = {}) {
  const preferenceProfile = recommendationPreferenceProfile(preferences);
  const counts = {
    top: wardrobe.filter((item) => item.category === 'top').length,
    bottom: wardrobe.filter((item) => item.category === 'bottom').length,
    shoes: wardrobe.filter((item) => item.category === 'shoes').length,
  };
  const dark = wardrobe.filter((item) => /black|navy|charcoal|dark|brown|indigo/i.test(item.color)).length;
  const formal = wardrobe.filter((item) => ['formal', 'semi-formal'].includes(item.formality)).length;
  const insights = [];
  const suggestions = [];
  const metrics = serverWardrobeMetrics(wardrobe, history, counts);
  const blocked = new Set(['t-shirt', 'hoodie', 'shorts', 'sweatpants', 'athletic-shoes']);
  const combinationCount = (items) => occasions.reduce((total, occasion) => {
    const eligible = items.filter((item) => item.occasions?.includes(occasion) && !((occasion === 'work' || occasion === 'formal') && blocked.has(item.garmentType)));
    const tops = eligible.filter((item) => item.category === 'top').length;
    const bottoms = eligible.filter((item) => item.category === 'bottom').length;
    const shoes = eligible.filter((item) => item.category === 'shoes').length;
    return total + tops * bottoms * shoes;
  }, 0);
  const currentCombinations = combinationCount(wardrobe);
  const addSuggestion = (suggestion) => {
    if (suggestions.some((item) => item.title === suggestion.title)) return;
    const hypothetical = { id: `suggestion-${suggestions.length}`, ...suggestion };
    suggestions.push({
      ...suggestion,
      combinationsUnlocked: Math.max(1, combinationCount([...wardrobe, hypothetical]) - currentCombinations),
    });
  };
  if (!wardrobe.length) {
    return {
      summary: 'Add clothing to unlock personalized insights.',
      score: metrics.score,
      efficiency: metrics.efficiency,
      insights: [{
        id: 'start',
        title: 'Build your wardrobe profile',
        detail: 'Add a few pieces to unlock useful gap analysis.',
        tone: 'opportunity',
      }],
      suggestions,
    };
  }
  if (wardrobe.length) {
    insights.push({
      id: 'foundation',
      title: 'Outfit potential',
      detail: `${wardrobe.length} pieces can create up to ${counts.top * counts.bottom * counts.shoes} complete combinations.`,
      tone: 'positive',
    });
  }
  if (wardrobe.length >= 24) {
    const colorCount = new Set(wardrobe.map((item) => String(item.color).toLowerCase())).size;
    const typeCount = new Set(wardrobe.map((item) => item.garmentType)).size;
    insights.push({
      id: 'catalog-depth',
      title: 'Expansion mode is active',
      detail: `${wardrobe.length} pieces already cover ${colorCount} colours and ${typeCount} garment types. New picks target distinctive textures, silhouettes, seasonal layers, and underused occasions rather than stopping at a perfect score.`,
      tone: 'positive',
    });
  }
  if (wardrobe.length >= 3 && dark > wardrobe.length * 0.6) {
    insights.push({ id: 'colour', title: 'Add some contrast', detail: 'A cream, light-blue, or stone piece would balance the darker palette.', tone: 'opportunity' });
    addSuggestion({ title: 'Cream overshirt', category: 'top', garmentType: 'jacket', color: 'Cream', style: 'classic', occasions: ['casual', 'school', 'work', 'date-night'], formality: 'smart-casual', reason: 'Adds contrast while staying versatile.' });
  }
  const weakest = Object.entries(counts).sort((a, b) => a[1] - b[1])[0];
  if (weakest?.[1] < 2) {
    const [category] = weakest;
    const title = category === 'shoes' ? 'Minimal leather sneakers' : category === 'bottom' ? 'Straight-leg chinos' : 'Versatile textured shirt';
    insights.push({ id: 'category', title: `Your ${category} selection is limiting outfits`, detail: `Adding one strong ${category} creates the largest immediate increase in combinations.`, tone: 'warning' });
    addSuggestion({ title, category, garmentType: category === 'shoes' ? 'sneakers' : category === 'bottom' ? 'chinos' : 'shirt', color: category === 'shoes' ? 'Off-white' : 'Mid blue', style: 'classic', occasions: category === 'shoes' ? ['casual', 'school', 'date-night'] : ['casual', 'school', 'work', 'date-night'], formality: 'smart-casual', reason: `Fills your smallest wardrobe category.` });
  }
  if (formal < 2) {
    insights.push({ id: 'formal', title: 'Formal coverage is limited', detail: 'A polished shoe or structured top would improve work and semi-formal outfits.', tone: 'opportunity' });
    addSuggestion({ title: 'Polished leather loafers', category: 'shoes', garmentType: 'loafers', color: 'Brown', style: 'business', occasions: ['work', 'semi-formal', 'formal', 'date-night'], formality: 'semi-formal', reason: 'Improves work and semi-formal coverage.' });
  }
  if (history.length > 3) {
    insights.push({ id: 'learning', title: 'Personalization is active', detail: `${history.length} saved decisions are helping tune future outfits.`, tone: 'positive' });
  }
  if (preferenceProfile.feedbackCount >= 2) {
    insights.push({ id: 'shopping-learning', title: 'Shopping suggestions are learning', detail: `${preferenceProfile.feedbackCount} product decisions are tuning audience, style, colour, and price.`, tone: 'positive' });
  }
  [
    { title: 'Light blue Oxford shirt', category: 'top', garmentType: 'shirt', color: 'Light blue', style: 'business', occasions: ['work', 'school', 'semi-formal', 'date-night'], formality: 'smart-casual', reason: 'Adds a reliable polished top without feeling overly formal.' },
    { title: 'Straight-leg navy trousers', category: 'bottom', garmentType: 'trousers', color: 'Navy blue', style: 'classic', occasions: ['work', 'semi-formal', 'formal', 'date-night'], formality: 'semi-formal', reason: 'Creates a clean base for both light and saturated tops.' },
    { title: 'Minimal off-white sneakers', category: 'shoes', garmentType: 'sneakers', color: 'Off-white', style: 'classic', occasions: ['casual', 'school', 'date-night', 'streetwear'], formality: 'relaxed', reason: 'Connects casual pieces across more colour combinations.' },
    { title: 'Charcoal knit sweater', category: 'top', garmentType: 'sweater', color: 'Charcoal', style: 'classic', occasions: ['casual', 'school', 'work', 'date-night'], formality: 'smart-casual', reason: 'Adds a flexible layer for cooler weather and smarter outfits.' },
    { title: 'Stone chinos', category: 'bottom', garmentType: 'chinos', color: 'Stone', style: 'classic', occasions: ['casual', 'school', 'work', 'date-night'], formality: 'smart-casual', reason: 'Introduces a lighter neutral base with broad outfit coverage.' },
    { title: 'Forest green bomber jacket', category: 'top', garmentType: 'jacket', color: 'Forest green', style: 'street', occasions: ['casual', 'school', 'date-night', 'streetwear'], formality: 'relaxed', reason: 'Adds colour and an easy outer layer without duplicating a basic top.' },
    { title: 'Black tailored trousers', category: 'bottom', garmentType: 'trousers', color: 'Black', style: 'business', occasions: ['work', 'semi-formal', 'formal', 'date-night'], formality: 'semi-formal', reason: 'Creates a polished base for work and evening outfits.' },
    { title: 'Brown suede boots', category: 'shoes', garmentType: 'boots', color: 'Brown', style: 'classic', occasions: ['casual', 'work', 'date-night', 'streetwear'], formality: 'smart-casual', reason: 'Adds texture and bridges relaxed and polished outfits.' },
    { title: 'Burgundy textured overshirt', category: 'top', garmentType: 'jacket', color: 'Burgundy', style: 'casual', occasions: ['casual', 'school', 'date-night'], formality: 'smart-casual', reason: 'Introduces a richer colour while remaining easy to layer.' },
    { title: 'Mid-wash straight jeans', category: 'bottom', garmentType: 'jeans', color: 'Mid blue', style: 'casual', occasions: ['casual', 'school', 'date-night', 'streetwear'], formality: 'relaxed', reason: 'Adds a lighter denim option for everyday outfits.' },
    { title: 'Clean black leather sneakers', category: 'shoes', garmentType: 'sneakers', color: 'Black', style: 'classic', occasions: ['casual', 'school', 'work', 'date-night'], formality: 'smart-casual', reason: 'Works across dark and light bottoms with a cleaner finish than athletic shoes.' },
  ].forEach(addSuggestion);
  return {
    summary: 'Your wardrobe has a usable core. These are the highest-impact additions.',
    score: metrics.score,
    efficiency: metrics.efficiency,
    insights,
    suggestions: suggestions
      .sort((a, b) =>
        (preferenceProfile.styleScores[b.style] ?? 0) + (preferenceProfile.garmentScores[b.garmentType] ?? 0) + (preferenceProfile.colorScores[String(b.color).toLowerCase()] ?? 0) -
        (preferenceProfile.styleScores[a.style] ?? 0) - (preferenceProfile.garmentScores[a.garmentType] ?? 0) - (preferenceProfile.colorScores[String(a.color).toLowerCase()] ?? 0))
      .slice(0, 12),
    preferenceProfile,
  };
}

function estimateUnlocked(wardrobe, suggestion) {
  const tops = wardrobe.filter((item) => item.category === 'top').length;
  const bottoms = wardrobe.filter((item) => item.category === 'bottom').length;
  const shoes = wardrobe.filter((item) => item.category === 'shoes').length;
  return Math.max(1, suggestion.category === 'top' ? bottoms * shoes : suggestion.category === 'bottom' ? tops * shoes : tops * bottoms);
}

async function generateWardrobeSuggestions(wardrobe, preferences, localSuggestions, forceExpansion = false, explorationSeed = '') {
  if (!cloudflareReady) return [];
  const profile = recommendationPreferenceProfile(preferences);
  const cacheKey = `suggestion-blueprints:${sha(JSON.stringify({
    wardrobe: wardrobe.map(({ name, category, color, style, garmentType, occasions, formality }) => ({ name, category, color, style, garmentType, occasions, formality })),
    profile,
    explorationSeed: forceExpansion ? String(explorationSeed) : '',
  }))}`;
  const cached = suggestionCache.get(cacheKey);
  if (cached) return cached;
  const counts = wardrobe.reduce((summary, item) => {
    summary.categories[item.category] = (summary.categories[item.category] ?? 0) + 1;
    summary.colors[item.color] = (summary.colors[item.color] ?? 0) + 1;
    summary.types[item.garmentType] = (summary.types[item.garmentType] ?? 0) + 1;
    summary.styles[item.style] = (summary.styles[item.style] ?? 0) + 1;
    item.occasions?.forEach((occasion) => { summary.occasions[occasion] = (summary.occasions[occasion] ?? 0) + 1; });
    return summary;
  }, { total: wardrobe.length, categories: {}, colors: {}, types: {}, styles: {}, occasions: {} });
  const prompt = `Act as a practical Canadian wardrobe stylist. Suggest 8 singular, specific, product-search-ready clothing products that add meaningful variety even when the wardrobe already has 100 or more versatile pieces. ${forceExpansion ? 'This is an explicit exploration request: do not answer that the wardrobe is complete. Find less obvious but still wearable additions across texture, silhouette, season, colour, layering function, and underused occasions.' : ''} For large wardrobes, prioritize underrepresented texture, silhouette, season, colour, layering function, and occasion instead of claiming nothing is missing. Every title must include a precise colour, material or finish, silhouette, and garment type. Avoid products already owned and close duplicates of these existing suggestions: ${JSON.stringify(localSuggestions.map((item) => item.title))}. Use the preference profile to reduce disliked audiences, styles, colours, garment types, and expensive items, while retaining variety after several dislikes. Never put T-shirts, hoodies, shorts, sweatpants, or athletic shoes in formal or semi-formal occasions. Return only a JSON array matching this shape: [{"title":"specific product","category":"top|bottom|shoes","color":"specific colour","style":"casual|business|sport|street|classic","garmentType":"one allowed garment type","occasions":["allowed occasion"],"formality":"relaxed|smart-casual|semi-formal|formal","reason":"why it expands this wardrobe"}]. Wardrobe summary: ${JSON.stringify(counts)}. Representative pieces: ${JSON.stringify(wardrobe.slice(0, 60))}. Preferences: ${JSON.stringify(profile).slice(0, 5000)}.`;
  try {
    const parsed = await cloudflareRequest(prompt);
    const list = normalizeSuggestionList(parsed);
    return suggestionCache.set(cacheKey, list, 1000 * 60 * 60 * 12);
  } catch (error) {
    console.warn('AI wardrobe suggestion fallback:', error.message);
    return [];
  }
}

const neutralColour = (value) => /black|white|cream|beige|gray|grey|navy|brown|tan|stone|charcoal/i.test(String(value));

function ownedPairingScore(item, candidate) {
  if (!candidate || item.id === candidate.id || item.category === candidate.category) return -1;
  const sharedOccasions = (candidate.occasions ?? []).filter((occasion) => item.occasions?.includes(occasion)).length;
  const style = item.style === candidate.style ? 2 : item.formality === candidate.formality ? 1 : 0;
  const colour = neutralColour(item.color) || neutralColour(candidate.color) ? 2 : item.color !== candidate.color ? 1 : 0;
  return sharedOccasions * 3 + style + colour + (candidate.clean ? 1 : 0);
}

function localPairingBlueprints(item) {
  const common = item.category === 'bottom'
    ? [
        { title: 'Crisp white heavyweight T-shirt', category: 'top', garmentType: 't-shirt', color: 'White', style: 'casual', occasions: ['casual', 'school', 'date-night'], formality: 'relaxed', reason: `A clean light top gives ${item.color} ${item.garmentType} an easy high-contrast pairing.` },
        { title: 'Light blue Oxford shirt', category: 'top', garmentType: 'shirt', color: 'Light blue', style: 'classic', occasions: ['school', 'work', 'semi-formal', 'date-night'], formality: 'smart-casual', reason: `A structured shirt makes ${item.name} work in smarter outfits.` },
        { title: 'Minimal off-white sneakers', category: 'shoes', garmentType: 'sneakers', color: 'Off-white', style: 'classic', occasions: ['casual', 'school', 'date-night'], formality: 'relaxed', reason: `Light neutral shoes finish ${item.name} without competing with it.` },
      ]
    : item.category === 'top'
      ? [
          { title: 'Straight-leg beige chinos', category: 'bottom', garmentType: 'chinos', color: 'Beige', style: 'classic', occasions: ['casual', 'school', 'work', 'date-night'], formality: 'smart-casual', reason: `A warm neutral bottom lets the colour of ${item.name} lead.` },
          { title: 'Dark indigo straight jeans', category: 'bottom', garmentType: 'jeans', color: 'Indigo', style: 'casual', occasions: ['casual', 'school', 'date-night'], formality: 'relaxed', reason: `Dark denim provides a dependable base for ${item.name}.` },
          { title: 'Clean white leather sneakers', category: 'shoes', garmentType: 'sneakers', color: 'White', style: 'classic', occasions: ['casual', 'school', 'date-night'], formality: 'smart-casual', reason: `Simple white shoes keep the look balanced and wearable.` },
        ]
      : [
          { title: 'Cream textured overshirt', category: 'top', garmentType: 'jacket', color: 'Cream', style: 'classic', occasions: ['casual', 'school', 'work', 'date-night'], formality: 'smart-casual', reason: `A light layer builds an outfit around ${item.name} without matching too literally.` },
          { title: 'Straight-leg navy trousers', category: 'bottom', garmentType: 'trousers', color: 'Navy blue', style: 'classic', occasions: ['casual', 'work', 'semi-formal', 'date-night'], formality: 'smart-casual', reason: `Navy trousers connect easily with ${item.name} and many tops.` },
          { title: 'White heavyweight T-shirt', category: 'top', garmentType: 't-shirt', color: 'White', style: 'casual', occasions: ['casual', 'school', 'streetwear'], formality: 'relaxed', reason: `A crisp white tee keeps ${item.name} as the visual anchor.` },
        ];
  return common;
}

async function generatePairingBlueprints(item, wardrobe, preferences, forceDiscovery = false) {
  const fallback = localPairingBlueprints(item);
  if (!cloudflareReady) return { blueprints: fallback, ai: false };
  const prompt = `Suggest 6 singular, product-search-ready garments that pair well with the selected item, covering the other clothing categories. ${forceDiscovery ? 'This is a user-requested exploration pass, so prioritize fresh, less obvious pairings instead of saying their existing wardrobe is sufficient.' : ''} Every title must name one exact colour, material or finish, silhouette, and garment type, for example "dark indigo straight-leg jeans" or "cream heavyweight cotton crewneck T-shirt". Never return groups, plural categories, custom-print services, generic phrases such as "men's shirts", or "design your own" products. Be practical about colour harmony, style, formality, and occasions. Do not suggest items already in the wardrobe. Respect this preference profile: ${JSON.stringify(recommendationPreferenceProfile(preferences))}. Never label T-shirts, hoodies, shorts, sweatpants, or athletic shoes as formal or semi-formal. Return only a JSON array in the required suggestion shape. Selected item: ${JSON.stringify(item)}. Wardrobe: ${JSON.stringify(wardrobe).slice(0, 10000)}.`;
  try {
    const parsed = await cloudflareRequest(prompt);
    return { blueprints: normalizeSuggestionList(parsed).slice(0, 6), ai: true };
  } catch (error) {
    console.warn('AI clothing pairing fallback:', error.message);
    return { blueprints: fallback, ai: false };
  }
}

function recommendationFromProduct(suggestion, product, index, wardrobe) {
  const typeLabel = String(suggestion.garmentType).replaceAll('-', ' ');
  const colorIncluded = String(product.name).toLowerCase().includes(String(suggestion.color).toLowerCase());
  const typeIncluded = matchesRequestedGarment(String(product.name), suggestion.garmentType);
  const concreteTitle = `${colorIncluded ? '' : `${suggestion.color} `}${product.name}${typeIncluded ? '' : ` ${typeLabel}`}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
  return {
    id: `recommendation-${index}-${sha(product.productUrl).slice(0, 10)}`,
    title: concreteTitle,
    category: suggestion.category,
    garmentType: suggestion.garmentType,
    color: suggestion.color,
    style: suggestion.style,
    formality: suggestion.formality,
    audience: product.audience,
    reason: suggestion.reason,
    combinationsUnlocked: suggestion.combinationsUnlocked ?? estimateUnlocked(wardrobe, suggestion),
    imageUrl: product.imageUrl,
    retailer: product.retailer,
    productUrl: product.productUrl,
    priceCad: product.priceCad,
    priceCadAmount: product.priceCadAmount,
    occasions: suggestion.occasions,
    verifiedAt: product.verifiedAt,
    linkStatus: product.linkStatus,
  };
}

const apiRateUsage = new Map();
const globalApiLimit = { name: 'all-api', windowMs: 10 * 60 * 1000, max: 300 };
const apiLimitRules = [
  { name: 'health', method: 'GET', pattern: /^\/(health|persistence\/status)$/, windowMs: 60 * 1000, max: 120 },
  { name: 'product-images', method: 'GET', pattern: /^\/products\/image$/, windowMs: 10 * 60 * 1000, max: 120 },
  { name: 'clothing-analysis', method: 'POST', pattern: /^\/clothing\/(match|analyze)$/, windowMs: 10 * 60 * 1000, max: 8 },
  { name: 'clothing-pairings', method: 'POST', pattern: /^\/clothing\/pairings$/, windowMs: 10 * 60 * 1000, max: 4 },
  { name: 'outfit-rerank', method: 'POST', pattern: /^\/outfits\/rerank$/, windowMs: 10 * 60 * 1000, max: 30 },
  { name: 'outfit-visualize', method: 'POST', pattern: /^\/outfits\/visualize$/, windowMs: 60 * 60 * 1000, max: 5 },
  { name: 'insights', method: 'POST', pattern: /^\/insights$/, windowMs: 10 * 60 * 1000, max: 4 },
  { name: 'storage', pattern: /^\/storage\/(upload|import|url|object)$/, windowMs: 60 * 60 * 1000, max: 40 },
];

function rateLimitIdentity(request) {
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const developmentUser = typeof request.headers['x-closet-user'] === 'string'
    ? request.headers['x-closet-user']
    : '';
  return sha(bearer || developmentUser || request.ip || request.socket.remoteAddress || 'unknown').slice(0, 24);
}

function consumeApiBudget(rule, identity) {
  const key = `${rule.name}:${identity}`;
  const now = Date.now();
  const current = apiRateUsage.get(key);
  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + rule.windowMs };
    apiRateUsage.set(key, next);
    return { allowed: true, remaining: rule.max - 1, resetAt: next.resetAt };
  }
  if (current.count >= rule.max) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }
  current.count += 1;
  return { allowed: true, remaining: rule.max - current.count, resetAt: current.resetAt };
}

function apiRateLimiter(request, response, next) {
  if (apiRateUsage.size > 3000) {
    const now = Date.now();
    for (const [key, value] of apiRateUsage) {
      if (value.resetAt <= now) apiRateUsage.delete(key);
    }
  }
  const identity = rateLimitIdentity(request);
  const path = request.originalUrl.split('?')[0].replace(/^\/api/, '') || '/';
  const specific = apiLimitRules.find((rule) =>
    (!rule.method || rule.method === request.method) && rule.pattern.test(path));
  for (const rule of [globalApiLimit, ...(specific ? [specific] : [])]) {
    const budget = consumeApiBudget(rule, identity);
    if (!budget.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((budget.resetAt - Date.now()) / 1000));
      response.set('Retry-After', String(retryAfterSeconds));
      response.status(429).json({
        error: `Request limit reached for ${rule.name}. This protects the free API quotas.`,
        retryAfterSeconds,
      });
      return;
    }
    response.set('X-RateLimit-Remaining', String(Math.max(0, budget.remaining)));
  }
  next();
}

app.use(cors());
app.use('/api', apiRateLimiter);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (request, response) => {
  if (request.query.verify === 'true') {
    await Promise.all([validateCloudinaryConfig(), validateFirestoreDatabase()]);
  }
  const services = {
    firebase: { ...credentialStatus('firebase'), ready: firebaseAdminReady, error: firebaseAdminError || undefined },
    firestoreDatabase: liveServiceStatus.firestoreDatabase,
      cloudflare: { ...credentialStatus('cloudflare'), ready: cloudflareReady, model: cloudflareModel },
      gemini: { ...credentialStatus('gemini'), ready: geminiReady, model: geminiVisionModel },
    tavily: { ...credentialStatus('tavily'), ready: tavilyReady },
    cloudinary: { ...credentialStatus('cloudinary'), ready: cloudinaryReady && liveServiceStatus.cloudinary.valid !== false, ...liveServiceStatus.cloudinary },
    cloudflareImage: { ...credentialStatus('cloudflare'), ready: cloudflareReady, model: cloudflareImageModel },
  };
  response.json({
    ok: true,
    apiVersion,
    services,
    features: {
      accounts: firebaseAdminReady ? 'firebase' : 'demo-local',
      clothingAnalysis: cloudflareReady ? 'cloudflare-workers-ai' : 'local-fallback',
      productSearch: tavilyReady ? 'tavily-verified' : 'unavailable',
      imageStorage: cloudinaryReady && liveServiceStatus.cloudinary.valid !== false ? 'cloudinary' : 'device-local',
      backgroundRemoval: 'disabled',
      outfitScoring: 'local',
      outfitVisualization: cloudflareReady && cloudinaryReady ? 'cloudflare-flux' : 'reference-moodboard',
    },
  });
});

app.get('/api/persistence/status', async (_request, response) => {
  const status = await validateFirestoreDatabase();
  response.json({ firestore: status });
});

app.get('/api/products/image', async (request, response) => {
  const imageUrl = String(request.query.url ?? '');
  const productUrl = String(request.query.product ?? '');
  if (!isSafePublicUrl(imageUrl)) {
    response.status(400).json({ error: 'A public HTTPS image URL is required.' });
    return;
  }
  const cacheKey = `product-image:${sha(imageUrl)}`;
  let image = productImageCache.get(cacheKey);
  try {
    if (!image) {
      const remote = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 ClosetAI/1.0',
          ...(isSafePublicUrl(productUrl) ? { Referer: productUrl } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(9000),
      });
      const contentType = remote.headers.get('content-type') ?? '';
      const contentLength = Number(remote.headers.get('content-length') ?? 0);
      if (!remote.ok || !contentType.startsWith('image/') || (contentLength && contentLength > 10 * 1024 * 1024)) throw new Error('Retailer image is unavailable.');
      const buffer = Buffer.from(await remote.arrayBuffer());
      if (buffer.length > 10 * 1024 * 1024) throw new Error('Retailer image is too large.');
      image = await sharp(buffer).rotate().resize(900, 900, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
      productImageCache.set(cacheKey, image, 1000 * 60 * 60 * 24);
    }
    response.set('Content-Type', 'image/webp');
    response.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    response.send(image);
  } catch {
    response.status(404).json({ error: 'Retailer image could not be loaded.' });
  }
});

app.post('/api/clothing/match', upload.single('image'), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'A JPEG, PNG, or WebP image is required.' });
    return;
  }
  try {
    const imageMetadata = await sharp(request.file.buffer).metadata();
    const { color, confidence: initialColorConfidence } = await detectDominantColor(request.file.buffer);
    const fallback = fallbackMetadata(color, imageMetadata.width, imageMetadata.height);
    let metadata = fallback;
    let aiProcessed = false;
    let aiError;
    if (cloudflareReady || geminiReady) {
      try {
        metadata = await inspectGarment(request.file, fallback);
        aiProcessed = true;
      } catch (error) {
        aiError = error.message;
        console.warn('Clothing vision analysis fallback:', error.message);
      }
    }
    if (!aiProcessed || metadata.confidence < 0.55) metadata.color = color;
    const matches = tavilyReady
      ? await searchCanadianProducts(metadata).catch((error) => {
          console.warn('Tavily product search fallback:', error.message);
          return [];
        })
      : [];
    response.json({
      apiVersion,
      item: {
        name: metadata.name,
        category: metadata.category,
        garmentType: metadata.garmentType,
        color: metadata.color,
        style: metadata.style,
        occasions: metadata.occasions,
        formality: metadata.formality,
        imageUri: '',
        imageSource: 'local',
        cutoutStatus: 'original',
        analysisSource: aiProcessed ? metadata.analysisProvider : 'local',
        analysisConfidence: aiProcessed ? metadata.confidence : initialColorConfidence,
      },
      matches,
      aiProcessed,
      colorConfidence: initialColorConfidence,
      processedImage: null,
      diagnostics: {
        analysisProvider: aiProcessed ? metadata.analysisProvider : 'local',
        productProvider: tavilyReady ? 'tavily' : 'unavailable',
        cutoutStatus: 'original',
        imageProvider: matches.length ? 'retailer-or-original' : 'original',
      },
      warning: aiError,
    });
  } catch (error) {
    console.error('Clothing matching failed:', error);
    response.status(500).json({ error: 'Clothing matching failed.' });
  }
});

app.post('/api/clothing/analyze', upload.single('image'), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'An image is required.' });
    return;
  }
  try {
    const metadata = await sharp(request.file.buffer).metadata();
    const { color, confidence: colorConfidence } = await detectDominantColor(request.file.buffer);
    const fallback = fallbackMetadata(color, metadata.width, metadata.height);
    const item = cloudflareReady || geminiReady
      ? await inspectGarment(request.file, fallback).catch(() => fallback)
      : fallback;
    response.json({
      item: { ...item, imageUri: '', imageSource: 'local' },
      processedImage: null,
      aiProcessed: (cloudflareReady || geminiReady) && item !== fallback,
      colorConfidence,
    });
  } catch {
    response.status(500).json({ error: 'Clothing analysis failed.' });
  }
});

app.post('/api/clothing/pairings', authenticate, async (request, response) => {
  const item = request.body?.item;
  const wardrobe = Array.isArray(request.body?.wardrobe) ? request.body.wardrobe : [];
  const forceDiscovery = request.body?.forceDiscovery === true;
  const explorationKey = forceDiscovery ? String(request.body?.explorationSeed ?? Date.now()).slice(0, 32) : '';
  const excludedProductUrls = Array.isArray(request.body?.excludedProductUrls)
    ? request.body.excludedProductUrls.filter(isSafePublicUrl).slice(0, 50)
    : [];
  const preferences = request.body?.preferences && typeof request.body.preferences === 'object'
    ? request.body.preferences
    : {};
  if (!item?.id || !item?.category) {
    response.status(400).json({ error: 'A wardrobe item is required.' });
    return;
  }
  const ownedMatches = wardrobe
    .map((candidate) => ({ item: candidate, score: ownedPairingScore(item, candidate) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => ({
      ...entry,
      reason: `${entry.item.color} ${String(entry.item.garmentType).replace('-', ' ')} shares the right occasions and balances ${item.name}.`,
    }));
  const { blueprints, ai } = await generatePairingBlueprints(item, wardrobe, preferences, forceDiscovery);
  const profile = recommendationPreferenceProfile(preferences);
  const shoppingMatches = tavilyReady
    ? (await Promise.all(blueprints.slice(0, 3).map(async (suggestion, index) => {
        const matches = await searchCanadianProducts(suggestion, {
          requirePrice: true,
          preferenceProfile: profile,
          excludedUrls: excludedProductUrls,
          explorationKey,
        }).catch(() => []);
        return matches[0] ? recommendationFromProduct(suggestion, matches[0], index, wardrobe) : null;
      }))).filter(Boolean).filter((product, index, list) => list.findIndex((entry) => entry.productUrl === product.productUrl) === index).slice(0, 3)
    : [];
  response.json({
    summary: forceDiscovery
      ? `Exploration mode found additional options around ${item.name}, beyond the strongest pieces you already own.`
      : ownedMatches.length
      ? `Start with what you own, then use the shopping ideas only if you want more options around ${item.name}.`
      : `These additions would build complete looks around ${item.name}.`,
    ownedMatches,
    shoppingMatches,
    generatedAt: new Date().toISOString(),
    provider: ai ? (tavilyReady ? 'cloudflare+tavily' : 'cloudflare') : (tavilyReady ? 'local+tavily' : 'local'),
  });
});

app.post('/api/storage/upload', authenticate, upload.single('image'), async (request, response) => {
  if (!request.file || !request.body.itemId) {
    response.status(400).json({ error: 'Image and itemId are required.' });
    return;
  }
  try {
    response.json(await storeImage(request.closetUserId, request.body.itemId, request.file.buffer));
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.post('/api/storage/import', authenticate, async (request, response) => {
  const { imageUrl, itemId } = request.body;
  if (!itemId || !isSafePublicUrl(imageUrl)) {
    response.status(400).json({ error: 'A safe image URL and itemId are required.' });
    return;
  }
  try {
    const remote = await fetch(imageUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const length = Number(remote.headers.get('content-length') ?? 0);
    if (!remote.ok || (length && length > 15 * 1024 * 1024)) throw new Error('Remote image is unavailable or too large.');
    const buffer = Buffer.from(await remote.arrayBuffer());
    if (buffer.length > 15 * 1024 * 1024) throw new Error('Remote image is too large.');
    response.json(await storeImage(request.closetUserId, itemId, buffer));
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.get('/api/storage/url', authenticate, async (request, response) => {
  const objectKey = String(request.query.key ?? '');
  const prefix = `closetai/users/${sanitizeId(request.closetUserId)}/`;
  if (!cloudinaryReady || !objectKey.startsWith(prefix)) {
    response.status(403).json({ error: 'Object is unavailable.' });
    return;
  }
  response.json({ imageUri: cloudinaryDeliveryUrl(objectKey) });
});

app.delete('/api/storage/object', authenticate, async (request, response) => {
  const { objectKey } = request.body;
  const prefix = `closetai/users/${sanitizeId(request.closetUserId)}/`;
  if (!cloudinaryReady || typeof objectKey !== 'string' || !objectKey.startsWith(prefix)) {
    response.status(403).json({ error: 'Object is unavailable.' });
    return;
  }
  try {
    await deleteCloudinaryImage(objectKey);
    response.json({ ok: true });
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.post('/api/outfits/rerank', authenticate, async (request, response) => {
  if (!cloudflareReady) {
    response.json({ selectedIndex: 0, reason: 'Local scoring selected the strongest combination.' });
    return;
  }
  try {
    const prompt = `Choose the strongest already-valid outfit for ${request.body.occasion ?? 'everyday wear'}. Respect feedback and recent-history penalties. Return {"selectedIndex":0,"trend":"short title","reason":"one sentence"}. Candidates: ${JSON.stringify(request.body).slice(0, 18000)}`;
    response.json(await cloudflareRequest(prompt));
  } catch {
    response.json({ selectedIndex: 0, reason: 'Local scoring selected the strongest combination.' });
  }
});

app.post('/api/outfits/visualize', authenticate, async (request, response) => {
  const outfit = request.body?.outfit;
  if (!outfit?.top || !outfit?.bottom || !outfit?.shoes) {
    response.status(400).json({ error: 'A complete outfit is required.' });
    return;
  }
  if (!cloudflareReady || !cloudinaryReady) {
    response.status(503).json({ error: 'AI outfit previews require Cloudflare Workers AI and Cloudinary.' });
    return;
  }
  const signature = sha(JSON.stringify([
    outfit.top.id, outfit.top.imageUri,
    outfit.bottom.id, outfit.bottom.imageUri,
    outfit.shoes.id, outfit.shoes.imageUri,
    outfit.occasion,
    outfit.previewBodyShape ?? 'average',
  ])).slice(0, 32);
  const cacheKey = `outfit-image:${request.closetUserId}:${signature}`;
  const cached = outfitImageCache.get(cacheKey);
  if (cached) {
    response.json(cached);
    return;
  }
  try {
    const generated = await generateCloudflareOutfit(outfit);
    const stored = await storeOutfitImage(request.closetUserId, signature, generated);
    const result = { imageUri: stored.imageUri, provider: 'cloudflare', model: cloudflareImageModel };
    outfitImageCache.set(cacheKey, result, 1000 * 60 * 60 * 24);
    response.json(result);
  } catch (error) {
    console.warn('AI outfit preview fallback:', error.message);
    response.status(503).json({ error: error.message });
  }
});

app.post('/api/insights', authenticate, async (request, response) => {
  const wardrobe = Array.isArray(request.body.wardrobe) ? request.body.wardrobe : [];
  const history = Array.isArray(request.body.history) ? request.body.history : [];
  const preferences = request.body.preferences && typeof request.body.preferences === 'object'
    ? request.body.preferences
    : {};
  const forceExpansion = request.body.forceExpansion === true;
  const explorationSeed = forceExpansion ? String(request.body.explorationSeed ?? Date.now()).slice(0, 32) : '';
  const excludedProductUrls = Array.isArray(request.body.excludedProductUrls)
    ? request.body.excludedProductUrls.filter(isSafePublicUrl).slice(0, 80)
    : [];
  const cacheKey = `insights:${sha(JSON.stringify({ wardrobe, history: history.slice(0, 20), preferences, explorationSeed }))}`;
  const cached = forceExpansion ? null : insightCache.get(cacheKey);
  if (cached) {
    response.json(cached);
    return;
  }
  const base = localWardrobeAnalysis(wardrobe, history, preferences);
  const preferenceProfile = base.preferenceProfile ?? recommendationPreferenceProfile(preferences);
  const aiSuggestions = await generateWardrobeSuggestions(wardrobe, preferences, base.suggestions, forceExpansion, explorationSeed);
  const suggestionPool = [...aiSuggestions, ...base.suggestions]
    .filter((suggestion, index, list) => list.findIndex((entry) => entry.title.toLowerCase() === suggestion.title.toLowerCase()) === index)
    .map((suggestion) => ({ ...suggestion, combinationsUnlocked: suggestion.combinationsUnlocked ?? estimateUnlocked(wardrobe, suggestion) }))
    .sort((a, b) =>
      (preferenceProfile.styleScores[b.style] ?? 0) + (preferenceProfile.garmentScores[b.garmentType] ?? 0) -
      (preferenceProfile.styleScores[a.style] ?? 0) - (preferenceProfile.garmentScores[a.garmentType] ?? 0));
  const recommendations = tavilyReady
    ? (await Promise.all(suggestionPool.slice(0, 4).map(async (suggestion, index) => {
        const matches = await searchCanadianProducts(suggestion, {
          requirePrice: true,
          preferenceProfile,
          excludedUrls: excludedProductUrls,
          explorationKey: explorationSeed,
        }).catch(() => []);
        const product = matches[0];
        if (!product) return null;
        return recommendationFromProduct(suggestion, product, index, wardrobe);
      }))).filter(Boolean)
        .filter((product, index, list) => list.findIndex((entry) => entry.productUrl === product.productUrl) === index)
        .slice(0, 4)
    : [];
  const result = {
    summary: forceExpansion
      ? 'Exploration mode searched beyond the obvious wardrobe gaps for fresh pieces that still fit your style.'
      : base.summary,
    score: base.score,
    efficiency: base.efficiency,
    insights: base.insights,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
  insightCache.set(cacheKey, result, forceExpansion ? 1000 * 60 * 30 : 1000 * 60 * 60 * 12);
  response.json(result);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`ClosetAI API listening on http://localhost:${port}`);
  Object.keys(requiredCredentials).forEach((service) => {
    const status = credentialStatus(service);
    if (service === 'firebase' && firebaseAdminError) {
      console.log(`[credentials] firebase invalid: ${firebaseAdminError}`);
    } else if (status.configured) {
      console.log(`[credentials] ${service} ready`);
    } else {
      console.log(`[credentials] ${service} missing: ${status.missing.join(', ')}`);
    }
  });
  console.log('[fallbacks] local clothing metadata, outfit scoring, and wardrobe insights are enabled.');
  validateCloudinaryConfig().then((cloudinary) => {
    if (cloudinary.valid === false) console.log(`[credentials] cloudinary invalid: ${cloudinary.error}`);
  });
  validateFirestoreDatabase().then((firestore) => {
    if (!firestore.ready) console.log('[persistence] Firestore (default) database is missing; clients will use per-account device storage.');
  });
});

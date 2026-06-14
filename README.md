# ClosetAI

An Expo wardrobe app with private accounts, intact garment images, verified
Canadian product matching, personalized outfits, laundry tracking, and wardrobe
insights.

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:8787/api/health` after startup. It lists every configured
service and the exact missing environment variable names without exposing any
secret values. Without cloud credentials, demo accounts, device-local images,
local outfit scoring, local clothing estimates, and local wardrobe insights
remain available.

## Free account setup

### 1. Firebase Spark

1. Create a Firebase project and register a Web app.
2. Enable **Authentication > Sign-in method > Email/Password**.
3. Open **Build > Firestore Database**, click **Create database**, choose the
   `(default)` database in production mode, and select a Canadian region.
4. Copy the Web app values into the four `EXPO_PUBLIC_FIREBASE_*` variables.
5. In **Project settings > Service accounts**, generate a private key JSON.
6. Copy its `project_id`, `client_email`, and `private_key` into the server-only
   `FIREBASE_*` variables. Preserve the quoted `\n` characters in the key.
7. Deploy the included owner-only rules:

```bash
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore:rules
```

Firebase Storage is not used, so the project can stay on Spark.

### 2. Cloudinary Free

1. Create a free Cloudinary product environment.
2. Open **Settings > API Keys**.
3. Add the cloud name, API key, and API secret to the server-only
   `CLOUDINARY_*` variables.

The Node API keeps the full original image, creates an optimized WebP, signs the
upload server-side, and stores it in Cloudinary. Verified retailer images stay
linked to their direct product source instead of being reprocessed.
Cloudinary Free delivery URLs are public-by-link, so never store sensitive photos.

### 3. Cloudflare Workers AI Free

1. Create a Cloudflare account and open **Workers AI**.
2. Copy the Account ID.
3. Create an API token with permission to run Workers AI.
4. Add it to `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Cloudflare performs clothing image recognition. If its daily free allocation is
exhausted, the API automatically uses local category, colour, and naming logic.
The same account generates optional outfit previews with the three garment
images as references using `CLOUDFLARE_IMAGE_MODEL`. Requests stop rather than
charging when the Workers AI free allocation is exhausted.

### 4. Tavily Researcher

1. Create a Tavily account and stay on the free **Researcher** plan.
2. No credit card is required for its 1,000 monthly API credits.
3. Create a key and add it to `TAVILY_API_KEY`.

Only reachable retailer pages with an extracted product image are returned.
Shopping recommendations additionally require a visible price. Results are
cached for 12 hours, and every search explicitly uses basic depth so it consumes
one credit instead of automatically upgrading to a two-credit advanced search.

## Phone testing

Expo Go cannot reach your computer through `localhost`. Find your computer's LAN
IP and set, for example:

```dotenv
EXPO_PUBLIC_CLOTHING_AI_URL=http://192.168.1.25:8787
```

Restart `npm start` after every `.env` change. Keep `.env` private and never put
server credentials in an `EXPO_PUBLIC_*` variable.

## Service behavior

- Firebase: email/password accounts, persistent sessions, realtime private data
- Cloudinary: signed server uploads, intact garment images, and generated outfit previews
- Cloudflare: image metadata and optional outfit reranking
- Tavily: verified Canadian product pages, images, retailers, and prices
- Cloudflare FLUX: optional reference-based outfit visualization within the daily free allocation
- Local fallbacks: image optimization, outfit scoring,
  wardrobe insights, and on-device demo persistence

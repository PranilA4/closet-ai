# ClosetAI Hackathon Deployment

The Expo client and Node API deploy separately. Firebase, Cloudinary, Cloudflare,
and Tavily are already hosted services; only `server/index.mjs` needs a public API
host.

## 1. Prepare the API

1. Create a small Vultr Cloud Compute instance with Docker installed.
2. Point an `A` record such as `api.example.com` to the server IP.
3. Allow inbound TCP ports `22`, `80`, and `443` in the Vultr Firewall.
4. Put the project on the server and keep the real `.env` out of Git.
5. Set `API_DOMAIN=api.example.com` in `.env`.
6. Start the API from the project root:

   ```bash
   docker compose -f deploy/docker-compose.yml up -d --build
   ```

7. Verify `https://api.example.com/api/health` before building the client.

Caddy obtains and renews HTTPS certificates automatically after DNS resolves.

## 2. Point the App at Production

Set this before exporting or building the app:

```dotenv
EXPO_PUBLIC_CLOTHING_AI_URL=https://api.example.com
```

Restart Expo after changing any `EXPO_PUBLIC_*` value.

## 3. Distribute the App

For a judge-ready mobile install:

```bash
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile preview --platform ios
```

For the web version:

```bash
npx expo export --platform web
```

Deploy the generated `dist` directory to EAS Hosting, Netlify, or another static
host. The public web build and phone builds must all use the HTTPS API URL.

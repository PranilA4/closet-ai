# Test ClosetAI in Expo Go

## Start the Phone Session

1. Connect the Mac and phone to the same Wi-Fi network.
2. Stop any existing ClosetAI or Expo terminal with `Ctrl+C`.
3. From the project directory, run:

   ```bash
   npm run phone
   ```

4. The command detects the Mac's current LAN address, starts the API on port
   `8787`, starts Expo in LAN mode on port `8081`, and prints a QR code.

If Expo Go reports that it cannot connect to Expo CLI on public, school, or
hackathon Wi-Fi, stop the command with `Ctrl+C` and use:

```bash
npm run phone:tunnel
```

The tunnel keeps the Expo bundle reachable without USB debugging. Firebase
accounts connect directly to Firebase, while clothing analysis and image
features use the same Expo tunnel through `/closet-api`. The phone does not need
direct access to port `8787` in tunnel mode.

## Confirm the Network Before Scanning

Open the printed health URL in Safari or Chrome on the phone. It looks like:

```text
http://192.168.x.x:8787/api/health
```

Continue only if the phone displays JSON containing `"ok": true`. This proves
the phone can reach the backend and avoids confusing API failures with Expo
connection failures.

## Open the App

1. Install or update **Expo Go** from the App Store or Google Play.
2. iPhone: scan the terminal QR code with the Camera app, then open Expo Go.
3. Android: open Expo Go and use **Scan QR code**.
4. Allow Camera and Photos permissions when ClosetAI asks.

## Test Checklist

1. Create an account or sign in.
2. Add clothing using the physical camera.
3. Confirm the item remains after refreshing, signing out, and signing in.
4. Edit the item and toggle Clean/Worn.
5. Generate an outfit and an AI preview.
6. Mark the outfit worn and confirm all three items become worn.
7. Open Insights and request Pieces Worth Adding.

## If the Phone Cannot Open the Health URL

- Verify both devices are on the same Wi-Fi and disable cellular data briefly.
- Turn off VPN, iCloud Private Relay, or similar network relays while testing.
- In macOS **System Settings > Network > Firewall**, allow incoming connections
  for Node if prompted.
- Public, school, and hackathon Wi-Fi can block device-to-device traffic. Use a
  personal hotspot or deploy the API to HTTPS and run:

  ```bash
  CLOSET_API_URL=https://your-api-domain.example npm run phone
  ```

Expo's `--tunnel` option only tunnels Metro. It does not make the local API on
port `8787` public, so the API needs its own public HTTPS URL when LAN access is
blocked.

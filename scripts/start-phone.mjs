import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';

const apiPort = Number(process.env.PORT || 8787);
const metroPort = 8081;
const checkOnly = process.argv.includes('--check');
const tunnel = process.argv.includes('--tunnel');

function privateIpv4() {
  const interfaces = networkInterfaces();
  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((address) => address.family === 'IPv4' && !address.internal)
      .map((address) => ({ name, address: address.address })),
  );
  return candidates.find((entry) => entry.name === 'en0' && isPrivate(entry.address))?.address ??
    candidates.find((entry) => isPrivate(entry.address))?.address ??
    candidates[0]?.address;
}

function isPrivate(address) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

async function validApi(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2500) });
    const body = await response.json();
    return response.ok && String(body.apiVersion ?? '').startsWith('closetai-');
  } catch {
    return false;
  }
}

async function waitForApi(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await validApi(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const lanIp = privateIpv4();
if (!lanIp) {
  console.error('No LAN address was found. Connect the Mac to Wi-Fi, then rerun npm run phone.');
  process.exit(1);
}

const localApiUrl = `http://${lanIp}:${apiPort}`;
const apiUrl = process.env.CLOSET_API_URL || localApiUrl;

console.log('\nClosetAI physical-phone setup');
console.log(`Mac LAN address: ${lanIp}`);
console.log(`Phone API URL:   ${apiUrl}`);
console.log(`Phone health:    ${apiUrl}/api/health`);
console.log(`Expo connection: ${tunnel ? 'Tunnel (public Wi-Fi friendly)' : 'LAN'}`);
console.log('Both devices must be on the same Wi-Fi unless CLOSET_API_URL is a public HTTPS address.\n');

if (checkOnly) {
  const reachable = await validApi(apiUrl);
  console.log(reachable
    ? 'API check passed. Open the health URL in your phone browser to confirm device-to-Mac access.'
    : 'API is not reachable yet. Run npm run phone to start it.');
  process.exit(reachable ? 0 : 1);
}

if (await portOpen(metroPort)) {
  console.error(`Expo is already using port ${metroPort}. Stop the old npm/Expo terminal with Ctrl+C, then rerun npm run phone.`);
  process.exit(1);
}

const childEnvironment = {
  ...process.env,
  // In tunnel mode the native client rewrites localhost to Metro's public
  // /closet-api proxy. This exposes both the bundle and API through one tunnel.
  EXPO_PUBLIC_CLOTHING_AI_URL: tunnel ? `http://localhost:${apiPort}` : apiUrl,
  ...(tunnel ? {} : { REACT_NATIVE_PACKAGER_HOSTNAME: lanIp }),
};
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const localApiAlreadyRunning = await validApi(localApiUrl);
if (!process.env.CLOSET_API_URL && !localApiAlreadyRunning) {
  const api = spawn(process.execPath, ['--watch', 'server/index.mjs'], {
    env: childEnvironment,
    stdio: 'inherit',
  });
  children.push(api);
  api.once('exit', (code) => { if (!stopping && code) stop(code); });
  if (!(await waitForApi(localApiUrl))) {
    console.error(`The API did not start on ${localApiUrl}. Check port ${apiPort} and the server logs above.`);
    stop(1);
  }
} else if (!process.env.CLOSET_API_URL) {
  console.log(`Reusing the ClosetAI API already running on port ${apiPort}.`);
}

const expoCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const expo = spawn(expoCommand, ['expo', 'start', tunnel ? '--tunnel' : '--lan', '--clear', '--port', String(metroPort)], {
  env: childEnvironment,
  stdio: 'inherit',
});
children.push(expo);
expo.once('exit', (code) => stop(code ?? 0));

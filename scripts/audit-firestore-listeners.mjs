import fs from 'node:fs';

const repositoryPath = new URL('../services/closetRepository.ts', import.meta.url);
const source = fs.readFileSync(repositoryPath, 'utf8');
const listenerCallbacks = [...source.matchAll(/onSnapshot\([\s\S]*?\}, \(error\) => \{/g)];
const forbiddenMutation = /\b(?:setDoc|deleteDoc|writeBatch|addDoc|updateDoc|runTransaction|queueCloudForUser|queueCloudWrite)\s*\(/;

if (!listenerCallbacks.length) {
  throw new Error('Firestore listener audit found no onSnapshot callbacks to inspect.');
}

for (const callback of listenerCallbacks) {
  const mutation = callback[0].match(forbiddenMutation);
  if (mutation) {
    throw new Error(`Firestore listener callback contains forbidden mutation: ${mutation[0]}`);
  }
}

console.log(`Firestore listener audit passed (${listenerCallbacks.length} read-only listeners).`);

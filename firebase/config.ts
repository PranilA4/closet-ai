import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  getAuth,
  initializeAuth,
  Persistence,
} from 'firebase/auth';
import * as FirebaseAuth from 'firebase/auth';
import { Firestore, getFirestore, initializeFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseReady = Object.values(firebaseConfig).every(Boolean);
export const firestoreReady = firebaseReady;

let app: FirebaseApp | null = null;
let configuredAuth: Auth | null = null;
let firestore: Firestore | null = null;

if (firebaseReady) {
  app = getApps()[0] ?? initializeApp(firebaseConfig);
  try {
    const reactNativePersistence = (
      FirebaseAuth as typeof FirebaseAuth & {
        getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
      }
    ).getReactNativePersistence;
    configuredAuth = initializeAuth(app, {
      persistence:
        Platform.OS === 'web'
          ? browserLocalPersistence
          : reactNativePersistence(AsyncStorage),
    });
  } catch {
    configuredAuth = getAuth(app);
  }
  try {
    firestore = Platform.OS === 'web'
      ? getFirestore(app)
      : initializeFirestore(app, {
          // Expo Go and some public/mobile networks buffer Firestore's WebChannel
          // stream. Long polling is slower, but far more reliable on those links.
          experimentalForceLongPolling: true,
        });
  } catch {
    // Fast refresh can initialize Firestore before this module is re-evaluated.
    firestore = getFirestore(app);
  }
}

export const firebaseApp = app;
export const auth = configuredAuth;
export const db = firestore;

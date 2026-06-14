import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth, firebaseReady } from '../firebase/config';
import { ClosetUser } from '../types';

export const demoUser: ClosetUser = {
  uid: 'closetai-demo-user',
  email: 'demo@closetai.local',
  demo: true,
};

const toClosetUser = (user: User): ClosetUser => ({
  uid: user.uid,
  email: user.email,
});

export function observeAuth(callback: (user: ClosetUser | null) => void) {
  if (!firebaseReady || !auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, (user) => callback(user ? toClosetUser(user) : null));
}

export async function createAccount(email: string, password: string) {
  if (!auth) throw new Error('Firebase is not configured.');
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  return toClosetUser(result.user);
}

export async function signIn(email: string, password: string) {
  if (!auth) throw new Error('Firebase is not configured.');
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  return toClosetUser(result.user);
}

export async function resetPassword(email: string) {
  if (!auth) throw new Error('Firebase is not configured.');
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOutUser() {
  if (auth) await signOut(auth);
}

export async function getAuthToken() {
  return auth?.currentUser?.getIdToken() ?? null;
}

export function getAuthErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/configuration-not-found') {
      return 'Firebase Authentication is not enabled. In Firebase Console, open Authentication, click Get started, then enable Email/Password under Sign-in method.';
    }
    if (error.code === 'auth/invalid-credential') {
      return 'The email or password is incorrect.';
    }
    if (error.code === 'auth/email-already-in-use') {
      return 'An account already exists for this email. Try signing in instead.';
    }
    if (error.code === 'auth/weak-password') {
      return 'Use a password with at least six characters.';
    }
    if (error.code === 'auth/invalid-email') {
      return 'Enter a valid email address.';
    }
    if (error.code === 'auth/too-many-requests') {
      return 'Too many attempts. Wait a moment and try again.';
    }
  }
  return error instanceof Error
    ? error.message.replace('Firebase: ', '')
    : 'Authentication failed.';
}

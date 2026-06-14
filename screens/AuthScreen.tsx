import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  createAccount,
  getAuthErrorMessage,
  resetPassword,
  signIn,
} from '../services/authService';
import { colors, shadows } from '../theme';
import { BrandLogo } from '../components/BrandLogo';
import { MotionPressable } from '../components/MotionPressable';

type Props = { firebaseConfigured: boolean; onDemo: () => void };
type Mode = 'sign-in' | 'create' | 'reset';

export function AuthScreen({ firebaseConfigured, onDemo }: Props) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'reset') {
        await resetPassword(email);
        setMessage('Password reset email sent.');
      } else if (mode === 'create') {
        await createAccount(email, password);
      } else {
        await signIn(email, password);
      }
    } catch (error) {
      setMessage(getAuthErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={['#F3E5D1', '#E9D2B5', '#F1CBAF']} style={styles.page}>
      <View style={styles.art}>
        <View style={styles.artRing} />
        <View style={styles.hanger}><View style={styles.hangerBar} /></View>
      </View>
      <View style={[styles.card, shadows.card]}>
        <BrandLogo />
        <Text style={styles.eyebrow}>YOUR PERSONAL STYLE SYSTEM</Text>
        <Text style={styles.title}>{mode === 'create' ? 'Build your closet.' : mode === 'reset' ? 'Reset access.' : 'Welcome back.'}</Text>
        <Text style={styles.subtitle}>Your wardrobe, outfit history, and preferences stay private to your account.</Text>

        {!firebaseConfigured && (
          <View style={styles.setupNote}>
            <Text style={styles.setupText}>Firebase is not configured yet. Use demo mode now, then add the Firebase values from .env.example.</Text>
          </View>
        )}

        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor={colors.muted} style={styles.input} />
        {mode !== 'reset' && <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor={colors.muted} style={styles.input} />}
        {!!message && <Text style={styles.message}>{message}</Text>}

        <MotionPressable disabled={busy || !firebaseConfigured} onPress={submit} containerStyle={styles.primaryMotion}>
          <View style={[styles.primary, (!firebaseConfigured || busy) && styles.disabled]}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{mode === 'create' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'}</Text>}
          </View>
        </MotionPressable>

        <View style={styles.links}>
          <Pressable onPress={() => setMode(mode === 'create' ? 'sign-in' : 'create')}><Text style={styles.link}>{mode === 'create' ? 'Already have an account?' : 'Create account'}</Text></Pressable>
          <Pressable onPress={() => setMode(mode === 'reset' ? 'sign-in' : 'reset')}><Text style={styles.link}>{mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}</Text></Pressable>
        </View>
        {!firebaseConfigured && <Pressable onPress={onDemo} style={styles.demo}><Text style={styles.demoText}>Continue in demo mode</Text></Pressable>}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  art: { position: 'absolute', top: 40, right: -30, width: 190, height: 190, alignItems: 'center', justifyContent: 'center' },
  artRing: { position: 'absolute', width: 190, height: 190, borderWidth: 1, borderColor: 'rgba(49,95,73,0.25)', borderRadius: 100 },
  hanger: { width: 90, height: 55, borderLeftWidth: 3, borderRightWidth: 3, borderBottomWidth: 3, borderColor: colors.green, transform: [{ rotate: '45deg' }] },
  hangerBar: { position: 'absolute', top: -30, left: 39, width: 12, height: 32, borderLeftWidth: 3, borderTopWidth: 3, borderColor: colors.green, borderTopLeftRadius: 9 },
  card: { width: '100%', maxWidth: 440, padding: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 30, backgroundColor: 'rgba(255,252,247,0.96)' },
  eyebrow: { marginTop: 28, color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { marginTop: 8, color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1.2 },
  subtitle: { marginTop: 10, marginBottom: 15, color: colors.muted, fontSize: 13, lineHeight: 19 },
  setupNote: { marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: colors.goldSoft },
  setupText: { color: '#78591F', fontSize: 11, lineHeight: 16 },
  input: { height: 52, marginTop: 10, paddingHorizontal: 15, borderWidth: 1, borderColor: colors.line, borderRadius: 14, color: colors.ink, backgroundColor: '#FFFFFF', fontSize: 14 },
  message: { marginTop: 10, color: colors.dirty, fontSize: 11, lineHeight: 16 },
  primaryMotion: { marginTop: 16 },
  primary: { height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.ink },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.985 }] },
  links: { marginTop: 16, flexDirection: 'row', justifyContent: 'space-between' },
  link: { color: colors.green, fontSize: 11, fontWeight: '800' },
  demo: { marginTop: 18, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 13 },
  demoText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
});

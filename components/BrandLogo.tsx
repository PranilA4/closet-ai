import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export function BrandLogo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <View style={styles.row}>
      <Image source={require('../assets/closetai-logo.png')} style={[styles.mark, compact && styles.markCompact]} resizeMode="cover" />
      <View>
        <Text style={[styles.wordmark, compact && styles.wordmarkCompact, light && styles.light]}>Closet<Text style={styles.accent}>AI</Text></Text>
        {!compact && <Text style={[styles.tagline, light && styles.lightSoft]}>YOUR WARDROBE, REMIXED</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: { width: 42, height: 42, borderRadius: 14 },
  markCompact: { width: 34, height: 34, borderRadius: 11 },
  wordmark: { color: colors.ink, fontSize: 23, fontWeight: '900', letterSpacing: -1.1 },
  wordmarkCompact: { fontSize: 21 },
  accent: { color: colors.green },
  tagline: { marginTop: 1, color: colors.gold, fontSize: 6, fontWeight: '900', letterSpacing: 1.2 },
  light: { color: '#FFFFFF' },
  lightSoft: { color: '#EADBC7' },
});

import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenEntrance } from '../components/ScreenEntrance';
import { BrandLogo } from '../components/BrandLogo';
import { MotionPressable } from '../components/MotionPressable';
import { colors, shadows } from '../theme';
import { ClothingItem, OutfitHistory, ScreenName } from '../types';

type Props = { wardrobe: ClothingItem[]; history: OutfitHistory[]; onNavigate: (screen: ScreenName) => void };

export function HomeScreen({ wardrobe, history, onNavigate }: Props) {
  const cleanCount = wardrobe.filter((item) => item.clean).length;
  const wornCount = history.filter((entry) => entry.wornAt).length;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenEntrance>
        <LinearGradient colors={['#E1E9DE', '#F1E4D4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroOrb} /><View style={styles.heroOrbSmall} /><View style={styles.runwayOne} /><View style={styles.runwayTwo} /><BrandLogo compact /><Text style={styles.eyebrow}>YOUR DIGITAL WARDROBE</Text><Text style={styles.title}>More Outfits.{`\n`}Less Guessing.</Text><Text style={styles.subtitle}>Build a private closet, get smarter recommendations, and learn what is actually worth adding next.</Text>
          <MotionPressable containerStyle={styles.primaryMotion} onPress={() => onNavigate('outfit')} hoverScale={1.02}><View style={styles.primaryButton}><Text style={styles.primaryText}>Style an Outfit</Text><Text style={styles.arrow}>-&gt;</Text></View></MotionPressable>
        </LinearGradient>

        <View style={[styles.stats, shadows.card]}>
          <View style={styles.stat}><Text style={styles.statValue}>{wardrobe.length}</Text><Text style={styles.statLabel}>PIECES</Text></View><View style={styles.divider} /><View style={styles.stat}><Text style={styles.statValue}>{cleanCount}</Text><Text style={styles.statLabel}>READY</Text></View><View style={styles.divider} /><View style={styles.stat}><Text style={styles.statValue}>{wornCount}</Text><Text style={styles.statLabel}>FITS WORN</Text></View>
        </View>

        <View style={styles.cards}>
          <MotionPressable onPress={() => onNavigate('wardrobe')} hoverLift={6} hoverScale={1.02}><LinearGradient colors={['#E7C8A2', '#D8AD7E']} style={[styles.actionCard, styles.closetCard]}><View style={styles.cardStripe} /><Text style={styles.cardEyebrow}>THE WARDROBE ROOM</Text><Text style={styles.cardTitle}>Slide Through Every Rail</Text><Text style={styles.cardText}>Browse tops, bottoms, and shoes in horizontal wardrobe panes.</Text><View style={styles.cardMark}><Text style={styles.cardMarkText}>01</Text></View></LinearGradient></MotionPressable>
          <MotionPressable onPress={() => onNavigate('insights')} hoverLift={6} hoverScale={1.02}><LinearGradient colors={['#F3E3C5', '#E9CBA4']} style={[styles.actionCard, styles.insightCard]}><View style={[styles.cardStripe, styles.cardStripeGold]} /><Text style={styles.cardEyebrow}>WARDROBE IQ</Text><Text style={styles.cardTitle}>Find What Is Missing</Text><Text style={styles.cardText}>Discover real additions, teach the recommender, and unlock more outfits.</Text><View style={styles.cardMark}><Text style={styles.cardMarkText}>AI</Text></View></LinearGradient></MotionPressable>
        </View>
      </ScreenEntrance>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 60 },
  hero: { marginTop: 16, minHeight: 350, overflow: 'hidden', padding: 25, borderRadius: 30 },
  heroOrb: { position: 'absolute', right: -45, top: -35, width: 210, height: 210, borderWidth: 35, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 110 },
  heroOrbSmall: { position: 'absolute', right: 35, bottom: -55, width: 150, height: 150, borderRadius: 80, backgroundColor: 'rgba(112,76,94,0.10)' },
  runwayOne: { position: 'absolute', right: 70, top: 110, width: 2, height: 260, backgroundColor: 'rgba(49,95,73,0.13)', transform: [{ rotate: '18deg' }] },
  runwayTwo: { position: 'absolute', right: 115, top: 100, width: 2, height: 260, backgroundColor: 'rgba(195,138,59,0.16)', transform: [{ rotate: '18deg' }] },
  eyebrow: { marginTop: 25, color: colors.green, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { marginTop: 16, color: colors.ink, fontSize: 45, fontWeight: '900', lineHeight: 46, letterSpacing: -2 },
  subtitle: { maxWidth: 340, marginTop: 16, color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  primaryMotion: { marginTop: 27 },
  primaryButton: { padding: 17, flexDirection: 'row', justifyContent: 'space-between', borderRadius: 17, backgroundColor: colors.ink },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  arrow: { color: colors.peach, fontSize: 18, fontWeight: '900' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  stats: { marginTop: 14, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.card },
  stat: { alignItems: 'center' },
  statValue: { color: colors.ink, fontSize: 25, fontWeight: '900' },
  statLabel: { marginTop: 3, color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  divider: { width: 1, height: 34, backgroundColor: colors.line },
  cards: { marginTop: 14, gap: 12 },
  actionCard: { minHeight: 155, overflow: 'hidden', padding: 20, borderRadius: 23 },
  closetCard: { backgroundColor: colors.greenSoft },
  insightCard: { backgroundColor: colors.goldSoft },
  cardEyebrow: { color: colors.green, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  cardTitle: { marginTop: 10, color: colors.ink, fontSize: 21, fontWeight: '900' },
  cardText: { maxWidth: 290, marginTop: 7, color: colors.muted, fontSize: 11, lineHeight: 17 },
  cardMark: { position: 'absolute', right: 18, bottom: 16, width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.65)' },
  cardMarkText: { color: colors.green, fontSize: 12, fontWeight: '900' },
  cardStripe: { position: 'absolute', right: 85, top: -20, width: 24, height: 220, backgroundColor: 'rgba(255,255,255,0.22)', transform: [{ rotate: '18deg' }] },
  cardStripeGold: { right: 115, backgroundColor: 'rgba(112,76,94,0.10)' },
});

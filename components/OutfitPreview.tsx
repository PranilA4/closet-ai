import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, shadows } from '../theme';
import { Outfit } from '../types';
import { titleCase } from '../utils/text';

type Props = { outfit: Outfit; loading?: boolean; error?: string; onGenerate?: () => void };

export function OutfitPreview({ outfit, loading = false, error = '', onGenerate }: Props) {
  const reveal = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    reveal.setValue(0);
    scale.setValue(1);
    setZoom(1);
    Animated.spring(reveal, { toValue: 1, useNativeDriver: true, damping: 17, stiffness: 105 }).start();
  }, [outfit.id, outfit.previewImageUri, reveal, scale]);

  const changeZoom = (next: number) => {
    const bounded = Math.max(0.7, Math.min(2.5, Math.round(next * 10) / 10));
    setZoom(bounded);
    Animated.spring(scale, {
      toValue: bounded,
      useNativeDriver: true,
      damping: 17,
      stiffness: 150,
    }).start();
  };

  return (
    <View style={[styles.card, shadows.card]}>
      <View style={styles.stage}>
        {outfit.previewImageUri ? (
          <Animated.Image
            source={{ uri: outfit.previewImageUri }}
            style={[styles.generatedImage, { opacity: reveal, transform: [{ scale }] }]}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.referenceStage}>
            <Text style={styles.referenceTitle}>OUTFIT REFERENCES</Text>
            <View style={styles.referenceRow}>
              {[outfit.top, outfit.bottom, outfit.shoes].map((item) => (
                <View key={item.id} style={styles.referenceCard}>
                  <Image source={{ uri: item.imageUri }} style={styles.referenceImage} resizeMode="contain" />
                  <Text style={styles.referenceName} numberOfLines={2}>{item.name}</Text>
                </View>
              ))}
            </View>
            {loading ? <View style={styles.status}><ActivityIndicator color={colors.green} /><Text style={styles.statusText}>AI is styling these pieces into one look...</Text></View> : null}
            {!loading && onGenerate ? <Pressable onPress={onGenerate} style={({ pressed }) => [styles.generateButton, pressed && styles.generatePressed]}><Text style={styles.generateText}>Generate AI outfit image</Text><Text style={styles.generateSub}>Cloudflare free-tier FLUX</Text></Pressable> : null}
            {!loading && error ? <Text style={styles.errorText}>{error} Showing the original product images instead.</Text> : null}
          </View>
        )}
        <View style={styles.fitLabel}><Text style={styles.fitLabelText}>{outfit.previewImageUri ? 'AI FIT' : 'SOURCE PIECES'} / {outfit.occasion === 'any' ? 'BEST' : outfit.occasion.toUpperCase()}</Text></View>
        {outfit.previewImageUri ? (
          <View style={styles.zoomControls}>
            <Pressable accessibilityLabel="Zoom outfit image out" onPress={() => changeZoom(zoom - 0.2)} style={({ pressed }) => [styles.zoomButton, pressed && styles.generatePressed]}><Text style={styles.zoomButtonText}>-</Text></Pressable>
            <Pressable accessibilityLabel="Reset outfit image zoom" onPress={() => changeZoom(1)} style={({ pressed }) => [styles.zoomValue, pressed && styles.generatePressed]}><Text style={styles.zoomValueText}>{Math.round(zoom * 100)}%</Text></Pressable>
            <Pressable accessibilityLabel="Zoom outfit image in" onPress={() => changeZoom(zoom + 0.2)} style={({ pressed }) => [styles.zoomButton, pressed && styles.generatePressed]}><Text style={styles.zoomButtonText}>+</Text></Pressable>
          </View>
        ) : null}
      </View>
      <View style={styles.legend}>
        <View style={styles.trendRow}><Text style={styles.lookName}>{titleCase(outfit.trend)}</Text><View style={styles.cleanBadge}><Text style={styles.cleanBadgeText}>ALL CLEAN</Text></View></View>
        <Text style={styles.lookPieces}>{titleCase(outfit.top.name)} / {titleCase(outfit.bottom.name)} / {titleCase(outfit.shoes.name)}</Text>
        <Text style={styles.reason}>{outfit.reason}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderWidth: 1, borderColor: colors.line, borderRadius: 28, backgroundColor: '#FFFFFF' },
  stage: { minHeight: 470, overflow: 'hidden', backgroundColor: '#F3F0E9' },
  generatedImage: { width: '100%', height: 560, backgroundColor: '#F3F0E9' },
  referenceStage: { minHeight: 470, padding: 22, alignItems: 'center', justifyContent: 'center' },
  referenceTitle: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  referenceRow: { width: '100%', marginTop: 22, flexDirection: 'row', gap: 8 },
  referenceCard: { flex: 1, minWidth: 0, padding: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: '#FFFFFF' },
  referenceImage: { width: '100%', height: 180 },
  referenceName: { minHeight: 28, marginTop: 7, color: colors.inkSoft, fontSize: 9, lineHeight: 13, textAlign: 'center', fontWeight: '800' },
  status: { marginTop: 24, alignItems: 'center', gap: 9 },
  statusText: { color: colors.muted, fontSize: 10, textAlign: 'center' },
  generateButton: { marginTop: 22, minWidth: 220, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', borderRadius: 14, backgroundColor: colors.green },
  generatePressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  generateText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  generateSub: { marginTop: 3, color: '#E8F1EC', fontSize: 8 },
  errorText: { marginTop: 22, maxWidth: 340, color: colors.dirty, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  fitLabel: { position: 'absolute', top: 17, right: 17, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.ink },
  fitLabelText: { color: '#FFFFFF', fontSize: 7, fontWeight: '900', letterSpacing: 0.6 },
  zoomControls: { position: 'absolute', right: 14, bottom: 14, padding: 4, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 14, backgroundColor: 'rgba(29,35,32,0.88)' },
  zoomButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)' },
  zoomButtonText: { color: '#FFFFFF', fontSize: 20, lineHeight: 22, fontWeight: '800' },
  zoomValue: { minWidth: 54, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  zoomValueText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  legend: { padding: 18, borderTopWidth: 1, borderTopColor: colors.line },
  trendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  lookName: { flex: 1, color: colors.ink, fontSize: 19, fontWeight: '900' },
  cleanBadge: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.greenSoft },
  cleanBadgeText: { color: colors.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  lookPieces: { marginTop: 6, color: colors.gold, fontSize: 10, lineHeight: 16 },
  reason: { marginTop: 11, color: colors.inkSoft, fontSize: 11, lineHeight: 17 },
});

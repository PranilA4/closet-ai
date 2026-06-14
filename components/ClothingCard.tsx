import { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, shadows } from '../theme';
import { ClothingItem } from '../types';
import { titleCase } from '../utils/text';

type Props = {
  item: ClothingItem;
  width: number;
  index: number;
  onToggleClean: (id: string) => void;
  onEdit: (item: ClothingItem) => void;
  onDelete: (item: ClothingItem) => void;
};

export function ClothingCard({ item, width, index, onToggleClean, onEdit, onDelete }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const entrance = useRef(new Animated.Value(0)).current;
  const statusPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(entrance, {
      toValue: 1,
      delay: Math.min(index, 9) * 55,
      useNativeDriver: true,
      damping: 16,
      stiffness: 130,
    }).start();
  }, [entrance, index]);

  useEffect(() => {
    Animated.sequence([
      Animated.spring(statusPulse, { toValue: 1.45, useNativeDriver: true, speed: 28 }),
      Animated.spring(statusPulse, { toValue: 1, useNativeDriver: true, speed: 22 }),
    ]).start();
  }, [item.clean, statusPulse]);

  const press = (toValue: number) => Animated.spring(scale, {
    toValue,
    useNativeDriver: true,
    speed: 22,
    bounciness: 4,
  }).start();

  return (
    <Animated.View
      style={[
        styles.card,
        shadows.card,
        {
          width,
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            { scale },
          ],
        },
      ]}
    >
      <Pressable style={styles.imageWrap} onPress={() => onEdit(item)} onHoverIn={() => press(1.035)} onHoverOut={() => press(1)} onPressIn={() => press(0.96)} onPressOut={() => press(1)}>
        <Image source={{ uri: item.imageUri }} style={styles.image} resizeMode="contain" />
        <Animated.View
          accessibilityLabel={item.clean ? 'Clean and ready to wear' : 'Worn and waiting for laundry'}
          style={[
            styles.statusDot,
            item.clean ? styles.cleanDot : styles.wornDot,
            { transform: [{ scale: statusPulse }] },
          ]}
        />
        <Pressable hitSlop={8} onPress={() => onDelete(item)} style={styles.deleteButton}><Text style={styles.deleteText}>x</Text></Pressable>
      </Pressable>
      <View style={styles.content}>
        <Text style={styles.category}>{item.category.toUpperCase()}</Text>
        <Text style={styles.name} numberOfLines={2}>{titleCase(item.name)}</Text>
        <Text style={styles.color} numberOfLines={1}>{item.color}</Text>
        <View style={styles.actions}>
          <Pressable onPress={() => onToggleClean(item.id)} style={({ pressed }) => [styles.action, !item.clean && styles.cleanAction, pressed && styles.pressed]}>
            <Text style={[styles.actionText, !item.clean && styles.cleanActionText]}>{item.clean ? 'Wear' : 'Clean'}</Text>
          </Pressable>
          <Pressable onPress={() => onEdit(item)} style={({ pressed }) => [styles.edit, pressed && styles.pressed]}><Text style={styles.editText}>Edit</Text></Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  imageWrap: { height: 125, padding: 6, backgroundColor: '#EAD6BB' },
  image: { width: '100%', height: '100%', borderRadius: 11 },
  statusDot: { position: 'absolute', left: 9, top: 9, width: 16, height: 16, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 9, shadowColor: '#17211B', shadowOpacity: 0.25, shadowRadius: 3, elevation: 3 },
  cleanDot: { backgroundColor: '#4F936B' },
  wornDot: { backgroundColor: colors.dirty },
  deleteButton: { position: 'absolute', top: 7, right: 7, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(23,33,27,0.84)' },
  deleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', lineHeight: 15 },
  content: { minHeight: 116, padding: 9 },
  category: { color: colors.gold, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  name: { marginTop: 4, minHeight: 30, color: colors.ink, fontSize: 12, fontWeight: '900', lineHeight: 15 },
  color: { marginTop: 3, color: colors.muted, fontSize: 9 },
  actions: { marginTop: 9, flexDirection: 'row', gap: 5 },
  action: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 9, backgroundColor: '#EAD6BB' },
  cleanAction: { backgroundColor: colors.green },
  actionText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  cleanActionText: { color: '#FFFFFF' },
  edit: { paddingHorizontal: 8, paddingVertical: 7, borderWidth: 1, borderColor: colors.line, borderRadius: 9 },
  editText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});

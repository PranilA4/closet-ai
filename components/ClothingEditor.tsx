import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import {
  Category,
  ClothingStyle,
  Formality,
  GarmentType,
  NewClothingItem,
  OutfitOccasion,
} from '../types';

type Props = {
  item: NewClothingItem;
  onChange: (item: NewClothingItem) => void;
};

const categories: { label: string; value: Category }[] = [
  { label: 'Top', value: 'top' },
  { label: 'Bottom', value: 'bottom' },
  { label: 'Shoes', value: 'shoes' },
];

const stylesList: { label: string; value: ClothingStyle }[] = [
  { label: 'Casual', value: 'casual' },
  { label: 'Business', value: 'business' },
  { label: 'Sport', value: 'sport' },
  { label: 'Street', value: 'street' },
  { label: 'Classic', value: 'classic' },
];

const garmentTypes: { label: string; value: GarmentType }[] = [
  { label: 'T-shirt', value: 't-shirt' }, { label: 'Shirt', value: 'shirt' },
  { label: 'Blouse', value: 'blouse' }, { label: 'Sweater', value: 'sweater' },
  { label: 'Hoodie', value: 'hoodie' }, { label: 'Jacket', value: 'jacket' },
  { label: 'Blazer', value: 'blazer' }, { label: 'Jeans', value: 'jeans' },
  { label: 'Trousers', value: 'trousers' }, { label: 'Chinos', value: 'chinos' },
  { label: 'Shorts', value: 'shorts' }, { label: 'Skirt', value: 'skirt' },
  { label: 'Sweatpants', value: 'sweatpants' }, { label: 'Sneakers', value: 'sneakers' },
  { label: 'Athletic shoes', value: 'athletic-shoes' }, { label: 'Boots', value: 'boots' },
  { label: 'Loafers', value: 'loafers' }, { label: 'Dress shoes', value: 'dress-shoes' },
  { label: 'Heels', value: 'heels' }, { label: 'Other', value: 'other' },
];

const formalities: { label: string; value: Formality }[] = [
  { label: 'Relaxed', value: 'relaxed' },
  { label: 'Smart casual', value: 'smart-casual' },
  { label: 'Semi-formal', value: 'semi-formal' },
  { label: 'Formal', value: 'formal' },
];

const occasions: { label: string; value: OutfitOccasion }[] = [
  { label: 'Casual', value: 'casual' },
  { label: 'Formal', value: 'formal' },
  { label: 'Semi-formal', value: 'semi-formal' },
  { label: 'School', value: 'school' },
  { label: 'Work', value: 'work' },
  { label: 'Date night', value: 'date-night' },
  { label: 'Active', value: 'active' },
  { label: 'Streetwear', value: 'streetwear' },
];

export function ClothingEditor({ item, onChange }: Props) {
  const patch = (values: Partial<NewClothingItem>) => onChange({ ...item, ...values });
  const toggleOccasion = (occasion: OutfitOccasion) => {
    const next = item.occasions.includes(occasion)
      ? item.occasions.filter((value) => value !== occasion)
      : [...item.occasions, occasion];
    patch({ occasions: next.length ? next : [occasion] });
  };

  return (
    <View style={styles.form}>
      <Text style={styles.label}>ITEM NAME</Text>
      <TextInput
        value={item.name}
        onChangeText={(name) => patch({ name })}
        placeholder="Item name"
        placeholderTextColor="#9A9F9A"
        style={styles.input}
      />

      <Text style={styles.label}>COLOUR</Text>
      <TextInput
        value={item.color}
        onChangeText={(color) => patch({ color })}
        placeholder="e.g. Navy blue"
        placeholderTextColor="#9A9F9A"
        style={styles.input}
      />

      <Text style={styles.label}>CATEGORY</Text>
      <View style={styles.options}>
        {categories.map((option) => (
          <Option key={option.value} label={option.label} active={item.category === option.value} onPress={() => patch({ category: option.value })} />
        ))}
      </View>

      <Text style={styles.label}>STYLE</Text>
      <View style={styles.options}>
        {stylesList.map((option) => (
          <Option key={option.value} label={option.label} active={item.style === option.value} onPress={() => patch({ style: option.value })} />
        ))}
      </View>

      <Text style={styles.label}>FORMALITY</Text>
      <View style={styles.options}>
        {formalities.map((option) => (
          <Option key={option.value} label={option.label} active={item.formality === option.value} onPress={() => patch({ formality: option.value })} />
        ))}
      </View>

      <Text style={styles.label}>GARMENT TYPE</Text>
      <View style={styles.options}>
        {garmentTypes.map((option) => (
          <Option key={option.value} label={option.label} active={item.garmentType === option.value} onPress={() => patch({ garmentType: option.value })} />
        ))}
      </View>

      <Text style={styles.label}>GOOD FOR</Text>
      <View style={styles.options}>
        {occasions.map((option) => (
          <Option key={option.value} label={option.label} active={item.occasions.includes(option.value)} onPress={() => toggleOccasion(option.value)} />
        ))}
      </View>
    </View>
  );
}

function Option({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}>
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: 18 },
  label: { marginTop: 17, marginBottom: 8, color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  input: { height: 52, paddingHorizontal: 15, borderWidth: 1, borderColor: colors.line, borderRadius: 14, color: colors.ink, backgroundColor: colors.card, fontSize: 15 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minWidth: '30%', flexGrow: 1, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.card },
  optionActive: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  optionText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  optionTextActive: { color: colors.greenDark },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { ClothingCard } from '../components/ClothingCard';
import { MotionPressable } from '../components/MotionPressable';
import { ScreenEntrance } from '../components/ScreenEntrance';
import { colors, shadows } from '../theme';
import { Category, ClothingItem, ClothingStyle, OutfitOccasion } from '../types';

type Props = {
  wardrobe: ClothingItem[];
  onAdd: () => void;
  onToggleClean: (id: string) => void;
  onCleanAll: () => void;
  onEdit: (item: ClothingItem) => void;
  onDelete: (item: ClothingItem) => void;
};
type StatusFilter = 'all' | 'clean' | 'worn';

const panes: { category: Category; label: string; note: string; accent: string; symbol: string }[] = [
  { category: 'top', label: 'Tops Rail', note: 'Shirts, layers, knits, and tees', accent: '#B9D2C0', symbol: '01' },
  { category: 'bottom', label: 'Bottoms Rail', note: 'Denim, trousers, chinos, and more', accent: '#DCC7A8', symbol: '02' },
  { category: 'shoes', label: 'Shoe Shelf', note: 'The pairs that finish the look', accent: '#D5B7C7', symbol: '03' },
];

export function WardrobeScreen({ wardrobe, onAdd, onToggleClean, onCleanAll, onEdit, onDelete }: Props) {
  const { width } = useWindowDimensions();
  const compactHeader = width < 430;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colorsFilter, setColorsFilter] = useState<string[]>([]);
  const [stylesFilter, setStylesFilter] = useState<ClothingStyle[]>([]);
  const [occasionFilter, setOccasionFilter] = useState<OutfitOccasion[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<Category[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const filterProgress = useRef(new Animated.Value(0)).current;
  const contentWidth = Math.min(width - 28, 940);
  const cardWidth = width < 430 ? 142 : width < 720 ? 154 : 170;
  const cleanCount = wardrobe.filter((item) => item.clean).length;
  const colorsAvailable = useMemo(() => [...new Set(wardrobe.map((item) => item.color))].sort(), [wardrobe]);
  const stylesAvailable = useMemo(() => [...new Set(wardrobe.map((item) => item.style))], [wardrobe]);
  const occasionsAvailable = useMemo(() => [...new Set(wardrobe.flatMap((item) => item.occasions))], [wardrobe]);
  const activeCount = colorsFilter.length + stylesFilter.length + occasionFilter.length + categoryFilter.length + (statusFilter === 'all' ? 0 : 1);
  const filtered = useMemo(() => wardrobe.filter((item) =>
    (!colorsFilter.length || colorsFilter.includes(item.color)) &&
    (!stylesFilter.length || stylesFilter.includes(item.style)) &&
    (!occasionFilter.length || occasionFilter.some((occasion) => item.occasions.includes(occasion))) &&
    (!categoryFilter.length || categoryFilter.includes(item.category)) &&
    (statusFilter === 'all' || (statusFilter === 'clean' ? item.clean : !item.clean)),
  ), [categoryFilter, colorsFilter, occasionFilter, statusFilter, stylesFilter, wardrobe]);

  const toggleFilters = () => {
    const next = !filtersOpen;
    setFiltersOpen(next);
    Animated.spring(filterProgress, { toValue: next ? 1 : 0, useNativeDriver: true, damping: 18, stiffness: 150 }).start();
  };
  const toggle = <T,>(value: T, current: T[], setter: (next: T[]) => void) => setter(current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  const clearFilters = () => { setColorsFilter([]); setStylesFilter([]); setOccasionFilter([]); setCategoryFilter([]); setStatusFilter('all'); };
  const confirmDelete = (item: ClothingItem) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${item.name} from your wardrobe?`)) { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); onDelete(item); }
      return;
    }
    Alert.alert('Delete this piece?', `${item.name} will be removed from your wardrobe.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); onDelete(item); } },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <ScreenEntrance style={{ width: contentWidth }}>
        <View style={[styles.headingRow, compactHeader && styles.headingRowMobile]}>
          <View style={styles.headingCopy}><Text style={styles.eyebrow}>THE WARDROBE ROOM</Text><Text style={[styles.title, compactHeader && styles.titleMobile]}>Your Closet, Organized.</Text><Text style={styles.count}>{wardrobe.length} pieces / {cleanCount} ready to wear</Text></View>
          <MotionPressable onPress={onAdd} containerStyle={compactHeader && styles.addButtonMotionMobile}><View style={[styles.addButton, compactHeader && styles.addButtonMobile]}><Text style={styles.plus}>+</Text><Text style={styles.addText}>Add Piece</Text></View></MotionPressable>
        </View>

        <View style={styles.wardrobeIntro}>
          <View style={styles.introPattern}><View style={styles.patternLine} /><View style={[styles.patternLine, styles.patternLineTwo]} /></View>
          <Text style={styles.introLabel}>SLIDE THE RAILS</Text><Text style={styles.introText}>Swipe left and right inside each wardrobe pane. Tap any piece to edit it or ask what matches.</Text>
        </View>

        <View style={styles.toolbar}>
          <MotionPressable onPress={toggleFilters} containerStyle={styles.toolGrow} hoverLift={2}><View style={[styles.toolButton, filtersOpen && styles.toolButtonActive]}><Text style={[styles.toolText, filtersOpen && styles.toolTextActive]}>Filters{activeCount ? ` (${activeCount})` : ''}</Text></View></MotionPressable>
          <MotionPressable disabled={cleanCount === wardrobe.length} onPress={onCleanAll} containerStyle={styles.toolGrow} hoverLift={2}><View style={[styles.toolButton, styles.cleanAllButton, cleanCount === wardrobe.length && styles.disabled]}><Text style={styles.cleanAllText}>Clean All</Text></View></MotionPressable>
        </View>

        {filtersOpen && <Animated.View style={[styles.filterPanel, { opacity: filterProgress, transform: [{ translateY: filterProgress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}>
          <FilterGroup title="STATUS" values={['all', 'clean', 'worn']} active={[statusFilter]} onToggle={(value) => setStatusFilter(value as StatusFilter)} />
          <FilterGroup title="CATEGORY" values={['top', 'bottom', 'shoes']} active={categoryFilter} onToggle={(value) => toggle(value as Category, categoryFilter, setCategoryFilter)} />
          <FilterGroup title="COLOUR" values={colorsAvailable} active={colorsFilter} onToggle={(value) => toggle(value, colorsFilter, setColorsFilter)} />
          <FilterGroup title="STYLE" values={stylesAvailable} active={stylesFilter} onToggle={(value) => toggle(value as ClothingStyle, stylesFilter, setStylesFilter)} />
          <FilterGroup title="OCCASION" values={occasionsAvailable} active={occasionFilter} onToggle={(value) => toggle(value as OutfitOccasion, occasionFilter, setOccasionFilter)} />
          <Pressable onPress={clearFilters} style={styles.clearButton}><Text style={styles.clearText}>Clear all filters</Text></Pressable>
        </Animated.View>}

        {!wardrobe.length ? <View style={[styles.empty, shadows.card]}><View style={styles.emptyDoors}><View style={styles.emptyDoor} /><View style={styles.emptyDoor} /></View><Text style={styles.emptyTitle}>Your Wardrobe Is Waiting.</Text><Text style={styles.emptyText}>Add a top, bottom, and shoes to build your first outfit.</Text><MotionPressable onPress={onAdd} containerStyle={styles.emptyButtonMotion}><View style={styles.emptyButton}><Text style={styles.emptyButtonText}>Add First Piece</Text></View></MotionPressable></View> : panes.map((pane, paneIndex) => {
          const items = filtered.filter((item) => item.category === pane.category);
          return <WardrobePane key={pane.category} {...pane} items={items} cardWidth={cardWidth} indexOffset={paneIndex * 10} onEdit={onEdit} onToggleClean={onToggleClean} onDelete={confirmDelete} filtered={activeCount > 0} />;
        })}

        {!!wardrobe.length && !filtered.length && <View style={styles.filteredEmpty}><Text style={styles.emptyTitle}>Nothing Is on These Rails</Text><Text style={styles.emptyText}>Clear a filter to bring your wardrobe back.</Text></View>}
      </ScreenEntrance>
    </ScrollView>
  );
}

function WardrobePane({ category, label, note, accent, symbol, items, cardWidth, indexOffset, onEdit, onToggleClean, onDelete, filtered }: {
  category: Category; label: string; note: string; accent: string; symbol: string; items: ClothingItem[]; cardWidth: number; indexOffset: number; onEdit: (item: ClothingItem) => void; onToggleClean: (id: string) => void; onDelete: (item: ClothingItem) => void; filtered: boolean;
}) {
  const isShoeShelf = category === 'shoes';
  const sway = useRef(new Animated.Value(0)).current;
  const lastOffset = useRef(0);
  const swayAmount = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    sway.stopAnimation();
  }, [sway]);
  const settle = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    const overshoot = -swayAmount.current * 0.35;
    Animated.sequence([
      Animated.spring(sway, { toValue: overshoot, useNativeDriver: true, damping: 9, stiffness: 95, mass: 0.65 }),
      Animated.spring(sway, { toValue: 0, useNativeDriver: true, damping: 10, stiffness: 85, mass: 0.75 }),
    ]).start(() => { swayAmount.current = 0; });
  };
  const move = (offset: number) => {
    const delta = offset - lastOffset.current;
    lastOffset.current = offset;
    if (Math.abs(delta) < 0.2) return;
    const target = Math.max(-7, Math.min(7, -delta * 0.7));
    swayAmount.current = target;
    Animated.timing(sway, { toValue: target, duration: 70, useNativeDriver: true }).start();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, 110);
  };
  const swayStyle = { transform: [{ rotate: sway.interpolate({ inputRange: [-7, 0, 7], outputRange: ['-2.4deg', '0deg', '2.4deg'] }) }] };
  return <View style={[styles.pane, shadows.card]}>
    <View style={styles.paneTop}><View style={[styles.paneNumber, { backgroundColor: accent }]}><Text style={styles.paneNumberText}>{symbol}</Text></View><View style={styles.paneCopy}><Text style={styles.paneTitle}>{label}</Text><Text style={styles.paneNote}>{note}</Text></View><Text style={styles.paneCount}>{items.length} PIECES</Text></View>
    <View style={styles.woodFrame}>
      <View style={styles.woodGrainOne} /><View style={styles.woodGrainTwo} />
      <View style={[styles.closetInterior, isShoeShelf && styles.shoeInterior]}>
        {!isShoeShelf && <View style={styles.rail}><View style={styles.railCapLeft} /><View style={styles.railCapRight} /></View>}
        {items.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.railContent, isShoeShelf && styles.shoeContent]} scrollEventThrottle={16} onScroll={(event) => move(event.nativeEvent.contentOffset.x)} onScrollEndDrag={settle} onMomentumScrollEnd={settle}>
          {items.map((item, index) => <Animated.View key={item.id} style={[styles.hangingItem, isShoeShelf && styles.shoeItem, swayStyle]}>{!isShoeShelf && <WardrobeHanger />}<ClothingCard item={item} width={cardWidth} index={index + indexOffset} onToggleClean={onToggleClean} onEdit={onEdit} onDelete={onDelete} /></Animated.View>)}
          <MotionPressable onPress={() => undefined} containerStyle={[styles.endCard, isShoeShelf ? styles.shoeEndCard : styles.hangingEndCard, { width: cardWidth }]} hoverLift={1}><View style={styles.endCardInner}><Text style={styles.endArrow}>-&gt;</Text><Text style={styles.endText}>End of Rail</Text></View></MotionPressable>
        </ScrollView> : <View style={styles.emptyRail}><Text style={styles.emptyRailTitle}>{filtered ? 'No matches in this pane' : 'This pane is empty'}</Text><Text style={styles.emptyRailText}>{filtered ? 'Adjust the filters above.' : 'Add a piece to start filling it.'}</Text></View>}
        <View style={styles.shelfEdge} />
      </View>
    </View>
  </View>;
}

function WardrobeHanger() {
  return <View pointerEvents="none" style={styles.hanger}><Image source={require('../assets/closetai-hanger.png')} style={styles.hangerImage} resizeMode="contain" /></View>;
}

function FilterGroup({ title, values, active, onToggle }: { title: string; values: string[]; active: string[]; onToggle: (value: string) => void }) {
  if (!values.length) return null;
  return <View style={styles.filterGroup}><Text style={styles.filterLabel}>{title}</Text><View style={styles.chips}>{values.map((value) => <MotionPressable key={value} onPress={() => onToggle(value)} hoverLift={1}><View style={[styles.chip, active.includes(value) && styles.chipActive]}><Text style={[styles.chipText, active.includes(value) && styles.chipTextActive]}>{value.replace('-', ' ')}</Text></View></MotionPressable>)}</View></View>;
}

const styles = StyleSheet.create({
  page: { padding: 14, paddingBottom: 70, alignItems: 'center' },
  headingRow: { marginTop: 20, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 },
  headingRowMobile: { flexDirection: 'column', alignItems: 'stretch' },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  title: { marginTop: 5, color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1.3 },
  titleMobile: { fontSize: 30, lineHeight: 34 },
  count: { marginTop: 5, color: colors.muted, fontSize: 11, fontWeight: '700' },
  addButton: { paddingHorizontal: 15, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 15, backgroundColor: colors.ink },
  addButtonMotionMobile: { width: '100%' },
  addButtonMobile: { width: '100%', justifyContent: 'center' },
  plus: { color: colors.peach, fontSize: 17, fontWeight: '900' }, addText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  wardrobeIntro: { marginTop: 18, overflow: 'hidden', padding: 16, borderRadius: 18, backgroundColor: colors.green },
  introPattern: { position: 'absolute', right: 0, top: 0, width: 145, height: '100%', opacity: 0.25 },
  patternLine: { position: 'absolute', right: 22, top: -30, width: 2, height: 150, backgroundColor: '#FFFFFF', transform: [{ rotate: '35deg' }] },
  patternLineTwo: { right: 70, top: -20 },
  introLabel: { color: colors.peach, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  introText: { maxWidth: 610, marginTop: 5, color: '#FFFFFF', fontSize: 11, lineHeight: 17 },
  toolbar: { marginTop: 12, flexDirection: 'row', gap: 9 },
  toolGrow: { flex: 1 },
  toolButton: { paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.card },
  toolButtonActive: { borderColor: colors.green, backgroundColor: colors.green }, toolText: { color: colors.ink, fontSize: 10, fontWeight: '900' }, toolTextActive: { color: '#FFFFFF' },
  cleanAllButton: { borderColor: '#C8D9CC', backgroundColor: colors.greenSoft }, cleanAllText: { color: colors.greenDark, fontSize: 10, fontWeight: '900' }, disabled: { opacity: 0.42 },
  filterPanel: { marginTop: 10, padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.card },
  filterGroup: { marginBottom: 12 }, filterLabel: { marginBottom: 7, color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: '#F7F3EC' }, chipActive: { borderColor: colors.green, backgroundColor: colors.greenSoft }, chipText: { color: colors.muted, fontSize: 9, fontWeight: '800', textTransform: 'capitalize' }, chipTextActive: { color: colors.greenDark },
  clearButton: { paddingVertical: 9, alignItems: 'center' }, clearText: { color: colors.dirty, fontSize: 9, fontWeight: '900' },
  pane: { marginTop: 17, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, borderRadius: 25, backgroundColor: colors.card },
  paneTop: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 },
  paneNumber: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  paneNumberText: { color: colors.ink, fontSize: 10, fontWeight: '900' },
  paneCopy: { flex: 1 }, paneTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' }, paneNote: { marginTop: 2, color: colors.muted, fontSize: 9 }, paneCount: { color: colors.gold, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  woodFrame: { padding: 10, paddingTop: 12, backgroundColor: '#6A4936' },
  woodGrainOne: { position: 'absolute', left: 30, top: 0, width: 1, height: '100%', backgroundColor: 'rgba(255,255,255,0.08)' },
  woodGrainTwo: { position: 'absolute', right: 55, top: 0, width: 2, height: '100%', backgroundColor: 'rgba(31,17,10,0.12)' },
  closetInterior: { minHeight: 305, overflow: 'hidden', paddingTop: 0, paddingBottom: 13, borderRadius: 16, backgroundColor: '#EDE4D7' },
  shoeInterior: { paddingTop: 13 },
  rail: { position: 'absolute', zIndex: 2, left: 20, right: 20, top: 13, height: 5, borderRadius: 4, backgroundColor: '#9A8775' },
  railCapLeft: { position: 'absolute', left: -5, top: -4, width: 9, height: 13, borderRadius: 5, backgroundColor: '#4E4036' },
  railCapRight: { position: 'absolute', right: -5, top: -4, width: 9, height: 13, borderRadius: 5, backgroundColor: '#4E4036' },
  railContent: { paddingHorizontal: 14, paddingTop: 0, paddingBottom: 10, gap: 10, alignItems: 'flex-start' },
  shoeContent: { paddingTop: 9, alignItems: 'flex-end' },
  hangingItem: { paddingTop: 57 },
  shoeItem: { paddingTop: 0 },
  hanger: { position: 'absolute', zIndex: 3, top: -1, left: '50%', width: 76, height: 56, marginLeft: -38 },
  hangerImage: { width: '100%', height: '100%', tintColor: '#76543D' },
  shelfEdge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 12, borderTopWidth: 2, borderTopColor: '#B49E86', backgroundColor: '#CBB79F' },
  endCard: { height: 235 }, hangingEndCard: { marginTop: 57 }, shoeEndCard: { marginTop: 0 }, endCardInner: { height: '100%', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: '#BAAA98', borderRadius: 17 }, endArrow: { color: colors.gold, fontSize: 20, fontWeight: '900' }, endText: { marginTop: 5, color: colors.muted, fontSize: 9, fontWeight: '800' },
  emptyRail: { height: 235, alignItems: 'center', justifyContent: 'center' }, emptyRailTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' }, emptyRailText: { marginTop: 5, color: colors.muted, fontSize: 10 },
  empty: { marginTop: 22, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 26, backgroundColor: colors.card },
  emptyDoors: { width: 120, height: 80, padding: 5, flexDirection: 'row', gap: 5, borderRadius: 8, backgroundColor: '#6A4936' }, emptyDoor: { flex: 1, borderWidth: 1, borderColor: '#B08C70', backgroundColor: '#7A543D' },
  emptyTitle: { marginTop: 14, color: colors.ink, fontSize: 19, fontWeight: '900' }, emptyText: { marginTop: 8, maxWidth: 280, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  emptyButtonMotion: { marginTop: 18 }, emptyButton: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 13, backgroundColor: colors.green }, emptyButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  filteredEmpty: { marginTop: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.card },
});

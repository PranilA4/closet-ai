import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BrandLogo } from './BrandLogo';
import { MotionPressable } from './MotionPressable';
import { colors } from '../theme';
import { ScreenName } from '../types';

type Props = {
  screen: ScreenName;
  email: string | null;
  onNavigate: (screen: ScreenName) => void;
  onSignOut: () => void;
};

const tabs: { label: string; screen: ScreenName }[] = [
  { label: 'Home', screen: 'home' },
  { label: 'Closet', screen: 'wardrobe' },
  { label: 'Outfit', screen: 'outfit' },
  { label: 'Insights', screen: 'insights' },
];

export function AppHeader({ screen, email, onNavigate, onSignOut }: Props) {
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <MotionPressable onPress={() => onNavigate('home')} hoverLift={1}><BrandLogo compact /></MotionPressable>
        <Pressable onPress={onSignOut} style={styles.account}><View style={styles.avatar}><Text style={styles.avatarText}>{email?.slice(0, 1).toUpperCase() ?? 'D'}</Text></View><Text style={styles.signOut}>Sign out</Text></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav}>
        {tabs.map((tab) => {
          const active = screen === tab.screen || ((screen === 'add' || screen === 'edit') && tab.screen === 'wardrobe');
          return <MotionPressable key={tab.screen} onPress={() => onNavigate(tab.screen)} hoverLift={2}><View style={[styles.navButton, active && styles.navButtonActive]}><Text style={[styles.navText, active && styles.navTextActive]}>{tab.label}</Text></View></MotionPressable>;
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.canvas },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  avatar: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.green },
  avatarText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  signOut: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  nav: { marginTop: 10, gap: 5 },
  navButton: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 18 },
  navButtonActive: { backgroundColor: colors.ink },
  navText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  navTextActive: { color: '#FFFFFF' },
});

import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Avatar, BottomNav, CourseVisual, IconButton, ProductScreen, SectionTitle, StatCard } from '../src/components/ProductUI'
import { demoCourses } from '../src/data/demo'
import { colors } from '../src/ui/theme'

export default function Profile() {
  const router = useRouter()
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <View style={styles.hero}>
        <CourseVisual course={demoCourses[0]} height={184} />
        <View style={styles.settings}><IconButton icon="settings" label="Profile settings" /></View>
        <View style={styles.avatarWrap}><Avatar initials="RK" size={86} color="#B1805D" /></View>
      </View>
      <View style={styles.identity}><Text style={styles.name}>Rohan Kohli</Text><Text style={styles.handle}>@rohank</Text></View>
      <View style={styles.stats}><StatCard label="Rounds" value="24" /><StatCard label="Courses" value="18" /><StatCard label="Avg score" value="84.1" /><StatCard label="Top rating" value="9.4/10" /></View>
      <View style={styles.actions}><Pressable onPress={() => router.push('/friends')} style={styles.action}><Feather name="users" size={18} color={colors.pine} /><Text style={styles.actionText}>Friends</Text></Pressable><Pressable onPress={() => router.push('/saved')} style={styles.action}><Feather name="bookmark" size={18} color={colors.pine} /><Text style={styles.actionText}>Saved</Text></Pressable><Pressable onPress={() => router.push('/stats')} style={styles.action}><Feather name="activity" size={18} color={colors.pine} /><Text style={styles.actionText}>Stats</Text></Pressable></View>
      <SectionTitle title="Achievements" />
      <View style={styles.achievements}>{[['award','First round'],['map','Course explorer'],['star','Top 10%']].map(([icon, label]) => <View key={label} style={styles.achievement}><View style={styles.medal}><Feather name={icon as never} size={21} color={colors.pine} /></View><Text style={styles.achievementTitle}>{label}</Text></View>)}</View>
      <SectionTitle title="Recent activity" />
      <Pressable onPress={() => router.push('/round/torrey-may')} style={styles.recent}><View style={{ width: 100 }}><CourseVisual course={demoCourses[3]} height={70} /></View><View style={{ flex: 1 }}><Text style={styles.recentTitle}>Torrey Pines (South)</Text><Text style={styles.handle}>May 12, 2024</Text></View><Text style={styles.recentScore}>82</Text></Pressable>
    </ProductScreen>
    <BottomNav />
  </>
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: -18, marginTop: -18, position: 'relative' }, settings: { position: 'absolute', right: 15, top: 14 }, avatarWrap: { bottom: -43, left: 0, position: 'absolute', right: 0, alignItems: 'center' },
  identity: { alignItems: 'center', marginTop: 30 }, name: { color: colors.ink, fontSize: 23, fontWeight: '800' }, handle: { color: colors.muted, fontSize: 11, marginTop: 4 },
  stats: { flexDirection: 'row', gap: 6 }, actions: { flexDirection: 'row', gap: 9 }, action: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 12, borderWidth: 1, flex: 1, gap: 5, padding: 12 }, actionText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  achievements: { flexDirection: 'row', gap: 9 }, achievement: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flex: 1, gap: 8, padding: 12 }, medal: { alignItems: 'center', backgroundColor: colors.pineSoft, borderRadius: 30, height: 46, justifyContent: 'center', width: 46 }, achievementTitle: { color: colors.ink, fontSize: 9, fontWeight: '800', textAlign: 'center' },
  recent: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, overflow: 'hidden', paddingRight: 14 }, recentTitle: { color: colors.ink, fontSize: 12, fontWeight: '800' }, recentScore: { color: colors.pine, fontSize: 22, fontWeight: '600' },
})

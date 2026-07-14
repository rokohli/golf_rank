import { Feather } from '@expo/vector-icons'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { CourseVisual, PrimaryButton, ProductScreen, ScreenHeader, SectionTitle, StatCard } from '../../src/components/ProductUI'
import { rounds } from '../../src/data/demo'
import { colors } from '../../src/ui/theme'

export default function RoundDetail() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const round = rounds.find((item) => item.id === id) ?? rounds[0]
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="Round summary" onBack={() => router.back()} />
      <View style={styles.courseCard}><View style={{ width: 118 }}><CourseVisual course={round.course} height={94} /></View><View style={{ flex: 1 }}><Text style={styles.course}>{round.course.name}</Text><Text style={styles.meta}>{round.course.location}</Text><Text style={styles.meta}>{round.date} · 18 holes</Text></View></View>
      <View style={styles.scoreHero}><Text style={styles.score}>{round.score}</Text><Text style={styles.toPar}>{round.toPar}</Text><Text style={styles.label}>Round score · Stroke play</Text></View>
      <View style={styles.stats}><StatCard label="Fairways" value="9/14" /><StatCard label="Greens" value="11/18" /><StatCard label="Putts" value="32" /><StatCard label="Scrambles" value="3/6" /></View>
      <SectionTitle title="How the round felt" />
      <View style={styles.memory}><View style={styles.memoryIcon}><Feather name="sun" size={20} color={colors.gold} /></View><View style={{ flex: 1 }}><Text style={styles.memoryTitle}>{round.weather} · 72°F</Text><Text style={styles.meta}>Greens were firm and fast. Wind picked up on the closing stretch.</Text></View></View>
      <SectionTitle title="Course memory" />
      <Text style={styles.body}>A confident day off the tee with the coastal holes standing out. This round remains separate from your personal course ranking.</Text>
      <PrimaryButton label="Update course ranking" icon="bar-chart-2" onPress={() => router.push('/rankings')} />
    </ProductScreen>
  </>
}

const styles = StyleSheet.create({
  courseCard: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, overflow: 'hidden', paddingRight: 12 }, course: { color: colors.ink, fontSize: 14, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  scoreHero: { alignItems: 'center', paddingVertical: 8 }, score: { color: colors.pine, fontSize: 58, fontWeight: '500', letterSpacing: -2 }, toPar: { color: colors.muted, fontSize: 14, fontWeight: '700' }, label: { color: colors.muted, fontSize: 10, marginTop: 5 }, stats: { flexDirection: 'row', gap: 6 },
  memory: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 }, memoryIcon: { alignItems: 'center', backgroundColor: '#FFF7E5', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 }, memoryTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' }, body: { color: colors.muted, fontSize: 13, lineHeight: 20 },
})

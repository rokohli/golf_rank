import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { CourseVisual, IconButton, PrimaryButton, ProductScreen, ScreenHeader, SectionTitle } from '../src/components/ProductUI'
import { demoCourses } from '../src/data/demo'
import { colors } from '../src/ui/theme'

const itinerary = [
  { day: 'SATURDAY', time: '8:12 AM', title: 'Half Moon Bay Golf Links', note: '18 holes · Ocean Course', price: '$145', course: demoCourses[0] },
  { day: 'SATURDAY', time: '12:30 PM', title: "Lunch at Sam's Chowder House", note: '10 min drive', price: '', course: null },
  { day: 'SATURDAY', time: '3:30 PM', title: 'Pasatiempo Golf Club', note: '18 holes · 95% taste match', price: '$165', course: demoCourses[1] },
  { day: 'SUNDAY', time: '9:00 AM', title: 'TPC Harding Park', note: '18 holes', price: '$160', course: demoCourses[3] },
]

export default function Planner() {
  const router = useRouter()
  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen>
    <ScreenHeader title="AI Trip Planner" onBack={() => router.back()} action={<IconButton icon="refresh-cw" label="Regenerate plan" />} />
    <View style={styles.planHeader}><View><Text style={styles.planTitle}>Weekend in Monterey</Text><Text style={styles.planDates}>May 24 – May 26</Text></View><View style={styles.aiPill}><Text style={styles.aiText}>AI GENERATED</Text></View></View>
    <View style={styles.reason}><Feather name="star" size={18} color={colors.pine} /><Text style={styles.reasonText}>Built around your love of coastal strategy, walking-friendly courses, and a $350 daily golf budget.</Text></View>
    <View>{itinerary.map((item, index) => <View key={`${item.time}-${item.title}`}><>{index === 0 || itinerary[index - 1].day !== item.day ? <SectionTitle title={item.day} /> : null}</><View style={styles.item}><Text style={styles.time}>{item.time}</Text>{item.course ? <View style={styles.thumb}><CourseVisual course={item.course} height={54} /></View> : <View style={styles.food}><Feather name="coffee" size={17} color={colors.pine} /></View>}<View style={{ flex: 1 }}><Text style={styles.itemTitle}>{item.title}</Text><Text style={styles.note}>{item.note}</Text></View><Text style={styles.price}>{item.price}</Text></View></View>)}</View>
    <View style={styles.total}><Text style={styles.totalLabel}>Estimated total</Text><View style={{ alignItems: 'flex-end' }}><Text style={styles.totalPrice}>$286</Text><Text style={styles.note}>per person</Text></View></View>
    <PrimaryButton label="Save itinerary" icon="bookmark" />
  </ProductScreen></>
}

const styles = StyleSheet.create({
  planHeader: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', padding: 15 }, planTitle: { color: '#FFF', fontSize: 17, fontWeight: '800' }, planDates: { color: '#D7E5DC', fontSize: 10, marginTop: 4 }, aiPill: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 }, aiText: { color: '#FFF', fontSize: 8, fontWeight: '800' },
  reason: { alignItems: 'flex-start', backgroundColor: colors.pineSoft, borderRadius: 13, flexDirection: 'row', gap: 9, padding: 12 }, reasonText: { color: colors.pineDark, flex: 1, fontSize: 11, lineHeight: 17 },
  item: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, marginBottom: 8, marginTop: 8, padding: 9 }, time: { color: colors.muted, fontSize: 9, fontWeight: '700', width: 48 }, thumb: { borderRadius: 8, overflow: 'hidden', width: 68 }, food: { alignItems: 'center', backgroundColor: colors.pineSoft, borderRadius: 8, height: 44, justifyContent: 'center', width: 48 }, itemTitle: { color: colors.ink, fontSize: 11, fontWeight: '800' }, note: { color: colors.muted, fontSize: 9, marginTop: 3 }, price: { color: colors.pine, fontSize: 10, fontWeight: '800' },
  total: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 14 }, totalLabel: { color: colors.ink, fontSize: 12, fontWeight: '800' }, totalPrice: { color: colors.ink, fontSize: 20, fontWeight: '800' },
})

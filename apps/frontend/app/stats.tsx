import { Stack, useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { BottomNav, ProductScreen, ScreenHeader, SectionTitle, StatCard } from '../src/components/ProductUI'
import { colors } from '../src/ui/theme'

export default function Stats() {
  const router = useRouter()
  const scores = [82, 88, 90, 83, 79, 81, 92, 88, 80, 86]
  const breakdown = [['Birdie or better','18%','#245D44'],['Par','45%','#56806B'],['Bogey','28%','#90A897'],['Double+','9%','#D6DED7']]
  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen>
    <ScreenHeader title="Your Stats" onBack={() => router.back()} />
    <View style={styles.stats}><StatCard label="Rounds" value="24" /><StatCard label="Courses" value="18" /><StatCard label="Avg score" value="84.1" /><StatCard label="Best" value="76" /></View>
    <SectionTitle title="Score trend" action="This year⌄" />
    <View style={styles.chart}><View style={styles.axis}><Text style={styles.axisText}>95</Text><Text style={styles.axisText}>85</Text><Text style={styles.axisText}>75</Text></View><View style={styles.bars}>{scores.map((score, index) => <View key={index} style={[styles.bar, { height: `${Math.max(15, 100 - (score - 75) * 4)}%` }]} />)}</View></View>
    <View style={styles.months}>{['Jan','Feb','Mar','Apr','May'].map((month) => <Text key={month} style={styles.month}>{month}</Text>)}</View>
    <SectionTitle title="Scoring breakdown" />
    <View style={styles.breakdown}><View style={styles.donut}><View style={styles.donutHole}><Text style={styles.donutText}>24</Text><Text style={styles.axisText}>rounds</Text></View></View><View style={{ flex: 1, gap: 11 }}>{breakdown.map(([label,value,color]) => <View key={label} style={styles.legend}><View style={[styles.dot,{ backgroundColor: color }]} /><Text style={styles.legendLabel}>{label}</Text><Text style={styles.legendValue}>{value}</Text></View>)}</View></View>
    <View style={styles.callout}><Text style={styles.calloutTitle}>Your scoring is trending down</Text><Text style={styles.calloutText}>You are averaging 3.2 fewer strokes than at the start of the year.</Text></View>
  </ProductScreen><BottomNav /></>
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 6 }, chart: { alignItems: 'stretch', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 16, borderWidth: 1, flexDirection: 'row', height: 180, padding: 16 }, axis: { justifyContent: 'space-between', paddingRight: 10 }, axisText: { color: colors.muted, fontSize: 9 }, bars: { alignItems: 'flex-end', borderBottomColor: colors.line, borderBottomWidth: 1, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'space-around' }, bar: { backgroundColor: colors.pine, borderTopLeftRadius: 4, borderTopRightRadius: 4, flex: 1, maxWidth: 16, minHeight: 18 }, months: { flexDirection: 'row', justifyContent: 'space-around', marginTop: -12, paddingLeft: 25 }, month: { color: colors.muted, fontSize: 9 },
  breakdown: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 24, padding: 18 }, donut: { alignItems: 'center', backgroundColor: colors.pine, borderColor: '#91A996', borderRadius: 60, borderWidth: 18, height: 120, justifyContent: 'center', width: 120 }, donutHole: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 30, height: 58, justifyContent: 'center', width: 58 }, donutText: { color: colors.ink, fontSize: 17, fontWeight: '800' }, legend: { alignItems: 'center', flexDirection: 'row', gap: 7 }, dot: { borderRadius: 4, height: 8, width: 8 }, legendLabel: { color: colors.muted, flex: 1, fontSize: 10 }, legendValue: { color: colors.ink, fontSize: 10, fontWeight: '800' },
  callout: { backgroundColor: colors.pineSoft, borderRadius: 14, gap: 5, padding: 14 }, calloutTitle: { color: colors.pineDark, fontSize: 13, fontWeight: '800' }, calloutText: { color: colors.muted, fontSize: 11, lineHeight: 16 },
})

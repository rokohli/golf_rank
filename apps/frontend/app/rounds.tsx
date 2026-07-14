import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { BottomNav, IconButton, ProductScreen, ScreenHeader, Segmented, StatCard } from '../src/components/ProductUI'
import { rounds } from '../src/data/demo'
import { colors } from '../src/ui/theme'

export default function Rounds() {
  const router = useRouter()
  const [filter, setFilter] = useState('This Year')
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="My Rounds" action={<IconButton icon="plus" label="Add round" />} />
      <Segmented options={['All', 'This Year', 'Favorites']} selected={filter} onSelect={setFilter} />
      <View style={styles.stats}><StatCard label="Rounds" value="24" /><StatCard label="Avg score" value="84.1" /><StatCard label="Best score" value="76" /></View>
      <View style={styles.list}>
        {rounds.map((round) => <Pressable key={round.id} onPress={() => router.push(`/round/${round.id}` as never)} style={({ pressed }) => [styles.roundCard, pressed && { opacity: 0.75 }]}>
          <View style={styles.dateLine} />
          <View style={{ flex: 1, gap: 4 }}><Text style={styles.date}>{round.date}</Text><Text style={styles.course}>{round.course.name}</Text><Text style={styles.meta}>{round.course.location}  ·  {round.weather}</Text></View>
          <Text style={styles.score}>{round.score}</Text><View style={styles.toPar}><Text style={styles.toParText}>{round.toPar}</Text></View><Feather name="chevron-right" size={16} color={colors.muted} />
        </Pressable>)}
      </View>
    </ProductScreen>
    <BottomNav />
  </>
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 8 }, list: { gap: 10 },
  roundCard: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, overflow: 'hidden', padding: 12 },
  dateLine: { alignSelf: 'stretch', backgroundColor: colors.pine, borderRadius: 3, width: 3 },
  date: { color: colors.muted, fontSize: 9, fontWeight: '700' }, course: { color: colors.ink, fontSize: 13, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 10 },
  score: { color: colors.pine, fontSize: 26, fontWeight: '500' }, toPar: { backgroundColor: colors.pineSoft, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 4 }, toParText: { color: colors.pine, fontSize: 9, fontWeight: '800' },
})

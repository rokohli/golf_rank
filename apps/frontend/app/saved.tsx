import { Stack, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { BottomNav, CourseCard, ProductScreen, ScreenHeader, Segmented } from '../src/components/ProductUI'
import { demoCourses } from '../src/data/demo'

export default function Saved() {
  const router = useRouter(); const [tab, setTab] = useState('Saved')
  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen><ScreenHeader title="Saved Courses" onBack={() => router.back()} /><Segmented options={['Saved','Bucket List']} selected={tab} onSelect={setTab} /><View style={styles.grid}>{demoCourses.map((course) => <View key={course.id} style={styles.item}><CourseCard compact course={course} badge={tab === 'Saved' ? 'Saved' : 'Dream'} onPress={() => router.push(`/course/${course.id}` as never)} /></View>)}</View></ProductScreen><BottomNav /></>
}
const styles = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, item: { width: '48%' } })

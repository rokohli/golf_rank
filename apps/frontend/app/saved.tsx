import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { getSavedLists } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { BottomNav, CourseCard, ProductScreen, ScreenHeader, Segmented } from '../src/components/ProductUI'
import { DemoCourse, demoCourses } from '../src/data/demo'
import { Course, SavedList } from '../src/types'
import { colors } from '../src/ui/theme'

export default function Saved() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [lists, setLists] = useState<SavedList[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const next = await getSavedLists(headers)
      setLists(next)
      setSelectedId((current) => next.some((list) => list.id === current)
        ? current
        : (next.find((list) => list.is_default) ?? next[0])?.id ?? null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load saved courses.')
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => {
    void load()
  }, [load]))

  const selected = lists.find((list) => list.id === selectedId) ?? null
  const options = useMemo(() => lists.map((list) => list.name), [lists])

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="Saved Courses" onBack={() => router.back()} />
      {options.length > 1 && selected ? <Segmented options={options} selected={selected.name} onSelect={(name) => setSelectedId(lists.find((list) => list.name === name)?.id ?? null)} /> : null}
      {loading ? <ActivityIndicator accessibilityLabel="Loading saved courses" color={colors.pine} /> : null}
      {error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {!loading && !error && !selected ? <Text style={styles.empty}>Courses you save will appear here.</Text> : null}
      {!loading && !error && selected && selected.courses.length === 0 ? <Text style={styles.empty}>No courses saved to {selected.name} yet.</Text> : null}
      {selected?.courses.length ? <View style={styles.grid}>{selected.courses.map(({ course }) => <View key={course.id} style={styles.item}><CourseCard compact course={toDemoCourse(course)} badge="Saved" onPress={() => router.push(`/course/${course.id}` as never)} /></View>)}</View> : null}
    </ProductScreen>
    <BottomNav />
  </>
}

function toDemoCourse(course: Course): DemoCourse {
  const known = demoCourses.find((item) => item.name === course.name)
  const visual = known ?? demoCourses[(course.id - 1) % demoCourses.length]
  return {
    ...visual,
    id: String(course.id),
    name: course.name,
    location: course.region,
    rating: course.community_rating ?? 0,
    reviews: String(course.rating_count ?? 0),
    price: course.green_fee == null ? '—' : course.green_fee > 500 ? '$$$$' : '$$$',
  }
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, fontSize: 13, paddingVertical: 28, textAlign: 'center' },
  error: { color: colors.error, fontSize: 12, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  item: { width: '48%' },
  retry: { borderColor: colors.pine, borderRadius: 18, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 8 },
  retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
  state: { alignItems: 'center', gap: 12, paddingVertical: 28 },
})

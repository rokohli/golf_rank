import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { getProfile, searchCourses } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { BottomNav, CourseVisual, DemoCourseRow, ProductScreen, ScreenHeader, SectionTitle } from '../src/components/ProductUI'
import { DemoCourse, demoCourses } from '../src/data/demo'
import { Course } from '../src/types'
import { colors } from '../src/ui/theme'

export default function Discover() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [apiCourses, setApiCourses] = useState<Course[]>([])
  const { getAuthHeaders } = useAuthHeaders()

  useEffect(() => {
    getAuthHeaders().then(getProfile).then(searchCourses).then(setApiCourses).catch(() => undefined)
  }, [getAuthHeaders])

  const catalog = useMemo(() => {
    if (!apiCourses.length) return demoCourses
    const fromApi: DemoCourse[] = apiCourses.map((course, index) => ({
      id: String(course.id), name: course.name, location: course.region, rating: course.community_rating ?? 0,
      reviews: String(course.rating_count ?? 0), distance: `$${course.green_fee}`, price: course.green_fee > 500 ? '$$$$' : '$$$',
      accent: '#6E8B84', secondary: '#AEC3B7', image: demoCourses[index % 3].image,
    }))
    return [...fromApi, ...demoCourses.filter((demo) => !fromApi.some((course) => course.name === demo.name))]
  }, [apiCourses])

  const results = useMemo(() => catalog.filter((course) => `${course.name} ${course.location}`.toLowerCase().includes(query.trim().toLowerCase())), [catalog, query])
  const openCourse = (course: DemoCourse) => router.push(`/course/${course.id}` as never)

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductScreen>
        <ScreenHeader title="Discover" />
        <View style={styles.searchWrap}><Feather name="search" size={16} color={colors.muted} /><TextInput accessibilityLabel="Search courses" placeholder="Search courses, locations, or players" placeholderTextColor="#8C948F" value={query} onChangeText={setQuery} style={styles.search} /><Feather name="sliders" size={16} color={colors.ink} /></View>

        {query ? <>
          <SectionTitle title={`${results.length} RESULTS`} />
          <View>{results.map((course, index) => <DemoCourseRow key={course.id} course={course} index={index + 1} onPress={() => openCourse(course)} />)}</View>
        </> : <>
          <Pressable onPress={() => openCourse(demoCourses[0])} style={styles.featured}>
            <CourseVisual course={demoCourses[0]} height={202}><View style={styles.featureTag}><Text style={styles.featureTagText}>FEATURED</Text></View></CourseVisual>
            <View style={styles.featureBody}><Text style={styles.featureTitle}>Pebble Beach Golf Links</Text><Text style={styles.meta}>Pebble Beach, California</Text><View style={styles.featureMeta}><Text style={styles.rating}>9.7/10</Text><Text style={styles.meta}>(2,341 ratings)</Text><View style={styles.divider} /><Text style={styles.meta}>Ranked #1 in California</Text></View></View>
          </Pressable>

          <SectionTitle title="EXPLORE NEARBY" action="See all" />
          <View style={styles.nearby}>{[demoCourses[1], demoCourses[3]].map((course) => <Pressable key={course.id} onPress={() => openCourse(course)} style={styles.nearbyItem}><CourseVisual course={course} height={112} /><Text numberOfLines={1} style={styles.tileTitle}>{course.name}</Text><Text style={styles.meta}>{course.location}</Text><Text style={styles.rating}>{course.rating}/10  <Text style={styles.meta}>({course.reviews} ratings)</Text></Text></Pressable>)}</View>

          <SectionTitle title="TRENDING THIS WEEK" action="See all" />
          <View>{[demoCourses[2], demoCourses[5]].map((course, index) => <DemoCourseRow key={course.id} course={course} index={index + 1} onPress={() => openCourse(course)} trailing={<Feather name="bookmark" size={17} color={colors.pine} />} />)}</View>
        </>}
      </ProductScreen>
      <BottomNav />
    </>
  )
}

const styles = StyleSheet.create({
  searchWrap: { alignItems: 'center', borderColor: '#D6D7D2', borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 9, paddingHorizontal: 13 }, search: { color: colors.ink, flex: 1, fontSize: 12, minHeight: 42 },
  featured: { borderColor: '#D7D8D3', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' }, featureTag: { backgroundColor: 'rgba(17, 60, 43, 0.88)', left: 10, paddingHorizontal: 8, paddingVertical: 5, position: 'absolute', top: 10 }, featureTagText: { color: '#FFF', fontSize: 8, fontWeight: '800', letterSpacing: 0.8 }, featureBody: { gap: 5, padding: 13 }, featureTitle: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 21 }, featureMeta: { alignItems: 'center', flexDirection: 'row', gap: 7, marginTop: 5 }, divider: { backgroundColor: '#D6D7D2', height: 13, width: StyleSheet.hairlineWidth },
  nearby: { flexDirection: 'row', gap: 11 }, nearbyItem: { flex: 1, gap: 4 }, tileTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14, marginTop: 4 }, meta: { color: colors.muted, fontSize: 9, lineHeight: 14 }, rating: { color: colors.gold, fontSize: 9, fontWeight: '700', marginTop: 3 },
})

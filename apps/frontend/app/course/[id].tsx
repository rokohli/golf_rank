import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { createSavedList, getCourse, getCourseRating, getSavedLists, removeCourseFromList, saveCourseToList } from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { Avatar, CourseVisual, IconButton, Pill, PrimaryButton, ProductScreen, SectionTitle } from '../../src/components/ProductUI'
import { DemoCourse, demoCourses, friends } from '../../src/data/demo'
import { Course, CourseRatingState, SavedList } from '../../src/types'
import { colors } from '../../src/ui/theme'

const seededDemoCourseIds: Record<string, number> = {
  pebble: 1,
  pasatiempo: 3,
}

export default function CourseDetail() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const mounted = useRef(true)
  const ratingRequestVersion = useRef(0)
  const savedRequestVersion = useRef(0)
  const demoCourse = useMemo(() => demoCourses.find((item) => item.id === id) ?? null, [id])
  const isNumericRoute = Boolean(id && /^\d+$/.test(id))
  const numericCourseId = isNumericRoute ? Number(id) : id ? seededDemoCourseIds[id] ?? null : null
  const [course, setCourse] = useState<DemoCourse | null>(demoCourse)
  const [publicCourse, setPublicCourse] = useState<Course | null>(null)
  const [courseError, setCourseError] = useState<string | null>(null)
  const [courseLoading, setCourseLoading] = useState(isNumericRoute)
  const [rating, setRating] = useState<CourseRatingState | null>(null)
  const [ratingError, setRatingError] = useState<string | null>(null)
  const [ratingLoading, setRatingLoading] = useState(Boolean(numericCourseId))
  const [savedLists, setSavedLists] = useState<SavedList[] | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      ratingRequestVersion.current += 1
      savedRequestVersion.current += 1
    }
  }, [])

  const loadCourse = useCallback(async () => {
    if (demoCourse) {
      setCourse(demoCourse)
      setPublicCourse(null)
      setCourseError(null)
      setCourseLoading(false)
      return
    }
    if (!id || !/^\d+$/.test(id)) {
      setCourse(null)
      setPublicCourse(null)
      setCourseError('Course not found.')
      setCourseLoading(false)
      return
    }

    setCourse(null)
    setPublicCourse(null)
    setCourseError(null)
    setCourseLoading(true)
    try {
      const nextCourse = await getCourse(Number(id))
      if (!mounted.current) return
      setPublicCourse(nextCourse)
      setCourse(toDemoCourse(nextCourse))
    } catch (reason) {
      if (mounted.current) setCourseError(errorMessage(reason, 'Unable to load this course.'))
    } finally {
      if (mounted.current) setCourseLoading(false)
    }
  }, [demoCourse, id])

  useEffect(() => {
    void loadCourse()
  }, [loadCourse])

  useEffect(() => {
    ratingRequestVersion.current += 1
    setRating(null)
    setRatingError(null)
    setRatingLoading(Boolean(numericCourseId))
  }, [numericCourseId])

  const refreshRating = useCallback(async () => {
    const requestVersion = ++ratingRequestVersion.current
    if (!numericCourseId) {
      if (mounted.current && requestVersion === ratingRequestVersion.current) {
        setRating(null)
        setRatingError(null)
        setRatingLoading(false)
      }
      return
    }

    setRatingError(null)
    setRatingLoading(true)
    try {
      const headers = await getAuthHeaders()
      const nextRating = await getCourseRating(numericCourseId, headers)
      if (mounted.current && requestVersion === ratingRequestVersion.current) setRating(nextRating)
    } catch (reason) {
      if (mounted.current && requestVersion === ratingRequestVersion.current) setRatingError(errorMessage(reason, 'Unable to load your rating.'))
    } finally {
      if (mounted.current && requestVersion === ratingRequestVersion.current) setRatingLoading(false)
    }
  }, [getAuthHeaders, numericCourseId])

  const refreshSavedState = useCallback(async () => {
    const requestVersion = ++savedRequestVersion.current
    if (!numericCourseId) {
      if (mounted.current && requestVersion === savedRequestVersion.current) {
        setSavedLists([])
        setSaveError(null)
      }
      return
    }

    setSaveError(null)
    try {
      const headers = await getAuthHeaders()
      const lists = await getSavedLists(headers)
      if (mounted.current && requestVersion === savedRequestVersion.current) setSavedLists(lists)
    } catch (reason) {
      if (mounted.current && requestVersion === savedRequestVersion.current) {
        setSaveError(errorMessage(reason, 'Unable to load saved courses.'))
      }
    }
  }, [getAuthHeaders, numericCourseId])

  const toggleSaved = useCallback(async () => {
    if (!numericCourseId || saveLoading) return
    // Invalidate a focus refresh that may still be loading the older state.
    savedRequestVersion.current += 1
    setSaveLoading(true)
    setSaveError(null)
    try {
      const headers = await getAuthHeaders()
      let lists = savedLists ?? await getSavedLists(headers)
      let target = lists.find((list) => list.is_default) ?? lists[0]
      if (!target) {
        target = await createSavedList({ name: 'Saved', visibility: 'private', is_default: true }, headers)
        lists = [...lists, target]
      }
      const alreadySaved = target.courses.some((item) => item.course.id === numericCourseId)
      if (alreadySaved) {
        await removeCourseFromList(target.id, numericCourseId, headers)
        target = { ...target, courses: target.courses.filter((item) => item.course.id !== numericCourseId) }
      } else {
        target = await saveCourseToList(target.id, numericCourseId, headers)
      }
      if (mounted.current) setSavedLists(lists.map((list) => list.id === target.id ? target : list))
    } catch (reason) {
      if (mounted.current) setSaveError(errorMessage(reason, 'Unable to update this saved course.'))
    } finally {
      if (mounted.current) setSaveLoading(false)
    }
  }, [getAuthHeaders, numericCourseId, saveLoading, savedLists])

  // Expo Router's focus effect runs on first display and again after the rating flow closes.
  useFocusEffect(useCallback(() => {
    void refreshRating()
    void refreshSavedState()
    return () => {
      ratingRequestVersion.current += 1
      savedRequestVersion.current += 1
    }
  }, [refreshRating, refreshSavedState]))

  if (!course) {
    return <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductScreen>
        <IconButton icon="arrow-left" label="Go back" onPress={() => router.back()} />
        {courseLoading ? <ActivityIndicator accessibilityLabel="Loading course" color={colors.pine} /> : null}
        <Text accessibilityRole={courseError ? 'alert' : undefined} style={styles.loadingText}>
          {courseError ?? 'Loading course...'}
        </Text>
        {courseError ? <Pressable accessibilityRole="button" onPress={() => void loadCourse()} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable> : null}
      </ProductScreen>
    </>
  }

  const communityRating = rating?.community_rating ?? (publicCourse ? publicCourse.community_rating : course.rating)
  const ratingCount = rating?.rating_count ?? publicCourse?.rating_count ?? parseRatingCount(course.reviews)
  const hasPersonalRating = rating?.personal_rating != null
  const hasKnownRatingState = rating != null
  const defaultSavedList = savedLists?.find((list) => list.is_default) ?? savedLists?.[0]
  const isSaved = Boolean(defaultSavedList?.courses.some((item) => item.course.id === numericCourseId))

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <View style={styles.hero}>
        <CourseVisual course={course} height={260} />
        <View style={styles.back}><IconButton icon="arrow-left" label="Go back" onPress={() => router.back()} /></View>
      </View>
      <View style={styles.titleRow}><View style={{ flex: 1 }}><Text style={styles.title}>{course.name}</Text><Text style={styles.location}>{course.location}</Text></View>{course.personalRank ? <Pill label={`Your #${course.personalRank}`} /> : null}</View>

      <View style={styles.ratingSummary}>
        <View style={styles.ratingBlock}>
          <Text style={styles.ratingLabel}>Community rating</Text>
          <Text accessibilityLabel={communityRating == null ? 'No community rating yet' : `Community rating ${communityRating} out of 10`} style={styles.ratingValue}>
            {communityRating == null ? '—' : formatRating(communityRating)}<Text style={styles.ratingScale}>/10</Text>
          </Text>
          <Text style={styles.ratingCount}>{ratingCount === 1 ? '1 rating' : `${ratingCount} ratings`}</Text>
        </View>
        <View style={styles.ratingDivider} />
        <View style={styles.ratingBlock}>
          <Text style={styles.ratingLabel}>Your rating</Text>
          {hasKnownRatingState ? hasPersonalRating ?
            <Text accessibilityLabel={`Your rating ${rating.personal_rating} out of 10`} style={styles.ratingValue}>{formatRating(rating.personal_rating!)}<Text style={styles.ratingScale}>/10</Text></Text> :
            <Text style={styles.notRated}>Not rated yet</Text> : ratingLoading ?
            <ActivityIndicator accessibilityLabel="Loading your rating" color={colors.pine} size="small" style={styles.personalLoader} /> :
            <Text style={styles.notRated}>Personal rating unavailable</Text>}
          {ratingError ? <><Text accessibilityRole="alert" style={styles.ratingError}>{ratingError}</Text><Pressable accessibilityRole="button" onPress={() => void refreshRating()}><Text style={styles.retryText}>Retry rating</Text></Pressable></> : null}
        </View>
      </View>

      {!numericCourseId ? <Text style={styles.unavailable}>Personal rating is unavailable for this demo-only course.</Text> : null}
      <View style={styles.actions}>
        {numericCourseId && hasKnownRatingState ? <CourseAction icon={hasPersonalRating ? 'check-circle' : 'edit-3'} label={hasPersonalRating ? 'Rated' : 'Rate'} onPress={() => router.push(`/rate/${numericCourseId}` as never)} /> : null}
        {numericCourseId ? <CourseAction disabled={saveLoading} icon={isSaved ? 'check-circle' : 'bookmark'} label={saveLoading ? 'Saving' : isSaved ? 'Saved' : 'Save'} onPress={() => void toggleSaved()} /> : null}
        <CourseAction icon="share" label="Share" />
      </View>
      {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
      <View style={styles.facts}><View><Text style={styles.factValue}>18</Text><Text style={styles.factLabel}>Holes</Text></View><View><Text style={styles.factValue}>135</Text><Text style={styles.factLabel}>Slope</Text></View><View><Text style={styles.factValue}>{course.price}</Text><Text style={styles.factLabel}>Price</Text></View></View>
      <SectionTitle title="Overview" />
      <Text style={styles.body}>A memorable routing shaped by its landscape, with strategic approaches and a finish that rewards thoughtful play. Ranked highly by golfers whose taste aligns with yours.</Text>
      <SectionTitle title="Friends who played" action="See all" onPress={() => router.push('/friends')} />
      <View style={styles.friendRow}>{friends.slice(0,4).map((friend) => <Avatar key={friend.name} initials={friend.initials} color={friend.accent} size={42} />)}<View style={styles.more}><Text style={styles.moreText}>+24</Text></View></View>
      <PrimaryButton label="View tee-time options" icon="calendar" />
    </ProductScreen>
  </>
}

function CourseAction({ disabled = false, icon, label, onPress }: { disabled?: boolean; icon: keyof typeof Feather.glyphMap; label: string; onPress?: () => void }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.actionDisabled]}><View style={styles.actionIcon}><Feather name={icon} size={18} color={colors.pine} /></View><Text style={styles.actionLabel}>{label}</Text></Pressable>
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: -18, marginTop: -18, position: 'relative' }, back: { left: 14, position: 'absolute', top: 14 },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 }, title: { color: colors.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 }, location: { color: colors.muted, fontSize: 11, marginTop: 5 },
  ratingSummary: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', padding: 14 }, ratingBlock: { flex: 1, minHeight: 82 }, ratingDivider: { backgroundColor: colors.line, marginHorizontal: 14, width: StyleSheet.hairlineWidth }, ratingLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }, ratingValue: { color: colors.ink, fontSize: 25, fontWeight: '800', marginTop: 5 }, ratingScale: { color: colors.muted, fontSize: 12, fontWeight: '600' }, ratingCount: { color: colors.muted, fontSize: 10, marginTop: 2 }, notRated: { color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 13 }, personalLoader: { alignSelf: 'flex-start', marginTop: 14 }, ratingError: { color: colors.error, fontSize: 9, marginTop: 5 }, unavailable: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around' }, action: { alignItems: 'center', gap: 5, minWidth: 64 }, actionIcon: { alignItems: 'center', borderColor: colors.line, borderRadius: 23, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 }, actionLabel: { color: colors.muted, fontSize: 10 },
  actionDisabled: { opacity: 0.55 }, saveError: { color: colors.error, fontSize: 10, textAlign: 'center' },
  facts: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-around', padding: 14 }, factValue: { color: colors.ink, fontSize: 16, fontWeight: '800', textAlign: 'center' }, factLabel: { color: colors.muted, fontSize: 9, marginTop: 3, textAlign: 'center' },
  body: { color: colors.muted, fontSize: 13, lineHeight: 20 }, friendRow: { flexDirection: 'row', gap: 8 }, more: { alignItems: 'center', backgroundColor: '#E7E9E4', borderRadius: 22, height: 42, justifyContent: 'center', width: 42 }, moreText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  loadingText: { color: colors.muted, fontSize: 14, paddingVertical: 16, textAlign: 'center' }, retryButton: { alignItems: 'center', alignSelf: 'center', borderColor: colors.pine, borderRadius: 20, borderWidth: 1, minWidth: 92, paddingHorizontal: 16, paddingVertical: 10 }, retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
})

function toDemoCourse(course: Course): DemoCourse {
  const knownCourse = demoCourses.find((item) => item.name === course.name)
  const visualFallback = knownCourse ?? demoCourses[(course.id - 1) % demoCourses.length]
  return {
    ...visualFallback,
    id: String(course.id),
    location: course.region,
    name: course.name,
    rating: course.community_rating ?? 0,
    reviews: String(course.rating_count ?? 0),
    price: course.green_fee > 500 ? '$$$$' : '$$$',
  }
}

function parseRatingCount(value: string): number {
  const normalized = value.toLowerCase().replace(/,/g, '')
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed)) return 0
  return normalized.endsWith('k') ? Math.round(parsed * 1000) : Math.round(parsed)
}

function formatRating(value: number): string {
  return value.toFixed(1)
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

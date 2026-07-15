import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { getRanking } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { BottomNav, CourseVisual, DemoCourseRow, IconButton, ProductScreen, ScreenHeader, SectionTitle } from '../src/components/ProductUI'
import { DemoCourse, demoCourses } from '../src/data/demo'
import { RankingSnapshot, RankingTier } from '../src/types'
import { colors } from '../src/ui/theme'

export default function Rankings() {
  const router = useRouter()
  const [scope, setScope] = useState('Courses')
  const [snapshot, setSnapshot] = useState<RankingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const { getAuthHeaders } = useAuthHeaders()

  const refreshRanking = useCallback(async () => {
    const currentRequest = ++requestVersion.current
    setError(null)
    setLoading(true)

    try {
      const headers = await getAuthHeaders()
      const nextSnapshot = await getRanking(headers)
      if (currentRequest === requestVersion.current) setSnapshot(nextSnapshot)
    } catch (reason) {
      if (currentRequest === requestVersion.current) setError(errorMessage(reason))
    } finally {
      if (currentRequest === requestVersion.current) setLoading(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => {
    void refreshRanking()
    return () => {
      requestVersion.current += 1
    }
  }, [refreshRanking]))

  const ranked = useMemo(() => {
    return snapshot?.entries.map((entry, index): DemoCourse => ({
      id: String(entry.course.id),
      name: entry.course.name,
      location: entry.course.region,
      rating: 0,
      reviews: '',
      distance: '',
      price: entry.course.green_fee > 500 ? '$$$$' : '$$$',
      accent: '#6E8B84',
      secondary: '#AEC3B7',
      image: demoCourses[index % 3].image,
      personalRank: entry.rank,
      personalRating: entry.personal_rating,
      tier: entry.tier,
    })) ?? []
  }, [snapshot])
  const leader = ranked[0]

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductScreen>
        <ScreenHeader title="Rankings" action={<IconButton icon="users" label="Friends rankings" />} />
        <View style={styles.tabs}>{['Courses', 'Friends'].map((tab) => <Pressable key={tab} onPress={() => setScope(tab)} style={[styles.tab, scope === tab && styles.tabActive]}><Text style={[styles.tabText, scope === tab && styles.tabTextActive]}>{tab.toUpperCase()}</Text></Pressable>)}</View>
        <SectionTitle title="MY COURSES" action="All time⌄" />

        {loading && !snapshot ? <View style={styles.status}><ActivityIndicator accessibilityLabel="Loading rankings" color={colors.pine} /><Text style={styles.statusText}>Loading your rankings...</Text></View> : null}

        {error && !snapshot ? <View style={styles.status}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text><RetryButton onPress={refreshRanking} /></View> : null}

        {snapshot && loading ? <View style={styles.inlineStatus}><ActivityIndicator accessibilityLabel="Refreshing rankings" color={colors.pine} size="small" /><Text style={styles.statusText}>Refreshing rankings...</Text></View> : null}

        {snapshot && error ? <View style={styles.inlineError}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text><RetryButton onPress={refreshRanking} /></View> : null}

        {snapshot && snapshot.entries.length === 0 ? <View style={styles.emptyState}><Feather name="flag" size={24} color={colors.pine} /><Text style={styles.emptyTitle}>Your rankings are ready to begin</Text><Text style={styles.emptyBody}>Rate a course to start building your personal list.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/discover' as never)} style={styles.outlineButton}><Text style={styles.outlineText}>Find a course to rate</Text></Pressable></View> : null}

        {leader ? <>
          <Pressable onPress={() => router.push(`/course/${leader.id}` as never)} style={styles.leader}>
            <CourseVisual course={leader} height={218}>
              <View style={styles.rankMark}><Text style={styles.rankMarkText}>1</Text></View>
              <View style={styles.leaderScrim} />
              <View style={styles.leaderInfo}><View style={{ flex: 1 }}><Text style={styles.leaderTitle}>{leader.name}</Text><Text style={styles.leaderMeta}>{leader.location}</Text></View><View style={{ alignItems: 'flex-end' }}><Text style={styles.leaderRating}>{leader.personalRating?.toFixed(1)}<Text style={styles.ratingScale}> / 10</Text></Text><Text style={styles.leaderMeta}>{tierLabel(leader.tier)} · My rating</Text></View></View>
            </CourseVisual>
            <View style={styles.leaderFacts}><Text style={styles.fact}>Best score: <Text style={styles.factStrong}>68 (-4)</Text></Text><Text style={styles.fact}>Played 6 times</Text></View>
          </Pressable>

          <View>{ranked.slice(1).map((course) => <DemoCourseRow key={course.id} course={course} index={course.personalRank} onPress={() => router.push(`/course/${course.id}` as never)} trailing={<View style={styles.rowRatingWrap}><Text style={styles.rowRating}>{course.personalRating?.toFixed(1)}<Text style={styles.rowScale}> / 10</Text></Text><Text style={styles.tierLabel}>{tierLabel(course.tier)}</Text></View>} />)}</View>

          <Pressable style={styles.outlineButton}><Text style={styles.outlineText}>Refine my rankings</Text></Pressable>
          <View style={styles.note}><Feather name="award" size={19} color={colors.pine} /><View style={{ flex: 1 }}><Text style={styles.noteTitle}>Your list is taking shape</Text><Text style={styles.noteBody}>Two more comparisons will improve confidence between ranks 3 and 4.</Text></View></View>
        </> : null}
      </ProductScreen>
      <BottomNav />
    </>
  )
}

const styles = StyleSheet.create({
  tabs: { borderBottomColor: '#D8D9D4', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row' }, tab: { alignItems: 'center', flex: 1, paddingBottom: 10 }, tabActive: { borderBottomColor: colors.pine, borderBottomWidth: 2 }, tabText: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 }, tabTextActive: { color: colors.pine },
  status: { alignItems: 'center', gap: 12, paddingVertical: 28 }, statusText: { color: colors.muted, fontSize: 11 }, errorText: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' }, inlineStatus: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center' }, inlineError: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 9, borderWidth: 1, gap: 9, padding: 12 }, retryButton: { borderColor: colors.pine, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 }, retryText: { color: colors.pine, fontSize: 10, fontWeight: '800' }, emptyState: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 10, borderWidth: 1, gap: 9, padding: 24 }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18, marginTop: 3, textAlign: 'center' }, emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 5, textAlign: 'center' },
  leader: { borderColor: '#D7D8D3', borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' }, rankMark: { left: 13, position: 'absolute', top: 8 }, rankMarkText: { color: '#FFF', fontFamily: 'Georgia', fontSize: 36 }, leaderScrim: { backgroundColor: 'rgba(6, 22, 14, 0.58)', bottom: 0, height: 70, left: 0, position: 'absolute', right: 0 }, leaderInfo: { alignItems: 'flex-end', bottom: 11, flexDirection: 'row', left: 13, position: 'absolute', right: 13 }, leaderTitle: { color: '#FFF', fontFamily: 'Georgia', fontSize: 21 }, leaderMeta: { color: '#E4E9E5', fontSize: 9, marginTop: 2 }, leaderRating: { color: '#FFF', fontFamily: 'Georgia', fontSize: 26 }, ratingScale: { fontFamily: undefined, fontSize: 10 }, leaderFacts: { flexDirection: 'row', justifyContent: 'space-between', padding: 11 }, fact: { color: colors.muted, fontSize: 9 }, factStrong: { color: colors.ink, fontWeight: '700' },
  rowRatingWrap: { alignItems: 'flex-end' }, rowRating: { color: colors.ink, fontFamily: 'Georgia', fontSize: 16 }, rowScale: { color: colors.muted, fontFamily: undefined, fontSize: 8 }, tierLabel: { color: colors.pine, fontSize: 8, fontWeight: '700', marginTop: 3, textTransform: 'uppercase' }, outlineButton: { alignItems: 'center', borderColor: colors.pine, borderRadius: 7, borderWidth: 1, paddingVertical: 12 }, outlineText: { color: colors.pine, fontSize: 12, fontWeight: '700' },
  note: { alignItems: 'center', borderBottomColor: '#D8D9D4', borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8D9D4', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, paddingVertical: 13 }, noteTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14 }, noteBody: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
})

function tierLabel(tier?: RankingTier): string {
  return ({ green: 'Green', fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker' } as const)[tier ?? 'rough']
}

function RetryButton({ onPress }: { onPress: () => Promise<void> }) {
  return <Pressable accessibilityRole="button" onPress={() => void onPress()} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable>
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Unable to load your rankings. Please try again.'
}

import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { getFriendRankings, getRanking, saveComparison as saveRankingComparison } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { Avatar, BottomNav, CourseVisual, DemoCourseRow, IconButton, ProductScreen, ScreenHeader, SectionTitle } from '../src/components/ProductUI'
import { DemoCourse, demoCourses } from '../src/data/demo'
import { ComparisonResult, FriendRanking, RankedCourse, RankingSnapshot, RankingTier } from '../src/types'
import { colors } from '../src/ui/theme'

export default function Rankings() {
  const router = useRouter()
  const [scope, setScope] = useState<'Courses' | 'Friends'>('Courses')
  const [snapshot, setSnapshot] = useState<RankingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [friendRankings, setFriendRankings] = useState<FriendRanking[] | null>(null)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [refining, setRefining] = useState(false)
  const [savingComparison, setSavingComparison] = useState(false)
  const [refinementError, setRefinementError] = useState<string | null>(null)
  const [comparedPairs, setComparedPairs] = useState<string[]>([])
  const [completedComparisons, setCompletedComparisons] = useState(0)
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

  const refreshFriendRankings = useCallback(async () => {
    setFriendsError(null)
    setFriendsLoading(true)
    try {
      const headers = await getAuthHeaders()
      setFriendRankings(await getFriendRankings(headers))
    } catch (reason) {
      setFriendsError(reason instanceof Error ? reason.message : 'Unable to load your friends’ rankings.')
    } finally {
      setFriendsLoading(false)
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
  const refinementPair = useMemo(
    () => nextRefinementPair(snapshot?.entries ?? [], new Set(comparedPairs)),
    [comparedPairs, snapshot],
  )
  const availableComparisons = useMemo(
    () => refinementPairCount(snapshot?.entries ?? []),
    [snapshot],
  )

  function openRefinement() {
    setComparedPairs([])
    setCompletedComparisons(0)
    setRefinementError(null)
    setRefining(true)
  }

  function selectScope(nextScope: 'Courses' | 'Friends') {
    setScope(nextScope)
    if (nextScope === 'Friends' && friendRankings === null && !friendsLoading) void refreshFriendRankings()
  }

  async function submitComparison(result: ComparisonResult) {
    if (!refinementPair || savingComparison) return
    setSavingComparison(true)
    setRefinementError(null)
    try {
      const headers = await getAuthHeaders()
      const nextSnapshot = await saveRankingComparison({
        course_a_id: refinementPair[0].course.id,
        course_b_id: refinementPair[1].course.id,
        result,
      }, headers)
      setSnapshot(nextSnapshot)
      setComparedPairs((current) => [...current, pairKey(refinementPair[0], refinementPair[1])])
      setCompletedComparisons((current) => current + 1)
    } catch (reason) {
      setRefinementError(errorMessage(reason))
    } finally {
      setSavingComparison(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductScreen>
        <ScreenHeader title="Rankings" action={<IconButton icon="users" label="Manage friends" onPress={() => router.push('/friends')} />} />
        <View style={styles.tabs}>{(['Courses', 'Friends'] as const).map((tab) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: scope === tab }} key={tab} onPress={() => selectScope(tab)} style={[styles.tab, scope === tab && styles.tabActive]}><Text style={[styles.tabText, scope === tab && styles.tabTextActive]}>{tab.toUpperCase()}</Text></Pressable>)}</View>
        {scope === 'Courses' ? <>
        <SectionTitle title="MY COURSES" />

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
            <View style={styles.leaderFacts}><Text style={styles.fact}>Best score: <Text style={styles.factStrong}>{snapshot?.entries[0]?.best_score ?? '—'}</Text></Text><Text style={styles.fact}>Played {snapshot?.entries[0]?.round_count ?? 0} {snapshot?.entries[0]?.round_count === 1 ? 'time' : 'times'}</Text></View>
          </Pressable>

          <View>{ranked.slice(1).map((course) => <DemoCourseRow key={course.id} course={course} index={course.personalRank} showRating={false} onPress={() => router.push(`/course/${course.id}` as never)} trailing={<View style={styles.rowRatingWrap}><Text style={styles.rowRating}>{course.personalRating?.toFixed(1)}<Text style={styles.rowScale}> / 10</Text></Text><Text style={styles.tierLabel}>{tierLabel(course.tier)}</Text></View>} />)}</View>

          <Pressable accessibilityRole="button" disabled={availableComparisons === 0} onPress={openRefinement} style={[styles.outlineButton, availableComparisons === 0 && styles.disabledButton]}><Text style={[styles.outlineText, availableComparisons === 0 && styles.disabledText]}>Refine my rankings</Text></Pressable>
          <View style={styles.note}><Feather name="award" size={19} color={colors.pine} /><View style={{ flex: 1 }}><Text style={styles.noteTitle}>{availableComparisons ? 'Your list is taking shape' : 'Add another course to refine'}</Text><Text style={styles.noteBody}>{availableComparisons ? `${availableComparisons} same-tier ${availableComparisons === 1 ? 'comparison' : 'comparisons'} can improve your ranking confidence.` : 'Pairwise refinement becomes available when two courses share a tier.'}</Text></View></View>
        </> : null}
        </> : <FriendsRankingsView error={friendsError} loading={friendsLoading} onCourse={(courseId) => router.push(`/course/${courseId}` as never)} onFindFriends={() => router.push('/friends')} onRetry={refreshFriendRankings} rankings={friendRankings} />}
      </ProductScreen>
      <BottomNav />
      <Modal animationType="slide" onRequestClose={() => setRefining(false)} presentationStyle="pageSheet" visible={refining}>
        <View style={styles.refinementScreen}>
          <View style={styles.refinementHeader}>
            <View><Text style={styles.refinementKicker}>REFINE YOUR LIST</Text><Text style={styles.refinementTitle}>Which would you play again?</Text></View>
            <Pressable accessibilityLabel="Close ranking refinement" accessibilityRole="button" hitSlop={8} onPress={() => setRefining(false)} style={styles.closeButton}><Feather name="x" size={21} color={colors.ink} /></Pressable>
          </View>

          {refinementPair ? <View style={styles.refinementBody}>
            <Text style={styles.refinementHelp}>Choose between two courses in the {tierLabel(refinementPair[0].tier)} tier. Each answer updates your order and confidence.</Text>
            <ComparisonCourse entry={refinementPair[0]} disabled={savingComparison} label="Choose first course" onPress={() => void submitComparison('course_a')} />
            <View style={styles.orRow}><View style={styles.orLine} /><Text style={styles.orText}>OR</Text><View style={styles.orLine} /></View>
            <ComparisonCourse entry={refinementPair[1]} disabled={savingComparison} label="Choose second course" onPress={() => void submitComparison('course_b')} />
            <View style={styles.secondaryChoices}>
              <Pressable accessibilityRole="button" disabled={savingComparison} onPress={() => void submitComparison('too_close')} style={styles.secondaryChoice}><Text style={styles.secondaryChoiceText}>Too close</Text></Pressable>
            </View>
            {savingComparison ? <View style={styles.savingRow}><ActivityIndicator accessibilityLabel="Saving comparison" color={colors.pine} size="small" /><Text style={styles.statusText}>Updating your rankings...</Text></View> : null}
            {refinementError ? <Text accessibilityRole="alert" style={styles.errorText}>{refinementError}</Text> : null}
            <Text style={styles.progressText}>{completedComparisons} completed this session</Text>
          </View> : <View style={styles.refinementComplete}>
            <Feather name="check-circle" size={34} color={colors.pine} />
            <Text style={styles.refinementTitle}>{completedComparisons ? 'Rankings refined' : 'Nothing to compare yet'}</Text>
            <Text style={styles.refinementHelp}>{completedComparisons ? `${completedComparisons} ${completedComparisons === 1 ? 'comparison has' : 'comparisons have'} been saved.` : 'Add at least two courses to the same tier, then come back to refine their order.'}</Text>
            <Pressable accessibilityRole="button" onPress={() => setRefining(false)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Done</Text></Pressable>
          </View>}
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  tabs: { borderBottomColor: '#D8D9D4', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row' }, tab: { alignItems: 'center', flex: 1, paddingBottom: 10 }, tabActive: { borderBottomColor: colors.pine, borderBottomWidth: 2 }, tabText: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 }, tabTextActive: { color: colors.pine },
  status: { alignItems: 'center', gap: 12, paddingVertical: 28 }, statusText: { color: colors.muted, fontSize: 11 }, errorText: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' }, inlineStatus: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center' }, inlineError: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 9, borderWidth: 1, gap: 9, padding: 12 }, retryButton: { borderColor: colors.pine, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 }, retryText: { color: colors.pine, fontSize: 10, fontWeight: '800' }, emptyState: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 10, borderWidth: 1, gap: 9, padding: 24 }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18, marginTop: 3, textAlign: 'center' }, emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 5, textAlign: 'center' },
  leader: { borderColor: '#D7D8D3', borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' }, rankMark: { left: 13, position: 'absolute', top: 8 }, rankMarkText: { color: '#FFF', fontFamily: 'Georgia', fontSize: 36 }, leaderScrim: { backgroundColor: 'rgba(6, 22, 14, 0.58)', bottom: 0, height: 70, left: 0, position: 'absolute', right: 0 }, leaderInfo: { alignItems: 'flex-end', bottom: 11, flexDirection: 'row', left: 13, position: 'absolute', right: 13 }, leaderTitle: { color: '#FFF', fontFamily: 'Georgia', fontSize: 21 }, leaderMeta: { color: '#E4E9E5', fontSize: 9, marginTop: 2 }, leaderRating: { color: '#FFF', fontFamily: 'Georgia', fontSize: 26 }, ratingScale: { fontFamily: undefined, fontSize: 10 }, leaderFacts: { flexDirection: 'row', justifyContent: 'space-between', padding: 11 }, fact: { color: colors.muted, fontSize: 9 }, factStrong: { color: colors.ink, fontWeight: '700' },
  rowRatingWrap: { alignItems: 'flex-end' }, rowRating: { color: colors.ink, fontFamily: 'Georgia', fontSize: 16 }, rowScale: { color: colors.muted, fontFamily: undefined, fontSize: 8 }, tierLabel: { color: colors.pine, fontSize: 8, fontWeight: '700', marginTop: 3, textTransform: 'uppercase' }, outlineButton: { alignItems: 'center', borderColor: colors.pine, borderRadius: 7, borderWidth: 1, paddingVertical: 12 }, outlineText: { color: colors.pine, fontSize: 12, fontWeight: '700' }, disabledButton: { borderColor: colors.line }, disabledText: { color: colors.muted },
  note: { alignItems: 'center', borderBottomColor: '#D8D9D4', borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8D9D4', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, paddingVertical: 13 }, noteTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14 }, noteBody: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
  friendSection: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 9 }, friendHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 12 }, friendName: { color: colors.ink, fontFamily: 'Georgia', fontSize: 16 }, friendHandle: { color: colors.muted, fontSize: 9, marginTop: 2 }, friendCourse: { alignItems: 'center', borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, paddingVertical: 11 }, friendRank: { color: colors.pine, fontFamily: 'Georgia', fontSize: 18, textAlign: 'center', width: 24 }, friendCourseName: { color: colors.ink, fontSize: 12, fontWeight: '700' }, friendCourseMeta: { color: colors.muted, fontSize: 9, marginTop: 3 }, friendRating: { color: colors.ink, fontFamily: 'Georgia', fontSize: 17 }, friendNoCourses: { color: colors.muted, fontSize: 10, paddingBottom: 12 },
  refinementScreen: { backgroundColor: colors.background, flex: 1, paddingHorizontal: 22, paddingTop: 22 }, refinementHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, refinementKicker: { color: colors.pine, fontSize: 9, fontWeight: '800', letterSpacing: 1.1 }, refinementTitle: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 25, lineHeight: 31, marginTop: 6 }, closeButton: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 }, refinementBody: { gap: 15, paddingTop: 30 }, refinementHelp: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' }, comparisonCourse: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 12, borderWidth: 1, gap: 5, padding: 20 }, comparisonRank: { color: colors.pine, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 }, comparisonName: { color: colors.ink, fontFamily: 'Georgia', fontSize: 21 }, comparisonMeta: { color: colors.muted, fontSize: 10 }, orRow: { alignItems: 'center', flexDirection: 'row', gap: 10 }, orLine: { backgroundColor: colors.line, flex: 1, height: StyleSheet.hairlineWidth }, orText: { color: colors.muted, fontSize: 9, fontWeight: '700' }, secondaryChoices: { flexDirection: 'row', gap: 10 }, secondaryChoice: { alignItems: 'center', borderColor: colors.pine, borderRadius: 7, borderWidth: 1, flex: 1, paddingVertical: 11 }, secondaryChoiceText: { color: colors.pine, fontSize: 11, fontWeight: '700' }, savingRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center' }, progressText: { color: colors.muted, fontSize: 9, textAlign: 'center' }, refinementComplete: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', paddingHorizontal: 28 }, primaryButton: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.pine, borderRadius: 8, paddingVertical: 13 }, primaryButtonText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
})

function FriendsRankingsView({ error, loading, onCourse, onFindFriends, onRetry, rankings }: { error: string | null; loading: boolean; onCourse: (courseId: number) => void; onFindFriends: () => void; onRetry: () => Promise<void>; rankings: FriendRanking[] | null }) {
  return <>
    <SectionTitle title="FRIENDS' COURSES" />
    {loading && rankings === null ? <View style={styles.status}><ActivityIndicator accessibilityLabel="Loading friends rankings" color={colors.pine} /><Text style={styles.statusText}>Loading friends’ rankings...</Text></View> : null}
    {error ? <View style={styles.status}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text><RetryButton onPress={onRetry} /></View> : null}
    {!loading && !error && rankings?.length === 0 ? <View style={styles.emptyState}><Feather name="users" size={24} color={colors.pine} /><Text style={styles.emptyTitle}>No friends’ rankings yet</Text><Text style={styles.emptyBody}>Mutual friends will appear here when they start ranking courses.</Text><Pressable accessibilityRole="button" hitSlop={8} onPress={onFindFriends}><Text style={styles.outlineText}>Find friends</Text></Pressable></View> : null}
    {rankings?.map((ranking) => <View key={ranking.user.id} style={styles.friendSection}>
      <View style={styles.friendHeader}><Avatar initials={initials(ranking.user.display_name)} size={38} color="#6E8B84" /><View style={{ flex: 1 }}><Text style={styles.friendName}>{ranking.user.display_name}</Text><Text style={styles.friendHandle}>{ranking.user.username ? `@${ranking.user.username}` : ranking.user.home_region ?? 'Golfer'}</Text></View></View>
      {ranking.entries.length ? ranking.entries.slice(0, 5).map((entry) => <Pressable accessibilityRole="button" key={entry.course.id} onPress={() => onCourse(entry.course.id)} style={({ pressed }) => [styles.friendCourse, pressed && { opacity: 0.6 }]}><Text style={styles.friendRank}>{entry.rank}</Text><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.friendCourseName}>{entry.course.name}</Text><Text numberOfLines={1} style={styles.friendCourseMeta}>{entry.course.region}</Text></View><Text style={styles.friendRating}>{entry.personal_rating.toFixed(1)}<Text style={styles.rowScale}> / 10</Text></Text><Feather name="chevron-right" size={15} color={colors.muted} /></Pressable>) : <Text style={styles.friendNoCourses}>No ranked courses yet.</Text>}
    </View>)}
  </>
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR'
}

function ComparisonCourse({ entry, disabled, label, onPress }: { entry: RankedCourse; disabled: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={`${label}: ${entry.course.name}`} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.comparisonCourse, pressed && { opacity: 0.75 }]}><Text style={styles.comparisonRank}>CURRENTLY #{entry.rank}</Text><Text style={styles.comparisonName}>{entry.course.name}</Text><Text style={styles.comparisonMeta}>{entry.course.region} · {entry.personal_rating.toFixed(1)} / 10 · {entry.confidence_label} confidence</Text></Pressable>
}

function nextRefinementPair(entries: RankedCourse[], excluded: Set<string>): [RankedCourse, RankedCourse] | null {
  const candidates: [RankedCourse, RankedCourse][] = []
  for (let index = 0; index < entries.length - 1; index += 1) {
    const pair: [RankedCourse, RankedCourse] = [entries[index], entries[index + 1]]
    if (pair[0].tier === pair[1].tier && !excluded.has(pairKey(...pair))) candidates.push(pair)
  }
  candidates.sort((left, right) => {
    const leftConfidence = left[0].confidence + left[1].confidence
    const rightConfidence = right[0].confidence + right[1].confidence
    return leftConfidence - rightConfidence || left[0].rank - right[0].rank
  })
  return candidates[0] ?? null
}

function refinementPairCount(entries: RankedCourse[]): number {
  return entries.slice(0, -1).filter((entry, index) => entry.tier === entries[index + 1].tier).length
}

function pairKey(first: RankedCourse, second: RankedCourse): string {
  return [first.course.id, second.course.id].sort((a, b) => a - b).join(':')
}

function tierLabel(tier?: RankingTier): string {
  return ({ green: 'Green', fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker' } as const)[tier ?? 'rough']
}

function RetryButton({ onPress }: { onPress: () => Promise<void> }) {
  return <Pressable accessibilityRole="button" onPress={() => void onPress()} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable>
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Unable to load your rankings. Please try again.'
}

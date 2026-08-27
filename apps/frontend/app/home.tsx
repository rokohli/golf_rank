import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'

import { getFeed, muteUser, setActivityReaction } from '../src/api/client'
import { useAuthGate } from '../src/auth/AuthProvider'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { Avatar, BottomNav, CourseVisual, IconButton, ProductScreen, SectionTitle } from '../src/components/ProductUI'
import { openUserProfile } from '../src/navigation/openUserProfile'
import { attributedCourseImage, CoursePresentation } from '../src/coursePresentation'
import { scoreToPar } from '../src/scorePresentation'
import { Activity, Course } from '../src/types'
import { colors } from '../src/ui/theme'

export default function Home() {
  const router = useRouter()
  const { profileImageUrl, profileInitials } = useAuthGate()
  const { getAuthHeaders } = useAuthHeaders()
  const [activities, setActivities] = useState<Activity[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [greeting, setGreeting] = useState(() => greetingForHour(new Date().getHours()))

  useEffect(() => {
    const updateGreeting = () => setGreeting(greetingForHour(new Date().getHours()))
    const interval = setInterval(updateGreeting, 60_000)
    return () => clearInterval(interval)
  }, [])

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const page = await getFeed(await getAuthHeaders())
      setActivities(page.items)
      setNextCursor(page.next_cursor)
    } catch (reason) {
      setActivities([])
      setError(message(reason, 'Unable to load friends activity.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await getFeed(await getAuthHeaders(), nextCursor)
      setActivities((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))])
      setNextCursor(page.next_cursor)
    } catch (reason) {
      setError(message(reason, 'Unable to load more activity.'))
    } finally {
      setLoadingMore(false)
    }
  }

  async function toggleReaction(activity: Activity) {
    const nextReacted = !activity.viewer_reacted
    setActivities((items) => items.map((item) => item.id === activity.id ? { ...item, viewer_reacted: nextReacted, reaction_count: Math.max(0, item.reaction_count + (nextReacted ? 1 : -1)) } : item))
    try {
      const result = await setActivityReaction(activity.id, nextReacted, await getAuthHeaders())
      setActivities((items) => items.map((item) => item.id === activity.id ? { ...item, ...result } : item))
    } catch (reason) {
      setActivities((items) => items.map((item) => item.id === activity.id ? activity : item))
      setError(message(reason, 'Unable to update this reaction.'))
    }
  }

  async function mute(activity: Activity) {
    try {
      await muteUser(activity.actor.id, true, await getAuthHeaders())
      setActivities((items) => items.filter((item) => item.actor.id !== activity.actor.id))
    } catch (reason) {
      setError(message(reason, 'Unable to mute this golfer.'))
    }
  }

  const featured = activities.find((activity) => activity.course) ?? null
  const recent = activities.filter((activity) => activity.id !== featured?.id)
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.pine} />}>
      <View style={styles.topRow}><Text style={styles.title}>{greeting}</Text><View style={styles.topActions}><IconButton icon="bell" label="Notifications" onPress={() => router.push('/notifications')} /><Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => router.push('/profile')}><Avatar imageUrl={profileImageUrl} initials={profileInitials} /></Pressable></View></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Plan a golf trip" onPress={() => router.push('/planner' as never)} style={({ pressed }) => [styles.planner, pressed && { opacity: 0.7 }]}><View style={styles.plannerIcon}><Feather name="map" size={19} color={colors.pine} /></View><View style={{ flex: 1 }}><Text style={styles.plannerTitle}>Plan a golf trip</Text><Text style={styles.muted}>Build and save a course itinerary from real catalog data.</Text></View><Feather name="chevron-right" size={17} color={colors.pine} /></Pressable>
      <SectionTitle title="FRIENDS ACTIVITY" action="Find friends" onPress={() => router.push('/friends')} />

      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading friends activity" color={colors.pine} /></View> : null}
      {!loading && error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
      {!loading && !error && !activities.length ? <View style={styles.state}><Feather name="users" size={26} color={colors.muted} /><Text style={styles.emptyTitle}>Your feed is quiet</Text><Text style={styles.muted}>Follow golfers to see their rounds, ratings, rankings, and saved courses.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/friends')} style={styles.retry}><Text style={styles.retryText}>Find golfers</Text></Pressable></View> : null}

      {featured?.course ? <FeaturedActivity activity={featured} onOpen={() => openActivity(featured, router)} onOpenProfile={() => openUserProfile(router, featured.actor.id)} onReact={() => void toggleReaction(featured)} /> : null}
      {recent.length ? <><SectionTitle title="RECENT ACTIVITY" /><View>{recent.map((activity, index) => <RecentActivity key={activity.id} activity={activity} last={index === recent.length - 1} onOpen={() => openActivity(activity, router)} onOpenProfile={() => openUserProfile(router, activity.actor.id)} onMute={() => void mute(activity)} onReact={() => void toggleReaction(activity)} />)}</View></> : null}
      {nextCursor ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={styles.loadMore}>{loadingMore ? <ActivityIndicator color={colors.pine} /> : <Text style={styles.loadMoreText}>Load more</Text>}</Pressable> : null}
    </ProductScreen>
    <BottomNav />
  </>
}

function FeaturedActivity({ activity, onOpen, onOpenProfile, onReact }: { activity: Activity; onOpen: () => void; onOpenProfile: () => void; onReact: () => void }) {
  const presentation = eventPresentation(activity)
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={presentation.accessibilityLabel} onPress={onOpen}>
      <CourseVisual course={toDisplayCourse(activity.course!, activity.id)} height={228}>
        <View style={styles.storyScrim} />
        <View style={styles.storyContent}><View style={styles.storyIdentity}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${activity.actor.display_name}'s profile`} onPress={onOpenProfile}><Avatar initials={initials(activity.actor.display_name)} size={36} /></Pressable><View style={{ flex: 1 }}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${activity.actor.display_name}'s profile`} onPress={onOpenProfile}><Text style={styles.storyKicker}>{activity.actor.display_name} {presentation.action}</Text></Pressable><Text style={styles.storyTitle}>{activity.course!.name}</Text><Text style={styles.storyMeta}>{activity.course!.region}</Text></View></View><ActivityMetric activity={activity} light /></View>
      </CourseVisual>
    </Pressable>
    <ActivityDetails activity={activity} />
    <View style={styles.socialProof}><Text style={styles.muted}>{relativeTime(activity.created_at)}</Text><View style={styles.footerReaction}><Pressable accessibilityRole="button" accessibilityLabel={activity.viewer_reacted ? 'Unlike activity' : 'Like activity'} onPress={onReact}><Feather name="heart" size={18} color={activity.viewer_reacted ? '#A14E4E' : colors.muted} /></Pressable>{activity.reaction_count > 0 ? <Text style={styles.muted}>{likeLabel(activity.reaction_count)}</Text> : null}</View></View>
  </>
}

function RecentActivity({ activity, last, onOpen, onOpenProfile, onMute, onReact }: { activity: Activity; last: boolean; onOpen: () => void; onOpenProfile: () => void; onMute: () => void; onReact: () => void }) {
  const presentation = eventPresentation(activity)
  return <View style={[styles.activityRow, last && styles.lastRow]}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${activity.actor.display_name}'s profile`} onPress={onOpenProfile}><Avatar initials={initials(activity.actor.display_name)} size={38} /></Pressable><View style={styles.activityBody}><View style={styles.activityCopy}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${activity.actor.display_name}'s profile`} onPress={onOpenProfile}><Text style={styles.activityPerson}>{activity.actor.display_name} {presentation.action}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={presentation.accessibilityLabel} onPress={onOpen}><Text style={styles.activityCourse}>{activity.course?.name ?? presentation.title}</Text></Pressable></View><ActivityDetails activity={activity} /><View style={styles.activityFooter}><Text style={styles.muted}>{relativeTime(activity.created_at)}</Text></View></View><View style={styles.activitySide}><View style={styles.activitySideTop}><ActivityMetric activity={activity} />{!activity.is_own_activity ? <Pressable accessibilityRole="button" accessibilityLabel={`Mute ${activity.actor.display_name}`} onPress={onMute} style={styles.muteButton}><Feather name="more-horizontal" size={16} color={colors.muted} /></Pressable> : null}</View><View style={styles.footerReaction}><Pressable accessibilityRole="button" accessibilityLabel={activity.viewer_reacted ? 'Unlike activity' : 'Like activity'} onPress={onReact}><Feather name="heart" size={15} color={activity.viewer_reacted ? '#A14E4E' : colors.muted} /></Pressable>{activity.reaction_count > 0 ? <Text style={styles.likeCount}>{likeLabel(activity.reaction_count)}</Text> : null}</View></View></View>
}

function ActivityMetric({ activity, light = false }: { activity: Activity; light?: boolean }) {
  if (activity.event_type === 'round_logged' && typeof activity.data.score === 'number') {
    const difference = scoreToPar(activity.data.score, activity.course?.par)
    return <View style={styles.scoreMetric}><Text style={[styles.scoreValue, light && styles.scoreValueLight]}>{activity.data.score}</Text>{difference ? <View style={[styles.scoreDifference, light && styles.scoreDifferenceLight]}><Text style={[styles.scoreDifferenceText, light && styles.scoreDifferenceTextLight]}>{difference}</Text></View> : null}</View>
  }
  if (activity.event_type === 'course_rated' && typeof activity.data.rating === 'number') return <Text style={[styles.ratingValue, light && styles.ratingValueLight]}>{activity.data.rating}/10</Text>
  return null
}

function ActivityDetails({ activity }: { activity: Activity }) {
  const note = typeof activity.data.note === 'string' && activity.data.note.trim() ? activity.data.note.trim() : null
  const favoriteHole = typeof activity.data.favorite_hole === 'number' ? activity.data.favorite_hole : null
  if (!note && favoriteHole === null) return null
  return <View style={styles.activityDetails}>{note ? <Text ellipsizeMode="tail" numberOfLines={3} style={styles.activityNote}>{note}</Text> : null}{favoriteHole !== null ? <View style={styles.favoriteHole}><Feather name="flag" size={11} color={colors.pine} /><Text style={styles.favoriteHoleText}>Favorite hole {favoriteHole}</Text></View> : null}</View>
}

function eventPresentation(activity: Activity) {
  const course = activity.course?.name ?? 'activity'
  if (activity.event_type === 'round_logged') return { action: 'played', title: 'Round', detail: roundScoreDetail(activity.data.score, activity.course?.par), accessibilityLabel: `Open round at ${course}` }
  if (activity.event_type === 'course_rated') return { action: 'rated', title: 'Course rating', detail: numberDetail(activity.data.rating, '/10'), accessibilityLabel: `Open rated course ${course}` }
  if (activity.event_type === 'course_saved') return { action: 'saved', title: 'Saved course', detail: null, accessibilityLabel: `Open saved course ${course}` }
  if (activity.event_type === 'ranking_updated') return { action: 'updated their rankings', title: 'Ranking update', detail: numberDetail(activity.data.course_count, ' courses'), accessibilityLabel: 'Open ranking activity' }
  return { action: 'shared', title: 'Golf update', detail: null, accessibilityLabel: 'Open activity' }
}

function toDisplayCourse(course: Course, _index: number): CoursePresentation { return { id: String(course.id), name: course.name, location: course.region, rating: course.community_rating ?? 0, reviews: '', distance: '', price: '', image: attributedCourseImage(course) } }
function openActivity(activity: Activity, router: ReturnType<typeof useRouter>) { if (activity.course) router.push(`/course/${activity.course.id}` as never) }
function numberDetail(value: unknown, suffix = '') { return typeof value === 'number' ? `${value}${suffix}` : null }
function roundScoreDetail(score: unknown, par: number | null | undefined) { return typeof score === 'number' ? [String(score), scoreToPar(score, par)].filter(Boolean).join(' ') : null }
function likeLabel(count: number) { return `${count} ${count === 1 ? 'like' : 'likes'}` }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR' }
function relativeTime(value: string) { const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago` }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }
export function greetingForHour(hour: number) { return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening' }

const styles = StyleSheet.create({
  topRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, topActions: { alignItems: 'center', flexDirection: 'row', gap: 9 }, title: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 31, fontWeight: '400', letterSpacing: -0.8, lineHeight: 36 },
  planner: { alignItems: 'center', backgroundColor: colors.pineSoft, borderRadius: 13, flexDirection: 'row', gap: 11, padding: 13 }, plannerIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, plannerTitle: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 16, marginBottom: 3 },
  storyScrim: { backgroundColor: 'rgba(5, 21, 13, 0.62)', bottom: 0, height: 92, left: 0, position: 'absolute', right: 0 }, storyContent: { alignItems: 'center', bottom: 13, flexDirection: 'row', left: 13, position: 'absolute', right: 13 }, storyIdentity: { alignItems: 'center', flexDirection: 'row', flex: 1, gap: 9 }, storyKicker: { color: '#DCE5DE', fontSize: 9 }, storyTitle: { color: '#FFF', fontFamily: 'Georgia', fontSize: 18, marginTop: 2 }, storyMeta: { color: '#E4E9E5', fontSize: 10, marginTop: 2 },
  socialProof: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 13 }, footerReaction: { alignItems: 'center', flexDirection: 'row', gap: 5 }, muted: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  activityRow: { alignItems: 'stretch', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, paddingVertical: 12 }, lastRow: { borderBottomWidth: 0 }, activityBody: { flex: 1 }, activityCopy: { flex: 1 }, activityPerson: { color: colors.muted, fontSize: 10 }, activityCourse: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14, marginTop: 3 }, activityDetails: { gap: 6, marginTop: 8 }, activityNote: { color: colors.ink, fontSize: 11, lineHeight: 16 }, favoriteHole: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.pineSoft, borderRadius: 10, flexDirection: 'row', gap: 4, paddingHorizontal: 7, paddingVertical: 3 }, favoriteHoleText: { color: colors.pineDark, fontSize: 9, fontWeight: '700' }, activityFooter: { marginTop: 9 }, activitySide: { alignItems: 'flex-end', justifyContent: 'space-between', minWidth: 62 }, activitySideTop: { alignItems: 'flex-end', gap: 7 }, scoreMetric: { alignItems: 'center', flexDirection: 'row', gap: 5 }, scoreValue: { color: colors.pine, fontFamily: 'Georgia', fontSize: 22, fontWeight: '400', letterSpacing: -0.5 }, scoreValueLight: { color: '#FFF' }, scoreDifference: { alignItems: 'center', borderColor: colors.muted, borderRadius: 13, borderWidth: 1, height: 26, justifyContent: 'center', minWidth: 26, paddingHorizontal: 4 }, scoreDifferenceLight: { borderColor: 'rgba(255,255,255,0.78)' }, scoreDifferenceText: { color: colors.muted, fontSize: 9, fontWeight: '700' }, scoreDifferenceTextLight: { color: '#FFF' }, ratingValue: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 20, fontWeight: '400', letterSpacing: -0.3 }, ratingValueLight: { color: '#FFF' }, muteButton: { marginRight: -2 }, likeCount: { color: colors.muted, fontSize: 9 },
  state: { alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 42 }, error: { color: colors.error, fontSize: 12, lineHeight: 18, textAlign: 'center' }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 }, retry: { backgroundColor: colors.pine, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9 }, retryText: { color: '#FFF', fontSize: 11, fontWeight: '800' }, loadMore: { alignItems: 'center', padding: 14 }, loadMoreText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
})

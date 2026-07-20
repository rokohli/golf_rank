import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'

import { getFeed, muteUser, setActivityReaction } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { Avatar, BottomNav, CourseVisual, IconButton, ProductScreen, SectionTitle } from '../src/components/ProductUI'
import { DemoCourse, demoCourses } from '../src/data/demo'
import { Activity, Course } from '../src/types'
import { colors } from '../src/ui/theme'

export default function Home() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [activities, setActivities] = useState<Activity[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <View style={styles.topRow}><Text style={styles.title}>Good morning</Text><View style={styles.topActions}><IconButton icon="bell" label="Notifications" onPress={() => router.push('/notifications')} /><Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => router.push('/profile')}><Avatar initials="GR" /></Pressable></View></View>
      <SectionTitle title="FRIENDS ACTIVITY" action="Find friends" onPress={() => router.push('/friends')} />

      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading friends activity" color={colors.pine} /></View> : null}
      {!loading && error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
      {!loading && !error && !activities.length ? <View style={styles.state}><Feather name="users" size={26} color={colors.muted} /><Text style={styles.emptyTitle}>Your feed is quiet</Text><Text style={styles.muted}>Follow golfers to see their rounds, ratings, rankings, and saved courses.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/friends')} style={styles.retry}><Text style={styles.retryText}>Find golfers</Text></Pressable></View> : null}

      {featured?.course ? <FeaturedActivity activity={featured} onOpen={() => openActivity(featured, router)} onReact={() => void toggleReaction(featured)} /> : null}
      {recent.length ? <><SectionTitle title="RECENT ACTIVITY" /><View>{recent.map((activity, index) => <RecentActivity key={activity.id} activity={activity} last={index === recent.length - 1} onOpen={() => openActivity(activity, router)} onMute={() => void mute(activity)} onReact={() => void toggleReaction(activity)} />)}</View></> : null}
      {nextCursor ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={styles.loadMore}>{loadingMore ? <ActivityIndicator color={colors.pine} /> : <Text style={styles.loadMoreText}>Load more</Text>}</Pressable> : null}
    </ProductScreen>
    <BottomNav />
  </>
}

function FeaturedActivity({ activity, onOpen, onReact }: { activity: Activity; onOpen: () => void; onReact: () => void }) {
  const presentation = eventPresentation(activity)
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={presentation.accessibilityLabel} onPress={onOpen}>
      <CourseVisual course={toDisplayCourse(activity.course!, activity.id)} height={228}>
        <View style={styles.storyScrim} />
        <View style={styles.storyContent}><View style={styles.storyIdentity}><Avatar initials={initials(activity.actor.display_name)} size={36} /><View style={{ flex: 1 }}><Text style={styles.storyKicker}>{activity.actor.display_name} {presentation.action}</Text><Text style={styles.storyTitle}>{activity.course!.name}</Text><Text style={styles.storyMeta}>{activity.course!.region} · {relativeTime(activity.created_at)}</Text></View></View>{presentation.detail ? <Text style={styles.score}>{presentation.detail}</Text> : null}</View>
      </CourseVisual>
    </Pressable>
    <View style={styles.socialProof}><Text style={styles.muted}>{activity.reaction_count ? `${activity.reaction_count} ${activity.reaction_count === 1 ? 'person likes' : 'people like'} this` : 'Be the first to like this'}</Text><Pressable accessibilityRole="button" accessibilityLabel={activity.viewer_reacted ? 'Unlike activity' : 'Like activity'} onPress={onReact} style={{ marginLeft: 'auto' }}><Feather name="heart" size={18} color={activity.viewer_reacted ? '#A14E4E' : colors.pine} /></Pressable></View>
  </>
}

function RecentActivity({ activity, last, onOpen, onMute, onReact }: { activity: Activity; last: boolean; onOpen: () => void; onMute: () => void; onReact: () => void }) {
  const presentation = eventPresentation(activity)
  return <View style={[styles.activityRow, last && styles.lastRow]}><Avatar initials={initials(activity.actor.display_name)} size={38} /><Pressable accessibilityRole="button" accessibilityLabel={presentation.accessibilityLabel} onPress={onOpen} style={{ flex: 1 }}><Text style={styles.activityPerson}>{activity.actor.display_name} {presentation.action}</Text><Text style={styles.activityCourse}>{activity.course?.name ?? presentation.title}</Text></Pressable><View style={styles.activityActions}>{presentation.detail ? <Text style={styles.activityDetail}>{presentation.detail}</Text> : null}<Text style={styles.muted}>{relativeTime(activity.created_at)}</Text><View style={styles.inlineActions}><Pressable accessibilityRole="button" accessibilityLabel={activity.viewer_reacted ? 'Unlike activity' : 'Like activity'} onPress={onReact}><Feather name="heart" size={15} color={activity.viewer_reacted ? '#A14E4E' : colors.muted} /></Pressable>{!activity.is_own_activity ? <Pressable accessibilityRole="button" accessibilityLabel={`Mute ${activity.actor.display_name}`} onPress={onMute}><Feather name="more-horizontal" size={16} color={colors.muted} /></Pressable> : null}</View></View></View>
}

function eventPresentation(activity: Activity) {
  const course = activity.course?.name ?? 'activity'
  if (activity.event_type === 'round_logged') return { action: 'played', title: 'Round', detail: numberDetail(activity.data.score), accessibilityLabel: `Open round at ${course}` }
  if (activity.event_type === 'course_rated') return { action: 'rated', title: 'Course rating', detail: numberDetail(activity.data.rating, '/10'), accessibilityLabel: `Open rated course ${course}` }
  if (activity.event_type === 'course_saved') return { action: 'saved', title: 'Saved course', detail: null, accessibilityLabel: `Open saved course ${course}` }
  if (activity.event_type === 'ranking_updated') return { action: 'updated their rankings', title: 'Ranking update', detail: numberDetail(activity.data.course_count, ' courses'), accessibilityLabel: 'Open ranking activity' }
  return { action: 'shared', title: 'Golf update', detail: null, accessibilityLabel: 'Open activity' }
}

function toDisplayCourse(course: Course, index: number): DemoCourse { return { id: String(course.id), name: course.name, location: course.region, rating: course.community_rating ?? 0, reviews: '', distance: '', price: '', accent: '#6E8B84', secondary: '#AEC3B7', image: demoCourses[index % demoCourses.length].image } }
function openActivity(activity: Activity, router: ReturnType<typeof useRouter>) { if (activity.course) router.push(`/course/${activity.course.id}` as never) }
function numberDetail(value: unknown, suffix = '') { return typeof value === 'number' ? `${value}${suffix}` : null }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR' }
function relativeTime(value: string) { const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago` }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  topRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, topActions: { alignItems: 'center', flexDirection: 'row', gap: 9 }, title: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 31, fontWeight: '400', letterSpacing: -0.8, lineHeight: 36 },
  storyScrim: { backgroundColor: 'rgba(5, 21, 13, 0.62)', bottom: 0, height: 92, left: 0, position: 'absolute', right: 0 }, storyContent: { alignItems: 'center', bottom: 13, flexDirection: 'row', left: 13, position: 'absolute', right: 13 }, storyIdentity: { alignItems: 'center', flexDirection: 'row', flex: 1, gap: 9 }, storyKicker: { color: '#DCE5DE', fontSize: 9 }, storyTitle: { color: '#FFF', fontFamily: 'Georgia', fontSize: 18, marginTop: 2 }, storyMeta: { color: '#E4E9E5', fontSize: 10, marginTop: 2 }, score: { color: '#FFF', fontFamily: 'Georgia', fontSize: 28 },
  socialProof: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingBottom: 13 }, muted: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  activityRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, paddingVertical: 12 }, lastRow: { borderBottomWidth: 0 }, activityPerson: { color: colors.muted, fontSize: 10 }, activityCourse: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14, marginTop: 3 }, activityDetail: { color: colors.ink, fontSize: 11, fontWeight: '700' }, activityActions: { alignItems: 'flex-end', gap: 3 }, inlineActions: { flexDirection: 'row', gap: 9, marginTop: 3 },
  state: { alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 42 }, error: { color: colors.error, fontSize: 12, lineHeight: 18, textAlign: 'center' }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 }, retry: { backgroundColor: colors.pine, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9 }, retryText: { color: '#FFF', fontSize: 11, fontWeight: '800' }, loadMore: { alignItems: 'center', padding: 14 }, loadMoreText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
})

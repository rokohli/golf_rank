import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'

import { getFeed, muteUser, setActivityReaction } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { Activity } from '../src/types'
import { Avatar, BottomNav, IconButton, ProductScreen, ScreenHeader } from '../src/components/ProductUI'
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
      const headers = await getAuthHeaders()
      const page = await getFeed(headers)
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

  useFocusEffect(useCallback(() => {
    void load()
  }, [load]))

  const loadMore = async () => {
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

  const toggleReaction = async (activity: Activity) => {
    const nextReacted = !activity.viewer_reacted
    setActivities((items) => items.map((item) => item.id === activity.id ? {
      ...item,
      viewer_reacted: nextReacted,
      reaction_count: Math.max(0, item.reaction_count + (nextReacted ? 1 : -1)),
    } : item))
    try {
      const result = await setActivityReaction(activity.id, nextReacted, await getAuthHeaders())
      setActivities((items) => items.map((item) => item.id === activity.id ? { ...item, ...result } : item))
    } catch (reason) {
      setActivities((items) => items.map((item) => item.id === activity.id ? activity : item))
      setError(message(reason, 'Unable to update this reaction.'))
    }
  }

  const mute = async (activity: Activity) => {
    try {
      await muteUser(activity.actor.id, true, await getAuthHeaders())
      setActivities((items) => items.filter((item) => item.actor.id !== activity.actor.id))
    } catch (reason) {
      setError(message(reason, 'Unable to mute this golfer.'))
    }
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.pine} />}>
      <ScreenHeader title="Home" action={<View style={styles.actions}><IconButton icon="bell" label="Notifications" onPress={() => router.push('/notifications')} /><Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => router.push('/profile')}><Avatar initials="GR" /></Pressable></View>} />
      <View><Text style={styles.eyebrow}>FRIENDS ACTIVITY</Text><Text style={styles.subtitle}>Rounds, ratings, rankings, and saved courses from people you follow.</Text></View>

      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading friends activity" color={colors.pine} /><Text style={styles.muted}>Loading activity…</Text></View> : null}
      {!loading && error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
      {!loading && !error && !activities.length ? <View style={styles.state}><Feather name="users" size={26} color={colors.muted} /><Text style={styles.emptyTitle}>Your feed is quiet</Text><Text style={styles.muted}>Follow golfers to see their friends-visible and public activity here.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/friends')} style={styles.retry}><Text style={styles.retryText}>Find golfers</Text></Pressable></View> : null}

      <View>{activities.map((activity) => <ActivityCard key={activity.id} activity={activity} onOpen={() => openActivity(activity, router)} onReact={() => void toggleReaction(activity)} onMute={() => void mute(activity)} />)}</View>
      {nextCursor ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={styles.loadMore}>{loadingMore ? <ActivityIndicator color={colors.pine} /> : <Text style={styles.loadMoreText}>Load more</Text>}</Pressable> : null}
      <Text style={styles.attribution}>Course catalog data © OpenGolfAPI, ODbL 1.0</Text>
    </ProductScreen>
    <BottomNav />
  </>
}

function ActivityCard({ activity, onOpen, onReact, onMute }: { activity: Activity; onOpen: () => void; onReact: () => void; onMute: () => void }) {
  const presentation = eventPresentation(activity)
  return <View style={styles.card}>
    <View style={styles.cardHeader}><Avatar initials={initials(activity.actor.display_name)} size={38} /><View style={{ flex: 1 }}><Text style={styles.actor}>{activity.actor.display_name}</Text><Text style={styles.muted}>{presentation.action} · {relativeTime(activity.created_at)}</Text></View>{!activity.is_own_activity ? <Pressable accessibilityRole="button" accessibilityLabel={`Mute ${activity.actor.display_name}`} onPress={onMute} hitSlop={8}><Feather name="more-horizontal" size={18} color={colors.muted} /></Pressable> : null}</View>
    <Pressable accessibilityRole="button" accessibilityLabel={presentation.accessibilityLabel} onPress={onOpen} style={styles.subject}>
      <Feather name={presentation.icon} size={18} color={colors.pine} />
      <View style={{ flex: 1 }}><Text style={styles.course}>{activity.course?.name ?? presentation.title}</Text>{activity.course ? <Text style={styles.muted}>{activity.course.region}</Text> : null}</View>
      {presentation.detail ? <Text style={styles.detail}>{presentation.detail}</Text> : null}
      <Feather name="chevron-right" size={16} color={colors.muted} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={activity.viewer_reacted ? 'Unlike activity' : 'Like activity'} onPress={onReact} style={styles.reaction}><Feather name="heart" size={17} color={activity.viewer_reacted ? '#A14E4E' : colors.muted} /><Text style={[styles.muted, activity.viewer_reacted && { color: '#A14E4E' }]}>{activity.reaction_count || 'Like'}</Text></Pressable>
  </View>
}

function eventPresentation(activity: Activity): { action: string; title: string; detail: string | null; icon: keyof typeof Feather.glyphMap; accessibilityLabel: string } {
  const course = activity.course?.name ?? 'activity'
  if (activity.event_type === 'round_logged') return { action: 'played a round', title: 'Round', detail: numberDetail(activity.data.score), icon: 'flag', accessibilityLabel: `Open round at ${course}` }
  if (activity.event_type === 'course_rated') return { action: 'rated a course', title: 'Course rating', detail: numberDetail(activity.data.rating, '/10'), icon: 'award', accessibilityLabel: `Open rated course ${course}` }
  if (activity.event_type === 'course_saved') return { action: 'saved a course', title: 'Saved course', detail: null, icon: 'bookmark', accessibilityLabel: `Open saved course ${course}` }
  if (activity.event_type === 'ranking_updated') return { action: 'updated their rankings', title: 'Ranking update', detail: numberDetail(activity.data.course_count, ' courses'), icon: 'bar-chart-2', accessibilityLabel: 'Open ranking activity' }
  return { action: 'shared an update', title: 'Golf update', detail: null, icon: 'activity', accessibilityLabel: 'Open activity' }
}

function openActivity(activity: Activity, router: ReturnType<typeof useRouter>) {
  if (activity.course) router.push(`/course/${activity.course.id}` as never)
}

function numberDetail(value: unknown, suffix = '') { return typeof value === 'number' ? `${value}${suffix}` : null }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR' }
function relativeTime(value: string) { const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago` }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  actions: { alignItems: 'center', flexDirection: 'row', gap: 8 }, eyebrow: { color: colors.ink, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }, subtitle: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  state: { alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 42 }, muted: { color: colors.muted, fontSize: 10, lineHeight: 15 }, error: { color: '#9A3E3E', fontSize: 12, lineHeight: 18, textAlign: 'center' }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 }, retry: { backgroundColor: colors.pine, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9 }, retryText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  card: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 11, paddingVertical: 15 }, cardHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 }, actor: { color: colors.ink, fontSize: 12, fontWeight: '800' }, subject: { alignItems: 'center', backgroundColor: '#F4F5F1', borderRadius: 9, flexDirection: 'row', gap: 11, padding: 12 }, course: { color: colors.ink, fontFamily: 'Georgia', fontSize: 15, marginBottom: 3 }, detail: { color: colors.pineDark, fontSize: 12, fontWeight: '800' }, reaction: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6 }, loadMore: { alignItems: 'center', padding: 14 }, loadMoreText: { color: colors.pine, fontSize: 11, fontWeight: '800' }, attribution: { color: colors.muted, fontSize: 8, textAlign: 'center' },
})

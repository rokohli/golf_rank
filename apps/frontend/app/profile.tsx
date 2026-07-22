import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getProfile, getRoundSummary } from '../src/api/client'
import { useAuthGate } from '../src/auth/AuthProvider'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { Avatar, BottomNav, CourseVisual, ProductScreen } from '../src/components/ProductUI'
import { DemoCourse } from '../src/data/demo'
import { Course, OnboardingPreferences, RoundSummary } from '../src/types'
import { colors } from '../src/ui/theme'

export default function Profile() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { profileImageUrl } = useAuthGate()
  const { getAuthHeaders } = useAuthHeaders()
  const [profile, setProfile] = useState<OnboardingPreferences | null>(null)
  const [summary, setSummary] = useState<RoundSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const [nextProfile, nextSummary] = await Promise.all([getProfile(headers), getRoundSummary(headers)])
      setProfile(nextProfile)
      setSummary(nextSummary)
    } catch (reason) {
      setError(message(reason, 'Unable to load your profile.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const first = profile?.onboarding_data?.first_name?.trim() ?? ''
  const last = profile?.onboarding_data?.last_name?.trim() ?? ''
  const name = `${first} ${last}`.trim() || 'Golfer'
  const username = profile?.onboarding_data?.username?.trim() ?? ''
  const latestRound = summary?.latest_round

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen edgeToEdge refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.pine} />}>
      <View style={styles.hero}>
        <CourseVisual course={profileBackdrop} height={176 + insets.top} squareTop />
        <Pressable accessibilityLabel="Profile settings" accessibilityRole="button" hitSlop={10} onPress={() => router.push('/settings' as never)} style={({ pressed }) => [styles.settings, { top: insets.top + 8 }, pressed && styles.pressed]}>
          <Feather name="settings" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.avatarWrap}><Avatar color={colors.pine} imageUrl={profileImageUrl} initials={initials(name)} size={64} /></View>
      </View>

      <View style={styles.identity}>
        <Text style={styles.name}>{name}</Text>
        {username ? <Text style={styles.handle}>@{username}</Text> : null}
        {profile?.home_region ? <View style={styles.regionRow}><Feather name="map-pin" size={12} color={colors.muted} /><Text style={styles.region}>{profile.home_region}</Text></View> : null}
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/profile/edit' as never)}><Text style={styles.editLink}>Edit profile</Text></Pressable>
      </View>

      {loading ? <ActivityIndicator accessibilityLabel="Loading profile" color={colors.pine} /> : null}
      {error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}

      <View style={styles.stats}>
        <ProfileStat label="Rounds" value={summary?.total_rounds ?? '—'} />
        <ProfileStat label="Courses" value={summary?.distinct_courses ?? '—'} />
        <ProfileStat label="Avg score" value={formatAverage(summary?.average_score)} />
        <ProfileStat label="Best" value={summary?.best_score ?? '—'} last />
      </View>

      <View style={styles.actions}>
        <ProfileAction icon="users" label="Friends" onPress={() => router.push('/friends')} />
        <ProfileAction icon="bookmark" label="Saved" onPress={() => router.push('/saved')} />
        <ProfileAction icon="clock" label="Rounds" onPress={() => router.push('/rounds')} />
        <ProfileAction icon="map" label="Trips" onPress={() => router.push('/planner' as never)} />
      </View>

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Recent round</Text></View>
      {latestRound ? <>
        <Pressable accessibilityLabel={`Open ${latestRound.course.name} round`} accessibilityRole="button" onPress={() => router.push(`/round/${latestRound.id}` as never)} style={({ pressed }) => [styles.recent, pressed && styles.pressed]}>
          <View style={styles.recentImage}><CourseVisual course={displayCourse(latestRound.course)} height={62} /></View>
          <View style={styles.recentCopy}>
            <Text numberOfLines={1} style={styles.recentTitle}>{latestRound.course.name}</Text>
            <Text numberOfLines={1} style={styles.recentMeta}>{formatDate(latestRound.played_on)} · {latestRound.course.region}</Text>
          </View>
          <Text accessibilityLabel={latestRound.score == null ? 'No score recorded' : `Score ${latestRound.score}`} style={styles.recentScore}>{latestRound.score ?? '—'}</Text>
          {latestRound.is_favorite ? <Feather accessibilityLabel="Favorite round" name="star" size={18} color={colors.gold} /> : null}
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/rounds')}><Text style={styles.viewAll}>View all rounds</Text></Pressable>
      </> : !loading && !error ? <View style={styles.empty}><Text style={styles.emptyText}>Your most recent round will appear here.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/round/new' as never)}><Text style={styles.logLink}>Log a round</Text></Pressable></View> : null}
    </ProductScreen>
    <BottomNav />
  </>
}

function ProfileStat({ label, last = false, value }: { label: string; last?: boolean; value: number | string }) {
  return <View style={[styles.stat, last && styles.statLast]}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>
}

function ProfileAction({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Feather name={icon} size={20} color={colors.pine} /><Text style={styles.actionText}>{label}</Text></Pressable>
}

const profileBackdrop: DemoCourse = { id: 'profile', name: 'Profile', location: '', rating: 0, reviews: '', distance: '', price: '', accent: '#6E8B84', secondary: '#AEC3B7' }
function displayCourse(course: Course): DemoCourse { const hero = course.images?.find((image) => image.is_hero && image.url) ?? course.images?.find((image) => image.url); return { id: String(course.id), name: course.name, location: course.region, rating: course.community_rating ?? 0, reviews: '', distance: '', price: '', accent: '#6E8B84', secondary: '#AEC3B7', image: hero?.url ? { uri: hero.url } : undefined } }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR' }
function formatAverage(value: number | null | undefined) { return value == null ? '—' : value.toFixed(1) }
function formatDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  hero: { marginHorizontal: -18, marginTop: -18, position: 'relative' },
  settings: { alignItems: 'center', height: 44, justifyContent: 'center', position: 'absolute', right: 10, width: 44 },
  avatarWrap: { alignItems: 'center', bottom: -32, left: 0, position: 'absolute', right: 0 },
  identity: { alignItems: 'center', gap: 4, marginTop: 22 },
  name: { color: colors.ink, fontFamily: 'Georgia', fontSize: 23 },
  handle: { color: colors.muted, fontSize: 11 },
  regionRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  region: { color: colors.muted, fontSize: 10 },
  editLink: { color: colors.pine, fontSize: 11, fontWeight: '800', marginTop: 5 },
  stats: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingVertical: 12 },
  stat: { alignItems: 'center', borderRightColor: colors.line, borderRightWidth: StyleSheet.hairlineWidth, flex: 1 },
  statLast: { borderRightWidth: 0 },
  statValue: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 },
  statLabel: { color: colors.muted, fontSize: 8, marginTop: 3, textTransform: 'uppercase' },
  actions: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 14, paddingBottom: 14 },
  action: { alignItems: 'center', gap: 6, minWidth: 72, paddingVertical: 5 },
  actionText: { color: colors.pine, fontSize: 10, fontWeight: '700' },
  sectionHeader: { paddingTop: 2 },
  sectionTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 },
  recent: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, paddingBottom: 13 },
  recentImage: { borderRadius: 8, overflow: 'hidden', width: 82 },
  recentCopy: { flex: 1, gap: 4 },
  recentTitle: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  recentMeta: { color: colors.muted, fontSize: 9 },
  recentScore: { color: colors.ink, fontFamily: 'Georgia', fontSize: 19, minWidth: 24, textAlign: 'right' },
  viewAll: { color: colors.pine, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  state: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  error: { color: colors.error, fontSize: 11, textAlign: 'center' },
  retry: { borderColor: colors.pine, borderRadius: 18, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 8 },
  retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', gap: 8, padding: 22 },
  emptyText: { color: colors.muted, fontSize: 11 },
  logLink: { color: colors.pine, fontSize: 11, fontWeight: '800' },
  pressed: { opacity: 0.65 },
})

import { Feather } from '@expo/vector-icons'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { blockUser, followUser, getUserCourses, getUserProfile, getUserRoundSummary, muteUser, unfollowUser } from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { Avatar, CourseRow, CourseVisual, ProductScreen } from '../../src/components/ProductUI'
import { attributedCourseImage, CoursePresentation } from '../../src/coursePresentation'
import { scoreAccessibilityLabel, scoreToPar } from '../../src/scorePresentation'
import { Course, GolfRound, PublicProfile, RankingTier, RoundSummary, UserCourseVisit } from '../../src/types'
import { colors, radii } from '../../src/ui/theme'

type ProfileAction = 'mute' | 'block'
type ActionSheet =
  | { kind: 'menu' }
  | { kind: 'confirm'; action: ProfileAction }
  | null

const coursesPageSize = 50

export default function UserProfileScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [summary, setSummary] = useState<RoundSummary | null>(null)
  const [courses, setCourses] = useState<UserCourseVisit[] | null>(null)
  const [coursesHasMore, setCoursesHasMore] = useState(false)
  const [coursesLoadingMore, setCoursesLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ActionSheet>(null)

  const userId = Number(id)

  const load = useCallback(async () => {
    if (!Number.isInteger(userId) || userId < 1) {
      setError('Profile not found.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const nextProfile = await getUserProfile(userId, headers)
      if (nextProfile.is_self) {
        router.replace('/profile' as never)
        return
      }
      setProfile(nextProfile)
      setSummary(null)
      setCourses(null)
      setCoursesHasMore(false)
      try {
        setSummary(await getUserRoundSummary(userId, headers))
      } catch {
        // Round stats are a secondary enhancement to the profile card; a
        // failure here should not blank out an otherwise-loaded profile.
      }
      try {
        const nextCourses = await getUserCourses(userId, headers, { limit: coursesPageSize })
        setCourses(nextCourses)
        setCoursesHasMore(nextCourses.length === coursesPageSize)
      } catch {
        // Same as above: courses-played is a secondary enhancement.
      }
    } catch (reason) {
      setProfile(null)
      setSummary(null)
      setCourses(null)
      setCoursesHasMore(false)
      setError(message(reason, 'Unable to load this profile.'))
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders, router, userId])

  useEffect(() => { void load() }, [load])

  async function loadMoreCourses() {
    if (coursesLoadingMore || !coursesHasMore) return
    setCoursesLoadingMore(true)
    try {
      const headers = await getAuthHeaders()
      const next = await getUserCourses(userId, headers, { limit: coursesPageSize, offset: courses?.length ?? 0 })
      setCourses((current) => [...(current ?? []), ...next])
      setCoursesHasMore(next.length === coursesPageSize)
    } catch (reason) {
      setError(message(reason, 'Unable to load more courses.'))
    } finally {
      setCoursesLoadingMore(false)
    }
  }

  const toggleFollow = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      if (profile.is_following) {
        await unfollowUser(profile.id, headers)
        setProfile((current) => current ? {
          ...current,
          is_following: false,
          is_mutual: false,
          follower_count: Math.max(0, current.follower_count - 1),
        } : current)
      } else {
        await followUser(profile.id, headers)
        setProfile((current) => current ? {
          ...current,
          is_following: true,
          is_mutual: current.is_followed_by,
          follower_count: current.follower_count + 1,
        } : current)
      }
      // Round-stat visibility depends on following status -- refresh so a
      // follow reveals stats immediately and an unfollow hides them again.
      setSummary(null)
      try {
        setSummary(await getUserRoundSummary(profile.id, headers))
      } catch {
        // Same as the initial load: a failure here shouldn't surface an error
        // for what is otherwise a successful follow/unfollow action.
      }
    } catch (reason) {
      setError(message(reason, 'Unable to update follow status.'))
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: ProfileAction) => {
    if (!profile) return
    setSheet(null)
    setBusy(true)
    setError(null)
    try {
      if (action === 'mute') {
        await muteUser(profile.id, true, await getAuthHeaders())
        setProfile((current) => current ? { ...current, is_muted: true } : current)
      } else {
        await blockUser(profile.id, true, await getAuthHeaders())
        router.back()
      }
    } catch (reason) {
      setError(message(reason, action === 'mute' ? 'Unable to mute this golfer.' : 'Unable to block this golfer.'))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={10} onPress={() => router.back()} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <Feather name="arrow-left" size={20} color={colors.muted} />
        </Pressable>
        {profile ? (
          <Pressable accessibilityLabel={`More options for ${profile.display_name}`} accessibilityRole="button" disabled={busy} hitSlop={10} onPress={() => setSheet({ kind: 'menu' })} style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
            <Feather name="more-horizontal" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {loading ? <ActivityIndicator accessibilityLabel="Loading profile" color={colors.pine} /> : null}
      {error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}

      {profile ? <>
        <View style={styles.identity}>
          <Avatar initials={initials(profile.display_name)} size={72} />
          <Text style={styles.name}>{profile.display_name}</Text>
          {profile.username ? <Text style={styles.handle}>@{profile.username}</Text> : null}
          {profile.home_region ? <View style={styles.regionRow}><Feather name="map-pin" size={12} color={colors.muted} /><Text style={styles.region}>{profile.home_region}</Text></View> : null}
          {profile.is_mutual ? <Text style={styles.mutual}>Friends</Text> : profile.is_followed_by ? <Text style={styles.followsYou}>Follows you</Text> : null}
        </View>

        <View style={styles.stats}>
          <ProfileStat label="Followers" value={profile.follower_count} />
          <ProfileStat label="Following" value={profile.following_count} last />
        </View>

        <View style={styles.stats}>
          <ProfileStat label="Rounds" value={summary?.total_rounds ?? '—'} />
          <ProfileStat label="Courses" value={summary?.distinct_courses ?? '—'} />
          <ProfileStat label="Avg score" value={formatAverage(summary?.average_score)} />
          <ProfileStat label="Best" value={summary?.best_score ?? '—'} last />
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={profile.is_following ? `Unfollow ${profile.display_name}` : `Follow ${profile.display_name}`}
            disabled={busy}
            onPress={() => void toggleFollow()}
            style={[styles.followButton, profile.is_following && styles.followingButton]}
          >
            {busy ? <ActivityIndicator color={colors.pine} size="small" /> : <Text style={styles.followButtonText}>{profile.is_following ? 'Following' : 'Follow'}</Text>}
          </Pressable>
        </View>

        {profile.is_muted ? <Text style={styles.mutedNote}>You muted this golfer. Their activity is hidden from your feed.</Text> : null}

        {summary?.latest_round ? <>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Recent round</Text></View>
          <RecentRound round={summary.latest_round} />
        </> : null}

        {courses && courses.length ? <>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Courses played</Text></View>
          {courses.map((entry) => <CoursePlayedRow key={entry.course.id} entry={entry} onPress={() => router.push(`/course/${entry.course.id}` as never)} />)}
          {coursesHasMore ? <Pressable accessibilityRole="button" disabled={coursesLoadingMore} onPress={() => void loadMoreCourses()} style={styles.more}>{coursesLoadingMore ? <ActivityIndicator color={colors.pine} size="small" /> : <Text style={styles.moreText}>Load more</Text>}</Pressable> : null}
        </> : null}
      </> : null}
    </ProductScreen>

    <Modal animationType="fade" transparent visible={sheet?.kind === 'menu'} onRequestClose={() => setSheet(null)}>
      <View style={styles.menuOverlay}>
        <Pressable accessibilityLabel="Dismiss options" accessibilityRole="button" onPress={() => setSheet(null)} style={StyleSheet.absoluteFill} />
        <View style={styles.menuCard}>
          <Pressable accessibilityRole="button" onPress={() => setSheet({ kind: 'confirm', action: 'mute' })} style={styles.menuOption}>
            <Feather name="volume-x" size={16} color={colors.ink} />
            <Text style={styles.menuOptionText}>Mute</Text>
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable accessibilityRole="button" onPress={() => setSheet({ kind: 'confirm', action: 'block' })} style={styles.menuOption}>
            <Feather name="slash" size={16} color={colors.error} />
            <Text style={[styles.menuOptionText, styles.menuOptionDanger]}>Block</Text>
          </Pressable>
        </View>
      </View>
    </Modal>

    <Modal animationType="fade" transparent visible={sheet?.kind === 'confirm'} onRequestClose={() => setSheet(null)}>
      <View style={styles.confirmOverlay}>
        <Pressable accessibilityLabel="Dismiss confirmation" accessibilityRole="button" onPress={() => setSheet(null)} style={StyleSheet.absoluteFill} />
        {sheet?.kind === 'confirm' && profile ? (
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>
              {sheet.action === 'mute' ? `Mute ${profile.display_name}?` : `Block ${profile.display_name}?`}
            </Text>
            <Text style={styles.confirmBody}>
              {sheet.action === 'mute'
                ? 'Their activity will be hidden from your feed. Unmute anytime in Settings → Muted accounts.'
                : 'They won’t see your activity and you won’t see theirs. Unblock anytime in Settings → Blocked accounts.'}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable accessibilityRole="button" onPress={() => setSheet(null)} style={styles.confirmCancel}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void runAction(sheet.action)}
                style={[styles.confirmPrimary, sheet.action === 'block' && styles.confirmDanger]}
              >
                <Text style={styles.confirmPrimaryText}>{sheet.action === 'mute' ? 'Mute' : 'Block'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  </>
}

function ProfileStat({ label, last = false, value }: { label: string; last?: boolean; value: number | string }) {
  return <View style={[styles.stat, last && styles.statLast]}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>
}

function RecentRound({ round }: { round: GolfRound }) {
  const toPar = scoreToPar(round.score, round.course.par)
  return (
    <View style={styles.recent}>
      <View style={styles.recentImage}><CourseVisual course={displayCourse(round.course)} height={62} /></View>
      <View style={styles.recentCopy}>
        <Text numberOfLines={1} style={styles.recentTitle}>{round.course.name}</Text>
        <Text numberOfLines={1} style={styles.recentMeta}>{formatDate(round.played_on)} · {round.course.region}</Text>
      </View>
      <View style={styles.recentScoreBlock}>
        <Text accessibilityLabel={scoreAccessibilityLabel(round.score, round.course.par)} style={styles.recentScore}>{round.score ?? '—'}</Text>
        {toPar ? <View style={styles.recentToParBadge}><Text style={styles.recentToPar}>{toPar}</Text></View> : null}
      </View>
      {round.is_favorite ? <Feather accessibilityLabel="Favorite round" name="star" size={18} color={colors.gold} /> : null}
    </View>
  )
}

function CoursePlayedRow({ entry, onPress }: { entry: UserCourseVisit; onPress: () => void }) {
  return (
    <CourseRow
      course={displayCourse(entry.course)}
      onPress={onPress}
      showRating={false}
      trailing={entry.rating != null ? (
        <View style={styles.playedRatingWrap}>
          <Text style={styles.playedRating}>{entry.rating.toFixed(1)}<Text style={styles.playedRatingScale}> / 10</Text></Text>
          <Text style={styles.playedTier}>{tierLabel(entry.tier)}</Text>
        </View>
      ) : <Text style={styles.playedNote}>Played</Text>}
    />
  )
}

function tierLabel(tier: RankingTier | null): string {
  return tier ? ({ green: 'Green', fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker' } as const)[tier] : ''
}

function displayCourse(course: Course): CoursePresentation { return { id: String(course.id), name: course.name, location: course.region, rating: course.community_rating ?? 0, reviews: '', distance: '', price: '', image: attributedCourseImage(course), heroImage: course.hero_image } }
function formatAverage(value: number | null | undefined) { return value == null ? '—' : value.toFixed(1) }
function formatDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR' }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: -4 },
  close: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
  pressed: { opacity: 0.6 },
  identity: { alignItems: 'center', gap: 5, paddingBottom: 8, paddingTop: 4 },
  name: { color: colors.ink, fontFamily: 'Georgia', fontSize: 23 },
  handle: { color: colors.muted, fontSize: 11 },
  regionRow: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 2 },
  region: { color: colors.muted, fontSize: 10 },
  mutual: { backgroundColor: colors.pineSoft, borderRadius: radii.pill, color: colors.pineDark, fontSize: 10, fontWeight: '800', marginTop: 4, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4 },
  followsYou: { color: colors.muted, fontSize: 10, marginTop: 4 },
  stats: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginTop: 8, paddingVertical: 12 },
  stat: { alignItems: 'center', borderRightColor: colors.line, borderRightWidth: StyleSheet.hairlineWidth, flex: 1 },
  statLast: { borderRightWidth: 0 },
  statValue: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 },
  statLabel: { color: colors.muted, fontSize: 8, marginTop: 3, textTransform: 'uppercase' },
  actions: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center', paddingVertical: 16 },
  followButton: { alignItems: 'center', borderColor: colors.pine, borderRadius: 18, borderWidth: 1, minWidth: 120, paddingHorizontal: 18, paddingVertical: 10 },
  followingButton: { backgroundColor: '#EDF1ED' },
  followButtonText: { color: colors.pine, fontSize: 12, fontWeight: '800' },
  moreButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
  mutedNote: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  sectionHeader: { paddingTop: 6 },
  sectionTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 },
  more: { alignItems: 'center', padding: 14 },
  moreText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
  recent: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingTop: 10 },
  recentImage: { borderRadius: 8, overflow: 'hidden', width: 82 },
  recentCopy: { flex: 1, gap: 4 },
  recentTitle: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  recentMeta: { color: colors.muted, fontSize: 9 },
  recentScoreBlock: { alignItems: 'center', flexDirection: 'row', gap: 5, minWidth: 28 },
  recentScore: { color: colors.ink, fontFamily: 'Georgia', fontSize: 19, minWidth: 24, textAlign: 'right' },
  recentToParBadge: { alignItems: 'center', borderColor: colors.muted, borderRadius: 11, borderWidth: 1, height: 22, justifyContent: 'center', minWidth: 22, paddingHorizontal: 3 },
  recentToPar: { color: colors.muted, fontSize: 8, fontWeight: '700' },
  playedRatingWrap: { alignItems: 'flex-end' },
  playedRating: { color: colors.ink, fontFamily: 'Georgia', fontSize: 16 },
  playedRatingScale: { color: colors.muted, fontFamily: undefined, fontSize: 8 },
  playedTier: { color: colors.pine, fontSize: 8, fontWeight: '700', marginTop: 3, textTransform: 'uppercase' },
  playedNote: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  state: { alignItems: 'center', gap: 10, paddingVertical: 34 },
  error: { color: colors.error, fontSize: 11, textAlign: 'center' },
  retry: { borderColor: colors.pine, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
  menuOverlay: { alignItems: 'flex-end', flex: 1, paddingRight: 14, paddingTop: 42 },
  menuCard: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, minWidth: 160, overflow: 'hidden' },
  menuOption: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 48, paddingHorizontal: 16 },
  menuOptionText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  menuOptionDanger: { color: colors.error },
  menuDivider: { backgroundColor: colors.line, height: StyleSheet.hairlineWidth },
  confirmOverlay: { alignItems: 'center', backgroundColor: 'rgba(10, 18, 14, 0.28)', flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  confirmCard: { backgroundColor: colors.card, borderRadius: 18, gap: 10, padding: 20, width: '100%' },
  confirmTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 22 },
  confirmBody: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  confirmCancel: { alignItems: 'center', borderColor: colors.line, borderRadius: radii.pill, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44 },
  confirmCancelText: { color: colors.pine, fontSize: 12, fontWeight: '800' },
  confirmPrimary: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, flex: 1, justifyContent: 'center', minHeight: 44 },
  confirmDanger: { backgroundColor: colors.error },
  confirmPrimaryText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
})

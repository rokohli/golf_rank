import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import { deleteRound, getRound } from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { ProductScreen } from '../../src/components/ProductUI'
import { GolfRound } from '../../src/types'
import { colors } from '../../src/ui/theme'

export default function RoundDetail() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const [round, setRound] = useState<GolfRound | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id || !/^\d+$/.test(id)) {
      setError('Round not found.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setRound(await getRound(Number(id), await getAuthHeaders()))
    } catch (reason) {
      setError(message(reason, 'Unable to load this round.'))
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders, id])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  function confirmDelete() {
    if (!round || deleting) return
    const detail = round.is_rating_round
      ? 'This round stores your course rating and ranking evidence. Deleting it also removes that rating and may change your rankings.'
      : 'This permanently removes the round from your playing history.'
    Alert.alert('Delete round?', detail, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove() },
    ])
  }

  async function remove() {
    if (!round) return
    setDeleting(true)
    setError(null)
    try {
      await deleteRound(round.id, await getAuthHeaders())
      router.replace('/rounds' as never)
    } catch (reason) {
      setError(message(reason, 'Unable to delete this round.'))
    } finally {
      setDeleting(false)
    }
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <View style={styles.header}><Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Feather name="arrow-left" size={24} color={colors.pineDark} /></Pressable><Text style={styles.title}>Round summary</Text></View>
      {loading ? <ActivityIndicator accessibilityLabel="Loading round" color={colors.pine} /> : null}
      {error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {!loading && round ? <>
        <Pressable accessibilityLabel={`Open ${round.course.name}`} accessibilityRole="button" onPress={() => router.push(`/course/${round.course.id}` as never)} style={({ pressed }) => [styles.feature, pressed && styles.pressed]}>
          <View style={styles.courseBlock}><Text style={styles.course}>{round.course.name}</Text><Text style={styles.region}>{round.course.region}</Text><View style={styles.courseRule} /><Text style={styles.date}>{formatDate(round.played_on)}  ·  {capitalize(round.visibility)}</Text></View>
          <View style={styles.featureDivider} />
          <View style={styles.scoreBlock}><Text accessibilityLabel={round.score == null ? 'No score recorded' : `Round score ${round.score}`} style={styles.score}>{round.score ?? '—'}</Text><Text style={styles.scoreLabel}>Round score</Text></View>
        </Pressable>
        <View style={styles.details}>
          <View style={styles.detail}><Text style={styles.detailPrimary}>{round.favorite_hole ?? '—'}</Text><Text style={styles.detailLabel}>Favorite hole</Text></View>
          <View style={[styles.detail, styles.detailMiddle]}><CompanionInitials round={round} /><Text numberOfLines={1} style={styles.companionValue}>{companionText(round)}</Text><Text style={styles.detailLabel}>Played with</Text></View>
          <View style={styles.detail}><Feather accessibilityLabel={round.is_favorite ? 'Favorite round' : 'Not a favorite round'} name="star" size={35} color={round.is_favorite ? colors.gold : colors.muted} /><Text style={styles.detailLabel}>Favorite</Text></View>
        </View>
        <View style={styles.note}><Text style={styles.noteLabel}>Round notes</Text><Text style={round.note ? styles.body : styles.emptyNote}>{round.note ?? 'No notes added.'}</Text></View>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/round/edit/${round.id}` as never)} style={({ pressed }) => [styles.editButton, pressed && styles.editPressed]}><Feather name="edit-3" size={17} color="#FFF" /><Text style={styles.editText}>Edit round</Text></Pressable>
        {round.is_rating_round ? <Pressable accessibilityRole="button" onPress={() => router.push(`/rate/${round.course.id}` as never)} style={styles.ratingButton}><Feather name="bar-chart-2" size={15} color={colors.pine} /><Text style={styles.ratingButtonText}>Edit course rating</Text></Pressable> : null}
        <Pressable accessibilityRole="button" disabled={deleting} onPress={confirmDelete} style={styles.deleteButton}>{deleting ? <ActivityIndicator color={colors.error} size="small" /> : <><Feather name="trash-2" size={15} color={colors.error} /><Text style={styles.deleteText}>Delete round</Text></>}</Pressable>
      </> : null}
    </ProductScreen>
  </>
}

function CompanionInitials({ round }: { round: GolfRound }) { const companions = round.companions.slice(0, 2); return companions.length ? <View style={styles.initials}>{companions.map((companion, index) => { const name = companion.display_name ?? companion.guest_name ?? '?'; return <View key={`${name}-${index}`} style={[styles.initial, index > 0 && styles.initialOverlap]}><Text style={styles.initialText}>{initials(name)}</Text></View> })}</View> : <Feather name="users" size={24} color={colors.muted} /> }
function companionText(round: GolfRound) { const names = round.companions.map((item) => item.display_name ?? item.guest_name).filter((name): name is string => Boolean(name)); return names.length > 1 ? `${names[0]} + ${names.length - 1}` : names[0] ?? 'Not recorded' }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?' }
function formatDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  header: { alignItems: 'flex-start', gap: 22 }, backButton: { alignItems: 'center', height: 38, justifyContent: 'center', marginLeft: -9, width: 38 }, title: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 34, fontWeight: '400', letterSpacing: -0.8 },
  feature: { alignItems: 'stretch', backgroundColor: colors.pine, borderBottomColor: colors.gold, borderBottomWidth: 2, flexDirection: 'row', marginHorizontal: -18, minHeight: 176, paddingHorizontal: 24, paddingVertical: 28 },
  courseBlock: { flex: 1, justifyContent: 'center' }, course: { color: '#F8F7F3', fontFamily: 'Georgia', fontSize: 21, lineHeight: 27 }, region: { color: '#CFD9D3', fontSize: 11, marginTop: 6 }, courseRule: { backgroundColor: 'rgba(255,255,255,0.2)', height: StyleSheet.hairlineWidth, marginVertical: 15, width: '72%' }, date: { color: '#CFD9D3', fontSize: 10 },
  featureDivider: { backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 18, width: StyleSheet.hairlineWidth }, scoreBlock: { alignItems: 'center', justifyContent: 'center', minWidth: 86 }, score: { color: '#F8F7F3', fontFamily: 'Georgia', fontSize: 60, letterSpacing: -2 }, scoreLabel: { color: '#F8F7F3', fontSize: 8, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase' },
  details: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingVertical: 22 }, detail: { alignItems: 'center', flex: 1, gap: 7, justifyContent: 'center', minHeight: 74, paddingHorizontal: 8 }, detailMiddle: { borderLeftColor: colors.line, borderLeftWidth: StyleSheet.hairlineWidth, borderRightColor: colors.line, borderRightWidth: StyleSheet.hairlineWidth }, detailPrimary: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 30 }, detailLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8, textAlign: 'center', textTransform: 'uppercase' }, companionValue: { color: colors.ink, fontFamily: 'Georgia', fontSize: 12, maxWidth: 104, textAlign: 'center' },
  initials: { flexDirection: 'row' }, initial: { alignItems: 'center', backgroundColor: colors.background, borderColor: colors.pineDark, borderRadius: 15, borderWidth: 1, height: 30, justifyContent: 'center', width: 30 }, initialOverlap: { marginLeft: -5 }, initialText: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 10 },
  note: { backgroundColor: '#F1EEE5', borderLeftColor: colors.pine, borderLeftWidth: 3, gap: 12, marginHorizontal: -18, paddingHorizontal: 32, paddingVertical: 22 }, noteLabel: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }, body: { color: colors.ink, fontFamily: 'Georgia', fontSize: 15, lineHeight: 23 }, emptyNote: { color: colors.muted, fontSize: 12 },
  editButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 50 }, editPressed: { opacity: 0.82 }, editText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  ratingButton: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: 7, padding: 7 }, ratingButtonText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
  deleteButton: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: 7, padding: 10 }, deleteText: { color: colors.error, fontSize: 11, fontWeight: '800' },
  state: { alignItems: 'center', gap: 12, paddingVertical: 28 }, error: { color: colors.error, fontSize: 11, textAlign: 'center' }, retry: { borderColor: colors.pine, borderRadius: 18, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 8 }, retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' }, pressed: { opacity: 0.85 },
})

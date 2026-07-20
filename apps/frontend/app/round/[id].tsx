import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import { deleteRound, getRound } from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { PrimaryButton, ProductScreen, ScreenHeader, SectionTitle } from '../../src/components/ProductUI'
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
      <ScreenHeader title="Round summary" onBack={() => router.back()} />
      {loading ? <ActivityIndicator accessibilityLabel="Loading round" color={colors.pine} /> : null}
      {error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {!loading && round ? <>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/course/${round.course.id}` as never)} style={styles.courseCard}><View style={styles.courseIcon}><Feather name="flag" size={22} color={colors.pine} /></View><View style={{ flex: 1 }}><Text style={styles.course}>{round.course.name}</Text><Text style={styles.meta}>{round.course.region}</Text><Text style={styles.meta}>{formatDate(round.played_on)} · {capitalize(round.visibility)}</Text></View><Feather name="chevron-right" size={16} color={colors.muted} /></Pressable>
        <View style={styles.scoreHero}><Text style={styles.score}>{round.score ?? '—'}</Text><Text style={styles.label}>{round.score == null ? 'No score recorded' : 'Round score'}</Text>{round.is_rating_round ? <Text style={styles.ratingVisit}>This visit stores your course rating</Text> : null}</View>
        <View style={styles.details}>
          <Detail icon="flag" label="Favorite hole" value={round.favorite_hole == null ? 'Not recorded' : `Hole ${round.favorite_hole}`} />
          <Detail icon={round.is_favorite ? 'star' : 'bookmark'} label="Favorite round" value={round.is_favorite ? 'Yes' : 'No'} />
          <Detail icon="users" label="Played with" value={companionText(round)} />
        </View>
        <SectionTitle title="Round notes" />
        <View style={styles.note}><Text style={round.note ? styles.body : styles.emptyNote}>{round.note ?? 'No notes added.'}</Text></View>
        <View style={styles.actions}><PrimaryButton label="Edit round" icon="edit-3" onPress={() => router.push(`/round/edit/${round.id}` as never)} />{round.is_rating_round ? <PrimaryButton label="Edit course rating" icon="bar-chart-2" onPress={() => router.push(`/rate/${round.course.id}` as never)} /> : null}</View>
        <Pressable accessibilityRole="button" disabled={deleting} onPress={confirmDelete} style={styles.deleteButton}>{deleting ? <ActivityIndicator color={colors.error} size="small" /> : <><Feather name="trash-2" size={15} color={colors.error} /><Text style={styles.deleteText}>Delete round</Text></>}</Pressable>
      </> : null}
    </ProductScreen>
  </>
}

function Detail({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) { return <View style={styles.detail}><Feather name={icon} size={17} color={colors.pine} /><View><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View></View> }
function companionText(round: GolfRound) { const names = round.companions.map((item) => item.display_name ?? item.guest_name).filter(Boolean); return names.length ? names.join(', ') : 'Not recorded' }
function formatDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  courseCard: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 }, courseIcon: { alignItems: 'center', backgroundColor: colors.pineSoft, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, course: { color: colors.ink, fontSize: 14, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  scoreHero: { alignItems: 'center', paddingVertical: 8 }, score: { color: colors.pine, fontSize: 58, fontWeight: '500', letterSpacing: -2 }, label: { color: colors.muted, fontSize: 10, marginTop: 5 }, ratingVisit: { backgroundColor: colors.pineSoft, borderRadius: 12, color: colors.pine, fontSize: 9, fontWeight: '800', marginTop: 10, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5 },
  details: { gap: 8 }, detail: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 12 }, detailLabel: { color: colors.muted, fontSize: 9 }, detailValue: { color: colors.ink, fontSize: 12, fontWeight: '700', marginTop: 2 },
  note: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 12, borderWidth: 1, padding: 14 }, body: { color: colors.ink, fontSize: 12, lineHeight: 19 }, emptyNote: { color: colors.muted, fontSize: 12 }, actions: { gap: 10 },
  deleteButton: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: 7, padding: 10 }, deleteText: { color: colors.error, fontSize: 11, fontWeight: '800' },
  state: { alignItems: 'center', gap: 12, paddingVertical: 28 }, error: { color: colors.error, fontSize: 11, textAlign: 'center' }, retry: { borderColor: colors.pine, borderRadius: 18, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 8 }, retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
})

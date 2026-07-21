import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'

import { getRounds, getRoundSummary } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { BottomNav, IconButton, ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { GolfRound, RoundSummary } from '../src/types'
import { colors } from '../src/ui/theme'

const pageSize = 20
type Filter = 'All' | 'This Year' | 'Favorites'

export default function Rounds() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [filter, setFilter] = useState<Filter>('This Year')
  const [rounds, setRounds] = useState<GolfRound[]>([])
  const [summary, setSummary] = useState<RoundSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filters = useCallback((selected: Filter) => ({
    limit: pageSize,
    ...(selected === 'This Year' ? { year: new Date().getFullYear() } : {}),
    ...(selected === 'Favorites' ? { favorites_only: true } : {}),
  }), [])

  const load = useCallback(async (selected: Filter, refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const [nextRounds, nextSummary] = await Promise.all([getRounds(headers, filters(selected)), getRoundSummary(headers)])
      setRounds(nextRounds)
      setSummary(nextSummary)
      setHasMore(nextRounds.length === pageSize)
    } catch (reason) {
      setError(message(reason, 'Unable to load your rounds.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [filters, getAuthHeaders])

  useFocusEffect(useCallback(() => { void load(filter) }, [filter, load]))

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const headers = await getAuthHeaders()
      const next = await getRounds(headers, { ...filters(filter), offset: rounds.length })
      setRounds((current) => [...current, ...next])
      setHasMore(next.length === pageSize)
    } catch (reason) {
      setError(message(reason, 'Unable to load more rounds.'))
    } finally {
      setLoadingMore(false)
    }
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(filter, true)} tintColor={colors.pine} />}>
      <ScreenHeader title="My Rounds" action={<IconButton icon="plus" label="Add round" onPress={() => router.push('/round/new' as never)} />} />
      <View style={styles.stats}><RoundStat label="Rounds" value={summary?.total_rounds ?? '—'} /><RoundStat label="Average" value={formatScore(summary?.average_score)} /><RoundStat label="Best" value={summary?.best_score ?? '—'} last /></View>
      <View accessibilityRole="tablist" style={styles.filters}>{(['All', 'This Year', 'Favorites'] as Filter[]).map((option) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: filter === option }} key={option} onPress={() => setFilter(option)} style={[styles.filter, filter === option && styles.filterActive]}><Text style={[styles.filterText, filter === option && styles.filterTextActive]}>{option}</Text></Pressable>)}</View>
      {loading ? <ActivityIndicator accessibilityLabel="Loading rounds" color={colors.pine} /> : null}
      {error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load(filter)} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {!loading && !error && rounds.length === 0 ? <View style={styles.state}><Feather name="flag" size={24} color={colors.muted} /><Text style={styles.emptyTitle}>{filter === 'Favorites' ? 'No favorite rounds yet' : 'No rounds here yet'}</Text><Text style={styles.empty}>Log each visit to a course to build your playing history.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/round/new' as never)} style={styles.primary}><Text style={styles.primaryText}>Log a round</Text></Pressable></View> : null}
      <View style={styles.list}>{rounds.map((round, index) => {
        const startsMonth = index === 0 || monthKey(round.played_on) !== monthKey(rounds[index - 1].played_on)
        return <View key={round.id}>{startsMonth ? <Text style={styles.monthLabel}>{formatMonth(round.played_on)}</Text> : null}<RoundRow round={round} onPress={() => router.push(`/round/${round.id}` as never)} /></View>
      })}</View>
      {hasMore ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={styles.more}>{loadingMore ? <ActivityIndicator color={colors.pine} size="small" /> : <Text style={styles.moreText}>Load more</Text>}</Pressable> : null}
    </ProductScreen>
    <BottomNav />
  </>
}

function RoundRow({ round, onPress }: { round: GolfRound; onPress: () => void }) {
  const date = formatDateParts(round.played_on)
  return <Pressable accessibilityLabel={`Open ${round.course.name} round`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.roundRow, pressed && { opacity: 0.6 }]}>
    <View style={styles.dateBlock}><Text style={styles.dateMonth}>{date.month}</Text><Text style={styles.dateDay}>{date.day}</Text></View>
    <View style={styles.roundCopy}><Text style={styles.course}>{round.course.name}</Text><Text numberOfLines={1} style={styles.meta}>{round.course.region}{round.is_rating_round ? ' · Rating visit' : ''}</Text></View>
    {round.is_favorite ? <Feather accessibilityLabel="Favorite round" name="star" size={16} color={colors.gold} /> : null}
    <Text accessibilityLabel={round.score == null ? 'No score recorded' : `Score ${round.score}`} style={styles.score}>{round.score ?? '—'}</Text>
  </Pressable>
}

function RoundStat({ label, last = false, value }: { label: string; last?: boolean; value: number | string }) {
  return <View style={[styles.stat, last && styles.statLast]}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>
}

function roundDate(value: string) { return new Date(`${value}T12:00:00`) }
function formatDateParts(value: string) { const date = roundDate(value); return { month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(), day: date.toLocaleDateString(undefined, { day: '2-digit' }) } }
function formatMonth(value: string) { return roundDate(value).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase() }
function monthKey(value: string) { return value.slice(0, 7) }
function formatScore(value: number | null | undefined) { return value == null ? '—' : value.toFixed(1) }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  stats: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingVertical: 13 }, stat: { alignItems: 'center', borderRightColor: colors.line, borderRightWidth: StyleSheet.hairlineWidth, flex: 1 }, statLast: { borderRightWidth: 0 }, statValue: { color: colors.ink, fontFamily: 'Georgia', fontSize: 22 }, statLabel: { color: colors.muted, fontSize: 8, marginTop: 3, textTransform: 'uppercase' },
  filters: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 22 }, filter: { paddingBottom: 9 }, filterActive: { borderBottomColor: colors.pine, borderBottomWidth: 2 }, filterText: { color: colors.muted, fontSize: 11 }, filterTextActive: { color: colors.ink, fontWeight: '700' },
  list: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  monthLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, paddingBottom: 7, paddingTop: 18 },
  roundRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 76, paddingVertical: 12 },
  dateBlock: { alignItems: 'center', borderRightColor: colors.line, borderRightWidth: StyleSheet.hairlineWidth, minWidth: 52, paddingRight: 12 },
  dateMonth: { color: colors.pine, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  dateDay: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 24, lineHeight: 28 },
  roundCopy: { flex: 1, gap: 4 },
  course: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14, fontWeight: '400' }, meta: { color: colors.muted, fontSize: 10 },
  score: { color: colors.pine, fontFamily: 'Georgia', fontSize: 28, fontWeight: '400', minWidth: 34, textAlign: 'right' },
  state: { alignItems: 'center', gap: 10, paddingVertical: 30 }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 }, empty: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  error: { color: colors.error, fontSize: 11, textAlign: 'center' }, retry: { borderColor: colors.pine, borderRadius: 18, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 8 }, retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
  primary: { backgroundColor: colors.pine, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9 }, primaryText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  more: { alignItems: 'center', borderColor: colors.pine, borderRadius: 20, borderWidth: 1, minHeight: 40, justifyContent: 'center' }, moreText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
})

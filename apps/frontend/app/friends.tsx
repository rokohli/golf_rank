import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'

import { blockUser, followUser, getFollows, searchUsers, unfollowUser } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { Avatar, BottomNav, IconButton, ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { Follow, UserSummary } from '../src/types'
import { colors } from '../src/ui/theme'

export default function Friends() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [follows, setFollows] = useState<Follow[]>([])
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)

  const loadFollows = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      setFollows(await getFollows(await getAuthHeaders()))
    } catch (reason) {
      setFollows([])
      setError(message(reason, 'Unable to load following.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => { void loadFollows() }, [loadFollows]))

  useEffect(() => {
    const normalized = query.trim()
    if (!searching || normalized.length < 2) {
      setResults([])
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    let active = true
    const timeout = setTimeout(() => {
      getAuthHeaders().then((headers) => searchUsers(normalized, headers)).then((users) => {
        if (active) setResults(users)
      }).catch((reason) => {
        if (active) setError(message(reason, 'Unable to search golfers.'))
      }).finally(() => {
        if (active) setSearchLoading(false)
      })
    }, 250)
    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [getAuthHeaders, query, searching])

  const toggleFollow = async (user: UserSummary) => {
    const existing = follows.find((follow) => follow.user.id === user.id)
    setBusyUserId(user.id)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      if (existing) {
        await unfollowUser(user.id, headers)
        setFollows((items) => items.filter((item) => item.user.id !== user.id))
      } else {
        const follow = await followUser(user.id, headers)
        setFollows((items) => [follow, ...items])
      }
    } catch (reason) {
      setError(message(reason, 'Unable to update this follow.'))
    } finally {
      setBusyUserId(null)
    }
  }

  const block = async (follow: Follow) => {
    setBusyUserId(follow.user.id)
    try {
      await blockUser(follow.user.id, true, await getAuthHeaders())
      setFollows((items) => items.filter((item) => item.user.id !== follow.user.id))
    } catch (reason) {
      setError(message(reason, 'Unable to block this golfer.'))
    } finally {
      setBusyUserId(null)
    }
  }

  const action = <View style={styles.actions}>{searching ? <IconButton icon="x" label="Close search" onPress={() => { setSearching(false); setQuery('') }} /> : <><IconButton icon="search" label="Search golfers" onPress={() => setSearching(true)} /><IconButton icon="user-plus" label="Find golfers" onPress={() => setSearching(true)} /></>}</View>
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadFollows(true)} tintColor={colors.pine} />}>
      <ScreenHeader title="Following" onBack={() => router.back()} action={action} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {searching ? <View style={styles.searchSection}>
        <View style={styles.searchWrap}><Feather name="search" size={16} color={colors.muted} /><TextInput accessibilityLabel="Search golfers" autoFocus value={query} onChangeText={setQuery} placeholder="Name, username, or region" placeholderTextColor={colors.muted} style={styles.searchInput} /></View>
        {searchLoading ? <ActivityIndicator accessibilityLabel="Searching golfers" color={colors.pine} /> : null}
        {!searchLoading && query.trim().length >= 2 && !results.length ? <Text style={styles.empty}>No golfers found.</Text> : null}
        {results.map((user) => <UserRow key={user.id} user={user} detail={user.home_region ?? `@${user.username ?? 'golfer'}`} action={follows.some((item) => item.user.id === user.id) ? 'Following' : 'Follow'} busy={busyUserId === user.id} onAction={() => void toggleFollow(user)} />)}
      </View> : <>
        {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading following" color={colors.pine} /></View> : null}
        {!loading && !follows.length ? <View style={styles.state}><Feather name="user-plus" size={25} color={colors.muted} /><Text style={styles.emptyTitle}>Find your golf people</Text><Text style={styles.empty}>Search for golfers to start building your feed.</Text><Pressable accessibilityRole="button" onPress={() => setSearching(true)} style={styles.primary}><Text style={styles.primaryText}>Find golfers</Text></Pressable></View> : null}
        <View>{follows.map((follow) => <View key={follow.user.id} style={styles.followRow}><UserRow user={follow.user} detail={follow.is_mutual ? 'Friends · mutual follow' : follow.user.home_region ?? 'Following'} action="Unfollow" busy={busyUserId === follow.user.id} onAction={() => void toggleFollow(follow.user)} /><Pressable accessibilityRole="button" accessibilityLabel={`Block ${follow.user.display_name}`} onPress={() => void block(follow)} hitSlop={8}><Feather name="slash" size={15} color={colors.muted} /></Pressable></View>)}</View>
      </>}
    </ProductScreen>
    <BottomNav />
  </>
}

function UserRow({ user, detail, action, busy, onAction }: { user: UserSummary; detail: string; action: string; busy: boolean; onAction: () => void }) {
  return <View style={styles.row}><Avatar initials={initials(user.display_name)} /><View style={{ flex: 1 }}><Text style={styles.name}>{user.display_name}</Text><Text style={styles.meta}>{user.username ? `@${user.username} · ` : ''}{detail}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`${action} ${user.display_name}`} disabled={busy} onPress={onAction} style={[styles.followButton, action === 'Following' && styles.followingButton]}>{busy ? <ActivityIndicator color={colors.pine} size="small" /> : <Text style={styles.followButtonText}>{action}</Text>}</Pressable></View>
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR' }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 7 }, intro: { color: colors.muted, fontSize: 10, lineHeight: 16 }, error: { color: '#9A3E3E', fontSize: 11, lineHeight: 16 }, searchSection: { gap: 12 }, searchWrap: { alignItems: 'center', borderColor: colors.line, borderRadius: 9, borderWidth: 1, flexDirection: 'row', gap: 9, paddingHorizontal: 12 }, searchInput: { color: colors.ink, flex: 1, fontSize: 12, minHeight: 44 },
  state: { alignItems: 'center', gap: 10, padding: 38 }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 }, empty: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' }, primary: { backgroundColor: colors.pine, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9 }, primaryText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  followRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row' }, row: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 11, paddingVertical: 13 }, name: { color: colors.ink, fontSize: 13, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 10, marginTop: 4 }, followButton: { alignItems: 'center', borderColor: colors.pine, borderRadius: 16, borderWidth: 1, minWidth: 72, paddingHorizontal: 11, paddingVertical: 7 }, followingButton: { backgroundColor: '#EDF1ED' }, followButtonText: { color: colors.pine, fontSize: 10, fontWeight: '800' },
})

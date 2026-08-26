import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'

import { blockUser, followUser, getFollows, muteUser, searchUsers, unfollowUser } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { Avatar, BottomNav, IconButton, ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { Follow, UserSummary } from '../src/types'
import { colors, radii } from '../src/ui/theme'

type MenuAnchor = { x: number; y: number; width: number; height: number }
type FollowAction = 'mute' | 'block'
type FollowSheet =
  | { kind: 'menu'; follow: Follow; anchor: MenuAnchor }
  | { kind: 'confirm'; follow: Follow; action: FollowAction }

const MENU_WIDTH = 168

export default function Friends() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const [follows, setFollows] = useState<Follow[]>([])
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const [sheet, setSheet] = useState<FollowSheet | null>(null)

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

  const runAction = async (follow: Follow, action: FollowAction) => {
    setBusyUserId(follow.user.id)
    setError(null)
    setSheet(null)
    try {
      if (action === 'mute') {
        await muteUser(follow.user.id, true, await getAuthHeaders())
      } else {
        await blockUser(follow.user.id, true, await getAuthHeaders())
        setFollows((items) => items.filter((item) => item.user.id !== follow.user.id))
      }
    } catch (reason) {
      setError(message(reason, action === 'mute' ? 'Unable to mute this golfer.' : 'Unable to block this golfer.'))
    } finally {
      setBusyUserId(null)
    }
  }

  const menuPosition = sheet?.kind === 'menu'
    ? {
        top: Math.min(sheet.anchor.y + sheet.anchor.height + 6, windowHeight - 120),
        left: Math.max(12, Math.min(sheet.anchor.x + sheet.anchor.width - MENU_WIDTH, windowWidth - MENU_WIDTH - 12)),
      }
    : null

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
        <View>{follows.map((follow) => (
          <View key={follow.user.id} style={styles.followRow}>
            <UserRow
              user={follow.user}
              detail={follow.is_mutual ? 'Friends · mutual follow' : follow.user.home_region ?? 'Following'}
              action="Unfollow"
              busy={busyUserId === follow.user.id}
              onAction={() => void toggleFollow(follow.user)}
              onMore={(anchor) => setSheet({ kind: 'menu', follow, anchor })}
            />
          </View>
        ))}</View>
      </>}
    </ProductScreen>
    <BottomNav />

    <Modal animationType="fade" transparent visible={sheet?.kind === 'menu'} onRequestClose={() => setSheet(null)}>
      <View style={styles.menuRoot}>
        <Pressable accessibilityLabel="Dismiss options" accessibilityRole="button" onPress={() => setSheet(null)} style={StyleSheet.absoluteFill} />
        {sheet?.kind === 'menu' && menuPosition ? (
          <View accessibilityLabel={`Options for ${sheet.follow.user.display_name}`} style={[styles.menuCard, menuPosition]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mute ${sheet.follow.user.display_name}`}
              onPress={() => setSheet({ kind: 'confirm', follow: sheet.follow, action: 'mute' })}
              style={styles.menuOption}
            >
              <Feather name="volume-x" size={15} color={colors.ink} />
              <Text style={styles.menuOptionText}>Mute</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Block ${sheet.follow.user.display_name}`}
              onPress={() => setSheet({ kind: 'confirm', follow: sheet.follow, action: 'block' })}
              style={styles.menuOption}
            >
              <Feather name="slash" size={15} color={colors.error} />
              <Text style={[styles.menuOptionText, styles.menuOptionDanger]}>Block</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>

    <Modal animationType="fade" transparent visible={sheet?.kind === 'confirm'} onRequestClose={() => setSheet(null)}>
      <View style={styles.confirmOverlay}>
        <Pressable accessibilityLabel="Dismiss confirmation" accessibilityRole="button" onPress={() => setSheet(null)} style={StyleSheet.absoluteFill} />
        {sheet?.kind === 'confirm' ? (
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>
              {sheet.action === 'mute' ? `Mute ${sheet.follow.user.display_name}?` : `Block ${sheet.follow.user.display_name}?`}
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
                accessibilityLabel={sheet.action === 'mute' ? `Confirm mute ${sheet.follow.user.display_name}` : `Confirm block ${sheet.follow.user.display_name}`}
                onPress={() => void runAction(sheet.follow, sheet.action)}
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

function UserRow({ user, detail, action, busy, onAction, onMore }: {
  user: UserSummary
  detail: string
  action: string
  busy: boolean
  onAction: () => void
  onMore?: (anchor: MenuAnchor) => void
}) {
  const moreRef = useRef<View>(null)

  const openMore = () => {
    const node = moreRef.current
    if (!node?.measureInWindow) {
      onMore?.({ x: 0, y: 0, width: 32, height: 32 })
      return
    }
    let measured = false
    node.measureInWindow((x, y, width, height) => {
      measured = true
      onMore?.({ x, y, width, height })
    })
    // Jest and some host views never invoke measureInWindow.
    requestAnimationFrame(() => {
      if (!measured) onMore?.({ x: 0, y: 0, width: 32, height: 32 })
    })
  }

  return (
    <View style={styles.row}>
      <Avatar initials={initials(user.display_name)} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{user.display_name}</Text>
        <Text style={styles.meta}>{user.username ? `@${user.username} · ` : ''}{detail}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action} ${user.display_name}`}
        disabled={busy}
        onPress={onAction}
        style={[styles.followButton, action === 'Following' && styles.followingButton]}
      >
        {busy ? <ActivityIndicator color={colors.pine} size="small" /> : <Text style={styles.followButtonText}>{action}</Text>}
      </Pressable>
      {onMore ? (
        <View ref={moreRef} collapsable={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More options for ${user.display_name}`}
            disabled={busy}
            hitSlop={8}
            onPress={openMore}
            style={styles.moreButton}
          >
            <Feather name="more-horizontal" size={16} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR' }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 7 }, error: { color: '#9A3E3E', fontSize: 11, lineHeight: 16 }, searchSection: { gap: 12 }, searchWrap: { alignItems: 'center', borderColor: colors.line, borderRadius: 9, borderWidth: 1, flexDirection: 'row', gap: 9, paddingHorizontal: 12 }, searchInput: { color: colors.ink, flex: 1, fontSize: 12, minHeight: 44 },
  state: { alignItems: 'center', gap: 10, padding: 38 }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 }, empty: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' }, primary: { backgroundColor: colors.pine, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9 }, primaryText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  followRow: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, row: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingVertical: 13 }, name: { color: colors.ink, fontSize: 13, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 10, marginTop: 4 }, followButton: { alignItems: 'center', borderColor: colors.pine, borderRadius: 16, borderWidth: 1, minWidth: 72, paddingHorizontal: 11, paddingVertical: 7 }, followingButton: { backgroundColor: '#EDF1ED' }, followButtonText: { color: colors.pine, fontSize: 10, fontWeight: '800' }, moreButton: { paddingHorizontal: 2, paddingVertical: 6 },
  menuRoot: { flex: 1 },
  menuCard: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.small,
    borderWidth: 1,
    elevation: 8,
    position: 'absolute',
    shadowColor: '#0B1911',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    width: MENU_WIDTH,
  },
  menuOption: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44, paddingHorizontal: 14 },
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

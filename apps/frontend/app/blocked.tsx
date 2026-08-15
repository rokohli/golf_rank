import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { getBlockedUsers, blockUser } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { BlockedUser } from '../src/types'

export default function Blocked() {
  const router = useRouter(); const { getAuthHeaders } = useAuthHeaders(); const [items, setItems] = useState<BlockedUser[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState<number | null>(null); const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => { setLoading(true); setError(null); try { setItems(await getBlockedUsers(await getAuthHeaders())) } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load blocked accounts.') } finally { setLoading(false) } }, [getAuthHeaders])
  useFocusEffect(useCallback(() => { void load() }, [load]))
  const unblock = async (item: BlockedUser) => { setBusy(item.id); try { await blockUser(item.id, false, await getAuthHeaders()); setItems(current => current.filter(value => value.id !== item.id)) } catch (e) { setError(e instanceof Error ? e.message : 'Unable to unblock this account.') } finally { setBusy(null) } }
  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen><ScreenHeader title="Blocked accounts" onBack={() => router.back()} />{loading ? <ActivityIndicator accessibilityLabel="Loading blocked accounts" /> : null}{error ? <Text accessibilityRole="alert">{error}</Text> : null}{!loading && !items.length ? <View><Feather name="shield" size={26} /><Text>No blocked accounts</Text><Text>Accounts you block will appear here.</Text></View> : null}{items.map(item => <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}><View style={{ flex: 1 }}><Text>{item.display_name}</Text><Text>{item.username ? `@${item.username}` : 'Golfer'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Unblock ${item.display_name}`} disabled={busy === item.id} onPress={() => void unblock(item)}><Text>{busy === item.id ? 'Unblocking…' : 'Unblock'}</Text></Pressable></View>)}</ProductScreen></>
}

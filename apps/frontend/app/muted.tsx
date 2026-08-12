import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import { getMutedUsers, muteUser } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { MutedUser } from '../src/types'

export default function Muted() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [items, setItems] = useState<MutedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await getMutedUsers(await getAuthHeaders()))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load muted accounts.')
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const unmute = async (item: MutedUser) => {
    const index = items.findIndex(value => value.id === item.id)
    setBusy(item.id)
    setError(null)
    setItems(current => current.filter(value => value.id !== item.id))
    try {
      await muteUser(item.id, false, await getAuthHeaders())
    } catch (reason) {
      setItems(current => current.some(value => value.id === item.id) ? current : [
        ...current.slice(0, Math.max(index, 0)), item, ...current.slice(Math.max(index, 0)),
      ])
      setError(reason instanceof Error ? reason.message : 'Unable to unmute this account.')
    } finally {
      setBusy(null)
    }
  }

  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen><ScreenHeader title="Muted accounts" onBack={() => router.back()} />
    {loading ? <ActivityIndicator accessibilityLabel="Loading muted accounts" /> : null}
    {error ? <View><Text accessibilityRole="alert">{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry muted accounts" onPress={() => void load()}><Text>Retry</Text></Pressable></View> : null}
    {!loading && !items.length && !error ? <View><Feather name="volume-x" size={26} /><Text>No muted accounts</Text><Text>Accounts you mute from the feed will appear here.</Text></View> : null}
    {items.map(item => <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}><View style={{ flex: 1 }}><Text>{item.display_name}</Text>{item.username ? <Text>@{item.username}</Text> : null}</View><Pressable accessibilityRole="button" accessibilityLabel={`Unmute ${item.display_name}`} disabled={busy === item.id} onPress={() => void unmute(item)}><Text>{busy === item.id ? 'Unmuting…' : 'Unmute'}</Text></Pressable></View>)}
  </ProductScreen></>
}

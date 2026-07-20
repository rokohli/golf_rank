import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'

import { getFollows, getRound, searchCourses, updateRound } from '../../../src/api/client'
import { useAuthHeaders } from '../../../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../../../src/components/ProductUI'
import { RoundForm } from '../../../src/components/RoundForm'
import { FriendSummary, GolfRound } from '../../../src/types'
import { colors } from '../../../src/ui/theme'

export default function EditRound() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const [round, setRound] = useState<GolfRound | null>(null)
  const [friends, setFriends] = useState<FriendSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!id || !/^\d+$/.test(id)) {
      setError('Round not found.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const [nextRound, follows] = await Promise.all([getRound(Number(id), headers), getFollows(headers)])
      setRound(nextRound)
      setFriends(follows.map((item) => item.user))
    } catch (reason) {
      setError(message(reason, 'Unable to load this round.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [id, getAuthHeaders])

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="Edit round" onBack={() => router.back()} />
      {loading ? <ActivityIndicator accessibilityLabel="Loading round" color={colors.pine} /> : null}
      {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></> : null}
      {!loading && round ? <RoundForm
        friends={friends}
        initialRound={round}
        onSubmit={async ({ course_id: _courseId, ...input }) => {
          await updateRound(round.id, input, await getAuthHeaders())
          router.replace(`/round/${round.id}` as never)
        }}
        searchCourses={(query) => searchCourses({ q: query, limit: 20 })}
        submitLabel="Save changes"
      /> : null}
    </ProductScreen>
  </>
}

function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  error: { color: colors.error, fontSize: 11, textAlign: 'center' },
  retry: { alignSelf: 'center', borderColor: colors.pine, borderRadius: 18, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 8 },
  retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
})

import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'

import {
  getCourseRating,
  getFriends,
  getRatingCandidate,
  saveCourseRating,
  saveRatingDetails,
} from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { RatingFlow } from '../../src/components/RatingFlow'
import { CourseRatingState, FriendSummary } from '../../src/types'
import { colors } from '../../src/ui/theme'

export default function RateCourseRoute() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const [rating, setRating] = useState<CourseRatingState | null>(null)
  const [friends, setFriends] = useState<FriendSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const courseId = id && /^\d+$/.test(id) ? Number(id) : null

  useEffect(() => {
    let cancelled = false
    if (!courseId) {
      setError('Course not found.')
      return
    }
    setRating(null)
    setError(null)
    getAuthHeaders()
      .then(async (headers) => Promise.all([
        getCourseRating(courseId, headers),
        getFriends(headers),
      ]))
      .then(([nextRating, nextFriends]) => {
        if (!cancelled) {
          setRating(nextRating)
          setFriends(nextFriends)
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load this rating.')
      })
    return () => { cancelled = true }
  }, [courseId, getAuthHeaders, reloadKey])

  const close = useCallback(() => router.back(), [router])

  if (!courseId || error || !rating) {
    return <>
      <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.state}>
          {error ? <>
            <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
            {courseId ? <Pressable accessibilityRole="button" onPress={() => setReloadKey((key) => key + 1)} style={styles.button}><Text style={styles.buttonText}>Retry</Text></Pressable> : null}
            <Pressable accessibilityRole="button" onPress={close}><Text style={styles.close}>Close</Text></Pressable>
          </> : <><ActivityIndicator accessibilityLabel="Loading rating" color={colors.pine} size="large" /><Text style={styles.loading}>Loading your rating...</Text><Pressable accessibilityRole="button" onPress={close} style={styles.loadingClose}><Text style={styles.close}>Close</Text></Pressable></>}
        </View>
      </SafeAreaView>
    </>
  }

  return <>
    <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal' }} />
    <RatingFlow
      course={rating.course}
      friends={friends}
      getCandidate={async (tier) => {
        const headers = await getAuthHeaders()
        return getRatingCandidate(courseId, tier, headers)
      }}
      initialRating={rating}
      onClose={close}
      saveDetails={async (input) => {
        const headers = await getAuthHeaders()
        return saveRatingDetails(courseId, input, headers)
      }}
      saveRating={async (input) => {
        const headers = await getAuthHeaders()
        return saveCourseRating(courseId, input, headers)
      }}
    />
  </>
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  state: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 28 },
  loading: { color: colors.muted, fontSize: 13 }, error: { color: colors.error, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { backgroundColor: colors.pine, borderRadius: 999, minWidth: 150, paddingHorizontal: 18, paddingVertical: 13 }, buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  close: { color: colors.pine, fontSize: 13, fontWeight: '800', padding: 8 },
  loadingClose: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 72 },
})

import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'

import {
  getRatingCandidate,
  saveCourseRating,
  saveRatingDetails,
} from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { RatingFlow } from '../../src/components/RatingFlow'
import { loadRatingBootstrap } from '../../src/rating/loadRatingBootstrap'
import { CourseRatingState, FriendSummary } from '../../src/types'
import { colors } from '../../src/ui/theme'

export default function RateCourseRoute() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const getAuthHeadersRef = useRef(getAuthHeaders)
  const requestVersionRef = useRef(0)
  const courseId = id && /^\d+$/.test(id) ? Number(id) : null
  getAuthHeadersRef.current = getAuthHeaders

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current
    const isCurrentRequest = () => requestVersionRef.current === requestVersion

    if (!courseId) {
      setBootstrap(null)
      return
    }

    setBootstrap({ courseId, error: null, friends: [], rating: null })
    getAuthHeadersRef.current()
      .then((headers) => loadRatingBootstrap(courseId, headers))
      .then(([nextRating, nextFriends]) => {
        if (isCurrentRequest()) {
          setBootstrap({ courseId, error: null, friends: nextFriends, rating: nextRating })
        }
      })
      .catch((reason) => {
        if (isCurrentRequest()) {
          setBootstrap({
            courseId,
            error: reason instanceof Error ? reason.message : 'Unable to load this rating.',
            friends: [],
            rating: null,
          })
        }
      })
    return () => {
      if (isCurrentRequest()) requestVersionRef.current += 1
    }
  }, [courseId, reloadKey])

  const close = useCallback(() => router.back(), [router])
  const currentBootstrap = bootstrap?.courseId === courseId ? bootstrap : null
  const error = courseId ? currentBootstrap?.error ?? null : 'Course not found.'
  const rating = currentBootstrap?.rating ?? null
  const friends = currentBootstrap?.friends ?? []

  if (!courseId || error || !rating) {
    return <>
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

type BootstrapState = {
  courseId: number
  error: string | null
  friends: FriendSummary[]
  rating: CourseRatingState | null
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  state: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 28 },
  loading: { color: colors.muted, fontSize: 13 }, error: { color: colors.error, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { backgroundColor: colors.pine, borderRadius: 999, minWidth: 150, paddingHorizontal: 18, paddingVertical: 13 }, buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  close: { color: colors.pine, fontSize: 13, fontWeight: '800', padding: 8 },
  loadingClose: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 72 },
})

import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'

import { createRound, getCourse, getFollows, getProfile, searchCourses } from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../../src/components/ProductUI'
import { RoundForm } from '../../src/components/RoundForm'
import { Course, FriendSummary, RoundVisibility } from '../../src/types'
import { colors } from '../../src/ui/theme'

export default function NewRound() {
  const router = useRouter()
  const { courseId } = useLocalSearchParams<{ courseId?: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const [initialCourse, setInitialCourse] = useState<Course | null>(null)
  const [friends, setFriends] = useState<FriendSummary[]>([])
  const [searchRegion, setSearchRegion] = useState<string | undefined>()
  const [defaultVisibility, setDefaultVisibility] = useState<RoundVisibility>('friends')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const headers = await getAuthHeaders()
        const [course, follows, profile] = await Promise.all([
          courseId && /^\d+$/.test(courseId) ? getCourse(Number(courseId)) : Promise.resolve(null),
          getFollows(headers),
          getProfile(headers).catch(() => null),
        ])
        if (!active) return
        setInitialCourse(course)
        setFriends(follows.map((item) => item.user))
        setSearchRegion(profile?.home_region || undefined)
        setDefaultVisibility(profile?.onboarding_data?.default_round_visibility ?? 'friends')
      } catch (reason) {
        if (active) setError(message(reason, 'Unable to prepare the round form.'))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [courseId, getAuthHeaders])

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="Log round" onBack={() => router.back()} />
      {loading ? <ActivityIndicator accessibilityLabel="Loading round form" color={colors.pine} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!loading ? <RoundForm
        friends={friends}
        defaultVisibility={defaultVisibility}
        initialCourse={initialCourse}
        onSubmit={async (input) => {
          const round = await createRound(input, await getAuthHeaders())
          router.replace(`/round/${round.id}` as never)
        }}
        searchCourses={(query) => searchCourses({ q: query, region: searchRegion, limit: 20 })}
        submitLabel="Log round"
      /> : null}
    </ProductScreen>
  </>
}

function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  error: { color: colors.error, fontSize: 11, textAlign: 'center' },
})

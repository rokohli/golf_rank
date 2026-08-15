import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import { getActivity } from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../../src/components/ProductUI'
import { Activity } from '../../src/types'

export default function ActivityDetail() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const [activity, setActivity] = useState<Activity | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const eventId = Number(id)
    if (!Number.isInteger(eventId) || eventId < 1) {
      setError('Activity not found.')
      return
    }
    setError(null)
    try {
      setActivity(await getActivity(eventId, await getAuthHeaders()))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load this activity.')
    }
  }, [getAuthHeaders, id])

  useEffect(() => { void load() }, [load])

  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen><ScreenHeader title="Friend activity" onBack={() => router.back()} />
    {!activity && !error ? <ActivityIndicator accessibilityLabel="Loading activity" /> : null}
    {error ? <View><Text accessibilityRole="alert">{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()}><Text>Retry activity</Text></Pressable></View> : null}
    {activity ? <View><Text>{activity.actor.display_name}</Text><Text>{activity.event_type === 'course_rated' ? 'rated' : 'played'} {activity.course?.name ?? 'a course'}</Text>{typeof activity.data.rating === 'number' ? <Text>{activity.data.rating.toFixed(1)}/10</Text> : null}</View> : null}
  </ProductScreen></>
}

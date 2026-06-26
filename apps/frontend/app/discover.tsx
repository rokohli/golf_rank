import { Stack, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { getProfile, searchCourses } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { CourseList } from '../src/components/CourseList'
import { Course } from '../src/types'

export default function Discover() {
  const router = useRouter()
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState<string | null>(null)
  const { getAuthHeaders } = useAuthHeaders()

  useEffect(() => {
    getAuthHeaders()
      .then(getProfile)
      .then(searchCourses)
      .then(setCourses)
      .catch((reason: Error) => setError(reason.message))
  }, [getAuthHeaders])

  return (
    <>
      <Stack.Screen options={{ title: 'Discover courses' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 24, paddingTop: 20, gap: 16 }}
      >
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ pressed }) => ({
            alignItems: 'center',
            alignSelf: 'flex-start',
            backgroundColor: pressed ? '#DDE5DF' : '#EAF0EC',
            borderRadius: 18,
            height: 36,
            justifyContent: 'center',
            width: 36,
          })}
        >
          <Text style={{ color: '#102015', fontSize: 30, fontWeight: '500', lineHeight: 32 }}>‹</Text>
        </Pressable>
        <View style={{ gap: 6 }}>
          <Text selectable style={{ fontSize: 28, fontWeight: '700', color: '#102015' }}>
            Discover courses
          </Text>
          <Text selectable style={{ fontSize: 16, lineHeight: 22, color: '#53605A' }}>
            Seeded local course data filtered through the API.
          </Text>
        </View>
        {error ? (
          <Text accessibilityRole="alert" selectable style={{ color: '#B42318' }}>
            {error}
          </Text>
        ) : (
          <CourseList courses={courses} />
        )}
      </ScrollView>
    </>
  )
}

import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { getProfile, searchCourses } from '../src/api/client'
import { CourseList } from '../src/components/CourseList'
import { Course } from '../src/types'

export default function Discover() {
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getProfile()
      .then(searchCourses)
      .then(setCourses)
      .catch((reason: Error) => setError(reason.message))
  }, [])

  return (
    <>
      <Stack.Screen options={{ title: 'Discover courses' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 24, paddingTop: 20, gap: 16 }}
      >
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

import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { searchCourses } from '../src/api/client'
import { CourseList } from '../src/components/CourseList'
import { Course } from '../src/types'
export default function Discover() {
  const [courses, setCourses] = useState<Course[]>([]); const [error, setError] = useState<string | null>(null)
  useEffect(() => { searchCourses().then(setCourses).catch((reason: Error) => setError(reason.message)) }, [])
  return <View><Text>Discover courses</Text>{error ? <Text accessibilityRole="alert">{error}</Text> : <CourseList courses={courses} />}</View>
}

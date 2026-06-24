import { Text, View } from 'react-native'
import { Course } from '../types'

export function CourseList({ courses }: { courses: Course[] }) {
  if (!courses.length) return <Text>No courses match your preferences yet.</Text>
  return <View>{courses.map((course) => <View key={course.id}><Text>{course.name}</Text><Text>{course.region} · ${course.green_fee}</Text></View>)}</View>
}

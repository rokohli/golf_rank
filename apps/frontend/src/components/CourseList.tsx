import { Text, View } from 'react-native'
import { Course } from '../types'

export function CourseList({ courses }: { courses: Course[] }) {
  if (!courses.length) {
    return (
      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18 }}>
        <Text selectable style={{ color: '#53605A', fontSize: 16, lineHeight: 22 }}>
          No courses match your preferences yet.
        </Text>
      </View>
    )
  }

  return (
    <View style={{ gap: 12 }}>
      {courses.map((course) => (
        <View
          key={course.id}
          style={{
            backgroundColor: '#FFFFFF',
            borderColor: '#E1E7E3',
            borderRadius: 18,
            borderWidth: 1,
            padding: 18,
          }}
        >
          <Text selectable style={{ color: '#102015', fontSize: 18, fontWeight: '700' }}>
            {course.name}
          </Text>
          <Text selectable style={{ color: '#53605A', fontSize: 15, marginTop: 6 }}>
            {course.region} · ${course.green_fee}
          </Text>
        </View>
      ))}
    </View>
  )
}

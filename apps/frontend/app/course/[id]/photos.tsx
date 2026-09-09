import { Feather } from '@expo/vector-icons'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getCourse } from '../../../src/api/client'
import { CoursePhotoItem } from '../[id]'
import { PhotoViewer } from '../../../src/components/PhotoViewer'
import { attributedCourseImages } from '../../../src/coursePresentation'
import { Course } from '../../../src/types'
import { colors } from '../../../src/ui/theme'

export default function CourseAllPhotos() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const courseId = id && /^\d+$/.test(id) ? Number(id) : null
  const [course, setCourse] = useState<Course | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!courseId) {
      setError('Course not found.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setCourse(await getCourse(courseId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load photos.')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => { void load() }, [load])

  const photos = course ? attributedCourseImages(course) : []

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={20} color={colors.pineDark} />
        </Pressable>
        <Text style={styles.title}>{course ? `${course.name} photos` : 'Course photos'}</Text>
      </View>
      {loading ? <ActivityIndicator accessibilityLabel="Loading photos" color={colors.pine} style={styles.loader} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!loading && !error ? (
        <FlatList
          contentContainerStyle={styles.grid}
          data={photos}
          keyExtractor={(image) => String(image.id)}
          numColumns={2}
          renderItem={({ item, index }) => (
            <Pressable accessibilityLabel={`View photo ${index + 1} of ${photos.length}`} accessibilityRole="button" onPress={() => setViewerIndex(index)} style={styles.gridCell}>
              <CoursePhotoItem courseName={course?.name ?? ''} image={item} index={index} />
            </Pressable>
          )}
        />
      ) : null}
      {viewerIndex !== null ? <PhotoViewer courseName={course?.name ?? ''} onClose={() => setViewerIndex(null)} photos={photos} startIndex={viewerIndex} /> : null}
    </View>
  </>
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#F8F7F3', flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
  backButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
  title: { color: colors.pineDark, flex: 1, fontFamily: 'Georgia', fontSize: 18 },
  loader: { marginTop: 24 },
  error: { color: colors.error, paddingHorizontal: 18, textAlign: 'center' },
  grid: { gap: 10, paddingHorizontal: 18, paddingVertical: 8 },
  gridCell: { flex: 1, marginHorizontal: 5, marginBottom: 10 },
})

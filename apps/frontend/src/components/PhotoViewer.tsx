import { Feather } from '@expo/vector-icons'
import { Dimensions, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CourseImage } from '../types'
import { Avatar } from './ProductUI'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')

function initials(username: string) { return username.slice(0, 2).toUpperCase() || 'GR' }

function formatMonthYear(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function PhotoViewer({ courseName, onClose, photos, startIndex }: { courseName: string; onClose: () => void; photos: CourseImage[]; startIndex: number }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={styles.viewerOverlay}>
      <FlatList
        data={photos}
        horizontal
        initialScrollIndex={startIndex}
        getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
        keyExtractor={(image) => String(image.id)}
        pagingEnabled
        renderItem={({ item }) => (
          <View style={styles.viewerPage}>
            <Image accessibilityLabel={item.alt_text ?? `${courseName} course photo`} resizeMode="contain" source={{ uri: item.url! }} style={styles.viewerImage} />
            {item.source_type === 'user' && item.uploaded_by_username ? (
              <View style={styles.viewerCredit}>
                <Avatar initials={initials(item.uploaded_by_username)} size={32} />
                <View>
                  <Text style={styles.viewerUsername}>{`@${item.uploaded_by_username}`}</Text>
                  {formatMonthYear(item.created_at) ? <Text style={styles.viewerDate}>{formatMonthYear(item.created_at)}</Text> : null}
                </View>
              </View>
            ) : (
              <Text style={styles.viewerCaption}>{item.source_type !== 'user' ? item.source_name ?? '' : ''}</Text>
            )}
          </View>
        )}
        showsHorizontalScrollIndicator={false}
      />
      <Pressable accessibilityLabel="Close photo viewer" accessibilityRole="button" onPress={onClose} style={[styles.viewerClose, { top: insets.top + 12 }]}>
        <Feather name="x" size={22} color="#FFF" />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  viewerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0B140F' },
  viewerPage: { alignItems: 'center', height: screenHeight, justifyContent: 'center', width: screenWidth },
  viewerImage: { height: screenHeight * 0.78, width: screenWidth },
  viewerCaption: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 12, paddingHorizontal: 24, textAlign: 'center' },
  viewerCredit: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 14, paddingHorizontal: 24 },
  viewerUsername: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  viewerDate: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 2 },
  viewerClose: { alignItems: 'center', backgroundColor: 'rgba(16,56,42,0.7)', borderRadius: 18, height: 36, justifyContent: 'center', position: 'absolute', right: 14, width: 36 },
})

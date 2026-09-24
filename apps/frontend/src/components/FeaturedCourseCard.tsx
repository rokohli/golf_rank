import { Feather } from '@expo/vector-icons'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { attributedCourseImage, CoursePresentation } from '../coursePresentation'
import { CourseVisual } from './ProductUI'
import { FeaturedCourse } from '../types'
import { colors, radii } from '../ui/theme'

export type FeaturedCourseCardProps = {
  featured: FeaturedCourse
  onOpenCourse: (courseId: number) => void
  onPlanTrip: (courseId: number) => void
  onSave: () => Promise<void> | void
  onDismiss?: () => Promise<void> | void
}

export function FeaturedCourseCard({
  featured,
  onOpenCourse,
  onPlanTrip,
  onSave,
  onDismiss,
}: FeaturedCourseCardProps) {
  const [saving, setSaving] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const course = featured.course

  const displayCourse: CoursePresentation = {
    id: String(course.id),
    name: course.name,
    location: course.region,
    rating: course.community_rating ?? 0,
    reviews: '',
    distance: featured.distance_miles ? `~${Math.round(featured.distance_miles)} mi` : '',
    price: course.green_fee ? `$${course.green_fee}` : '',
    image: attributedCourseImage(course),
    heroImage: course.hero_image,
  }

  const handleSave = async () => {
    if (saving || dismissing || featured.is_saved) return
    setSaving(true)
    try {
      await onSave()
    } finally {
      setSaving(false)
    }
  }

  const handleDismiss = async () => {
    if (dismissing || saving || !onDismiss || !featured.can_dismiss) return
    setDismissing(true)
    try {
      await onDismiss()
    } finally {
      setDismissing(false)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.spotlightBadge}>
          <Feather
            name={featured.is_regional_fallback ? 'compass' : 'star'}
            size={12}
            color={colors.gold}
          />
          <Text style={styles.spotlightText}>
            {featured.is_regional_fallback ? 'REGIONAL SPOTLIGHT' : "THIS WEEK'S SPOTLIGHT"}
          </Text>
        </View>

        {featured.can_dismiss && onDismiss ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show next recommendation"
            onPress={handleDismiss}
            disabled={dismissing || saving}
            style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
          >
            {dismissing ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : (
              <>
                <Feather name="refresh-cw" size={11} color={colors.muted} />
                <Text style={styles.dismissText}>Next pick</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${course.name} details`}
        onPress={() => onOpenCourse(course.id)}
        style={({ pressed }) => [styles.visualWrapper, pressed && styles.pressed]}
      >
        <CourseVisual course={displayCourse} height={160}>
          <View style={styles.imageScrim} />
          <View style={styles.imageContent}>
            <View style={{ flex: 1 }}>
              <Text style={styles.courseName} numberOfLines={1}>{course.name}</Text>
              <Text style={styles.courseRegion} numberOfLines={1}>{course.region}</Text>
            </View>
            {featured.distance_miles !== null && featured.distance_miles !== undefined ? (
              <View style={styles.distanceBadge}>
                <Feather name="navigation" size={10} color="#FFF" />
                <Text style={styles.distanceText}>~{Math.round(featured.distance_miles)} mi</Text>
              </View>
            ) : null}
          </View>
        </CourseVisual>
      </Pressable>

      {featured.match_tags?.length ? (
        <View style={styles.tagsRow}>
          {featured.match_tags.map((tag) => (
            <View key={tag} style={styles.tagChip}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.rationaleBox}>
        <View style={styles.rationaleIcon}>
          <Feather name="award" size={13} color={colors.pine} />
        </View>
        <Text style={styles.rationaleText}>{featured.rationale}</Text>
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Explore ${course.name}`}
          onPress={() => onOpenCourse(course.id)}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryButtonText}>View Course</Text>
          <Feather name="arrow-right" size={14} color="#FFF" />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Plan a trip to ${course.name}`}
          onPress={() => onPlanTrip(course.id)}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Feather name="map" size={13} color={colors.pineDark} />
          <Text style={styles.secondaryButtonText}>Plan Trip</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={featured.is_saved ? `${course.name} is saved` : `Save ${course.name}`}
          onPress={handleSave}
          disabled={saving || dismissing || featured.is_saved}
          style={({ pressed }) => [
            styles.saveButton,
            featured.is_saved && styles.saveButtonActive,
            pressed && styles.pressed,
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.pine} />
          ) : (
            <Feather
              name="bookmark"
              size={15}
              color={featured.is_saved ? '#FFF' : colors.pineDark}
            />
          )}
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 12,
    marginBottom: 18,
    padding: 14,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  spotlightBadge: {
    alignItems: 'center',
    backgroundColor: '#FDF7EB',
    borderColor: '#F3E4C0',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  spotlightText: {
    color: '#8A5D00',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  dismissButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dismissText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  visualWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  imageScrim: {
    backgroundColor: 'rgba(5, 21, 13, 0.58)',
    bottom: 0,
    height: 70,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  imageContent: {
    alignItems: 'flex-end',
    bottom: 11,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 12,
    position: 'absolute',
    right: 12,
  },
  courseName: {
    color: '#FFF',
    fontFamily: 'Georgia',
    fontSize: 17,
    fontWeight: '500',
  },
  courseRegion: {
    color: '#E0E7E2',
    fontSize: 11,
    marginTop: 2,
  },
  distanceBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  distanceText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagChip: {
    backgroundColor: '#F2F3EE',
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '600',
  },
  rationaleBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.pineSoft,
    borderRadius: radii.small,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  rationaleIcon: {
    marginTop: 2,
  },
  rationaleText: {
    color: colors.pineDark,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.pine,
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#ECEEE9',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: colors.pineDark,
    fontSize: 12,
    fontWeight: '700',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#ECEEE9',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  saveButtonActive: {
    backgroundColor: colors.pine,
  },
  pressed: {
    opacity: 0.75,
  },
})

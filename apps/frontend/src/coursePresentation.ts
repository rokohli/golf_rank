import { ImageSourcePropType } from 'react-native'

import { Course, CourseImage, HeroImage } from './types'

export type CoursePresentation = {
  id: string
  name: string
  location: string
  rating: number
  reviews: string
  distance: string
  price: string
  image?: ImageSourcePropType
  heroImage?: HeroImage | null
  personalRank?: number
  personalRating?: number
  tier?: 'green' | 'fairway' | 'rough' | 'bunker'
}

const SOURCE_PRIORITY: Record<string, number> = {
  official: 1,
  user: 2,
  wikimedia: 3,
}

// The course-detail API resolves and returns `hero_image` per the backend's
// OFFICIAL -> USER -> WIKIMEDIA -> SATELLITE -> NONE priority; list/search
// responses don't include it (would be too slow to resolve per row), so this
// falls back to sorting `course.images` by source priority (OFFICIAL -> USER ->
// WIKIMEDIA), then featured status (`is_hero`), then position.
export function attributedCourseImage(course: Course): ImageSourcePropType | undefined {
  if (course.hero_image && course.hero_image.type !== 'NONE' && course.hero_image.url) {
    return { uri: course.hero_image.url }
  }
  const images = attributedCourseImages(course)
  if (images.length === 0) {
    return undefined
  }
  const sorted = [...images].sort((a, b) => {
    const priorityA = a.source_type ? (SOURCE_PRIORITY[a.source_type.toLowerCase()] ?? 99) : 99
    const priorityB = b.source_type ? (SOURCE_PRIORITY[b.source_type.toLowerCase()] ?? 99) : 99
    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }
    if (a.is_hero !== b.is_hero) {
      return a.is_hero ? -1 : 1
    }
    return a.position - b.position
  })
  const image = sorted[0]
  return image?.url ? { uri: image.url } : undefined
}

export function attributedCourseImages(course: Course): CourseImage[] {
  return course.images?.filter((image) => Boolean(
    image.url && image.source_name && image.source_url,
  )) ?? []
}

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

// The course-detail API resolves and returns `hero_image` per the backend's
// OFFICIAL -> USER -> WIKIMEDIA -> SATELLITE -> NONE priority; list/search
// responses don't include it (would be too slow to resolve per row), so this
// falls back to the legacy image-array heuristic there.
export function attributedCourseImage(course: Course): ImageSourcePropType | undefined {
  if (course.hero_image && course.hero_image.type !== 'NONE' && course.hero_image.url) {
    return { uri: course.hero_image.url }
  }
  const images = attributedCourseImages(course)
  const image = images.find((item) => item.is_hero) ?? images[0]
  return image?.url ? { uri: image.url } : undefined
}

export function attributedCourseImages(course: Course): CourseImage[] {
  return course.images?.filter((image) => Boolean(
    image.url && image.source_name && image.source_url,
  )) ?? []
}

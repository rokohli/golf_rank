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

// Mirrors CourseImageRepository.IDEAL_HERO_ASPECT_RATIO / _aspect_penalty on
// the backend -- lower is better, missing dimensions are a mild penalty.
const IDEAL_HERO_ASPECT_RATIO = 16 / 9

function aspectPenalty(image: CourseImage): number {
  if (!image.width || !image.height) {
    return 1.0
  }
  return Math.abs(image.width / image.height - IDEAL_HERO_ASPECT_RATIO)
}

// Only the OFFICIAL/USER tiers are exempt from requiring attribution --
// they have nullable source_name/source_url and are exempt on the detail
// hero too (CourseImageService._to_result). Everything else (Wikimedia, or
// a missing source_type -- the backend's own column default is WIKIMEDIA)
// still needs attribution to be shown, matching the pre-existing behavior
// this codebase already relies on for legal/licensing reasons.
function isDisplayableCourseImage(image: CourseImage): boolean {
  if (!image.url) {
    return false
  }
  const sourceType = image.source_type?.toLowerCase()
  if (sourceType === 'official' || sourceType === 'user') {
    return true
  }
  return Boolean(image.source_name && image.source_url)
}

// The course-detail API resolves and returns `hero_image` per the backend's
// OFFICIAL -> USER -> WIKIMEDIA -> SATELLITE -> NONE priority; list/search
// responses don't include it (would be too slow to resolve per row), so this
// falls back to sorting `course.images` by source priority (OFFICIAL -> USER ->
// WIKIMEDIA), then the same within-tier ranking as
// CourseImageRepository._rank_key: featured status, quality score, aspect
// ratio fit, recency, then id.
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
    const qualityA = a.quality_score ?? -1.0
    const qualityB = b.quality_score ?? -1.0
    if (qualityA !== qualityB) {
      return qualityB - qualityA
    }
    const aspectDelta = aspectPenalty(a) - aspectPenalty(b)
    if (aspectDelta !== 0) {
      return aspectDelta
    }
    const createdA = a.created_at ? Date.parse(a.created_at) : 0
    const createdB = b.created_at ? Date.parse(b.created_at) : 0
    if (createdA !== createdB) {
      return createdB - createdA
    }
    return a.id - b.id
  })
  const image = sorted[0]
  return image?.url ? { uri: image.url } : undefined
}

export function attributedCourseImages(course: Course): CourseImage[] {
  return course.images?.filter(isDisplayableCourseImage) ?? []
}

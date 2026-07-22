import { ImageSourcePropType } from 'react-native'

import { Course, CourseImage } from './types'

export type CoursePresentation = {
  id: string
  name: string
  location: string
  rating: number
  reviews: string
  distance: string
  price: string
  image?: ImageSourcePropType
  personalRank?: number
  personalRating?: number
  tier?: 'green' | 'fairway' | 'rough' | 'bunker'
}

export function attributedCourseImage(course: Course): ImageSourcePropType | undefined {
  const images = attributedCourseImages(course)
  const image = images.find((item) => item.is_hero) ?? images[0]
  return image?.url ? { uri: image.url } : undefined
}

export function attributedCourseImages(course: Course): CourseImage[] {
  return course.images?.filter((image) => Boolean(
    image.url && image.source_name && image.source_url,
  )) ?? []
}

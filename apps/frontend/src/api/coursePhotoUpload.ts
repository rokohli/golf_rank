import * as ImagePicker from 'expo-image-picker'

import { ApiHeaders } from '../auth/useAuthToken'
import { CourseImage } from '../types'
import { CoursePhotoContentType, confirmCoursePhotoUpload, getCoursePhotoUploadUrl, uploadCoursePhotoToStorage } from './client'

export function contentTypeForAsset(mimeType: string | undefined | null): CoursePhotoContentType {
  if (mimeType === 'image/png') return 'image/png'
  if (mimeType === 'image/webp') return 'image/webp'
  return 'image/jpeg'
}

export type PickedCoursePhotoAsset = {
  uri: string
  contentType: CoursePhotoContentType
  dimensions?: { width: number; height: number }
}

// Shared by every course-photo picker entry point (course detail, rating flow)
// so the picker options and content-type/dimension derivation can't drift
// between call sites. Returns null when the user cancels the picker.
export async function pickCoursePhotoAsset(): Promise<PickedCoursePhotoAsset | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 })
  if (result.canceled || !result.assets[0]?.uri) return null
  const asset = result.assets[0]
  return {
    uri: asset.uri,
    contentType: contentTypeForAsset(asset.mimeType),
    dimensions: asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined,
  }
}

export async function uploadCoursePhoto(
  courseId: number,
  imageUri: string,
  contentType: CoursePhotoContentType,
  headers: ApiHeaders,
  dimensions?: { width: number; height: number },
  roundId?: number,
): Promise<CourseImage> {
  const { storageKey } = await startCoursePhotoUpload(courseId, imageUri, contentType, headers)
  return confirmCoursePhotoUpload(courseId, storageKey, headers, dimensions, roundId)
}

// A round's photos can't be confirmed with a round_id until the round exists --
// for a brand-new rating that's only true after Continue saves it. The upload
// to R2 itself doesn't need a round_id though, so it starts right away (the
// slow part, done in the background) while confirm (fast) is deferred to
// whenever the round is actually saved.
export const MAX_PHOTOS_PER_ROUND = 5

export async function startCoursePhotoUpload(
  courseId: number,
  imageUri: string,
  contentType: CoursePhotoContentType,
  headers: ApiHeaders,
): Promise<{ storageKey: string }> {
  const { upload_url: uploadUrl, storage_key: storageKey } = await getCoursePhotoUploadUrl(courseId, contentType, headers)
  await uploadCoursePhotoToStorage(uploadUrl, contentType, imageUri)
  return { storageKey }
}

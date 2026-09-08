import { ApiHeaders } from '../auth/useAuthToken'
import { CourseImage } from '../types'
import { CoursePhotoContentType, confirmCoursePhotoUpload, getCoursePhotoUploadUrl, uploadCoursePhotoToStorage } from './client'

export function contentTypeForAsset(mimeType: string | undefined | null): CoursePhotoContentType {
  if (mimeType === 'image/png') return 'image/png'
  if (mimeType === 'image/webp') return 'image/webp'
  return 'image/jpeg'
}

export async function uploadCoursePhoto(
  courseId: number,
  imageUri: string,
  contentType: CoursePhotoContentType,
  headers: ApiHeaders,
  dimensions?: { width: number; height: number },
): Promise<CourseImage> {
  const { storageKey } = await startCoursePhotoUpload(courseId, imageUri, contentType, headers)
  return confirmCoursePhotoUpload(courseId, storageKey, headers, dimensions)
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

import * as ImagePicker from 'expo-image-picker'

import { ApiHeaders } from '../auth/useAuthToken'
import { CourseImage } from '../types'
import { ApiResponseError, CoursePhotoContentType, confirmCoursePhotoUpload, discardCoursePhotoUpload, getCoursePhotoUploadUrl, uploadCoursePhotoToStorage } from './client'

// A confirm failure is worth retrying (or at least not worth discarding the
// staged object over) whenever the object might still exist / the request
// might still have succeeded: a network-level failure (no response at all --
// not an ApiResponseError), a 429 (rate limited, nothing about the request
// was rejected), or a 5xx (a server-side failure -- an R2 transport error
// inside head_object, a transient database error, storage briefly
// unavailable -- none of which confirm_upload's own validation-rejection
// paths raise; those are always 4xx and delete the object before
// responding). Only a definitive 4xx rejection (bad type/size, round
// mismatch, cap exceeded, wrong owner) means the server actually processed
// the request and deleted the object -- that, and only that, can never
// succeed by retrying/be salvaged by keeping the same storage_key. Shared by
// every confirm call site (RatingFlow's staged-photo retry, this module's
// uploadCoursePhoto) so the classification can't drift between them.
export function isRetryableConfirmFailure(reason: unknown): boolean {
  if (!(reason instanceof ApiResponseError)) return true
  return reason.status === 429 || reason.status >= 500
}

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
  try {
    return await confirmCoursePhotoUpload(courseId, storageKey, headers, dimensions, roundId)
  } catch (error) {
    // Only discard on a definitive rejection -- confirm_upload has already
    // deleted the object itself in that case, so this is a harmless no-op
    // cleanup of a key that's already gone. For a retryable failure (a
    // network error, or a 5xx that could mean the request actually
    // succeeded and only the response was lost), discarding would be wrong
    // in two ways: the object may still be needed to retry against, and if
    // confirm actually committed, discard's own "already confirmed" check
    // (see discard_upload) makes this a no-op anyway -- so there's nothing
    // to gain and a real object to lose by discarding here.
    if (!isRetryableConfirmFailure(error)) {
      await discardCoursePhotoUpload(courseId, storageKey, headers)
    }
    throw error
  }
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

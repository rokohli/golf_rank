import { ApiHeaders } from '../auth/useAuthToken'
import {
  Course,
  CourseRatingInput,
  CourseRatingState,
  FriendSummary,
  OnboardingPreferences,
  RankingComparison,
  RankingSnapshot,
  RatingCandidate,
  RatingDetailsInput,
  RatingTier,
  TierPlacement,
} from '../types'

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'

export class ApiResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiResponseError'
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json() as { detail?: string }
    if (body.detail) return new ApiResponseError(body.detail, response.status)
  } catch {
    // The API may return an empty or non-JSON error response.
  }
  return new ApiResponseError(fallback, response.status)
}

export async function savePreferences(input: OnboardingPreferences, headers: ApiHeaders): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/onboarding-preferences`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  })
  if (!response.ok) throw await responseError(response, 'Unable to save preferences. Please try again.')
}

export async function getProfile(headers: ApiHeaders): Promise<OnboardingPreferences> {
  const response = await fetch(`${baseUrl}/api/v1/me/profile`, {
    headers,
  })
  if (!response.ok) throw await responseError(response, 'Unable to load profile. Please complete onboarding first.')
  return response.json()
}

export async function searchCourses(filters?: OnboardingPreferences): Promise<Course[]> {
  const params = new URLSearchParams()
  if (filters?.home_region) params.set('region', filters.home_region)
  if (filters?.max_green_fee !== undefined) params.set('max_green_fee', String(filters.max_green_fee))
  if (filters?.difficulty && filters.difficulty !== 'any') params.set('difficulty', filters.difficulty)
  if (filters?.access && filters.access !== 'any') params.set('access', filters.access)

  const query = params.toString()
  const response = await fetch(`${baseUrl}/api/v1/courses${query ? `?${query}` : ''}`)
  if (!response.ok) throw await responseError(response, 'Unable to load courses. Please try again.')
  return response.json()
}

export async function getCourse(courseId: number): Promise<Course> {
  const response = await fetch(`${baseUrl}/api/v1/courses/${courseId}`)
  if (!response.ok) throw await responseError(response, 'Unable to load this course. Please try again.')
  return response.json()
}

export async function getRanking(headers: ApiHeaders): Promise<RankingSnapshot> {
  const response = await fetch(`${baseUrl}/api/v1/me/rankings`, { headers })
  if (!response.ok) throw await responseError(response, 'Unable to load your rankings. Please try again.')
  return response.json()
}

export async function saveTierPlacements(
  assignments: TierPlacement[],
  headers: ApiHeaders,
): Promise<RankingSnapshot> {
  const response = await fetch(`${baseUrl}/api/v1/me/rankings/tiers`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ assignments }),
  })
  if (!response.ok) throw await responseError(response, 'Unable to update your ranking tiers. Please try again.')
  return response.json()
}

export async function saveComparison(
  comparison: RankingComparison,
  headers: ApiHeaders,
): Promise<RankingSnapshot> {
  const response = await fetch(`${baseUrl}/api/v1/me/rankings/comparisons`, {
    method: 'POST',
    headers,
    body: JSON.stringify(comparison),
  })
  if (!response.ok) throw await responseError(response, 'Unable to save this comparison. Please try again.')
  return response.json()
}

export async function getCourseRating(
  courseId: number,
  headers: ApiHeaders,
): Promise<CourseRatingState> {
  const response = await fetch(`${baseUrl}/api/v1/me/course-ratings/${courseId}`, { headers })
  if (!response.ok) {
    throw await responseError(response, 'Unable to load your rating for this course. Please try again.')
  }
  return response.json()
}

export async function getRatingCandidate(
  courseId: number,
  tier: RatingTier,
  headers: ApiHeaders,
): Promise<RatingCandidate> {
  const response = await fetch(
    `${baseUrl}/api/v1/me/course-ratings/${courseId}/comparison-candidate?tier=${encodeURIComponent(tier)}`,
    { headers },
  )
  if (!response.ok) {
    throw await responseError(response, 'Unable to load a course comparison. Please try again.')
  }
  return response.json()
}

export async function saveCourseRating(
  courseId: number,
  input: CourseRatingInput,
  headers: ApiHeaders,
): Promise<CourseRatingState> {
  const response = await fetch(`${baseUrl}/api/v1/me/course-ratings/${courseId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw await responseError(response, 'Unable to save your course rating. Please try again.')
  }
  return response.json()
}

export async function saveRatingDetails(
  courseId: number,
  input: RatingDetailsInput,
  headers: ApiHeaders,
): Promise<CourseRatingState> {
  const response = await fetch(`${baseUrl}/api/v1/me/course-ratings/${courseId}/details`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw await responseError(response, 'Unable to save your round details. Please try again.')
  }
  return response.json()
}

type FollowResponse = {
  user: FriendSummary
  is_mutual: boolean
  followed_at: string
}

export async function getFriends(headers: ApiHeaders): Promise<FriendSummary[]> {
  const response = await fetch(`${baseUrl}/api/v1/me/follows`, { headers })
  if (!response.ok) {
    throw await responseError(response, 'Unable to load your friends. Please try again.')
  }
  const follows = await response.json() as FollowResponse[]
  return follows.map(({ user }) => user)
}

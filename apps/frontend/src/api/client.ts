import { ApiHeaders } from '../auth/useAuthToken'
import {
  Course,
  CourseRegion,
  CourseSearchFilters,
  CourseRatingInput,
  CourseRatingState,
  FriendSummary,
  FeedPage,
  Follow,
  OnboardingPreferences,
  RankingComparison,
  RankingSnapshot,
  RatingCandidate,
  RatingDetailsInput,
  RatingTier,
  SavedList,
  TierPlacement,
  UserSummary,
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

export async function searchCourses(filters?: OnboardingPreferences | CourseSearchFilters): Promise<Course[]> {
  const params = new URLSearchParams()
  if (filters && 'home_region' in filters && filters.home_region) params.set('region', filters.home_region)
  if (filters && !('home_region' in filters)) {
    for (const key of ['q', 'region', 'country', 'admin1', 'city'] as const) {
      if (filters[key]) params.set(key, String(filters[key]))
    }
    for (const key of ['lat', 'lng', 'radius_miles', 'cursor', 'limit'] as const) {
      if (filters[key] !== undefined) params.set(key, String(filters[key]))
    }
  }
  if (filters?.max_green_fee !== undefined) params.set('max_green_fee', String(filters.max_green_fee))
  if (filters?.difficulty && filters.difficulty !== 'any') params.set('difficulty', filters.difficulty)
  if (filters?.access && filters.access !== 'any') params.set('access', filters.access)

  const query = params.toString()
  const response = await fetch(`${baseUrl}/api/v1/courses${query ? `?${query}` : ''}`)
  if (!response.ok) throw await responseError(response, 'Unable to load courses. Please try again.')
  return response.json()
}

export async function getCourseRegions(): Promise<CourseRegion[]> {
  const response = await fetch(`${baseUrl}/api/v1/course-regions`)
  if (!response.ok) throw await responseError(response, 'Unable to load course regions. Please try again.')
  const body = await response.json() as { regions: CourseRegion[] }
  return body.regions
}

export async function submitCourseCandidate(
  input: { name: string; city?: string; admin1_code?: string; notes?: string },
  headers: ApiHeaders,
): Promise<{ id: number; status: string }> {
  const response = await fetch(`${baseUrl}/api/v1/course-candidates`, {
    method: 'POST', headers, body: JSON.stringify(input),
  })
  if (!response.ok) throw await responseError(response, 'Unable to submit this course. Please try again.')
  return response.json()
}

export async function getCourse(courseId: number): Promise<Course> {
  const response = await fetch(`${baseUrl}/api/v1/courses/${courseId}`)
  if (!response.ok) throw await responseError(response, 'Unable to load this course. Please try again.')
  return response.json()
}

export async function getSavedLists(headers: ApiHeaders): Promise<SavedList[]> {
  const response = await fetch(`${baseUrl}/api/v1/me/saved-lists`, { headers })
  if (!response.ok) throw await responseError(response, 'Unable to load saved courses. Please try again.')
  return response.json()
}

export async function createSavedList(
  input: { name: string; visibility: 'private' | 'friends' | 'public'; is_default: boolean },
  headers: ApiHeaders,
): Promise<SavedList> {
  const response = await fetch(`${baseUrl}/api/v1/me/saved-lists`, {
    method: 'POST', headers, body: JSON.stringify(input),
  })
  if (!response.ok) throw await responseError(response, 'Unable to create your saved courses list. Please try again.')
  return response.json()
}

export async function saveCourseToList(listId: number, courseId: number, headers: ApiHeaders): Promise<SavedList> {
  const response = await fetch(`${baseUrl}/api/v1/me/saved-lists/${listId}/courses/${courseId}`, {
    method: 'PUT', headers, body: JSON.stringify({ note: null }),
  })
  if (!response.ok) throw await responseError(response, 'Unable to save this course. Please try again.')
  return response.json()
}

export async function removeCourseFromList(listId: number, courseId: number, headers: ApiHeaders): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/saved-lists/${listId}/courses/${courseId}`, {
    method: 'DELETE', headers,
  })
  if (!response.ok) throw await responseError(response, 'Unable to remove this saved course. Please try again.')
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

export async function getFeed(headers: ApiHeaders, cursor?: string): Promise<FeedPage> {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', cursor)
  const response = await fetch(`${baseUrl}/api/v1/feed?${params}`, { headers })
  if (!response.ok) throw await responseError(response, 'Unable to load friends activity. Please try again.')
  return response.json()
}

export async function searchUsers(query: string, headers: ApiHeaders): Promise<UserSummary[]> {
  const response = await fetch(`${baseUrl}/api/v1/users?q=${encodeURIComponent(query)}`, { headers })
  if (!response.ok) throw await responseError(response, 'Unable to search golfers. Please try again.')
  return response.json()
}

export async function getFollows(headers: ApiHeaders): Promise<Follow[]> {
  const response = await fetch(`${baseUrl}/api/v1/me/follows`, { headers })
  if (!response.ok) throw await responseError(response, 'Unable to load following. Please try again.')
  return response.json()
}

export async function followUser(userId: number, headers: ApiHeaders): Promise<Follow> {
  const response = await fetch(`${baseUrl}/api/v1/me/follows/${userId}`, { method: 'PUT', headers })
  if (!response.ok) throw await responseError(response, 'Unable to follow this golfer. Please try again.')
  return response.json()
}

export async function unfollowUser(userId: number, headers: ApiHeaders): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/follows/${userId}`, { method: 'DELETE', headers })
  if (!response.ok) throw await responseError(response, 'Unable to unfollow this golfer. Please try again.')
}

export async function setActivityReaction(
  eventId: number,
  reacted: boolean,
  headers: ApiHeaders,
): Promise<{ reaction_count: number; viewer_reacted: boolean }> {
  const response = await fetch(`${baseUrl}/api/v1/feed/${eventId}/reactions/like`, {
    method: reacted ? 'PUT' : 'DELETE', headers,
  })
  if (!response.ok) throw await responseError(response, 'Unable to update this reaction. Please try again.')
  return response.json()
}

export async function muteUser(userId: number, muted: boolean, headers: ApiHeaders): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/mutes/${userId}`, { method: muted ? 'PUT' : 'DELETE', headers })
  if (!response.ok) throw await responseError(response, 'Unable to update mute settings. Please try again.')
}

export async function blockUser(userId: number, blocked: boolean, headers: ApiHeaders): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/blocks/${userId}`, { method: blocked ? 'PUT' : 'DELETE', headers })
  if (!response.ok) throw await responseError(response, 'Unable to update block settings. Please try again.')
}

export async function getFriends(headers: ApiHeaders): Promise<FriendSummary[]> {
  const follows = await getFollows(headers) as FollowResponse[]
  return follows.map(({ user }) => ({
    id: user.id,
    display_name: user.display_name,
    username: user.username,
  }))
}

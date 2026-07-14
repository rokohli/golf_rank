import {
  getCourse,
  getCourseRating,
  getFriends,
  getProfile,
  getRanking,
  getRatingCandidate,
  saveComparison,
  saveCourseRating,
  savePreferences,
  saveRatingDetails,
  saveTierPlacements,
  searchCourses,
} from '../client'
import { RatingTier } from '../../types'

describe('api client', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('passes saved profile preferences as course search filters', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response)

    await searchCourses({
      home_region: 'Monterey, CA',
      max_green_fee: 450,
      difficulty: 'challenging',
      access: 'public',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/courses?region=Monterey%2C+CA&max_green_fee=450&difficulty=challenging&access=public',
    )
  })

  it('loads the saved profile for discovery', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        home_region: 'Monterey, CA',
        max_green_fee: 450,
        difficulty: 'challenging',
        access: 'public',
      }),
    } as Response)

    const headers = {
      'Content-Type': 'application/json' as const,
      'X-Development-Subject': 'dev:local-user',
    }

    await expect(getProfile(headers)).resolves.toMatchObject({ max_green_fee: 450 })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/v1/me/profile', { headers })
  })

  it('loads an API course by its numeric id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 2, name: 'Spyglass Hill Golf Course' }),
    } as Response)

    await expect(getCourse(2)).resolves.toMatchObject({ id: 2, name: 'Spyglass Hill Golf Course' })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/v1/courses/2')
  })

  it('surfaces API authentication errors during onboarding', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'Invalid authentication token' }),
    } as Response)

    await expect(savePreferences({
      home_region: 'Monterey, CA',
      max_green_fee: 450,
      difficulty: 'challenging',
      access: 'public',
    }, {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test.jwt',
    })).rejects.toThrow('Invalid authentication token')
  })

  it('loads the current comparison-derived ranking', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, entries: [] }),
    } as Response)
    const headers = { 'Content-Type': 'application/json' as const, 'X-Development-Subject': 'dev:local-user' }

    await getRanking(headers)

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/v1/me/rankings', { headers })
  })

  it('sends tier placements and pairwise comparison outcomes', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, entries: [] }),
    } as Response)
    const headers = { 'Content-Type': 'application/json' as const, Authorization: 'Bearer test.jwt' }

    await saveTierPlacements([{ course_id: 1, tier: 'green' }], headers)
    await saveComparison({ course_a_id: 1, course_b_id: 2, result: 'too_close' }, headers)

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:8000/api/v1/me/rankings/tiers', {
      method: 'PUT', headers, body: JSON.stringify({ assignments: [{ course_id: 1, tier: 'green' }] }),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:8000/api/v1/me/rankings/comparisons', {
      method: 'POST', headers, body: JSON.stringify({ course_a_id: 1, course_b_id: 2, result: 'too_close' }),
    })
  })

  it('loads rating state and an encoded comparison candidate', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ course: { id: 7 }, personal_rating: null, companions: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 9, name: 'Candidate Course' }),
      } as Response)
    const headers = { 'Content-Type': 'application/json' as const, Authorization: 'Bearer test.jwt' }

    await expect(getCourseRating(7, headers)).resolves.toMatchObject({ course: { id: 7 } })
    await expect(getRatingCandidate(7, 'green & fairway' as RatingTier, headers))
      .resolves.toMatchObject({ id: 9 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8000/api/v1/me/course-ratings/7',
      { headers },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/api/v1/me/course-ratings/7/comparison-candidate?tier=green%20%26%20fairway',
      { headers },
    )
  })

  it('saves rating and detail payloads with authenticated JSON requests', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ course: { id: 7 }, tier: 'green', companions: [] }),
    } as Response)
    const headers = { 'Content-Type': 'application/json' as const, Authorization: 'Bearer test.jwt' }
    const rating = {
      tier: 'green' as const,
      played_on: '2026-07-13',
      score: 82,
      comparison_course_id: 9,
      comparison_result: 'course_a' as const,
    }
    const details = {
      note: 'Fast greens',
      favorite_hole: 7,
      friend_user_ids: [22],
      guest_names: ['Alex'],
      visibility: 'friends' as const,
    }

    await saveCourseRating(7, rating, headers)
    await saveRatingDetails(7, details, headers)

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:8000/api/v1/me/course-ratings/7', {
      method: 'PUT', headers, body: JSON.stringify(rating),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:8000/api/v1/me/course-ratings/7/details', {
      method: 'PATCH', headers, body: JSON.stringify(details),
    })
  })

  it('maps followed-user response envelopes to friend summaries', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{
        user: {
          id: 22,
          display_name: 'Morgan Golfer',
          username: 'morgan',
          home_region: 'Monterey, CA',
          follower_count: 4,
          following_count: 6,
        },
        is_mutual: true,
        followed_at: '2026-07-14T12:00:00Z',
      }],
    } as Response)
    const headers = { 'Content-Type': 'application/json' as const, Authorization: 'Bearer test.jwt' }

    await expect(getFriends(headers)).resolves.toEqual([{
      id: 22,
      display_name: 'Morgan Golfer',
      username: 'morgan',
    }])
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/v1/me/follows', { headers })
  })

  it('propagates API detail errors when rating details cannot be saved', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'All friend_user_ids must be followed users' }),
    } as Response)

    await expect(saveRatingDetails(7, {
      note: null,
      favorite_hole: null,
      friend_user_ids: [404],
      guest_names: [],
      visibility: 'private',
    }, {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test.jwt',
    })).rejects.toThrow('All friend_user_ids must be followed users')
  })
})

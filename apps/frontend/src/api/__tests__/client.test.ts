import { getCourse, getProfile, getRanking, saveComparison, savePreferences, saveTierPlacements, searchCourses } from '../client'

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

    await saveTierPlacements([{ course_id: 1, tier: 'loved_it' }], headers)
    await saveComparison({ course_a_id: 1, course_b_id: 2, result: 'too_close' }, headers)

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:8000/api/v1/me/rankings/tiers', {
      method: 'PUT', headers, body: JSON.stringify({ assignments: [{ course_id: 1, tier: 'loved_it' }] }),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:8000/api/v1/me/rankings/comparisons', {
      method: 'POST', headers, body: JSON.stringify({ course_a_id: 1, course_b_id: 2, result: 'too_close' }),
    })
  })
})

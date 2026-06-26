import { getProfile, searchCourses } from '../client'

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
})

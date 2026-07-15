import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { StrictMode } from 'react'

import RateCourseRoute from '../[id]'
import { loadRatingBootstrap } from '../../../src/rating/loadRatingBootstrap'
import { CourseRatingState } from '../../../src/types'

const mockGetCourseRating = jest.fn()
const mockGetFriends = jest.fn()
const mockGetToken = jest.fn().mockResolvedValue('test-token')
const mockBack = jest.fn()
let mockCourseId = '1'

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockCourseId }),
  useRouter: () => ({ back: mockBack }),
}))

jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}))

jest.mock('../../../src/api/client', () => ({
  getCourseRating: (...args: unknown[]) => mockGetCourseRating(...args),
  getFriends: (...args: unknown[]) => mockGetFriends(...args),
  getRatingCandidate: jest.fn(),
  saveCourseRating: jest.fn(),
  saveRatingDetails: jest.fn(),
}))

jest.mock('../../../src/components/RatingFlow', () => {
  const { Text, View } = require('react-native')
  return {
    RatingFlow: ({ course, friends }: { course: { name: string }, friends: unknown[] }) => (
      <View accessibilityLabel="Rating flow">
        <Text>{course.name}</Text>
        <Text>{friends.length} friends loaded</Text>
      </View>
    ),
  }
})

const friends = [{ id: 1, display_name: 'Test Friend', username: 'test-friend' }]

describe('rate course route loading', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCourseId = '1'
    mockGetToken.mockResolvedValue('test-token')
    mockGetCourseRating.mockResolvedValue(rating(1, 'First Course'))
    mockGetFriends.mockResolvedValue(friends)
  })

  it('loads once across the loading-to-content transition and renders RatingFlow', async () => {
    const pendingRating = deferred<CourseRatingState>()
    const pendingFriends = deferred<typeof friends>()
    mockGetCourseRating.mockReturnValue(pendingRating.promise)
    mockGetFriends.mockReturnValue(pendingFriends.promise)

    render(<RateCourseRoute />)

    expect(screen.getByLabelText('Loading rating')).toBeOnTheScreen()
    await act(async () => {
      pendingRating.resolve(rating(1, 'First Course'))
      pendingFriends.resolve(friends)
      await Promise.all([pendingRating.promise, pendingFriends.promise])
    })

    expect(await screen.findByLabelText('Rating flow')).toBeOnTheScreen()
    expect(screen.getByText('First Course')).toBeOnTheScreen()
    expect(screen.getByText('1 friends loaded')).toBeOnTheScreen()

    expect(mockGetToken).toHaveBeenCalledTimes(1)
    expect(mockGetCourseRating).toHaveBeenCalledTimes(1)
    expect(mockGetFriends).toHaveBeenCalledTimes(1)
  })

  it('deduplicates the paired bootstrap request during a StrictMode effect replay', async () => {
    const pendingRating = deferred<CourseRatingState>()
    const pendingFriends = deferred<typeof friends>()
    mockGetCourseRating.mockReturnValue(pendingRating.promise)
    mockGetFriends.mockReturnValue(pendingFriends.promise)

    render(<StrictMode><RateCourseRoute /></StrictMode>)

    await waitFor(() => expect(mockGetToken).toHaveBeenCalledTimes(2))
    expect(mockGetCourseRating).toHaveBeenCalledTimes(1)
    expect(mockGetFriends).toHaveBeenCalledTimes(1)

    await act(async () => {
      pendingRating.resolve(rating(1, 'Strict Course'))
      pendingFriends.resolve(friends)
      await Promise.all([pendingRating.promise, pendingFriends.promise])
    })
    expect(await screen.findByText('Strict Course')).toBeOnTheScreen()
  })

  it('does not cache a completed bootstrap across genuine remounts', async () => {
    const firstRoute = render(<RateCourseRoute />)
    expect(await screen.findByText('First Course')).toBeOnTheScreen()
    firstRoute.unmount()

    render(<RateCourseRoute />)
    expect(await screen.findByText('First Course')).toBeOnTheScreen()

    expect(mockGetCourseRating).toHaveBeenCalledTimes(2)
    expect(mockGetFriends).toHaveBeenCalledTimes(2)
  })

  it('does not share an in-flight bootstrap across auth identities', async () => {
    await Promise.all([
      loadRatingBootstrap(1, {
        'Content-Type': 'application/json',
        Authorization: 'Bearer first-user',
      }),
      loadRatingBootstrap(1, {
        'Content-Type': 'application/json',
        Authorization: 'Bearer second-user',
      }),
    ])

    expect(mockGetCourseRating).toHaveBeenCalledTimes(2)
    expect(mockGetFriends).toHaveBeenCalledTimes(2)
  })

  it('performs exactly one new paired load when Retry is pressed', async () => {
    mockGetCourseRating
      .mockRejectedValueOnce(new Error('Rating service unavailable'))
      .mockResolvedValueOnce(rating(1, 'Recovered Course'))

    render(<RateCourseRoute />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Rating service unavailable')
    fireEvent.press(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered Course')).toBeOnTheScreen()
    expect(mockGetToken).toHaveBeenCalledTimes(2)
    expect(mockGetCourseRating).toHaveBeenCalledTimes(2)
    expect(mockGetFriends).toHaveBeenCalledTimes(2)
  })

  it('ignores stale results when the course ID changes', async () => {
    const olderRating = deferred<CourseRatingState>()
    const olderFriends = deferred<typeof friends>()
    mockGetCourseRating
      .mockReturnValueOnce(olderRating.promise)
      .mockResolvedValueOnce(rating(2, 'Second Course'))
    mockGetFriends
      .mockReturnValueOnce(olderFriends.promise)
      .mockResolvedValueOnce([])

    const route = render(<RateCourseRoute />)
    await waitFor(() => expect(mockGetCourseRating).toHaveBeenCalledWith(1, expect.any(Object)))

    mockCourseId = '2'
    route.rerender(<RateCourseRoute />)

    expect(await screen.findByText('Second Course')).toBeOnTheScreen()
    expect(screen.getByText('0 friends loaded')).toBeOnTheScreen()

    await act(async () => {
      olderRating.resolve(rating(1, 'Stale First Course'))
      olderFriends.resolve(friends)
      await Promise.all([olderRating.promise, olderFriends.promise])
    })

    expect(screen.getByText('Second Course')).toBeOnTheScreen()
    expect(screen.queryByText('Stale First Course')).toBeNull()
    expect(mockGetCourseRating).toHaveBeenCalledTimes(2)
    expect(mockGetFriends).toHaveBeenCalledTimes(2)
  })

  it('does not render loaded data with callbacks for a newly selected course', async () => {
    render(<RateCourseRoute />)
    expect(await screen.findByText('First Course')).toBeOnTheScreen()

    const secondRating = deferred<CourseRatingState>()
    const secondFriends = deferred<typeof friends>()
    mockGetCourseRating.mockReturnValueOnce(secondRating.promise)
    mockGetFriends.mockReturnValueOnce(secondFriends.promise)
    mockCourseId = '2'
    screen.rerender(<RateCourseRoute />)

    expect(screen.getByLabelText('Loading rating')).toBeOnTheScreen()
    expect(screen.queryByText('First Course')).toBeNull()

    await act(async () => {
      secondRating.resolve(rating(2, 'Second Course'))
      secondFriends.resolve([])
      await Promise.all([secondRating.promise, secondFriends.promise])
    })
    expect(await screen.findByText('Second Course')).toBeOnTheScreen()
  })

  it('does not apply a pending result after unmount', async () => {
    const pendingRating = deferred<CourseRatingState>()
    const pendingFriends = deferred<typeof friends>()
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGetCourseRating.mockReturnValue(pendingRating.promise)
    mockGetFriends.mockReturnValue(pendingFriends.promise)

    const route = render(<RateCourseRoute />)
    await waitFor(() => expect(mockGetCourseRating).toHaveBeenCalledTimes(1))
    route.unmount()

    await act(async () => {
      pendingRating.resolve(rating(1, 'Unmounted Course'))
      pendingFriends.resolve(friends)
      await Promise.all([pendingRating.promise, pendingFriends.promise])
    })

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

function rating(id: number, name: string): CourseRatingState {
  return {
    course: {
      id,
      name,
      region: 'Test Region',
      green_fee: 100,
      difficulty: 'moderate',
      is_public: true,
      community_rating: 8.2,
      rating_count: 12,
    },
    personal_rating: null,
    tier: null,
    confidence: null,
    community_rating: 8.2,
    rating_count: 12,
    round: null,
    companions: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

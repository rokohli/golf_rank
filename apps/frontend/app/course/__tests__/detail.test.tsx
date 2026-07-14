import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import CourseDetail from '../[id]'
import { CourseRatingState } from '../../../src/types'

const mockGetCourse = jest.fn()
const mockGetCourseRating = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({
  'Content-Type': 'application/json',
  Authorization: 'Bearer test-token',
})
const mockPush = jest.fn()
const mockRouter = { back: jest.fn(), push: mockPush }
let mockCourseId = '7'
let mockFocusEffect: (() => void | (() => void)) | undefined
let mockFocusCleanup: (() => void) | undefined

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return {
    Feather: ({ name }: { name: string }) => <Text>{name}</Text>,
  }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusEffect = callback
      React.useEffect(() => {
        const cleanup = callback()
        mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined
        return cleanup
      }, [callback])
    },
    useLocalSearchParams: () => ({ id: mockCourseId }),
    useRouter: () => mockRouter,
  }
})

jest.mock('../../../src/api/client', () => ({
  getCourse: (...args: unknown[]) => mockGetCourse(...args),
  getCourseRating: (...args: unknown[]) => mockGetCourseRating(...args),
}))

jest.mock('../../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

const course = {
  id: 7,
  name: 'Test Links',
  region: 'Monterey, CA',
  green_fee: 175,
  difficulty: 'challenging',
  is_public: true,
  community_rating: 8.7,
  rating_count: 24,
}

function rating(personalRating: number | null): CourseRatingState {
  return {
    course,
    personal_rating: personalRating,
    tier: personalRating == null ? null : 'green',
    confidence: personalRating == null ? null : 0.8,
    community_rating: 8.7,
    rating_count: 24,
    round: null,
    companions: [],
  }
}

describe('course detail ratings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCourseId = '7'
    mockFocusEffect = undefined
    mockFocusCleanup = undefined
    mockGetCourse.mockResolvedValue(course)
    mockGetCourseRating.mockResolvedValue(rating(null))
  })

  it('shows distinct community and personal /10 values with only the supported actions', async () => {
    mockGetCourseRating.mockResolvedValue(rating(9.2))

    render(<CourseDetail />)

    expect(await screen.findByText('Test Links')).toBeOnTheScreen()
    expect(screen.getByLabelText('Community rating 8.7 out of 10')).toBeOnTheScreen()
    expect(screen.getByText('24 ratings')).toBeOnTheScreen()
    expect(await screen.findByLabelText('Your rating 9.2 out of 10')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Rated' })).toBeOnTheScreen()
    expect(screen.getByText('check-circle')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Share' })).toBeOnTheScreen()
    expect(screen.queryByText('Review')).toBeNull()
    expect(screen.queryByText('Played')).toBeNull()
    expect(screen.queryByText(/★/)).toBeNull()
  })

  it('navigates to rate, refreshes on focus, and keeps Rated functional for editing', async () => {
    mockGetCourseRating
      .mockResolvedValueOnce(rating(null))
      .mockResolvedValueOnce(rating(9.1))

    render(<CourseDetail />)

    const rateButton = await screen.findByRole('button', { name: 'Rate' })
    fireEvent.press(rateButton)
    expect(mockPush).toHaveBeenLastCalledWith('/rate/7')

    await act(async () => {
      mockFocusEffect?.()
    })

    expect(await screen.findByRole('button', { name: 'Rated' })).toBeOnTheScreen()
    expect(screen.getByLabelText('Your rating 9.1 out of 10')).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Rated' }))
    expect(mockPush).toHaveBeenLastCalledWith('/rate/7')
    expect(mockGetCourseRating).toHaveBeenCalledTimes(2)
    expect(mockGetAuthHeaders).toHaveBeenCalledTimes(2)
  })

  it('does not classify a failed initial rating load as unrated or enable rating navigation', async () => {
    mockGetCourseRating
      .mockRejectedValueOnce(new Error('Rating service unavailable'))
      .mockResolvedValueOnce(rating(null))

    render(<CourseDetail />)

    expect(await screen.findByText('Personal rating unavailable')).toBeOnTheScreen()
    expect(screen.getByRole('alert')).toHaveTextContent('Rating service unavailable')
    expect(screen.queryByText('Not rated yet')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rated' })).toBeNull()

    fireEvent.press(screen.getByText('Retry rating'))
    expect(await screen.findByText('Not rated yet')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Rate' })).toBeOnTheScreen()
  })

  it('ignores stale rating requests that resolve after a newer focus refresh', async () => {
    const older = deferred<CourseRatingState>()
    const newer = deferred<CourseRatingState>()
    mockGetCourseRating
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)

    render(<CourseDetail />)
    await waitFor(() => expect(mockGetCourseRating).toHaveBeenCalledTimes(1))

    await act(async () => {
      mockFocusCleanup?.()
      const cleanup = mockFocusEffect?.()
      mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined
    })
    expect(mockGetCourseRating).toHaveBeenCalledTimes(2)

    await act(async () => {
      newer.resolve(rating(9.4))
      await newer.promise
    })
    expect(await screen.findByLabelText('Your rating 9.4 out of 10')).toBeOnTheScreen()
    expect(screen.queryByLabelText('Loading your rating')).toBeNull()

    await act(async () => {
      older.resolve(rating(7.1))
      await older.promise
    })
    expect(screen.getByLabelText('Your rating 9.4 out of 10')).toBeOnTheScreen()
    expect(screen.queryByLabelText('Your rating 7.1 out of 10')).toBeNull()
    expect(screen.queryByLabelText('Loading your rating')).toBeNull()
  })

  it('maps seeded demo courses and hides Rate for demo-only courses', async () => {
    mockCourseId = 'pasatiempo'
    mockGetCourseRating.mockResolvedValue(rating(null))
    const { unmount } = render(<CourseDetail />)

    expect(await screen.findByRole('button', { name: 'Rate' })).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Rate' }))
    expect(mockPush).toHaveBeenLastCalledWith('/rate/3')
    unmount()

    mockCourseId = 'bandon'
    render(<CourseDetail />)
    expect(await screen.findByText('Bandon Dunes')).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: 'Rate' })).toBeNull()
    expect(screen.getByText('Personal rating is unavailable for this demo-only course.')).toBeOnTheScreen()
  })

  it('offers retry when the public course fails to load', async () => {
    mockGetCourse.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(course)

    render(<CourseDetail />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
    fireEvent.press(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mockGetCourse).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Test Links')).toBeOnTheScreen()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

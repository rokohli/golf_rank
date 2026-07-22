import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Linking, Share } from 'react-native'

import CourseDetail from '../[id]'
import { CourseRatingState } from '../../../src/types'

const mockGetCourse = jest.fn()
const mockGetCourseRating = jest.fn()
const mockGetSavedLists = jest.fn()
const mockCreateSavedList = jest.fn()
const mockSaveCourseToList = jest.fn()
const mockRemoveCourseFromList = jest.fn()
const mockUpdateRound = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({
  'Content-Type': 'application/json',
  Authorization: 'Bearer test-token',
})
const mockPush = jest.fn()
const mockRouter = { back: jest.fn(), push: mockPush }
const mockShare = jest.spyOn(Share, 'share')
const mockOpenUrl = jest.spyOn(Linking, 'openURL')
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
  createSavedList: (...args: unknown[]) => mockCreateSavedList(...args),
  getCourse: (...args: unknown[]) => mockGetCourse(...args),
  getCourseRating: (...args: unknown[]) => mockGetCourseRating(...args),
  getSavedLists: (...args: unknown[]) => mockGetSavedLists(...args),
  removeCourseFromList: (...args: unknown[]) => mockRemoveCourseFromList(...args),
  saveCourseToList: (...args: unknown[]) => mockSaveCourseToList(...args),
  updateRound: (...args: unknown[]) => mockUpdateRound(...args),
}))

jest.mock('../../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }),
}))

const course = {
  id: 7,
  name: 'Test Links',
  region: 'Monterey, CA',
  green_fee: 175,
  difficulty: 'challenging',
  is_public: true,
  hole_count: 18,
  par: 70,
  slope_rating: 141,
  tee_time_url: 'https://example.com/tee-times',
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
    mockGetSavedLists.mockResolvedValue([])
    mockRemoveCourseFromList.mockResolvedValue(undefined)
    mockUpdateRound.mockResolvedValue({})
    mockShare.mockResolvedValue({ action: 'sharedAction' } as never)
    mockOpenUrl.mockResolvedValue(undefined)
  })

  it('shows distinct community and personal /10 values with only the supported actions', async () => {
    mockGetCourseRating.mockResolvedValue(rating(9.2))

    render(<CourseDetail />)

    expect(await screen.findByText('Test Links')).toBeOnTheScreen()
    expect(screen.getByLabelText('Community rating 8.7 out of 10')).toBeOnTheScreen()
    expect(screen.getByText('24 ratings')).toBeOnTheScreen()
    expect(await screen.findByLabelText('Your rating 9.2 out of 10')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Rated' })).toBeOnTheScreen()
    expect(screen.getAllByText('Rated')).toHaveLength(1)
    expect(screen.getAllByText('check-circle').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Log round' })).toBeOnTheScreen()
    expect(screen.queryByText(/Your #/)).toBeNull()
    expect(screen.queryByText('Review')).toBeNull()
    expect(screen.queryByText('Played')).toBeNull()
    expect(screen.queryByText(/★/)).toBeNull()
  })

  it('renders at most two course facts and keeps share and tee times functional', async () => {
    render(<CourseDetail />)

    expect(await screen.findByText('Test Links')).toBeOnTheScreen()
    expect(screen.getByText('18')).toBeOnTheScreen()
    expect(screen.getByText('70')).toBeOnTheScreen()
    expect(screen.queryByText('GREEN FEE')).toBeNull()
    expect(screen.queryByText('SLOPE')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Share course' }))
    await waitFor(() => expect(mockShare).toHaveBeenCalledWith({ message: 'Test Links\nMonterey, CA' }))

    fireEvent.press(screen.getByRole('button', { name: 'View tee times' }))
    expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com/tee-times')
  })

  it('shows honest social empty states and real personal round details', async () => {
    const personal = rating(9.2)
    personal.round = {
      id: 42,
      played_on: '2026-07-18',
      score: 79,
      note: 'Fast greens.',
      favorite_hole: 16,
      visibility: 'friends',
    }
    mockGetCourseRating.mockResolvedValue(personal)

    render(<CourseDetail />)

    expect(await screen.findByText('No course photos yet.')).toBeOnTheScreen()
    expect(screen.queryByText('Public shared photos')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Your thoughts & details' }))
    expect(screen.getByRole('button', { name: 'Score, 79' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Notes, Added' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Favorite hole, Hole 16' })).toBeOnTheScreen()
    expect(screen.getByLabelText('Add photos, coming soon')).toBeOnTheScreen()
    expect(screen.queryByText('Fast greens.')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Score, 79' }))
    fireEvent.changeText(screen.getByLabelText('Edit score'), '74')
    fireEvent.press(screen.getByRole('button', { name: 'Save score' }))
    await waitFor(() => expect(mockUpdateRound).toHaveBeenCalledWith(42, { score: 74 }, expect.objectContaining({ Authorization: 'Bearer test-token' })))

    fireEvent.press(screen.getByRole('button', { name: 'Notes, Added' }))
    fireEvent.changeText(screen.getByLabelText('Edit notes'), 'Firm and fast.')
    fireEvent.press(screen.getByRole('button', { name: 'Save notes' }))
    await waitFor(() => expect(mockUpdateRound).toHaveBeenCalledWith(42, { note: 'Firm and fast.' }, expect.any(Object)))

    fireEvent.press(screen.getByRole('button', { name: 'Favorite hole, Hole 16' }))
    fireEvent.changeText(screen.getByLabelText('Edit favorite hole'), '7')
    fireEvent.press(screen.getByRole('button', { name: 'Save favorite hole' }))
    await waitFor(() => expect(mockUpdateRound).toHaveBeenCalledWith(42, { favorite_hole: 7 }, expect.any(Object)))
    expect(screen.queryByRole('button', { name: /Add photos/ })).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Friends’ thoughts & details' }))
    expect(screen.getByText('Friends’ thoughts aren’t available yet.')).toBeOnTheScreen()
  })

  it('renders attributed course images returned by the API', async () => {
    mockGetCourse.mockResolvedValue({
      ...course,
      images: [{
        id: 8,
        url: 'https://images.example/test-links.jpg',
        alt_text: 'Test Links eighteenth green',
        source_name: 'Course photographer',
        source_url: 'https://images.example/license',
        position: 0,
        is_hero: true,
      }],
    })

    render(<CourseDetail />)

    expect(await screen.findByLabelText('Test Links eighteenth green')).toBeOnTheScreen()
    expect(screen.getByText('Photos: Course photographer')).toBeOnTheScreen()
  })

  it('does not present an unattributed URL as a course photograph', async () => {
    mockGetCourse.mockResolvedValue({
      ...course,
      images: [{
        id: 8,
        url: 'https://images.example/unknown.jpg',
        alt_text: null,
        source_name: null,
        source_url: null,
        position: 0,
        is_hero: true,
      }],
    })

    render(<CourseDetail />)

    expect(await screen.findByText('No course photos yet.')).toBeOnTheScreen()
    expect(screen.getByLabelText('Course image unavailable')).toBeOnTheScreen()
    expect(screen.queryByLabelText('Test Links course photo')).toBeNull()
  })

  it('shows only known backend facts and does not invent course access', async () => {
    mockGetCourse.mockResolvedValue({
      ...course,
      difficulty: null,
      green_fee: null,
      hole_count: 18,
      is_public: null,
      access: null,
      par: null,
      slope_rating: null,
    })

    render(<CourseDetail />)

    expect(await screen.findByText('Access unavailable')).toBeOnTheScreen()
    expect(screen.getByText('18')).toBeOnTheScreen()
    expect(screen.queryByText('PAR')).toBeNull()
    expect(screen.queryByText('GREEN FEE')).toBeNull()
    expect(screen.queryByText('SLOPE')).toBeNull()
  })

  it('uses distinct icons for rating and logging a round', async () => {
    render(<CourseDetail />)

    expect(await screen.findByText('bar-chart-2')).toBeOnTheScreen()
    expect(screen.getAllByText('edit-3')).toHaveLength(2)
  })

  it('starts a separate round log from the course page', async () => {
    render(<CourseDetail />)

    fireEvent.press(await screen.findByRole('button', { name: 'Log round' }))

    expect(mockPush).toHaveBeenLastCalledWith('/round/new?courseId=7')
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
    expect(mockGetAuthHeaders).toHaveBeenCalledTimes(4)
  })

  it('creates a default list, persists the course, and can remove it again', async () => {
    const emptyList = { id: 12, name: 'Saved', visibility: 'private', is_default: true, courses: [], created_at: '2026-07-15T12:00:00Z' }
    const populatedList = {
      ...emptyList,
      courses: [{ id: 44, course, note: null, created_at: '2026-07-15T12:01:00Z' }],
    }
    mockCreateSavedList.mockResolvedValue(emptyList)
    mockSaveCourseToList.mockResolvedValue(populatedList)

    render(<CourseDetail />)
    await waitFor(() => expect(mockGetSavedLists).toHaveBeenCalledTimes(1))

    fireEvent.press(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeOnTheScreen()
    expect(mockCreateSavedList).toHaveBeenCalledWith(
      { name: 'Saved', visibility: 'private', is_default: true },
      expect.objectContaining({ Authorization: 'Bearer test-token' }),
    )
    expect(mockSaveCourseToList).toHaveBeenCalledWith(12, 7, expect.any(Object))

    fireEvent.press(screen.getByRole('button', { name: 'Saved' }))
    expect(await screen.findByRole('button', { name: 'Save' })).toBeOnTheScreen()
    expect(mockRemoveCourseFromList).toHaveBeenCalledWith(12, 7, expect.any(Object))
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

  it('rejects legacy demo slugs instead of presenting bundled course data', async () => {
    mockCourseId = 'pebble'

    render(<CourseDetail />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Course not found.')
    expect(mockGetCourse).not.toHaveBeenCalled()
    expect(mockGetCourseRating).not.toHaveBeenCalled()
    expect(screen.queryByText('Pebble Beach Golf Links')).toBeNull()
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

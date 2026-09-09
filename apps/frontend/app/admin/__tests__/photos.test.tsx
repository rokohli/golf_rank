import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

import AdminPhotos from '../photos'
import { AdminCoursePhoto } from '../../../src/types'

const mockGetAdminCoursePhotos = jest.fn()
const mockApprove = jest.fn()
const mockReject = jest.fn()
const mockSetFeatured = jest.fn()
const mockDelete = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })
const mockRouter = { back: jest.fn(), push: jest.fn() }
let mockAdminAccess = { isAdmin: true, loading: false }

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-image', () => {
  const { View } = require('react-native')
  return { Image: (props: object) => <View {...props} /> }
})

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
}))

jest.mock('../../../src/api/client', () => ({
  approveCoursePhoto: (...args: unknown[]) => mockApprove(...args),
  deleteCoursePhoto: (...args: unknown[]) => mockDelete(...args),
  getAdminCoursePhotos: (...args: unknown[]) => mockGetAdminCoursePhotos(...args),
  rejectCoursePhoto: (...args: unknown[]) => mockReject(...args),
  setCoursePhotoFeatured: (...args: unknown[]) => mockSetFeatured(...args),
}))

jest.mock('../../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

jest.mock('../../../src/auth/useAdminAccess', () => ({
  useAdminAccess: () => mockAdminAccess,
}))

function photo(overrides: Partial<AdminCoursePhoto> = {}): AdminCoursePhoto {
  return {
    image: {
      id: 1, url: 'https://cdn.example/a.jpg', alt_text: 'A hole', source_name: null, source_url: null,
      position: 0, is_hero: false, source_type: 'user', quality_score: null,
      created_at: '2026-09-01T12:00:00Z', uploaded_by_username: 'rohan',
    },
    course_id: 7,
    course_name: 'Pasatiempo',
    moderation_status: 'pending',
    scoring_attempts: 0,
    course_hero_locked: false,
    ...overrides,
  } as AdminCoursePhoto
}

describe('Photo moderation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAdminAccess = { isAdmin: true, loading: false }
    mockGetAdminCoursePhotos.mockResolvedValue({ items: [photo()], next_cursor: null })
  })

  it('renders the queue with the course and uploader', async () => {
    render(<AdminPhotos />)

    expect(await screen.findByText('Pasatiempo')).toBeOnTheScreen()
    expect(screen.getByText(/@rohan/)).toBeOnTheScreen()
  })

  it('shows the Gemini score and its reasons', async () => {
    mockGetAdminCoursePhotos.mockResolvedValue({
      items: [photo({
        image: { ...photo().image, quality_score: 9 },
        quality_score_reasons: ['wide fairway', 'no people in frame'],
      })],
      next_cursor: null,
    })

    render(<AdminPhotos />)

    expect(await screen.findByText('9/10')).toBeOnTheScreen()
    expect(screen.getByText('• wide fairway')).toBeOnTheScreen()
    expect(screen.getByText('• no people in frame')).toBeOnTheScreen()
  })

  it('distinguishes an unscored photo from one skipped for a locked hero', async () => {
    mockGetAdminCoursePhotos.mockResolvedValue({ items: [photo()], next_cursor: null })
    const { unmount } = render(<AdminPhotos />)
    expect(await screen.findByText('Not scored yet.')).toBeOnTheScreen()
    unmount()

    mockGetAdminCoursePhotos.mockResolvedValue({
      items: [photo({ course_hero_locked: true })], next_cursor: null,
    })
    render(<AdminPhotos />)

    expect(
      await screen.findByText('Not scored — this course already has a featured hero.'),
    ).toBeOnTheScreen()
  })

  it('reports a failed scoring attempt', async () => {
    mockGetAdminCoursePhotos.mockResolvedValue({
      items: [photo({ scored_at: '2026-09-02T00:00:00Z', scoring_attempts: 2 })],
      next_cursor: null,
    })

    render(<AdminPhotos />)

    expect(await screen.findByText('Scoring failed after 2 attempt(s).')).toBeOnTheScreen()
  })

  it('approves a photo and drops it from the pending list', async () => {
    mockApprove.mockResolvedValue(photo({ moderation_status: 'approved' }))
    render(<AdminPhotos />)
    fireEvent.press(await screen.findByText('Approve'))

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(1, { Authorization: 'Bearer test' }))
    // It no longer matches the active "pending" filter.
    await waitFor(() => expect(screen.queryByText('Pasatiempo')).not.toBeOnTheScreen())
  })

  it('confirms before deleting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    render(<AdminPhotos />)
    fireEvent.press(await screen.findByText('Delete'))

    expect(alert).toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it('confirms before rejecting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    render(<AdminPhotos />)
    fireEvent.press(await screen.findByText('Reject'))

    expect(alert).toHaveBeenCalled()
    expect(mockReject).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it('features a photo', async () => {
    mockSetFeatured.mockResolvedValue(photo({
      moderation_status: 'pending',
      image: { ...photo().image, is_hero: true },
    }))
    render(<AdminPhotos />)
    fireEvent.press(await screen.findByText('Feature'))

    await waitFor(() => expect(mockSetFeatured).toHaveBeenCalledWith(1, true, { Authorization: 'Bearer test' }))
  })

  it('surfaces an error without losing the list', async () => {
    mockApprove.mockRejectedValue(new Error('Nope.'))
    render(<AdminPhotos />)
    fireEvent.press(await screen.findByText('Approve'))

    expect(await screen.findByText('Nope.')).toBeOnTheScreen()
    expect(screen.getByText('Pasatiempo')).toBeOnTheScreen()
  })

  it('renders nothing useful for a non-admin', async () => {
    mockAdminAccess = { isAdmin: false, loading: false }

    render(<AdminPhotos />)

    expect(await screen.findByText("This area isn't available.")).toBeOnTheScreen()
    expect(mockGetAdminCoursePhotos).not.toHaveBeenCalled()
  })

  it('paginates when another page is available', async () => {
    mockGetAdminCoursePhotos
      .mockResolvedValueOnce({ items: [photo()], next_cursor: 1 })
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 2 }, course_name: 'Cypress Point' })],
        next_cursor: null,
      })

    render(<AdminPhotos />)
    await screen.findByText('Pasatiempo')
    fireEvent(screen.UNSAFE_getByType(require('react-native').FlatList), 'endReached')

    expect(await screen.findByText('Cypress Point')).toBeOnTheScreen()
  })

  it('prevents overlapping page loads when scrolled rapidly', async () => {
    let resolveSecondPage!: (val: unknown) => void
    const secondPagePromise = new Promise((resolve) => {
      resolveSecondPage = resolve
    })

    mockGetAdminCoursePhotos
      .mockResolvedValueOnce({ items: [photo()], next_cursor: 1 })
      .mockImplementationOnce(() => secondPagePromise)

    render(<AdminPhotos />)
    await screen.findByText('Pasatiempo')

    const flatList = screen.UNSAFE_getByType(require('react-native').FlatList)
    fireEvent(flatList, 'endReached')
    fireEvent(flatList, 'endReached')
    fireEvent(flatList, 'endReached')

    // Only one loadMore call should be initiated while in-flight
    await waitFor(() => expect(mockGetAdminCoursePhotos).toHaveBeenCalledTimes(2))

    resolveSecondPage({
      items: [photo({ image: { ...photo().image, id: 2 }, course_name: 'Cypress Point' })],
      next_cursor: null,
    })

    expect(await screen.findByText('Cypress Point')).toBeOnTheScreen()
  })

  it('discards stale in-flight results when switching status tabs', async () => {
    let resolveInitialPending!: (val: unknown) => void
    const pendingPromise = new Promise((resolve) => {
      resolveInitialPending = resolve
    })

    mockGetAdminCoursePhotos
      .mockImplementationOnce(() => pendingPromise)
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 99 }, course_name: 'Approved Course', moderation_status: 'approved' })],
        next_cursor: null,
      })

    render(<AdminPhotos />)

    fireEvent.press(screen.getByText('Approved'))

    expect(await screen.findByText('Approved Course')).toBeOnTheScreen()

    resolveInitialPending({
      items: [photo({ image: { ...photo().image, id: 1 }, course_name: 'Stale Pending Course', moderation_status: 'pending' })],
      next_cursor: null,
    })

    await waitFor(() => {
      expect(screen.queryByText('Stale Pending Course')).not.toBeOnTheScreen()
    })
  })

  it('deduplicates appended photos by id to prevent duplicates', async () => {
    mockGetAdminCoursePhotos
      .mockResolvedValueOnce({ items: [photo({ image: { ...photo().image, id: 1 } })], next_cursor: 1 })
      .mockResolvedValueOnce({
        items: [
          photo({ image: { ...photo().image, id: 1 } }),
          photo({ image: { ...photo().image, id: 2 }, course_name: 'New Course' }),
        ],
        next_cursor: null,
      })

    render(<AdminPhotos />)
    await screen.findByText('Pasatiempo')
    fireEvent(screen.UNSAFE_getByType(require('react-native').FlatList), 'endReached')

    expect(await screen.findByText('New Course')).toBeOnTheScreen()
    expect(screen.getAllByText('Pasatiempo')).toHaveLength(1)
  })

  it('preserves existing photos on append failure and retries on press', async () => {
    mockGetAdminCoursePhotos
      .mockResolvedValueOnce({ items: [photo()], next_cursor: 1 })
      .mockRejectedValueOnce(new Error('Network disconnected'))
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 2 }, course_name: 'Retried Course' })],
        next_cursor: null,
      })

    render(<AdminPhotos />)
    await screen.findByText('Pasatiempo')
    fireEvent(screen.UNSAFE_getByType(require('react-native').FlatList), 'endReached')

    expect(await screen.findByText('Network disconnected')).toBeOnTheScreen()
    expect(screen.getByText('Pasatiempo')).toBeOnTheScreen()

    fireEvent.press(screen.getByText('Retry'))

    expect(await screen.findByText('Retried Course')).toBeOnTheScreen()
    expect(screen.queryByText('Network disconnected')).not.toBeOnTheScreen()
  })

  it('displays correct audit copy for each moderation action', async () => {
    mockGetAdminCoursePhotos.mockResolvedValueOnce({
      items: [
        photo({
          image: { ...photo().image, id: 10 },
          course_name: 'Course Featured',
          moderated_by_username: 'alice',
          moderation_action: 'featured',
        }),
        photo({
          image: { ...photo().image, id: 11 },
          course_name: 'Course Unfeatured',
          moderated_by_username: 'bob',
          moderation_action: 'unfeatured',
        }),
        photo({
          image: { ...photo().image, id: 12 },
          course_name: 'Course Approved',
          moderated_by_username: 'carol',
          moderation_action: 'approved',
        }),
        photo({
          image: { ...photo().image, id: 13 },
          course_name: 'Course Rejected',
          moderated_by_username: 'dan',
          moderation_action: 'rejected',
          moderation_reason: 'Blurry background',
        }),
        photo({
          image: { ...photo().image, id: 14 },
          course_name: 'Course Auto',
          moderation_action: 'auto_approved',
        }),
      ],
      next_cursor: null,
    })

    render(<AdminPhotos />)

    expect(await screen.findByText('Featured by @alice')).toBeOnTheScreen()
    expect(screen.getByText('Unfeatured by @bob')).toBeOnTheScreen()
    expect(screen.getByText('Approved by @carol')).toBeOnTheScreen()
    expect(screen.getByText('Rejected by @dan · Blurry background')).toBeOnTheScreen()
    expect(screen.getByText('Approved automatically')).toBeOnTheScreen()
  })
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
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

  it('discards action results when tab changes while action is in flight', async () => {
    let resolveApprove!: (val: unknown) => void
    const approvePromise = new Promise((resolve) => {
      resolveApprove = resolve
    })
    mockApprove.mockImplementationOnce(() => approvePromise)

    mockGetAdminCoursePhotos
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 1 }, course_name: 'Pending Photo', moderation_status: 'pending' })],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 2 }, course_name: 'Approved Photo', moderation_status: 'approved' })],
        next_cursor: null,
      })

    render(<AdminPhotos />)
    expect(await screen.findByText('Pending Photo')).toBeOnTheScreen()

    fireEvent.press(screen.getByText('Approve'))

    fireEvent.press(screen.getByText('Approved'))
    expect(await screen.findByText('Approved Photo')).toBeOnTheScreen()

    resolveApprove(photo({ image: { ...photo().image, id: 1 }, course_name: 'Pending Photo', moderation_status: 'approved' }))

    await waitFor(() => {
      expect(screen.queryByText('Pending Photo')).not.toBeOnTheScreen()
    })
    expect(screen.getByText('Approved Photo')).toBeOnTheScreen()
  })

  it('maintains independent busy indicators for distinct photo cards when multiple actions are in flight', async () => {
    let resolveFirst!: (val: unknown) => void
    let resolveSecond!: (val: unknown) => void
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve
    })
    mockApprove.mockImplementationOnce(() => firstPromise)
    mockSetFeatured.mockImplementationOnce(() => secondPromise)

    mockGetAdminCoursePhotos.mockResolvedValueOnce({
      items: [
        photo({ image: { ...photo().image, id: 1 }, course_name: 'First Photo' }),
        photo({ image: { ...photo().image, id: 2 }, course_name: 'Second Photo' }),
      ],
      next_cursor: null,
    })

    render(<AdminPhotos />)
    expect(await screen.findByText('First Photo')).toBeOnTheScreen()
    expect(screen.getByText('Second Photo')).toBeOnTheScreen()

    // Trigger action on first card
    fireEvent.press(screen.getAllByText('Approve')[0])

    // Trigger action on second card (first card has unmounted its action buttons)
    fireEvent.press(screen.getByText('Feature'))

    // Both cards should show busy indicator
    await waitFor(() => {
      expect(screen.getAllByLabelText('Applying')).toHaveLength(2)
    })

    // Resolve first action
    await act(async () => {
      resolveFirst(photo({ image: { ...photo().image, id: 1 }, course_name: 'First Photo', moderation_status: 'approved' }))
      await Promise.resolve()
    })

    // First card should finish busy, but second card remains busy
    await waitFor(() => {
      expect(screen.getAllByLabelText('Applying')).toHaveLength(1)
    }, { timeout: 3000 })

    // Resolve second action
    await act(async () => {
      resolveSecond(photo({ image: { ...photo().image, id: 2, is_hero: true }, course_name: 'Second Photo', moderation_status: 'approved' }))
      await Promise.resolve()
    })

    // Both finished
    await waitFor(() => {
      expect(screen.queryByLabelText('Applying')).not.toBeOnTheScreen()
    }, { timeout: 3000 })
  })

  it('preserves in-flight card busy state when changing tabs until the action resolves', async () => {
    let resolveApprove!: (val: unknown) => void
    const approvePromise = new Promise((resolve) => {
      resolveApprove = resolve
    })
    mockApprove.mockImplementationOnce(() => approvePromise)

    let resolveApprovedTab!: (val: unknown) => void
    const approvedTabPromise = new Promise((resolve) => {
      resolveApprovedTab = resolve
    })

    mockGetAdminCoursePhotos
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 1 }, course_name: 'Photo In Flight' })],
        next_cursor: null,
      })
      .mockImplementationOnce(() => approvedTabPromise)

    render(<AdminPhotos />)
    expect(await screen.findByText('Photo In Flight')).toBeOnTheScreen()

    // Start in-flight approve action on card 1
    fireEvent.press(screen.getByText('Approve'))
    expect(screen.getByLabelText('Applying')).toBeOnTheScreen()

    // Switch tab to Approved while approve action is in-flight and tab fetch is pending
    fireEvent.press(screen.getByText('Approved'))

    // The previous photo queue is cleared immediately so stale cards cannot be manipulated
    expect(screen.queryByText('Photo In Flight')).not.toBeOnTheScreen()
    expect(screen.getByLabelText('Loading photos')).toBeOnTheScreen()

    // Resolve the in-flight action
    resolveApprove(photo({ image: { ...photo().image, id: 1 }, moderation_status: 'approved' }))

    // Finish tab load
    resolveApprovedTab({
      items: [photo({ image: { ...photo().image, id: 2 }, course_name: 'Approved Photo' })],
      next_cursor: null,
    })

    await waitFor(() => {
      expect(screen.queryByText('Photo In Flight')).not.toBeOnTheScreen()
      expect(screen.getByText('Approved Photo')).toBeOnTheScreen()
    })
  })

  it('updates sibling hero to unfeatured with audit text when featuring another photo', async () => {
    mockGetAdminCoursePhotos
      .mockResolvedValueOnce({ items: [], next_cursor: null })
      .mockResolvedValueOnce({
        items: [
          photo({
            image: { ...photo().image, id: 1, is_hero: true },
            course_id: 7,
            course_name: 'Pasatiempo',
            moderation_status: 'approved',
            moderation_action: 'featured',
            moderated_by_username: 'oldmod',
          }),
          photo({
            image: { ...photo().image, id: 2, is_hero: false },
            course_id: 7,
            course_name: 'Pasatiempo',
            moderation_status: 'approved',
            moderation_action: 'approved',
            moderated_by_username: 'oldmod',
          }),
        ],
        next_cursor: null,
      })
    mockSetFeatured.mockResolvedValueOnce(
      photo({
        image: { ...photo().image, id: 2, is_hero: true },
        course_id: 7,
        course_name: 'Pasatiempo',
        moderation_status: 'approved',
        moderation_action: 'featured',
        moderated_by_username: 'newmod',
        moderated_at: '2026-09-09T21:00:00Z',
      })
    )

    render(<AdminPhotos />)
    fireEvent.press(screen.getByText('Approved'))
    expect(await screen.findByText('Featured by @oldmod')).toBeOnTheScreen()

    // Find Feature button for photo 2
    fireEvent.press(screen.getByText('Feature'))

    // After resolving, photo 1 should now display 'Unfeatured by @newmod'
    expect(await screen.findByText('Unfeatured by @newmod')).toBeOnTheScreen()
    expect(screen.getByText('Featured by @newmod')).toBeOnTheScreen()
  })

  it('clears stale pagination loading state when changing tabs while append is in flight', async () => {
    let resolveAppend!: (val: unknown) => void
    const appendPromise = new Promise((resolve) => {
      resolveAppend = resolve
    })

    mockGetAdminCoursePhotos
      // Initial pending load with a next_cursor to allow loadMore
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 1 }, course_name: 'Pending Photo 1' })],
        next_cursor: 1,
      })
      // loadMore call that hangs in flight
      .mockImplementationOnce(() => appendPromise)
      // Approved tab load with no next_cursor
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 2 }, course_name: 'Approved Photo 1', moderation_status: 'approved' })],
        next_cursor: null,
      })

    render(<AdminPhotos />)
    expect(await screen.findByText('Pending Photo 1')).toBeOnTheScreen()

    // Trigger loadMore on Pending tab
    const flatList = screen.UNSAFE_getByType(require('react-native').FlatList)
    fireEvent(flatList, 'endReached')

    // Now append is in flight and footer loader is visible
    expect(await screen.findByLabelText('Loading more photos')).toBeOnTheScreen()

    // Switch tabs to Approved while append is in flight
    fireEvent.press(screen.getByText('Approved'))

    // Approved tab arrives
    expect(await screen.findByText('Approved Photo 1')).toBeOnTheScreen()

    // Footer loader should NOT be visible on the approved tab
    expect(screen.queryByLabelText('Loading more photos')).not.toBeOnTheScreen()

    // Now resolve the stale append from the previous tab
    resolveAppend({
      items: [photo({ image: { ...photo().image, id: 3 }, course_name: 'Stale Appended Photo' })],
      next_cursor: null,
    })

    // Footer loader must still not be present
    expect(screen.queryByLabelText('Loading more photos')).not.toBeOnTheScreen()
    expect(screen.queryByText('Stale Appended Photo')).not.toBeOnTheScreen()
  })

  it('clears previous tab photos immediately upon switching tabs', async () => {
    let resolveApproved!: (val: unknown) => void
    const approvedPromise = new Promise((resolve) => {
      resolveApproved = resolve
    })

    mockGetAdminCoursePhotos
      .mockResolvedValueOnce({
        items: [photo({ image: { ...photo().image, id: 1 }, course_name: 'Pending Course' })],
        next_cursor: null,
      })
      .mockImplementationOnce(() => approvedPromise)

    render(<AdminPhotos />)
    expect(await screen.findByText('Pending Course')).toBeOnTheScreen()

    fireEvent.press(screen.getByText('Approved'))

    // Existing photos from previous tab are immediately cleared
    expect(screen.queryByText('Pending Course')).not.toBeOnTheScreen()

    resolveApproved({
      items: [photo({ image: { ...photo().image, id: 2 }, course_name: 'Approved Course', moderation_status: 'approved' })],
      next_cursor: null,
    })

    expect(await screen.findByText('Approved Course')).toBeOnTheScreen()
  })

  it('reports a failed scoring attempt when scoring_exhausted is true even if scored_at is null', async () => {
    mockGetAdminCoursePhotos.mockResolvedValue({
      items: [photo({ scored_at: null, scoring_attempts: 3, scoring_exhausted: true })],
      next_cursor: null,
    })

    render(<AdminPhotos />)

    expect(await screen.findByText('Scoring failed after 3 attempt(s).')).toBeOnTheScreen()
  })

  it('reports scoring in progress when is_scoring is true', async () => {
    mockGetAdminCoursePhotos.mockResolvedValue({
      items: [photo({ scored_at: null, scoring_attempts: 1, is_scoring: true })],
      next_cursor: null,
    })

    render(<AdminPhotos />)

    expect(await screen.findByText('Scoring in progress...')).toBeOnTheScreen()
  })
})

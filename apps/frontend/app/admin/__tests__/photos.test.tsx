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
})

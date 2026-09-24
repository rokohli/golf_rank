import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import UserProfileScreen from '../[id]'

const mockGetUserProfile = jest.fn()
const mockGetUserRoundSummary = jest.fn()
const mockGetUserCourses = jest.fn()
const mockFollowUser = jest.fn()
const mockUnfollowUser = jest.fn()
const mockBlockUser = jest.fn()
const mockMuteUser = jest.fn()
const mockRouterPush = jest.fn()
const mockRouterReplace = jest.fn()
const mockRouterBack = jest.fn()

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

const mockRouter = {
  push: (...args: unknown[]) => mockRouterPush(...args),
  replace: (...args: unknown[]) => mockRouterReplace(...args),
  back: (...args: unknown[]) => mockRouterBack(...args),
}

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '42' }),
  useRouter: () => mockRouter,
}))

jest.mock('../../../src/api/client', () => ({
  blockUser: (...args: unknown[]) => mockBlockUser(...args),
  followUser: (...args: unknown[]) => mockFollowUser(...args),
  getUserCourses: (...args: unknown[]) => mockGetUserCourses(...args),
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
  getUserRoundSummary: (...args: unknown[]) => mockGetUserRoundSummary(...args),
  muteUser: (...args: unknown[]) => mockMuteUser(...args),
  unfollowUser: (...args: unknown[]) => mockUnfollowUser(...args),
}))

const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer token' })
jest.mock('../../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

describe('UserProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUserProfile.mockResolvedValue({
      id: 42,
      display_name: 'Alex Golfer',
      username: 'alexg',
      home_region: 'Monterey, CA',
      home_course_id: '101',
      home_course_name: 'Spyglass Hill',
      follower_count: 10,
      following_count: 8,
      is_self: false,
      is_following: false,
      is_followed_by: false,
      is_mutual: false,
      is_muted: false,
    })
    mockGetUserRoundSummary.mockResolvedValue({
      total_rounds: 15,
      distinct_courses: 7,
      average_score: 82.5,
      best_score: 76,
      latest_round: null,
    })
    mockGetUserCourses.mockResolvedValue([])
  })

  it('renders user home course and navigates to course page on click', async () => {
    render(<UserProfileScreen />)

    expect(await screen.findByText('Alex Golfer')).toBeOnTheScreen()
    await screen.findByText('15')
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
    expect(screen.getByText('@alexg')).toBeOnTheScreen()
    expect(screen.getByText('Monterey, CA')).toBeOnTheScreen()
    expect(screen.getByText('Spyglass Hill')).toBeOnTheScreen()

    const homeCourseButton = screen.getByRole('button', { name: 'Home course: Spyglass Hill' })
    expect(homeCourseButton).toBeOnTheScreen()

    fireEvent.press(homeCourseButton)
    expect(mockRouterPush).toHaveBeenCalledWith('/course/101')
  })

  it('renders profile identity without gating on slow round summary', async () => {
    mockGetUserRoundSummary.mockImplementationOnce(() => new Promise(() => {}))
    render(<UserProfileScreen />)

    expect(await screen.findByText('Alex Golfer')).toBeOnTheScreen()
    expect(screen.getByText('@alexg')).toBeOnTheScreen()
    expect(screen.getByText('Monterey, CA')).toBeOnTheScreen()
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
  })
})

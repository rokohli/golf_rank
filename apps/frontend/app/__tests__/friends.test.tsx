import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Friends from '../friends'

const mockGetFollows = jest.fn()
const mockSearchUsers = jest.fn()
const mockFollowUser = jest.fn()
const mockUnfollowUser = jest.fn()
const mockBlockUser = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' })

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
    usePathname: () => '/friends',
    useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  }
})

jest.mock('../../src/api/client', () => ({
  blockUser: (...args: unknown[]) => mockBlockUser(...args),
  followUser: (...args: unknown[]) => mockFollowUser(...args),
  getFollows: (...args: unknown[]) => mockGetFollows(...args),
  searchUsers: (...args: unknown[]) => mockSearchUsers(...args),
  unfollowUser: (...args: unknown[]) => mockUnfollowUser(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({ useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }) }))

const user = { id: 2, display_name: 'Maya Golfer', username: 'maya', home_region: 'San Diego, CA', follower_count: 4, following_count: 5 }

describe('Following', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetFollows.mockResolvedValue([{ user, is_mutual: true, followed_at: '2026-07-15T12:00:00Z' }])
    mockSearchUsers.mockResolvedValue([{ ...user, id: 3, display_name: 'Morgan Golfer', username: 'morgan' }])
    mockFollowUser.mockResolvedValue({ user: { ...user, id: 3, display_name: 'Morgan Golfer' }, is_mutual: false, followed_at: '2026-07-15T12:00:00Z' })
  })

  it('renders real following data and hides unsupported fake tabs', async () => {
    render(<Friends />)
    expect(await screen.findByText('Maya Golfer')).toBeOnTheScreen()
    expect(screen.getByText(/Friends · mutual follow/)).toBeOnTheScreen()
    expect(screen.queryByText('Followers')).toBeNull()
    expect(screen.queryByText('Requests')).toBeNull()
  })

  it('searches users and follows a result', async () => {
    render(<Friends />)
    await screen.findByText('Maya Golfer')
    fireEvent.press(screen.getByRole('button', { name: 'Find golfers' }))
    fireEvent.changeText(screen.getByLabelText('Search golfers'), 'Morgan')

    expect(await screen.findByText('Morgan Golfer')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Follow Morgan Golfer' }))
    await waitFor(() => expect(mockFollowUser).toHaveBeenCalledWith(3, expect.objectContaining({ Authorization: 'Bearer test-token' })))
  })
})

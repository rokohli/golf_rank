import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Home, { greetingForHour } from '../home'

const mockGetFeed = jest.fn()
const mockSetReaction = jest.fn()
const mockMuteUser = jest.fn()
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
    usePathname: () => '/home',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  }
})

jest.mock('../../src/api/client', () => ({
  getFeed: (...args: unknown[]) => mockGetFeed(...args),
  setActivityReaction: (...args: unknown[]) => mockSetReaction(...args),
  muteUser: (...args: unknown[]) => mockMuteUser(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({ useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }) }))

const activity = {
  id: 8,
  event_type: 'course_rated',
  subject_type: 'rating_round',
  subject_id: 3,
  actor: { id: 2, display_name: 'Maya Golfer', username: 'maya', home_region: 'San Diego, CA', follower_count: 2, following_count: 3 },
  course: { id: 1, name: 'Pebble Beach Golf Links', region: 'Monterey, CA', green_fee: null, difficulty: null, is_public: true },
  data: { rating: 9.4 },
  reaction_count: 0,
  viewer_reacted: false,
  is_own_activity: false,
  created_at: new Date().toISOString(),
}

describe('Home social feed', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetFeed.mockResolvedValue({ items: [activity], next_cursor: null })
    mockSetReaction.mockResolvedValue({ reaction_count: 1, viewer_reacted: true })
  })

  it('renders real activity and activates the reaction control', async () => {
    render(<Home />)
    expect(await screen.findByText('Maya Golfer rated')).toBeOnTheScreen()
    expect(screen.getByText('Pebble Beach Golf Links')).toBeOnTheScreen()
    expect(screen.getByText('9.4/10')).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Like activity' }))
    await waitFor(() => expect(mockSetReaction).toHaveBeenCalledWith(8, true, expect.objectContaining({ Authorization: 'Bearer test-token' })))
  })

  it('shows an honest empty state without demo activity', async () => {
    mockGetFeed.mockResolvedValue({ items: [], next_cursor: null })
    render(<Home />)
    expect(await screen.findByText('Your feed is quiet')).toBeOnTheScreen()
    expect(screen.queryByText('Torrey Pines (South)')).toBeNull()
  })

  it('shows an actionable API error', async () => {
    mockGetFeed.mockRejectedValue(new Error('Feed unavailable'))
    render(<Home />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Feed unavailable')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen()
  })
})

describe('home greeting', () => {
  it.each([
    [0, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [16, 'Good afternoon'],
    [17, 'Good evening'],
    [23, 'Good evening'],
  ])('uses the local hour %i for %s', (hour, expected) => {
    expect(greetingForHour(hour)).toBe(expected)
  })
})

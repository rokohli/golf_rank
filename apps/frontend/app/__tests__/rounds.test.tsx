import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Rounds from '../rounds'

const mockGetRounds = jest.fn()
const mockGetRoundSummary = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({
  'Content-Type': 'application/json',
  Authorization: 'Bearer test-token',
})
const mockRouter = { push: jest.fn(), replace: jest.fn() }

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
    usePathname: () => '/rounds',
    useRouter: () => mockRouter,
  }
})

jest.mock('../../src/api/client', () => ({
  getRounds: (...args: unknown[]) => mockGetRounds(...args),
  getRoundSummary: (...args: unknown[]) => mockGetRoundSummary(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

const round = {
  id: 42,
  course: { id: 7, name: 'Test Links', region: 'Monterey, CA' },
  played_on: '2026-07-17',
  score: 84,
  note: null,
  favorite_hole: 7,
  companions: [],
  visibility: 'friends',
  is_favorite: true,
  is_rating_round: false,
  created_at: '2026-07-17T12:00:00Z',
  updated_at: '2026-07-17T12:00:00Z',
}

describe('round history', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRounds.mockResolvedValue([round])
    mockGetRoundSummary.mockResolvedValue({
      total_rounds: 3, rounds_this_year: 2, average_score: 84.5,
      best_score: 80, distinct_courses: 2, latest_round: round,
    })
  })

  it('renders persisted rounds and opens a round and the log flow', async () => {
    render(<Rounds />)

    expect(await screen.findByText('Test Links')).toBeOnTheScreen()
    expect(screen.getByText('84.5')).toBeOnTheScreen()
    expect(screen.getByText('JULY 2026')).toBeOnTheScreen()
    expect(screen.getByText('JUL')).toBeOnTheScreen()
    expect(screen.getByText('17')).toBeOnTheScreen()
    expect(screen.queryByText('72°F')).toBeNull()
    expect(screen.queryByText('chevron-right')).toBeNull()
    expect(mockGetRounds).toHaveBeenCalledWith(expect.anything(), { limit: 20, year: 2026 })

    fireEvent.press(screen.getByRole('button', { name: 'Open Test Links round' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/round/42')
    fireEvent.press(screen.getByRole('button', { name: 'Add round' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/round/new')
  })

  it('requests favorites when the filter changes', async () => {
    render(<Rounds />)
    await screen.findByText('Test Links')

    fireEvent.press(screen.getByText('Favorites'))

    await waitFor(() => expect(mockGetRounds).toHaveBeenLastCalledWith(expect.anything(), { limit: 20, favorites_only: true }))
  })
})

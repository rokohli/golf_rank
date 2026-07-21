import { fireEvent, render, screen } from '@testing-library/react-native'

import RoundDetail from '../[id]'

const mockGetRound = jest.fn()
const mockDeleteRound = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' })
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() }

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
    useLocalSearchParams: () => ({ id: '42' }),
    useRouter: () => mockRouter,
  }
})

jest.mock('../../../src/api/client', () => ({
  deleteRound: (...args: unknown[]) => mockDeleteRound(...args),
  getRound: (...args: unknown[]) => mockGetRound(...args),
}))

jest.mock('../../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

const round = {
  id: 42,
  course: { id: 7, name: 'Pasatiempo Golf Club', region: 'Santa Cruz, California', green_fee: 325, difficulty: 'challenging', is_public: true },
  played_on: '2026-07-18',
  score: 79,
  note: 'Fast greens and a great finish on the back nine.',
  favorite_hole: 16,
  companions: [
    { friend_user_id: 1, display_name: 'Alex Morgan', guest_name: null },
    { friend_user_id: null, display_name: null, guest_name: 'Jordan Reed' },
  ],
  visibility: 'friends',
  is_favorite: true,
  is_rating_round: false,
  created_at: '2026-07-18T12:00:00Z',
  updated_at: '2026-07-18T12:00:00Z',
}

describe('round summary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRound.mockResolvedValue(round)
  })

  it('renders the editorial summary and keeps course and edit navigation functional', async () => {
    render(<RoundDetail />)

    expect(await screen.findByText('Pasatiempo Golf Club')).toBeOnTheScreen()
    expect(screen.getByLabelText('Round score 79')).toBeOnTheScreen()
    expect(screen.getByText('Alex Morgan + 1')).toBeOnTheScreen()
    expect(screen.getByText(round.note)).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Open Pasatiempo Golf Club' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/course/7')

    fireEvent.press(screen.getByRole('button', { name: 'Edit round' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/round/edit/42')
  })
})

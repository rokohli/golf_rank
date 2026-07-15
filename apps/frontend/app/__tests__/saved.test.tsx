import { render, screen } from '@testing-library/react-native'

import Saved from '../saved'

const mockGetSavedLists = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({
  'Content-Type': 'application/json',
  Authorization: 'Bearer test-token',
})
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
    usePathname: () => '/saved',
    useRouter: () => mockRouter,
  }
})

jest.mock('../../src/api/client', () => ({
  getSavedLists: (...args: unknown[]) => mockGetSavedLists(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

describe('saved courses', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders persisted courses rather than demo catalog content', async () => {
    mockGetSavedLists.mockResolvedValue([{
      id: 12,
      name: 'Saved',
      visibility: 'private',
      is_default: true,
      created_at: '2026-07-15T12:00:00Z',
      courses: [{
        id: 44,
        note: null,
        created_at: '2026-07-15T12:01:00Z',
        course: {
          id: 7,
          name: 'Test Links',
          region: 'Monterey, CA',
          green_fee: 175,
          difficulty: 'challenging',
          is_public: true,
          community_rating: 8.7,
          rating_count: 24,
        },
      }],
    }])

    render(<Saved />)

    expect(await screen.findByText('Test Links')).toBeOnTheScreen()
    expect(screen.getByText('Monterey, CA')).toBeOnTheScreen()
    expect(screen.queryByText('Pebble Beach Golf Links')).toBeNull()
    expect(mockGetSavedLists).toHaveBeenCalledWith(expect.objectContaining({ Authorization: 'Bearer test-token' }))
  })

  it('shows an honest empty state when no saved lists exist', async () => {
    mockGetSavedLists.mockResolvedValue([])

    render(<Saved />)

    expect(await screen.findByText('Courses you save will appear here.')).toBeOnTheScreen()
  })
})

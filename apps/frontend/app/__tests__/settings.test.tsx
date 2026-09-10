import { fireEvent, render, screen } from '@testing-library/react-native'

import Settings from '../settings'

const mockGetProfile = jest.fn()
const mockDeleteAccount = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() }
let mockAdminAccess = { isAdmin: false, loading: false }

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
    useRouter: () => mockRouter,
  }
})

jest.mock('../../src/api/client', () => ({
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

jest.mock('../../src/auth/AuthProvider', () => ({
  useAuthGate: () => ({ signOut: jest.fn().mockResolvedValue(undefined) }),
}))

jest.mock('../../src/auth/useAdminAccess', () => ({
  useAdminAccess: () => mockAdminAccess,
}))

describe('Settings moderation entry point', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAdminAccess = { isAdmin: false, loading: false }
    mockGetProfile.mockResolvedValue({
      home_region: 'Monterey, CA', max_green_fee: 300, difficulty: 'any', access: 'any',
    })
  })

  it('hides photo moderation from a non-admin', async () => {
    render(<Settings />)
    await screen.findByText('Settings')

    expect(screen.queryByText('Photo moderation')).not.toBeOnTheScreen()
  })

  it('shows photo moderation to an admin and routes to it', async () => {
    mockAdminAccess = { isAdmin: true, loading: false }
    render(<Settings />)

    fireEvent.press(await screen.findByText('Photo moderation'))

    expect(mockRouter.push).toHaveBeenCalledWith('/admin/photos')
  })
})

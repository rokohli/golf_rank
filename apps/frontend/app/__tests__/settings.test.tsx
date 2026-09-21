import { fireEvent, render, screen } from '@testing-library/react-native'
import { Linking } from 'react-native'

import Settings from '../settings'

const mockGetProfile = jest.fn()
const mockDeleteAccount = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() }
const mockOpenBrowserAsync = jest.fn().mockResolvedValue({ type: 'opened' })
const mockOpenUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never)
let mockAdminAccess = { isAdmin: false, loading: false }

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}))

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

describe('Settings legal section', () => {
  const originalWebUrl = process.env.EXPO_PUBLIC_WEB_URL

  beforeEach(() => {
    jest.clearAllMocks()
    mockAdminAccess = { isAdmin: false, loading: false }
    mockGetProfile.mockResolvedValue({
      home_region: 'Monterey, CA', max_green_fee: 300, difficulty: 'any', access: 'any',
    })
    delete process.env.EXPO_PUBLIC_WEB_URL
  })

  afterAll(() => {
    if (originalWebUrl === undefined) {
      delete process.env.EXPO_PUBLIC_WEB_URL
    } else {
      process.env.EXPO_PUBLIC_WEB_URL = originalWebUrl
    }
  })

  it('renders Terms of service and Privacy policy rows', async () => {
    render(<Settings />)
    await screen.findByText('Settings')

    expect(screen.getByText('LEGAL')).toBeOnTheScreen()
    expect(screen.getByText('Terms of service')).toBeOnTheScreen()
    expect(screen.getByText('Privacy policy')).toBeOnTheScreen()
  })

  it('opens Terms of service in in-app browser using default base URL', async () => {
    render(<Settings />)
    await screen.findByText('Settings')

    fireEvent.press(screen.getByText('Terms of service'))

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://fairway-web.onrender.com/terms.html')
  })

  it('opens Privacy policy in in-app browser using configured EXPO_PUBLIC_WEB_URL', async () => {
    process.env.EXPO_PUBLIC_WEB_URL = 'https://custom-web.example.com/'
    render(<Settings />)
    await screen.findByText('Settings')

    fireEvent.press(screen.getByText('Privacy policy'))

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://custom-web.example.com/privacy.html')
  })

  it('falls back to Linking.openURL if WebBrowser.openBrowserAsync throws', async () => {
    mockOpenBrowserAsync.mockRejectedValueOnce(new Error('Browser unavailable'))
    render(<Settings />)
    await screen.findByText('Settings')

    fireEvent.press(screen.getByText('Terms of service'))

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://fairway-web.onrender.com/terms.html')
    // Wait for promise tick since catch block is async
    await Promise.resolve()
    expect(mockOpenUrl).toHaveBeenCalledWith('https://fairway-web.onrender.com/terms.html')
  })
})

describe('Settings account section', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAdminAccess = { isAdmin: false, loading: false }
    mockGetProfile.mockResolvedValue({
      home_region: 'Monterey, CA', max_green_fee: 300, difficulty: 'any', access: 'any',
    })
  })

  it('does not render Email & security or Managed by Clerk', async () => {
    render(<Settings />)
    await screen.findByText('Settings')

    expect(screen.queryByText('Email & security')).not.toBeOnTheScreen()
    expect(screen.queryByText('Managed by Clerk')).not.toBeOnTheScreen()
  })

  it('routes to /support when Help & support is pressed', async () => {
    render(<Settings />)
    await screen.findByText('Settings')

    fireEvent.press(screen.getByText('Help & support'))

    expect(mockRouter.push).toHaveBeenCalledWith('/support')
  })
})

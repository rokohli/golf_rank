import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import NotificationSettings from '../notification-settings'

const mockGetProfile = jest.fn()
const mockGetLinkedContactStatus = jest.fn()
const mockSavePreferences = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })
const mockRegisterPushToken = jest.fn()
const mockUnregisterCurrentPushToken = jest.fn()
const mockRouterBack = jest.fn()

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-contacts', () => ({
  Fields: { Emails: 'emails', PhoneNumbers: 'phoneNumbers' },
  requestPermissionsAsync: jest.fn(),
  getContactsAsync: jest.fn(),
}))

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
    useRouter: () => ({ back: mockRouterBack }),
  }
})

jest.mock('../../src/api/client', () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  getLinkedContactStatus: (...args: unknown[]) => mockGetLinkedContactStatus(...args),
  savePreferences: (...args: unknown[]) => mockSavePreferences(...args),
  deleteLinkedContacts: jest.fn(),
  syncLinkedContacts: jest.fn(),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

jest.mock('../../src/auth/AuthProvider', () => ({
  useAuthGate: () => ({ registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args) }),
}))

jest.mock('../../src/notifications/pushTokens', () => ({
  unregisterCurrentPushToken: (...args: unknown[]) => mockUnregisterCurrentPushToken(...args),
}))

const profile = {
  home_region: 'Monterey, CA',
  max_green_fee: 700,
  difficulty: 'any' as const,
  access: 'any' as const,
  onboarding_data: { first_name: 'Alice', last_name: 'Golfer', username: 'alice', notifications: false },
}

describe('NotificationSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetProfile.mockResolvedValue(profile)
    mockGetLinkedContactStatus.mockResolvedValue({ linked: false, contact_count: 0 })
    mockSavePreferences.mockResolvedValue(undefined)
  })

  it('registers a push token when the user re-enables notifications', async () => {
    render(<NotificationSettings />)
    await screen.findByText('Stay in the loop')

    fireEvent(screen.getByLabelText('Allow notifications'), 'valueChange', true)
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mockSavePreferences).toHaveBeenCalledTimes(1))
    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
    expect(mockUnregisterCurrentPushToken).not.toHaveBeenCalled()
    expect(mockRouterBack).toHaveBeenCalledTimes(1)
  })

  it('unregisters the push token when the user disables notifications', async () => {
    mockGetProfile.mockResolvedValue({
      ...profile,
      onboarding_data: { ...profile.onboarding_data, notifications: true },
    })
    render(<NotificationSettings />)
    await screen.findByText('Stay in the loop')

    fireEvent(screen.getByLabelText('Allow notifications'), 'valueChange', false)
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mockSavePreferences).toHaveBeenCalledTimes(1))
    expect(mockUnregisterCurrentPushToken).toHaveBeenCalledTimes(1)
    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })
})

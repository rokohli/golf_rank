import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Index from '../index'
import { ApiResponseError } from '../../src/api/client'

const mockSignOut = jest.fn()
const mockRegisterPushToken = jest.fn()
const mockGetProfile = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({
  'Content-Type': 'application/json',
  Authorization: 'Bearer test-token',
})
const mockReplace = jest.fn()
const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
  replace: mockReplace,
}

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
}))

jest.mock('../../src/api/client', () => ({
  ...jest.requireActual('../../src/api/client'),
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  savePreferences: jest.fn(),
}))

jest.mock('../../src/auth/AuthProvider', () => ({
  useAuthGate: () => ({
    returnToGetStarted: jest.fn(() => false),
    signOut: (...args: unknown[]) => mockSignOut(...args),
    // A stable reference, not a new wrapper closure per call: Index's
    // checkSavedProfile depends on this in a useCallback array, and a
    // fresh function identity every render would re-trigger its effect
    // forever (mirrors the real AuthProvider's memoized registerPushToken).
    registerPushToken: mockRegisterPushToken,
    updateUserProfile: jest.fn(),
  }),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

jest.mock('../../src/components/OnboardingForm', () => {
  const { Pressable, Text } = require('react-native')
  return {
    OnboardingForm: ({ onExit }: { onExit?: () => void }) => (
      <>
        <Text>Onboarding form</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onExit}>
          <Text>Back</Text>
        </Pressable>
      </>
    ),
  }
})

describe('startup profile routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    })
  })

  it('skips onboarding when the authenticated account has a saved profile', async () => {
    mockGetProfile.mockResolvedValue({
      home_region: 'Santa Cruz, CA',
      max_green_fee: 225,
      difficulty: 'any',
      access: 'public',
    })

    render(<Index />)

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/home'))
    expect(screen.queryByText('Onboarding form')).toBeNull()
  })

  it('registers this device for push once a returning account with notifications enabled loads', async () => {
    mockGetProfile.mockResolvedValue({
      home_region: 'Santa Cruz, CA',
      max_green_fee: 225,
      difficulty: 'any',
      access: 'public',
      onboarding_data: { first_name: 'Rohan', last_name: 'K', username: 'rohan', notifications: true },
    })

    render(<Index />)

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/home'))
    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
  })

  it('does not register push for a returning account that saved notifications as disabled', async () => {
    mockGetProfile.mockResolvedValue({
      home_region: 'Santa Cruz, CA',
      max_green_fee: 225,
      difficulty: 'any',
      access: 'public',
      onboarding_data: { first_name: 'Rohan', last_name: 'K', username: 'rohan', notifications: false },
    })

    render(<Index />)

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/home'))
    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })

  it('does not register push for a legacy/never-chosen account (notifications: null) -- "not false" is not the same as an explicit "true"', async () => {
    mockGetProfile.mockResolvedValue({
      home_region: 'Santa Cruz, CA',
      max_green_fee: 225,
      difficulty: 'any',
      access: 'public',
      onboarding_data: { first_name: 'Rohan', last_name: 'K', username: 'rohan', notifications: null },
    })

    render(<Index />)

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/home'))
    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })

  it('never registers push before a brand-new account reaches onboarding -- device-wide OS permission is not this account\'s consent', async () => {
    mockGetProfile.mockRejectedValue(new ApiResponseError('Profile not found', 404))

    render(<Index />)

    expect(await screen.findByText('Onboarding form')).toBeOnTheScreen()
    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })

  it('shows onboarding only when the authenticated account has no profile', async () => {
    mockGetProfile.mockRejectedValue(new ApiResponseError('Profile not found', 404))

    render(<Index />)

    expect(await screen.findByText('Onboarding form')).toBeOnTheScreen()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('signs out from the first onboarding step when there is no navigation history', async () => {
    mockGetProfile.mockRejectedValue(new ApiResponseError('Profile not found', 404))

    render(<Index />)

    expect(await screen.findByText('Onboarding form')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))

    expect(mockSignOut).toHaveBeenCalled()
    expect(mockRouter.back).not.toHaveBeenCalled()
  })

  it('does not mistake a temporary profile error for a new account', async () => {
    mockGetProfile
      .mockRejectedValueOnce(new ApiResponseError('Service unavailable', 503))
      .mockResolvedValueOnce({
        home_region: 'Santa Cruz, CA',
        max_green_fee: 225,
        difficulty: 'any',
        access: 'public',
      })

    render(<Index />)

    expect(await screen.findByText('We couldn’t load your profile.')).toBeOnTheScreen()
    expect(screen.queryByText('Onboarding form')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/home'))
  })
})

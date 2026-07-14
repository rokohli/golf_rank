import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Index from '../index'
import { ApiResponseError } from '../../src/api/client'

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
    updateUserProfile: jest.fn(),
  }),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

jest.mock('../../src/components/OnboardingForm', () => {
  const { Text } = require('react-native')
  return { OnboardingForm: () => <Text>Onboarding form</Text> }
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

  it('shows onboarding only when the authenticated account has no profile', async () => {
    mockGetProfile.mockRejectedValue(new ApiResponseError('Profile not found', 404))

    render(<Index />)

    expect(await screen.findByText('Onboarding form')).toBeOnTheScreen()
    expect(mockReplace).not.toHaveBeenCalled()
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

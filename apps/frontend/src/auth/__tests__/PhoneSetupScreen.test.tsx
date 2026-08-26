import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { hasVerifiedPhone, PhoneSetupScreen } from '../PhoneSetupScreen'

const mockSignOut = jest.fn()
const mockCreatePhoneNumber = jest.fn()
const mockReload = jest.fn()
const mockPrepareVerification = jest.fn()
const mockAttemptVerification = jest.fn()

const phoneResource = {
  id: 'phone_1',
  phoneNumber: '+14155551212',
  prepareVerification: mockPrepareVerification,
  attemptVerification: mockAttemptVerification,
  verification: { status: 'unverified' },
}

const mockUser = {
  createPhoneNumber: mockCreatePhoneNumber,
  reload: mockReload,
  phoneNumbers: [phoneResource] as typeof phoneResource[],
}

jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
  useUser: () => ({ user: mockUser }),
}))

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return {
    Feather: ({ name }: { name: string }) => <Text>{name}</Text>,
  }
})

describe('hasVerifiedPhone', () => {
  it('returns true only when Clerk has a verified phone number', () => {
    expect(hasVerifiedPhone({ phoneNumbers: [] })).toBe(false)
    expect(hasVerifiedPhone({ phoneNumbers: [{ verification: { status: 'unverified' } }] })).toBe(false)
    expect(hasVerifiedPhone({ phoneNumbers: [{ verification: { status: 'verified' } }] })).toBe(true)
  })
})

describe('PhoneSetupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser.phoneNumbers = [phoneResource]
    mockCreatePhoneNumber.mockResolvedValue({ id: 'phone_1' })
    mockReload.mockResolvedValue(undefined)
    mockPrepareVerification.mockResolvedValue(undefined)
    mockAttemptVerification.mockResolvedValue({ verification: { status: 'verified' } })
  })

  it('collects a phone number on a dedicated screen then verifies the SMS code', async () => {
    mockUser.phoneNumbers = []
    mockReload.mockImplementation(async () => {
      mockUser.phoneNumbers = [phoneResource]
    })
    render(<PhoneSetupScreen />)

    expect(screen.getByText('Add your phone')).toBeOnTheScreen()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()

    fireEvent.changeText(screen.getByLabelText('Phone number'), '(415) 555-1212')
    fireEvent.press(screen.getByRole('button', { name: 'Send SMS Code' }))

    await waitFor(() => {
      expect(mockCreatePhoneNumber).toHaveBeenCalledWith({ phoneNumber: '+14155551212' })
      expect(mockPrepareVerification).toHaveBeenCalledWith({ strategy: 'phone_code' })
    })

    expect(screen.getByText('Verify your phone')).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('SMS verification code'), '654321')
    fireEvent.press(screen.getByRole('button', { name: 'Verify Phone' }))

    await waitFor(() => {
      expect(mockAttemptVerification).toHaveBeenCalledWith({ code: '654321' })
      expect(mockReload).toHaveBeenCalled()
    })
  })

  it('reuses an existing Clerk phone number when resending the SMS code', async () => {
    render(<PhoneSetupScreen />)

    fireEvent.changeText(screen.getByLabelText('Phone number'), '(415) 555-1212')
    fireEvent.press(screen.getByRole('button', { name: 'Send SMS Code' }))

    await waitFor(() => {
      expect(mockPrepareVerification).toHaveBeenCalledWith({ strategy: 'phone_code' })
    })
    expect(mockCreatePhoneNumber).not.toHaveBeenCalled()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Blocked from '../blocked'

const mockGetBlockedUsers = jest.fn()
const mockBlockUser = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return { Stack: { Screen: () => null }, useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]), useRouter: () => ({ back: jest.fn() }) }
})

jest.mock('../../src/api/client', () => ({
  getBlockedUsers: (...args: unknown[]) => mockGetBlockedUsers(...args),
  blockUser: (...args: unknown[]) => mockBlockUser(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

describe('Blocked accounts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBlockUser.mockResolvedValue(undefined)
  })

  it('shows an error without a misleading empty state and retries', async () => {
    mockGetBlockedUsers.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce([])
    render(<Blocked />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
    expect(screen.queryByText('No blocked accounts')).toBeNull()
    fireEvent.press(screen.getByRole('button', { name: 'Retry blocked accounts' }))
    await waitFor(() => expect(mockGetBlockedUsers).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No blocked accounts')).toBeOnTheScreen()
  })
})

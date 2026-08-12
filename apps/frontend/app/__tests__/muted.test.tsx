import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Muted from '../muted'

const mockGetMutedUsers = jest.fn()
const mockMuteUser = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })
const mockRouter = { back: jest.fn() }

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return { Stack: { Screen: () => null }, useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]), useRouter: () => mockRouter }
})

jest.mock('../../src/api/client', () => ({
  getMutedUsers: (...args: unknown[]) => mockGetMutedUsers(...args),
  muteUser: (...args: unknown[]) => mockMuteUser(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

describe('Muted accounts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetMutedUsers.mockResolvedValue([])
    mockMuteUser.mockResolvedValue(undefined)
  })

  it('renders loading then an empty state', async () => {
    let resolve: (items: []) => void = () => undefined
    mockGetMutedUsers.mockImplementation(() => new Promise<[]>(done => { resolve = done }))
    render(<Muted />)
    expect(screen.getByLabelText('Loading muted accounts')).toBeOnTheScreen()
    await waitFor(() => expect(mockGetMutedUsers).toHaveBeenCalled())
    await act(async () => resolve([]))
    expect(await screen.findByText('No muted accounts')).toBeOnTheScreen()
  })

  it('renders an error and retries loading', async () => {
    mockGetMutedUsers.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce([])
    render(<Muted />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
    fireEvent.press(screen.getByRole('button', { name: 'Retry muted accounts' }))
    await waitFor(() => expect(mockGetMutedUsers).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No muted accounts')).toBeOnTheScreen()
  })

  it('removes an account after unmuting', async () => {
    const muted = { id: 7, display_name: 'Morgan Golfer', username: 'morgan' }
    mockGetMutedUsers.mockResolvedValue([muted])
    render(<Muted />)
    expect(await screen.findByText('Morgan Golfer')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Unmute Morgan Golfer' }))
    await waitFor(() => expect(mockMuteUser).toHaveBeenCalledWith(7, false, { Authorization: 'Bearer test' }))
    expect(screen.queryByText('Morgan Golfer')).toBeNull()

  })

  it('restores an account when unmuting fails', async () => {
    const muted = { id: 7, display_name: 'Morgan Golfer', username: 'morgan' }
    mockGetMutedUsers.mockResolvedValue([muted])
    mockMuteUser.mockRejectedValueOnce(new Error('Unable to unmute'))
    render(<Muted />)
    expect(await screen.findByText('Morgan Golfer')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Unmute Morgan Golfer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to unmute')
    expect(screen.getByText('Morgan Golfer')).toBeOnTheScreen()
  })
})

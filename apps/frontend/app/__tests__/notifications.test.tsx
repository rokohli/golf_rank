import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Notifications from '../notifications'

const mockGetNotifications = jest.fn()
const mockFollowUser = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })
const mockRouter = { back: jest.fn(), push: jest.fn() }

jest.mock('@expo/vector-icons', () => { const { Text } = require('react-native'); return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> } })
jest.mock('expo-router', () => { const React = require('react'); return { Stack: { Screen: () => null }, useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]), useRouter: () => mockRouter } })
jest.mock('../../src/api/client', () => ({ getNotifications: (...args: unknown[]) => mockGetNotifications(...args), followUser: (...args: unknown[]) => mockFollowUser(...args) }))
jest.mock('../../src/auth/useAuthToken', () => ({ useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }) }))

describe('Notifications', () => {
  beforeEach(() => { jest.clearAllMocks(); mockGetNotifications.mockResolvedValue([{ id: 9, notification_type: 'contact_joined', actor: { id: 2, display_name: 'Maya Golfer', username: 'maya', home_region: null, follower_count: 0, following_count: 0 }, created_at: new Date().toISOString() }]); mockFollowUser.mockResolvedValue(undefined) })
  it('shows contact-join notifications with a functional follow action', async () => { render(<Notifications />); expect(await screen.findByText('Maya Golfer')).toBeOnTheScreen(); fireEvent.press(screen.getByRole('button', { name: 'Follow Maya Golfer' })); await waitFor(() => expect(mockFollowUser).toHaveBeenCalledWith(2, expect.anything())); fireEvent.press(screen.getByRole('button', { name: 'Notification settings' })); expect(mockRouter.push).toHaveBeenCalledWith('/notification-settings') })
})

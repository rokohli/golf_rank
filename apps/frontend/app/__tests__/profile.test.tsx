import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

import EditProfile from '../profile/edit'
import GolfPreferences from '../profile/preferences'
import Profile from '../profile'
import Notifications from '../notifications'
import Privacy from '../privacy'
import Settings from '../settings'

const mockGetProfile = jest.fn()
const mockGetRoundSummary = jest.fn()
const mockSavePreferences = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })
const mockUpdateUserProfile = jest.fn()
const mockUpdateProfileImage = jest.fn()
const mockSignOut = jest.fn()
const mockLaunchImageLibraryAsync = jest.fn()
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() }

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}))

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
    usePathname: () => '/profile',
    useRouter: () => mockRouter,
  }
})

jest.mock('../../src/api/client', () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  getRoundSummary: (...args: unknown[]) => mockGetRoundSummary(...args),
  savePreferences: (...args: unknown[]) => mockSavePreferences(...args),
}))

jest.mock('../../src/auth/AuthProvider', () => ({
  useAuthGate: () => ({
    profileImageUrl: null,
    signOut: mockSignOut,
    updateProfileImage: mockUpdateProfileImage,
    updateUserProfile: mockUpdateUserProfile,
  }),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }),
}))

const profile = {
  access: 'public',
  difficulty: 'challenging',
  home_region: 'Monterey, CA',
  max_green_fee: 350,
  onboarding_data: {
    first_name: 'Rohan', last_name: 'Kohli', username: 'rohank', profile_photo_added: false,
    home_course_id: 'pebble', home_course_search: 'Pebble Beach Golf Links', played_course_ids: [], favorite_wins: [], dream_course_ids: [], friend_search: '', preferences: ['Scenic views'], group_size: 'Foursome', budget: '$$$', travel_distance: '45 minutes', preferred_tee_time: 'Weekend mornings', transportation: 'Cart', notifications: true,
  },
}

const latestRound = {
  id: 42,
  course: { id: 7, name: 'Pebble Beach Golf Links', region: 'Monterey, CA' },
  played_on: '2026-07-17', score: 84, note: null, favorite_hole: 7, companions: [], visibility: 'friends', is_favorite: true, is_rating_round: false, created_at: '', updated_at: '',
}

describe('profile experience', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetProfile.mockResolvedValue(profile)
    mockGetRoundSummary.mockResolvedValue({ total_rounds: 24, distinct_courses: 18, average_score: 84.1, best_score: 78, latest_round: latestRound })
    mockSavePreferences.mockResolvedValue(undefined)
    mockUpdateUserProfile.mockResolvedValue(undefined)
    mockUpdateProfileImage.mockResolvedValue(undefined)
    mockSignOut.mockResolvedValue(undefined)
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] })
  })

  it('renders the compact profile and opens its primary destinations', async () => {
    render(<Profile />)

    expect(await screen.findByText('Rohan Kohli')).toBeOnTheScreen()
    expect(screen.getByText('@rohank')).toBeOnTheScreen()
    expect(screen.getByText('84.1')).toBeOnTheScreen()
    expect(screen.getByText('Pebble Beach Golf Links')).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Profile settings' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/settings')
    fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/edit')
    fireEvent.press(screen.getByRole('button', { name: 'Open Pebble Beach Golf Links round' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/round/42')
    fireEvent.press(screen.getByRole('button', { name: 'Trips' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/planner')
  })

  it('updates Clerk identity and the saved profile from Edit profile', async () => {
    render(<EditProfile />)

    await screen.findByDisplayValue('Rohan')
    fireEvent.changeText(screen.getByLabelText('First name'), 'Rowan')
    fireEvent.changeText(screen.getByLabelText('Home region'), 'Carmel, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockUpdateUserProfile).toHaveBeenCalledWith({ firstName: 'Rowan', lastName: 'Kohli', username: 'rohank' })
      expect(mockSavePreferences).toHaveBeenCalledWith(expect.objectContaining({
        home_region: 'Carmel, CA',
        onboarding_data: expect.objectContaining({ first_name: 'Rowan' }),
      }), expect.anything())
      expect(mockRouter.back).toHaveBeenCalled()
    })
  })

  it('routes settings actions and confirms sign out', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Sign out')?.onPress?.()
    })
    render(<Settings />)

    await screen.findByText('Golf preferences')
    fireEvent.press(screen.getByText('Golf preferences'))
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/preferences')
    fireEvent.press(screen.getByText('Notifications'))
    expect(mockRouter.push).toHaveBeenCalledWith('/notifications')
    fireEvent.press(screen.getByText('Privacy & visibility'))
    expect(mockRouter.push).toHaveBeenCalledWith('/privacy')
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })
    alert.mockRestore()
  })

  it('edits golf preference tiles and preserves the rest of the profile', async () => {
    render(<GolfPreferences />)

    await screen.findByText('$350')
    fireEvent(screen.getByLabelText('Maximum green fee'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
    fireEvent.press(screen.getByRole('button', { name: 'Usual group, Foursome' }))
    fireEvent.press(screen.getByText('Solo'))
    fireEvent.press(screen.getByRole('button', { name: 'Done' }))
    fireEvent.press(screen.getByRole('button', { name: 'Course access Private' }))
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockSavePreferences).toHaveBeenCalledWith(expect.objectContaining({
        access: 'private',
        home_region: 'Monterey, CA',
        max_green_fee: 375,
        onboarding_data: expect.objectContaining({ first_name: 'Rohan', group_size: 'Solo' }),
      }), expect.anything())
      expect(mockRouter.back).toHaveBeenCalled()
    })
  })

  it('persists the master notification preference', async () => {
    render(<Notifications />)

    await screen.findByText('Stay in the loop')
    fireEvent(screen.getByLabelText('Allow notifications'), 'valueChange', false)
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockSavePreferences).toHaveBeenCalledWith(expect.objectContaining({
        home_region: 'Monterey, CA',
        onboarding_data: expect.objectContaining({ first_name: 'Rohan', notifications: false }),
      }), expect.anything())
      expect(mockRouter.back).toHaveBeenCalled()
    })
  })

  it('persists profile and default round visibility', async () => {
    render(<Privacy />)

    await screen.findByText('PROFILE VISIBILITY')
    fireEvent.press(screen.getByRole('radio', { name: 'Private: Your profile is hidden from golfer search.' }))
    fireEvent.press(screen.getByRole('radio', { name: 'Public: Followers can see new rounds.' }))
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockSavePreferences).toHaveBeenCalledWith(expect.objectContaining({
        onboarding_data: expect.objectContaining({
          default_round_visibility: 'public',
          profile_visibility: 'private',
        }),
      }), expect.anything())
      expect(mockRouter.back).toHaveBeenCalled()
    })
  })
})

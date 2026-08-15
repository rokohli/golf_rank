import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import NewRound from '../new'

const mockGetFollows = jest.fn()
const mockGetProfile = jest.fn()
const mockSearchCourses = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })

jest.mock('expo-router', () => {
  const React = require('react')
  return { Stack: { Screen: () => null }, useLocalSearchParams: () => ({}), useRouter: () => ({ back: jest.fn(), replace: jest.fn() }) }
})

jest.mock('../../../src/api/client', () => ({
  createRound: jest.fn(), getCourse: jest.fn(), getFollows: (...args: unknown[]) => mockGetFollows(...args), getProfile: (...args: unknown[]) => mockGetProfile(...args), searchCourses: (...args: unknown[]) => mockSearchCourses(...args),
}))

jest.mock('../../../src/auth/useAuthToken', () => ({ useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }) }))

jest.mock('../../../src/components/RoundForm', () => {
  const { Pressable, Text } = require('react-native')
  return { RoundForm: ({ searchCourses }: { searchCourses: (query: string) => Promise<unknown> }) => <Pressable accessibilityRole="button" onPress={() => void searchCourses('Crystal Springs Golf Course')}><Text>Search Crystal Springs</Text></Pressable> }
})

describe('new round', () => {
  beforeEach(() => {
    mockGetFollows.mockResolvedValue([])
    mockGetProfile.mockResolvedValue({ home_region: 'Monterey, CA', onboarding_data: { default_round_visibility: 'friends' } })
    mockSearchCourses.mockResolvedValue([])
  })

  it('searches the full course catalog instead of restricting results to the home region', async () => {
    render(<NewRound />)
    await screen.findByText('Search Crystal Springs')
    fireEvent.press(screen.getByText('Search Crystal Springs'))
    await waitFor(() => expect(mockSearchCourses).toHaveBeenCalledWith({ q: 'Crystal Springs Golf Course', limit: 20 }))
  })
})

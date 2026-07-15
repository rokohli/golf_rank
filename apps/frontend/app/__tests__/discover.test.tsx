import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Discover from '../discover'

const mockSearchCourses = jest.fn()
const mockResolveCurrentRegion = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' })

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  usePathname: () => '/discover',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('../../src/api/client', () => ({
  getCourseRegions: jest.fn().mockResolvedValue([]),
  searchCourses: (...args: unknown[]) => mockSearchCourses(...args),
  submitCourseCandidate: jest.fn(),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

jest.mock('../../src/location/currentRegion', () => ({
  CALIFORNIA_FALLBACK_REGION: 'All California',
  resolveCurrentLocation: () => mockResolveCurrentRegion(),
}))

jest.mock('../../src/location/regionPreference', () => ({
  loadSavedRegion: jest.fn().mockResolvedValue(null),
  saveRegion: jest.fn().mockResolvedValue(undefined),
}))

const courses = [
  { id: 1, name: 'Pebble Beach Golf Links', region: 'Monterey, CA', green_fee: 650, difficulty: 'challenging', is_public: true, community_rating: 9.7, rating_count: 10 },
  { id: 2, name: 'Torrey Pines South', region: 'San Diego, CA', green_fee: 250, difficulty: 'challenging', is_public: true, community_rating: 9.1, rating_count: 8 },
]

describe('Discover location search', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test-token' })
    mockSearchCourses.mockImplementation(async (filters: { region?: string; lat?: number }) => {
      if (filters.region === 'Monterey, CA') return [courses[0]]
      if (filters.lat !== undefined) return [courses[1]]
      return courses
    })
    mockResolveCurrentRegion.mockResolvedValue({ label: 'San Diego, CA', latitude: 32.7, longitude: -117.1 })
  })

  it('requests current location only after search is activated and uses it as the editable region', async () => {
    render(<Discover />)

    await waitFor(() => expect(mockSearchCourses).toHaveBeenCalledWith(expect.objectContaining({ country: 'US', admin1: 'CA' })))

    expect(screen.queryByLabelText('Region')).toBeNull()
    expect(mockResolveCurrentRegion).not.toHaveBeenCalled()

    fireEvent(screen.getByLabelText('Search courses'), 'focus')

    expect(await screen.findByDisplayValue('San Diego, CA')).toBeOnTheScreen()
    expect(mockResolveCurrentRegion).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockSearchCourses).toHaveBeenCalledWith(expect.objectContaining({ lat: 32.7, lng: -117.1 })))
    expect(await screen.findByText('Torrey Pines South')).toBeOnTheScreen()
    await waitFor(() => expect(screen.queryByText('Pebble Beach Golf Links')).toBeNull())

    fireEvent.changeText(screen.getByLabelText('Region'), 'Monterey, CA')

    expect(await screen.findByText('Pebble Beach Golf Links')).toBeOnTheScreen()
    await waitFor(() => expect(screen.queryByText('Torrey Pines South')).toBeNull())
  })

  it('falls back to all California when location permission or lookup is unavailable', async () => {
    mockResolveCurrentRegion.mockResolvedValue(null)
    render(<Discover />)

    fireEvent(screen.getByLabelText('Search courses'), 'focus')

    expect(await screen.findByDisplayValue('All California')).toBeOnTheScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('Location is unavailable. Showing all California courses.')
    expect(await screen.findByText('Pebble Beach Golf Links')).toBeOnTheScreen()
    expect(await screen.findByText('Torrey Pines South')).toBeOnTheScreen()
  })

  it('lets the user retry current-location detection', async () => {
    mockResolveCurrentRegion.mockResolvedValueOnce(null).mockResolvedValueOnce({ label: 'Monterey, CA', latitude: 36.6, longitude: -121.9 })
    render(<Discover />)
    fireEvent(screen.getByLabelText('Search courses'), 'focus')
    expect(await screen.findByDisplayValue('All California')).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Use current location' }))

    await waitFor(() => expect(mockResolveCurrentRegion).toHaveBeenCalledTimes(2))
    expect(await screen.findByDisplayValue('Monterey, CA')).toBeOnTheScreen()
  })
})

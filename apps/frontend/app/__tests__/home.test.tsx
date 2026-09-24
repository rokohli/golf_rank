import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Home, { greetingForHour } from '../home'

const mockGetFeed = jest.fn()
const mockGetFeaturedCourse = jest.fn()
const mockSaveFeaturedCourse = jest.fn()
const mockDismissFeaturedCourse = jest.fn()
const mockSetReaction = jest.fn()
const mockMuteUser = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' })
const mockRouter = { push: jest.fn(), replace: jest.fn() }

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
    usePathname: () => '/home',
    useRouter: () => mockRouter,
  }
})

jest.mock('../../src/api/client', () => ({
  getFeed: (...args: unknown[]) => mockGetFeed(...args),
  getFeaturedCourse: (...args: unknown[]) => mockGetFeaturedCourse(...args),
  saveFeaturedCourse: (...args: unknown[]) => mockSaveFeaturedCourse(...args),
  dismissFeaturedCourse: (...args: unknown[]) => mockDismissFeaturedCourse(...args),
  setActivityReaction: (...args: unknown[]) => mockSetReaction(...args),
  muteUser: (...args: unknown[]) => mockMuteUser(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({ useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }) }))
jest.mock('../../src/auth/AuthProvider', () => ({ useAuthGate: () => ({ profileImageUrl: null, profileInitials: 'RK' }) }))
const mockResolveCoordinates = jest.fn().mockResolvedValue({ latitude: 36.5685, longitude: -121.949 })
jest.mock('../../src/location/currentRegion', () => ({
  resolveCoordinates: () => mockResolveCoordinates(),
}))

const mockFeatured = {
  id: 101,
  recommendation_date: '2026-09-23',
  sequence: 1,
  headline: "Today's Course Spotlight",
  rationale: 'Pasatiempo is a classic Alister MacKenzie layout great for walking.',
  match_tags: ['~15 mi away', '$410 Fee', 'Challenging', 'Walking'],
  is_regional_fallback: false,
  course: {
    id: 3,
    name: 'Pasatiempo Golf Club',
    region: 'Santa Cruz, CA',
    green_fee: 410,
    difficulty: 'challenging',
    is_public: true,
  },
  distance_miles: 15.2,
  is_saved: false,
  can_dismiss: true,
}

const activity = {
  id: 8,
  event_type: 'course_rated',
  subject_type: 'rating_round',
  subject_id: 3,
  actor: { id: 2, display_name: 'Maya Golfer', username: 'maya', home_region: 'San Diego, CA', follower_count: 2, following_count: 3 },
  course: { id: 1, name: 'Pebble Beach Golf Links', region: 'Monterey, CA', green_fee: null, difficulty: null, is_public: true },
  data: { rating: 9.4, note: 'Windy but fun.', favorite_hole: 7 },
  reaction_count: 1,
  viewer_reacted: false,
  is_own_activity: false,
  created_at: new Date().toISOString(),
}

describe('Home social feed', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetFeed.mockResolvedValue({ items: [activity], next_cursor: null })
    mockGetFeaturedCourse.mockResolvedValue(mockFeatured)
    mockSaveFeaturedCourse.mockResolvedValue({ status: 'saved', course_id: 3, is_new: true })
    mockDismissFeaturedCourse.mockResolvedValue({
      ...mockFeatured,
      id: 102,
      sequence: 2,
      course: { ...mockFeatured.course, id: 4, name: 'Spyglass Hill Golf Course' },
    })
    mockSetReaction.mockResolvedValue({ reaction_count: 1, viewer_reacted: true })
  })

  it('renders skeleton loader while feed is loading', () => {
    mockGetFeed.mockReturnValue(new Promise(() => {}))
    render(<Home />)
    expect(screen.getByLabelText('Loading friends activity')).toBeOnTheScreen()
  })

  it('renders real activity and activates the reaction control', async () => {
    render(<Home />)
    expect(screen.getByText('RK')).toBeOnTheScreen()
    expect(await screen.findByText('Maya Golfer rated')).toBeOnTheScreen()
    expect(screen.getByText('Pebble Beach Golf Links')).toBeOnTheScreen()
    expect(screen.getByText('9.4/10')).toBeOnTheScreen()
    expect(screen.getByText('Windy but fun.')).toBeOnTheScreen()
    expect(screen.getByText('Favorite hole 7')).toBeOnTheScreen()
    expect(screen.getByText('1 like')).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Like activity' }))
    await waitFor(() => expect(mockSetReaction).toHaveBeenCalledWith(8, true, expect.objectContaining({ Authorization: 'Bearer test-token' })))
  })

  it('opens the trip planner from Home', async () => {
    render(<Home />)
    await screen.findByText('Plan a golf trip')
    fireEvent.press(screen.getByRole('button', { name: 'Plan a golf trip' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/planner')
  })

  it('shows an honest empty state without demo activity', async () => {
    mockGetFeed.mockResolvedValue({ items: [], next_cursor: null })
    render(<Home />)
    expect(await screen.findByText('Your feed is quiet')).toBeOnTheScreen()
    expect(screen.queryByText('Torrey Pines (South)')).toBeNull()
  })

  it('shows an actionable API error', async () => {
    mockGetFeed.mockRejectedValue(new Error('Feed unavailable'))
    render(<Home />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Feed unavailable')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen()
  })

  it('shows a shared round score relative to the course par', async () => {
    mockGetFeed.mockResolvedValue({ items: [{ ...activity, event_type: 'round_logged', course: { ...activity.course, par: 72 }, data: { score: 70 } }], next_cursor: null })
    render(<Home />)
    expect(await screen.findByText('70')).toBeOnTheScreen()
    expect(screen.getByText('-2')).toBeOnTheScreen()
  })

  it('hides the like count when an activity has no likes', async () => {
    mockGetFeed.mockResolvedValue({ items: [{ ...activity, reaction_count: 0 }], next_cursor: null })
    render(<Home />)
    await screen.findByText('Maya Golfer rated')
    expect(screen.queryByText('0 likes')).toBeNull()
  })

  it('bounds long round notes in feed cards', async () => {
    const longNote = 'A'.repeat(5_000)
    mockGetFeed.mockResolvedValue({
      items: [{ ...activity, data: { ...activity.data, note: longNote } }],
      next_cursor: null,
    })
    render(<Home />)

    const note = await screen.findByText(longNote)
    expect(note).toHaveProp('numberOfLines', 3)
    expect(note).toHaveProp('ellipsizeMode', 'tail')
  })

  it('shows a round\'s own photos in the feed regardless of moderation status', async () => {
    mockGetFeed.mockResolvedValue({
      items: [{
        ...activity,
        data: {
          ...activity.data,
          photos: [
            { id: 1, url: 'https://cdn.example/a.jpg', alt_text: null, source_name: null, source_url: null, position: 0, is_hero: false },
            { id: 2, url: 'https://cdn.example/b.jpg', alt_text: null, source_name: null, source_url: null, position: 1, is_hero: false },
          ],
        },
      }],
      next_cursor: null,
    })
    render(<Home />)

    expect(await screen.findAllByLabelText('Round photo')).toHaveLength(2)
  })

  it('renders daily featured course spotlight card with action buttons', async () => {
    render(<Home />)
    expect(await screen.findByText("THIS WEEK'S SPOTLIGHT")).toBeOnTheScreen()
    expect(mockGetFeaturedCourse).toHaveBeenCalledWith(expect.anything(), { latitude: 36.5685, longitude: -121.949 })
    expect(screen.getByText('Pasatiempo Golf Club')).toBeOnTheScreen()
    expect(screen.getByText('Pasatiempo is a classic Alister MacKenzie layout great for walking.')).toBeOnTheScreen()
    expect(screen.getByText('~15 mi away')).toBeOnTheScreen()
    expect(screen.getByText('View Course')).toBeOnTheScreen()
    expect(screen.getByText('Plan Trip')).toBeOnTheScreen()

    // Press View Course
    fireEvent.press(screen.getByRole('button', { name: 'Explore Pasatiempo Golf Club' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/course/3')

    // Press Plan Trip
    fireEvent.press(screen.getByRole('button', { name: 'Plan a trip to Pasatiempo Golf Club' }))
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/planner', params: { courseId: '3' } })
  })

  it('allows 1-tap saving of the featured course', async () => {
    render(<Home />)
    expect(await screen.findByText('Pasatiempo Golf Club')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Save Pasatiempo Golf Club' }))
    await waitFor(() => expect(mockSaveFeaturedCourse).toHaveBeenCalled())
  })

  it('allows dismissing the featured course to show the next recommendation', async () => {
    render(<Home />)
    expect(await screen.findByText('Pasatiempo Golf Club')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Show next recommendation' }))
    await waitFor(() => expect(mockDismissFeaturedCourse).toHaveBeenCalled())
    expect(await screen.findByText('Spyglass Hill Golf Course')).toBeOnTheScreen()
  })
})

describe('home greeting', () => {
  it.each([
    [0, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [16, 'Good afternoon'],
    [17, 'Good evening'],
    [23, 'Good evening'],
  ])('uses the local hour %i for %s', (hour, expected) => {
    expect(greetingForHour(hour)).toBe(expected)
  })
})

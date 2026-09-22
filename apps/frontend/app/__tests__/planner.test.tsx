import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Planner from '../planner'
import { ApiResponseError } from '../../src/api/client'

const mockCreatePlan = jest.fn()
const mockDeletePlan = jest.fn()
const mockGetPlan = jest.fn()
const mockGetPlans = jest.fn()
const mockGetProfile = jest.fn()
const mockGenerateAIItinerary = jest.fn()
const mockSavePlan = jest.fn()
const mockUpdatePlan = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer test' })
const mockRouter = { back: jest.fn(), push: jest.fn() }
const mockParams = {}

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
    useLocalSearchParams: () => mockParams,
    usePathname: () => '/planner',
    useRouter: () => mockRouter,
  }
})

jest.mock('../../src/api/client', () => {
  class ApiResponseError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.name = 'ApiResponseError'
      this.status = status
    }
  }
  return {
    ApiResponseError,
    createPlan: (...args: unknown[]) => mockCreatePlan(...args),
    deletePlan: (...args: unknown[]) => mockDeletePlan(...args),
    getPlan: (...args: unknown[]) => mockGetPlan(...args),
    getPlans: (...args: unknown[]) => mockGetPlans(...args),
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
    generateAIItinerary: (...args: unknown[]) => mockGenerateAIItinerary(...args),
    savePlan: (...args: unknown[]) => mockSavePlan(...args),
    updatePlan: (...args: unknown[]) => mockUpdatePlan(...args),
  }
})

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

const plan = {
  id: 9, title: 'Monterey weekend', start_date: '2026-08-01', end_date: '2026-08-02', status: 'draft',
  constraints: {
    party_size: 4, max_green_fee: 500, access: 'any', difficulty: 'any', regions: ['Monterey, CA'],
    origin_latitude: null, origin_longitude: null, radius_miles: null, transportation: 'either',
    tee_time_window: null, must_haves: [], max_candidates: 5,
  },
  candidates: [{
    position: 1, score: 60, distance_miles: null, reasons: ['This would add a new course to your played list.'],
    caveats: ['Tee-time availability has not been verified.'], source_checked_at: '2026-07-21T00:00:00Z',
    course: { id: 1, name: 'Pebble Beach Golf Links', region: 'Monterey, CA', green_fee: 675, difficulty: 'challenging', is_public: true },
  }],
  itinerary: [{ id: 1, date: '2026-08-01', position: 1, title: 'Play Pebble Beach Golf Links', start_time: null, course: { id: 1, name: 'Pebble Beach Golf Links', region: 'Monterey, CA' }, details: { availability_verified: false } }],
  created_at: '', updated_at: '',
}

describe('trip planner', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPlans.mockResolvedValue([])
    mockGetProfile.mockResolvedValue(null)
    mockCreatePlan.mockResolvedValue(plan)
    mockSavePlan.mockResolvedValue({ ...plan, status: 'saved' })
    mockGenerateAIItinerary.mockResolvedValue({
      ...plan,
      generation_status: 'generated',
      generated_summary: 'A validated AI-organized Monterey itinerary.',
      fallback_reason: null,
      itinerary: [{
        ...plan.itinerary[0],
        details: {
          availability_verified: false,
          ai_generated: true,
          rationale: ['This would add a new course to your played list.'],
          caveats: ['Tee-time availability has not been verified.'],
        },
      }],
    })
  })

  it('creates, renders, and saves a persisted deterministic trip', async () => {
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')

    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Monterey weekend')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Monterey, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))

    expect(await screen.findByText('Pebble Beach Golf Links')).toBeOnTheScreen()
    await waitFor(() => expect(mockCreatePlan).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Monterey weekend', regions: ['Monterey, CA'] }),
      expect.objectContaining({ Authorization: 'Bearer test' }),
    ))
    expect(screen.getByText('08/01/2026 – 08/02/2026')).toBeOnTheScreen()
    expect(screen.queryByLabelText('Access')).toBeNull()
    expect(screen.queryByLabelText('Origin latitude')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Save trip' }))
    await waitFor(() => expect(mockSavePlan).toHaveBeenCalledWith(9, expect.anything()))
    expect(await screen.findByText('Saved')).toBeOnTheScreen()
  })

  it('validates US-formatted dates before calling the API', async () => {
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Nearby')
    fireEvent.changeText(screen.getByLabelText('Start date'), '13/40/2026')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Use MM/DD/YYYY for both dates.')
    expect(mockCreatePlan).not.toHaveBeenCalled()
  })

  it('lets the user refine a generated query', async () => {
    mockUpdatePlan.mockResolvedValue({ ...plan, title: 'Refined Monterey' })
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Monterey weekend')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Monterey, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))
    await screen.findByRole('button', { name: 'Refine trip' })

    fireEvent.press(screen.getByRole('button', { name: 'Refine trip' }))
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Refined Monterey')
    fireEvent.press(screen.getByRole('button', { name: 'Update trip' }))

    await waitFor(() => expect(mockUpdatePlan).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        title: 'Refined Monterey', access: 'any', difficulty: 'any', transportation: 'either',
        origin_latitude: null, origin_longitude: null, radius_miles: null, tee_time_window: null,
      }),
      expect.anything(),
    ))
  })

  it('organizes a persisted candidate set with AI and shows generation status', async () => {
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Monterey weekend')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Monterey, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))
    await screen.findByRole('button', { name: 'Organize itinerary with AI' })

    fireEvent.press(screen.getByRole('button', { name: 'Organize itinerary with AI' }))

    await waitFor(() => expect(mockGenerateAIItinerary).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ Authorization: 'Bearer test' }),
    ))
    expect(await screen.findByText('AI ORGANIZED')).toBeOnTheScreen()
    expect(screen.getByText('A validated AI-organized Monterey itinerary.')).toBeOnTheScreen()
  })

  it('shows an "unavailable" fallback state when AI planning is disabled or the caller is not enrolled', async () => {
    mockGenerateAIItinerary.mockResolvedValue({
      ...plan,
      generation_status: 'fallback',
      generated_summary: 'Your itinerary, organized by our default ranking.',
      fallback_reason: 'disabled',
    })
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Monterey weekend')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Monterey, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))
    await screen.findByRole('button', { name: 'Organize itinerary with AI' })

    fireEvent.press(screen.getByRole('button', { name: 'Organize itinerary with AI' }))

    expect(await screen.findByText('AI PLANNING UNAVAILABLE')).toBeOnTheScreen()
    expect(screen.getByText(/isn’t turned on for your account yet/)).toBeOnTheScreen()
    expect(screen.getByText('Your itinerary, organized by our default ranking.')).toBeOnTheScreen()
  })

  it('shows a "paused" fallback state when the monthly AI cost limit is hit', async () => {
    mockGenerateAIItinerary.mockResolvedValue({
      ...plan,
      generation_status: 'fallback',
      generated_summary: 'Your itinerary, organized by our default ranking.',
      fallback_reason: 'monthly_cost_limit',
    })
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Monterey weekend')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Monterey, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))
    await screen.findByRole('button', { name: 'Organize itinerary with AI' })

    fireEvent.press(screen.getByRole('button', { name: 'Organize itinerary with AI' }))

    expect(await screen.findByText('AI PLANNING PAUSED')).toBeOnTheScreen()
    expect(screen.getByText(/reached this month’s AI planning limit/)).toBeOnTheScreen()
  })

  it('keeps the plain deterministic-fallback label for transient AI failures', async () => {
    mockGenerateAIItinerary.mockResolvedValue({
      ...plan,
      generation_status: 'fallback',
      generated_summary: 'Your itinerary, organized by our default ranking.',
      fallback_reason: 'timeout',
    })
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Monterey weekend')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Monterey, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))
    await screen.findByRole('button', { name: 'Organize itinerary with AI' })

    fireEvent.press(screen.getByRole('button', { name: 'Organize itinerary with AI' }))

    expect(await screen.findByText('DETERMINISTIC PLAN KEPT')).toBeOnTheScreen()
  })

  it('shows a friendly message when AI planning is rate limited', async () => {
    mockGenerateAIItinerary.mockRejectedValue(new ApiResponseError('Too Many Requests', 429))
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Monterey weekend')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Monterey, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))
    await screen.findByRole('button', { name: 'Organize itinerary with AI' })

    fireEvent.press(screen.getByRole('button', { name: 'Organize itinerary with AI' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AI trip planning has hit its usage limit for now. Please try again later.')
  })

  it('pre-populates party size, max green fee, access, difficulty, transportation, and preference tags from user profile', async () => {
    mockGetProfile.mockResolvedValue({
      home_region: 'Monterey, CA',
      max_green_fee: 175,
      difficulty: 'challenging',
      access: 'public',
      onboarding_data: {
        group_size: 'Twosome',
        transportation: 'Walking',
        preferences: ['Scenic views', 'Walking friendly'],
        budget: '$$$',
      },
    })
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')

    expect(screen.getByLabelText('Party size')).toHaveProp('value', '2')
    expect(screen.getByLabelText('Maximum green fee')).toHaveProp('value', '175')
    expect(screen.getByLabelText('Must-haves')).toHaveProp('value', 'Scenic views, Walking friendly')
    expect(screen.getByLabelText('Destination or regions')).toHaveProp('placeholder', 'e.g. Monterey, CA')

    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Pacific Grove Round')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Monterey, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))

    await waitFor(() => expect(mockCreatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Pacific Grove Round',
        party_size: 2,
        max_green_fee: 175,
        access: 'public',
        difficulty: 'challenging',
        transportation: 'walking',
        must_haves: ['Scenic views', 'Walking friendly'],
        regions: ['Monterey, CA'],
      }),
      expect.anything(),
    ))
  })

  it('allows selecting and updating access, difficulty, and transportation chips', async () => {
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')

    fireEvent.press(screen.getByRole('button', { name: 'Private' }))
    fireEvent.press(screen.getByRole('button', { name: 'Beginner' }))
    fireEvent.press(screen.getByRole('button', { name: 'Cart' }))

    expect(screen.getByRole('button', { name: 'Private' }).props.accessibilityState).toEqual({ selected: true })
    expect(screen.getByRole('button', { name: 'Public' }).props.accessibilityState).toEqual({ selected: false })

    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Desert Outing')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Palm Springs, CA')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))

    await waitFor(() => expect(mockCreatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Desert Outing',
        access: 'private',
        difficulty: 'beginner',
        transportation: 'cart',
      }),
      expect.anything(),
    ))
  })

  it('hides the form and displays loading indicator while loading profile defaults', async () => {
    let resolveProfile!: (value: unknown) => void
    const profilePromise = new Promise((resolve) => { resolveProfile = resolve })
    mockGetProfile.mockReturnValue(profilePromise)

    render(<Planner />)

    expect(screen.getByLabelText('Loading trips')).toBeOnTheScreen()
    expect(screen.queryByLabelText('Party size')).toBeNull()

    resolveProfile({
      home_region: 'Monterey, CA',
      max_green_fee: 175,
      difficulty: 'challenging',
      access: 'public',
      onboarding_data: { group_size: 'Solo', transportation: 'Walking', preferences: ['Ocean views'] },
    })

    expect(await screen.findByLabelText('Party size')).toHaveProp('value', '1')
    expect(screen.getByLabelText('Maximum green fee')).toHaveProp('value', '175')
    expect(screen.getByLabelText('Must-haves')).toHaveProp('value', 'Ocean views')
  })

  it('populates destination with home region when tapping "Use home region"', async () => {
    mockGetProfile.mockResolvedValue({
      home_region: 'San Diego, CA',
      max_green_fee: 100,
      difficulty: 'any',
      access: 'any',
      onboarding_data: { group_size: 'Foursome' },
    })
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')

    const homeRegionButton = await screen.findByRole('button', { name: 'Use home region (San Diego, CA)' })
    fireEvent.press(homeRegionButton)

    expect(screen.getByLabelText('Destination or regions')).toHaveProp('value', 'San Diego, CA')

    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Local Weekend')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))

    await waitFor(() => expect(mockCreatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Local Weekend',
        regions: ['San Diego, CA'],
      }),
      expect.anything(),
    ))
  })

  it('allows toggling suggested must-have preference tags from profile', async () => {
    mockGetProfile.mockResolvedValue({
      home_region: 'Monterey, CA',
      max_green_fee: 175,
      difficulty: 'any',
      access: 'any',
      onboarding_data: {
        preferences: ['Ocean views', 'Fast greens'],
      },
    })
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')

    expect(screen.getByLabelText('Must-haves')).toHaveProp('value', 'Ocean views, Fast greens')

    fireEvent.press(screen.getByRole('button', { name: '✓ Ocean views' }))
    expect(screen.getByLabelText('Must-haves')).toHaveProp('value', 'Fast greens')

    fireEvent.press(screen.getByRole('button', { name: '+ Ocean views' }))
    expect(screen.getByLabelText('Must-haves')).toHaveProp('value', 'Fast greens, Ocean views')
  })

  it('handles profile fetch failure gracefully and uses fallbacks', async () => {
    mockGetProfile.mockRejectedValue(new Error('Network error'))
    render(<Planner />)
    await screen.findByText('Draft and saved trips will appear here.')

    expect(screen.getByLabelText('Party size')).toHaveProp('value', '4')
    expect(screen.getByLabelText('Maximum green fee')).toHaveProp('value', '')

    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Fallback Trip')
    fireEvent.changeText(screen.getByLabelText('Destination or regions'), 'Scottsdale, AZ')
    fireEvent.press(screen.getByRole('button', { name: 'Build trip' }))

    await waitFor(() => expect(mockCreatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Fallback Trip',
        party_size: 4,
        max_green_fee: null,
        access: 'any',
        difficulty: 'any',
        transportation: 'either',
      }),
      expect.anything(),
    ))
  })
})

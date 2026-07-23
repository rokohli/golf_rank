import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Planner from '../planner'

const mockCreatePlan = jest.fn()
const mockDeletePlan = jest.fn()
const mockGetPlan = jest.fn()
const mockGetPlans = jest.fn()
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

jest.mock('../../src/api/client', () => ({
  createPlan: (...args: unknown[]) => mockCreatePlan(...args),
  deletePlan: (...args: unknown[]) => mockDeletePlan(...args),
  getPlan: (...args: unknown[]) => mockGetPlan(...args),
  getPlans: (...args: unknown[]) => mockGetPlans(...args),
  generateAIItinerary: (...args: unknown[]) => mockGenerateAIItinerary(...args),
  savePlan: (...args: unknown[]) => mockSavePlan(...args),
  updatePlan: (...args: unknown[]) => mockUpdatePlan(...args),
}))

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
})

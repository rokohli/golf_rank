import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Rankings from '../rankings'
import { RankingSnapshot } from '../../src/types'

const mockGetRanking = jest.fn()
const mockGetAuthHeaders = jest.fn().mockResolvedValue({
  'Content-Type': 'application/json',
  Authorization: 'Bearer test-token',
})
const mockPush = jest.fn()
const mockReplace = jest.fn()
let mockFocusEffect: (() => void | (() => void)) | undefined
let mockFocusCleanup: (() => void) | undefined

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return {
    Feather: ({ name }: { name: string }) => <Text>{name}</Text>,
  }
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusEffect = callback
      React.useEffect(() => {
        const cleanup = callback()
        mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined
        return cleanup
      }, [callback])
    },
    usePathname: () => '/rankings',
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
  }
})

jest.mock('../../src/api/client', () => ({
  getRanking: (...args: unknown[]) => mockGetRanking(...args),
}))

jest.mock('../../src/auth/useAuthToken', () => ({
  useAuthHeaders: () => ({ getAuthHeaders: mockGetAuthHeaders }),
}))

describe('rankings refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFocusEffect = undefined
    mockFocusCleanup = undefined
    mockGetAuthHeaders.mockResolvedValue({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    })
  })

  it('shows initial loading and then renders the authenticated ranking with /10 values', async () => {
    const request = deferred<RankingSnapshot>()
    mockGetRanking.mockReturnValue(request.promise)

    render(<Rankings />)

    expect(screen.getByLabelText('Loading rankings')).toBeOnTheScreen()
    expect(screen.queryByText('Pebble Beach Golf Links')).toBeNull()

    await act(async () => {
      request.resolve(rankingSnapshot('Authenticated Links', 9.2))
      await request.promise
    })

    expect(await screen.findByText('Authenticated Links')).toBeOnTheScreen()
    expect(screen.getByText(/9\.2/)).toHaveTextContent(/9\.2 \/ 10/)
    expect(mockGetAuthHeaders).toHaveBeenCalledTimes(1)
    expect(mockGetRanking).toHaveBeenCalledWith(expect.objectContaining({ Authorization: 'Bearer test-token' }))
  })

  it('fetches and updates the ranking whenever the screen regains focus', async () => {
    mockGetRanking
      .mockResolvedValueOnce(rankingSnapshot('First Ranking', 8.1))
      .mockResolvedValueOnce(rankingSnapshot('Updated Ranking', 9.4))

    render(<Rankings />)
    expect(await screen.findByText('First Ranking')).toBeOnTheScreen()

    await refocus()

    expect(await screen.findByText('Updated Ranking')).toBeOnTheScreen()
    expect(screen.queryByText('First Ranking')).toBeNull()
    expect(mockGetRanking).toHaveBeenCalledTimes(2)
    expect(mockGetAuthHeaders).toHaveBeenCalledTimes(2)
  })

  it('ignores an older request that resolves after a newer focus refresh', async () => {
    const older = deferred<RankingSnapshot>()
    const newer = deferred<RankingSnapshot>()
    mockGetRanking.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

    render(<Rankings />)
    await waitFor(() => expect(mockGetRanking).toHaveBeenCalledTimes(1))

    await refocus()
    expect(mockGetRanking).toHaveBeenCalledTimes(2)

    await act(async () => {
      newer.resolve(rankingSnapshot('Newest Ranking', 9.7))
      await newer.promise
    })
    expect(await screen.findByText('Newest Ranking')).toBeOnTheScreen()
    expect(screen.queryByLabelText('Loading rankings')).toBeNull()

    await act(async () => {
      older.resolve(rankingSnapshot('Stale Ranking', 6.3))
      await older.promise
    })
    expect(screen.getByText('Newest Ranking')).toBeOnTheScreen()
    expect(screen.queryByText('Stale Ranking')).toBeNull()
    expect(screen.queryByLabelText('Loading rankings')).toBeNull()
  })

  it('does not apply a pending request after the screen blurs', async () => {
    const blurredRequest = deferred<RankingSnapshot>()
    mockGetRanking
      .mockReturnValueOnce(blurredRequest.promise)
      .mockResolvedValueOnce(rankingSnapshot('Refocused Ranking', 9.1))

    render(<Rankings />)
    await waitFor(() => expect(mockGetRanking).toHaveBeenCalledTimes(1))

    act(() => {
      mockFocusCleanup?.()
    })

    await act(async () => {
      blurredRequest.resolve(rankingSnapshot('Blurred Ranking', 7.2))
      await blurredRequest.promise
    })

    expect(screen.queryByText('Blurred Ranking')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    await refocus()

    expect(await screen.findByText('Refocused Ranking')).toBeOnTheScreen()
    expect(screen.queryByText('Blurred Ranking')).toBeNull()
    expect(screen.queryByLabelText('Loading rankings')).toBeNull()
  })

  it('shows an honest initial error and retries without displaying demo rankings', async () => {
    mockGetRanking
      .mockRejectedValueOnce(new Error('Ranking service unavailable'))
      .mockResolvedValueOnce(rankingSnapshot('Recovered Ranking', 8.8))

    render(<Rankings />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Ranking service unavailable')
    expect(screen.queryByText('Pebble Beach Golf Links')).toBeNull()
    expect(screen.queryByText('Refine my rankings')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered Ranking')).toBeOnTheScreen()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockGetRanking).toHaveBeenCalledTimes(2)
  })

  it('keeps a successful snapshot visible when refocus fails and recovers on retry', async () => {
    mockGetRanking
      .mockResolvedValueOnce(rankingSnapshot('Stale Ranking', 8.4))
      .mockRejectedValueOnce(new Error('Refresh unavailable'))
      .mockResolvedValueOnce(rankingSnapshot('Recovered Ranking', 9.3))

    render(<Rankings />)
    expect(await screen.findByText('Stale Ranking')).toBeOnTheScreen()

    await refocus()

    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh unavailable')
    expect(screen.getByText('Stale Ranking')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered Ranking')).toBeOnTheScreen()
    expect(screen.queryByText('Stale Ranking')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockGetRanking).toHaveBeenCalledTimes(3)
  })

  it('renders a real empty state without substituting demo rankings', async () => {
    mockGetRanking.mockResolvedValue(rankingSnapshot())

    render(<Rankings />)

    expect(await screen.findByText('Your rankings are ready to begin')).toBeOnTheScreen()
    expect(screen.getByText('Rate a course to start building your personal list.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Find a course to rate' })).toBeOnTheScreen()
    expect(screen.queryByText('Pebble Beach Golf Links')).toBeNull()
    expect(screen.queryByText('Refine my rankings')).toBeNull()
  })
})

async function refocus() {
  await act(async () => {
    mockFocusCleanup?.()
    const cleanup = mockFocusEffect?.()
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined
  })
}

function rankingSnapshot(name?: string, personalRating = 8.5): RankingSnapshot {
  return {
    version: 1,
    algorithm_version: 'test',
    overall_confidence: 0.8,
    entries: name ? [{
      rank: 1,
      course: {
        id: 42,
        name,
        region: 'Santa Cruz, CA',
        green_fee: 150,
        difficulty: 'challenging',
        is_public: true,
      },
      tier: 'green',
      tier_position: 1,
      personal_rating: personalRating,
      confidence: 0.9,
      confidence_label: 'high',
    }] : [],
    unranked_courses: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

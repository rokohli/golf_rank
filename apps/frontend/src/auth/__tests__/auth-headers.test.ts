import { renderHook } from '@testing-library/react-native'

import { buildAuthHeaders, useAuthHeaders } from '../useAuthToken'

let mockGetToken = jest.fn<Promise<string | null>, []>()

jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}))

describe('buildAuthHeaders', () => {
  const originalAuthMode = process.env.EXPO_PUBLIC_AUTH_MODE

  afterEach(() => {
    process.env.EXPO_PUBLIC_AUTH_MODE = originalAuthMode
  })

  it('uses the development identity header in development auth mode', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'development'

    await expect(buildAuthHeaders(async () => null)).resolves.toEqual({
      'Content-Type': 'application/json',
      'X-Development-Subject': 'dev:local-user',
    })
  })

  it('keeps the development auth header callback stable across renders', () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'development'

    const { result, rerender } = renderHook(() => useAuthHeaders())
    const firstCallback = result.current.getAuthHeaders
    rerender(undefined)

    expect(result.current.getAuthHeaders).toBe(firstCallback)
  })

  it('does not treat admin-development as a development bypass', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'admin-development'

    await expect(buildAuthHeaders(async () => 'jwt-token')).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-token',
    })
  })

  it('keeps the Clerk auth header callback stable while using the latest token getter', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    mockGetToken = jest.fn().mockResolvedValue('first-token')

    const { result, rerender } = renderHook(() => useAuthHeaders())
    const firstCallback = result.current.getAuthHeaders

    mockGetToken = jest.fn().mockResolvedValue('refreshed-token')
    rerender(undefined)

    expect(result.current.getAuthHeaders).toBe(firstCallback)
    await expect(result.current.getAuthHeaders()).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer refreshed-token',
    })
  })

  it('uses a Clerk bearer token outside development auth mode', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'

    await expect(buildAuthHeaders(async () => 'jwt-token')).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-token',
    })
  })

  it('throws when Clerk mode has no active token', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'

    await expect(buildAuthHeaders(async () => null)).rejects.toThrow('Sign in required')
  })
})

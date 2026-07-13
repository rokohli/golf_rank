import { buildAuthHeaders } from '../useAuthToken'

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

  it('does not treat admin-development as a development bypass', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'admin-development'

    await expect(buildAuthHeaders(async () => 'jwt-token')).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-token',
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

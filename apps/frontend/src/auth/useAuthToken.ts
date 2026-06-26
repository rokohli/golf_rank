export type ApiHeaders = {
  'Content-Type': 'application/json'
  Authorization?: string
  'X-Development-Subject'?: string
}

export async function buildAuthHeaders(getToken: () => Promise<string | null>): Promise<ApiHeaders> {
  if (process.env.EXPO_PUBLIC_AUTH_MODE === 'development') {
    return {
      'Content-Type': 'application/json',
      'X-Development-Subject': 'dev:local-user',
    }
  }

  if (process.env.EXPO_PUBLIC_AUTH_MODE === 'admin-development') {
    return {
      'Content-Type': 'application/json',
      'X-Development-Subject': 'dev:admin',
    }
  }

  const token = await getToken()
  if (!token) throw new Error('Sign in required')

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export function useAuthHeaders() {
  if (
    process.env.EXPO_PUBLIC_AUTH_MODE === 'development' ||
    process.env.EXPO_PUBLIC_AUTH_MODE === 'admin-development'
  ) {
    return {
      getAuthHeaders: () => buildAuthHeaders(async () => null),
    }
  }

  return {
    getAuthHeaders: () => buildAuthHeaders(async () => null),
  }
}

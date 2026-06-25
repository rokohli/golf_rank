import { useCallback } from 'react'

type ClerkUseAuth = typeof import('@clerk/clerk-expo')['useAuth']

declare const require: (moduleName: string) => { useAuth: ClerkUseAuth }

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

  const token = await getToken()
  if (!token) throw new Error('Sign in required')

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export function useAuthHeaders() {
  const { useAuth } = require('@clerk/clerk-expo')
  const { getToken } = useAuth()

  return {
    getAuthHeaders: useCallback(() => buildAuthHeaders(() => getToken()), [getToken]),
  }
}

import { ApiHeaders } from '../auth/useAuthToken'
import { Course, OnboardingPreferences } from '../types'

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function savePreferences(input: OnboardingPreferences, headers: ApiHeaders): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/onboarding-preferences`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error('Unable to save preferences. Please try again.')
}

export async function getProfile(headers: ApiHeaders): Promise<OnboardingPreferences> {
  const response = await fetch(`${baseUrl}/api/v1/me/profile`, {
    headers,
  })
  if (!response.ok) throw new Error('Unable to load profile. Please complete onboarding first.')
  return response.json()
}

export async function searchCourses(filters?: OnboardingPreferences): Promise<Course[]> {
  const params = new URLSearchParams()
  if (filters?.home_region) params.set('region', filters.home_region)
  if (filters?.max_green_fee !== undefined) params.set('max_green_fee', String(filters.max_green_fee))
  if (filters?.difficulty && filters.difficulty !== 'any') params.set('difficulty', filters.difficulty)
  if (filters?.access && filters.access !== 'any') params.set('access', filters.access)

  const query = params.toString()
  const response = await fetch(`${baseUrl}/api/v1/courses${query ? `?${query}` : ''}`)
  if (!response.ok) throw new Error('Unable to load courses. Please try again.')
  return response.json()
}

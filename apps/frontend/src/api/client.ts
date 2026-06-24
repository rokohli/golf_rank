import { Course, OnboardingPreferences } from '../types'

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'
const developmentHeaders = {
  'Content-Type': 'application/json',
  'X-Development-Subject': 'dev:local-user',
}

export async function savePreferences(input: OnboardingPreferences): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/me/onboarding-preferences`, {
    method: 'PUT',
    headers: developmentHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error('Unable to save preferences. Please try again.')
}

export async function searchCourses(): Promise<Course[]> {
  const response = await fetch(`${baseUrl}/api/v1/courses`)
  if (!response.ok) throw new Error('Unable to load courses. Please try again.')
  return response.json()
}

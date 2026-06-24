export type OnboardingPreferences = {
  home_region: string
  max_green_fee: number
  difficulty: 'beginner' | 'intermediate' | 'challenging' | 'any'
  access: 'public' | 'private' | 'any'
}

export type Course = {
  id: number
  name: string
  region: string
  green_fee: number
  difficulty: string
  is_public: boolean
}

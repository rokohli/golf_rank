export type OnboardingPreferences = {
  home_region: string
  max_green_fee: number
  difficulty: 'beginner' | 'intermediate' | 'challenging' | 'any'
  access: 'public' | 'private' | 'any'
  onboarding_data?: {
    first_name: string
    last_name: string
    username: string
    profile_photo_added: boolean
    home_course_id: string | null
    home_course_search: string
    played_course_ids: string[]
    favorite_wins: string[]
    dream_course_ids: string[]
    friend_search: string
    preferences: string[]
    group_size: 'Solo' | 'Twosome' | 'Foursome' | null
    budget: '$' | '$$' | '$$$' | '$$$$' | null
    travel_distance: string
    preferred_tee_time: string
    transportation: 'Walking' | 'Cart' | 'Either' | null
    notifications: boolean | null
  }
}

export type Course = {
  id: number
  name: string
  region: string
  green_fee: number
  difficulty: string
  is_public: boolean
}

export type RankingTier = 'loved_it' | 'liked_it' | 'fine' | 'no'

export type TierPlacement = {
  course_id: number
  tier: RankingTier | 'not_sure'
  position?: number
}

export type ComparisonResult = 'course_a' | 'course_b' | 'too_close' | 'not_sure'

export type RankingComparison = {
  course_a_id: number
  course_b_id: number
  result: ComparisonResult
}

export type RankedCourse = {
  rank: number
  course: Course
  tier: RankingTier
  tier_position: number
  personal_rating: number
  confidence: number
  confidence_label: 'low' | 'medium' | 'high'
}

export type RankingSnapshot = {
  version: number
  algorithm_version: string
  overall_confidence: number
  entries: RankedCourse[]
  unranked_courses: Course[]
  created_at?: string | null
}

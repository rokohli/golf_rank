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
  community_rating?: number | null
  rating_count?: number
}

export type RatingTier = 'green' | 'fairway' | 'rough' | 'bunker'

export type RankingTier = RatingTier

export type TierPlacement = {
  course_id: number
  tier: RankingTier | 'not_sure'
  position?: number
}

export type ComparisonResult = 'course_a' | 'course_b' | 'too_close'

type CourseRatingCore = {
  tier: RatingTier
  played_on: string
  score: number | null
}

export type CourseRatingInput = CourseRatingCore & (
  | {
      comparison_course_id: number
      comparison_result: ComparisonResult
    }
  | {
      comparison_course_id?: never
      comparison_result?: never
    }
)

export type RatingDetailsInput = {
  note: string | null
  favorite_hole: number | null
  friend_user_ids: number[]
  guest_names: string[]
  visibility: 'private' | 'friends'
}

export type CourseRatingState = {
  course: Course
  personal_rating: number | null
  tier: RatingTier | null
  confidence: number | null
  community_rating: number | null
  rating_count: number
  round: {
    id: number
    played_on: string
    score: number | null
    note: string | null
    favorite_hole: number | null
    visibility: 'private' | 'friends'
  } | null
  companions: {
    friend_user_id: number | null
    guest_name: string | null
  }[]
}

export type RatingCandidate = Course | null

export type FriendSummary = {
  id: number
  display_name: string
  username: string | null
}

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

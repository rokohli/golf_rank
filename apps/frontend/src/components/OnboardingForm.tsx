import * as SecureStore from 'expo-secure-store'
import { Feather, Ionicons } from '@expo/vector-icons'
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { OnboardingPreferences } from '../types'

type Difficulty = OnboardingPreferences['difficulty']
type Access = OnboardingPreferences['access']

type CourseSeed = {
  id: string
  name: string
  location: string
  city: string
  region: string
  imageTone: string
  meta: string
}

type OnboardingDraft = {
  firstName: string
  lastName: string
  username: string
  profilePhotoAdded: boolean
  homeCourseId: string | null
  homeCourseSearch: string
  playedCourseIds: string[]
  favoriteWins: string[]
  dreamCourseIds: string[]
  friendSearch: string
  preferences: string[]
  groupSize: 'Solo' | 'Twosome' | 'Foursome' | null
  budget: '$' | '$$' | '$$$' | '$$$$' | null
  travelDistance: string
  preferredTeeTime: string
  transportation: 'Walking' | 'Cart' | 'Either' | null
  notifications: boolean | null
}

type StepKey =
  | 'profile'
  | 'home'
  | 'played'
  | 'rank'
  | 'dreams'
  | 'friends'
  | 'preferences'
  | 'planning'
  | 'notifications'
  | 'success'

type OnboardingFormProps = {
  submit: (input: OnboardingPreferences) => Promise<void>
  onComplete: (destination: 'home' | 'profile') => void
  onExit?: () => void
  saveProfile?: (profile: { firstName: string; lastName: string; username: string }) => Promise<void>
}

const DRAFT_KEY = 'golfrank_onboarding_draft'

const steps: StepKey[] = [
  'profile',
  'home',
  'played',
  'rank',
  'dreams',
  'friends',
  'preferences',
  'planning',
  'notifications',
  'success',
]

const initialDraft: OnboardingDraft = {
  firstName: '',
  lastName: '',
  username: '',
  profilePhotoAdded: false,
  homeCourseId: null,
  homeCourseSearch: '',
  playedCourseIds: [],
  favoriteWins: [],
  dreamCourseIds: [],
  friendSearch: '',
  preferences: [],
  groupSize: null,
  budget: null,
  travelDistance: 'Up to 45 minutes',
  preferredTeeTime: 'Weekend mornings',
  transportation: null,
  notifications: null,
}

const courses: CourseSeed[] = [
  {
    id: 'pasatiempo',
    name: 'Pasatiempo Golf Club',
    location: 'Santa Cruz, CA',
    city: 'Santa Cruz',
    region: 'CA',
    imageTone: '#8EA58D',
    meta: 'MacKenzie classic',
  },
  {
    id: 'pebble',
    name: 'Pebble Beach Golf Links',
    location: 'Monterey, CA',
    city: 'Monterey',
    region: 'CA',
    imageTone: '#78918E',
    meta: 'Oceanfront icon',
  },
  {
    id: 'spyglass',
    name: 'Spyglass Hill Golf Course',
    location: 'Pebble Beach, CA',
    city: 'Pebble Beach',
    region: 'CA',
    imageTone: '#546C5A',
    meta: 'Forest and dunes',
  },
  {
    id: 'torrey',
    name: 'Torrey Pines South',
    location: 'La Jolla, CA',
    city: 'La Jolla',
    region: 'CA',
    imageTone: '#6D8FA0',
    meta: 'Cliffside municipal',
  },
  {
    id: 'bandon',
    name: 'Bandon Dunes',
    location: 'Bandon, OR',
    city: 'Bandon',
    region: 'OR',
    imageTone: '#A28E6D',
    meta: 'Links destination',
  },
  {
    id: 'pinehurst',
    name: 'Pinehurst No. 2',
    location: 'Pinehurst, NC',
    city: 'Pinehurst',
    region: 'NC',
    imageTone: '#8A9368',
    meta: 'Championship routing',
  },
  {
    id: 'augusta',
    name: 'Augusta National',
    location: 'Augusta, GA',
    city: 'Augusta',
    region: 'GA',
    imageTone: '#4C7A4D',
    meta: 'Bucket list',
  },
  {
    id: 'standrews',
    name: 'St Andrews Old Course',
    location: 'St Andrews, Scotland',
    city: 'St Andrews',
    region: 'Scotland',
    imageTone: '#7F8A75',
    meta: 'Home of golf',
  },
  {
    id: 'cabot',
    name: 'Cabot Cliffs',
    location: 'Inverness, Canada',
    city: 'Inverness',
    region: 'NS',
    imageTone: '#668187',
    meta: 'Coastal drama',
  },
  {
    id: 'taraiti',
    name: 'Tara Iti',
    location: 'Mangawhai, New Zealand',
    city: 'Mangawhai',
    region: 'NZ',
    imageTone: '#B0976A',
    meta: 'Pure links',
  },
]

const preferenceOptions = [
  'Great value',
  'Scenic views',
  'Championship courses',
  'Fast pace',
  'Walking friendly',
  'Resort golf',
  'Public courses',
  'Private clubs',
  'Tough layouts',
  'Beginner friendly',
  'Hidden gems',
  'Stay & Play',
  'Weekend trips',
  'Match play',
  'Food & drinks',
]

const rankPairs: [string, string][] = [
  ['pebble', 'torrey'],
  ['pasatiempo', 'spyglass'],
  ['bandon', 'pinehurst'],
  ['cabot', 'standrews'],
]

function selectedCourse(ids: string[], fallback = courses[0]) {
  return ids.map((id) => courses.find((course) => course.id === id)).find(Boolean) ?? fallback
}

function filterCourses(query: string, source = courses) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return source
  return source.filter((course) => `${course.name} ${course.location}`.toLowerCase().includes(normalized))
}

function toPreferences(draft: OnboardingDraft): OnboardingPreferences {
  const homeCourse = draft.homeCourseId ? courses.find((course) => course.id === draft.homeCourseId) : null
  const maxGreenFee = draft.budget === '$' ? 125 : draft.budget === '$$' ? 225 : draft.budget === '$$$$' ? 650 : 350
  const difficulty: Difficulty = draft.preferences.includes('Beginner friendly')
    ? 'beginner'
    : draft.preferences.includes('Tough layouts') || draft.preferences.includes('Championship courses')
      ? 'challenging'
      : 'any'
  const access: Access = draft.preferences.includes('Public courses')
    ? 'public'
    : draft.preferences.includes('Private clubs')
      ? 'private'
      : 'any'

  return {
    access,
    difficulty,
    home_region: homeCourse ? `${homeCourse.city}, ${homeCourse.region}` : draft.homeCourseSearch.trim(),
    max_green_fee: maxGreenFee,
    onboarding_data: {
      first_name: draft.firstName.trim(),
      last_name: draft.lastName.trim(),
      username: draft.username.trim(),
      profile_photo_added: draft.profilePhotoAdded,
      home_course_id: draft.homeCourseId,
      home_course_search: draft.homeCourseSearch.trim(),
      played_course_ids: draft.playedCourseIds,
      favorite_wins: draft.favoriteWins,
      dream_course_ids: draft.dreamCourseIds,
      friend_search: draft.friendSearch.trim(),
      preferences: draft.preferences,
      group_size: draft.groupSize,
      budget: draft.budget,
      travel_distance: draft.travelDistance.trim(),
      preferred_tee_time: draft.preferredTeeTime.trim(),
      transportation: draft.transportation,
      notifications: draft.notifications,
    },
  }
}

export function OnboardingForm({ submit, onComplete, onExit, saveProfile }: OnboardingFormProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [draft, setDraft] = useState<OnboardingDraft>(initialDraft)
  const [courseQuery, setCourseQuery] = useState('')
  const [dreamQuery, setDreamQuery] = useState('')
  const [rankIndex, setRankIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const opacity = useRef(new Animated.Value(1)).current
  const translateX = useRef(new Animated.Value(0)).current

  const step = steps[stepIndex]

  useEffect(() => {
    SecureStore.getItemAsync(DRAFT_KEY)
      .then((stored) => {
        if (!stored) return
        const parsed = JSON.parse(stored) as Partial<OnboardingDraft> & { draftVersion?: number; name?: string; stepIndex?: number; rankIndex?: number }
        const [legacyFirstName = '', ...legacyLastNameParts] = parsed.name?.trim().split(/\s+/) ?? []
        setDraft({
          ...initialDraft,
          ...parsed,
          firstName: parsed.firstName ?? legacyFirstName,
          lastName: parsed.lastName ?? legacyLastNameParts.join(' '),
        })
        if (typeof parsed.stepIndex === 'number') {
          const migratedStepIndex = parsed.draftVersion && parsed.draftVersion >= 2 ? parsed.stepIndex : Math.max(parsed.stepIndex - 2, 0)
          setStepIndex(Math.min(migratedStepIndex, steps.length - 1))
        }
        if (typeof parsed.rankIndex === 'number') setRankIndex(Math.min(parsed.rankIndex, rankPairs.length - 1))
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true))
  }, [])

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { duration: 90, toValue: 0.96, useNativeDriver: true }),
        Animated.timing(translateX, { duration: 90, toValue: 10, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(opacity, { damping: 18, mass: 0.7, stiffness: 140, toValue: 1, useNativeDriver: true }),
        Animated.spring(translateX, { damping: 18, mass: 0.7, stiffness: 140, toValue: 0, useNativeDriver: true }),
      ]),
    ]).start()
  }, [opacity, stepIndex, translateX])

  useEffect(() => {
    if (!hydrated) return
    SecureStore.setItemAsync(DRAFT_KEY, JSON.stringify({ ...draft, draftVersion: 3, rankIndex, stepIndex })).catch(() => undefined)
  }, [draft, hydrated, rankIndex, stepIndex])

  const playedCourses = useMemo(() => draft.playedCourseIds.map((id) => courses.find((course) => course.id === id)).filter(Boolean) as CourseSeed[], [draft.playedCourseIds])
  const homeSuggestions = filterCourses(draft.homeCourseSearch || courseQuery).slice(0, 4)
  const playedSuggestions = filterCourses(courseQuery, courses.slice(0, 6))
  const dreamSuggestions = filterCourses(dreamQuery, courses.slice(4))
  const currentPair = rankPairs[rankIndex]
  const leftRankCourse = courses.find((course) => course.id === currentPair?.[0]) ?? courses[1]
  const rightRankCourse = courses.find((course) => course.id === currentPair?.[1]) ?? courses[3]

  function patchDraft(patch: Partial<OnboardingDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function next() {
    setError(null)
    if (step === 'home') setCourseQuery('')
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function back() {
    setError(null)
    setStepIndex((current) => Math.max(current - 1, 0))
  }

  function toggleList(field: 'playedCourseIds' | 'dreamCourseIds' | 'preferences', value: string) {
    setDraft((current) => {
      const selected = current[field]
      return {
        ...current,
        [field]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
      }
    })
  }

  function chooseRankWinner(courseId: string) {
    patchDraft({ favoriteWins: [...draft.favoriteWins, courseId] })
    if (rankIndex >= Math.min(rankPairs.length, 3) - 1) {
      next()
      return
    }
    setRankIndex((current) => current + 1)
  }

  async function finish(destination: 'home' | 'profile') {
    setSaving(true)
    setError(null)
    try {
      await submit(toPreferences(draft))
      await SecureStore.deleteItemAsync(DRAFT_KEY)
      onComplete(destination)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save preferences. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.shell}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={stepIndex === 0 ? onExit : back}
          style={({ pressed }) => [styles.backButton, stepIndex === 0 && !onExit && styles.hiddenButton, pressed && styles.softPressed]}
        >
          <Feather name="arrow-left" size={22} color="#173D30" />
        </Pressable>
        <View style={styles.progressSegments}>
          {steps.slice(0, -1).map((item, index) => (
            <View key={item} style={[styles.progressSegment, index <= stepIndex && styles.progressSegmentActive]} />
          ))}
        </View>
        <View style={styles.topBarSpacer} />
      </View>

      <Animated.View style={[styles.card, { opacity, transform: [{ translateX }] }]}>
        {step === 'profile' ? (
          <ProfileStep draft={draft} onChange={patchDraft} onNext={next} saveProfile={saveProfile} />
        ) : step === 'home' ? (
          <HomeCourseStep
            draft={draft}
            suggestions={homeSuggestions}
            onChange={patchDraft}
            onNext={next}
            onQuery={setCourseQuery}
          />
        ) : step === 'played' ? (
          <PlayedCoursesStep
            query={courseQuery}
            selectedIds={draft.playedCourseIds}
            suggestions={playedSuggestions}
            onQuery={setCourseQuery}
            onToggle={(courseId) => toggleList('playedCourseIds', courseId)}
            onNext={next}
          />
        ) : step === 'rank' ? (
          <RankStep
            current={rankIndex}
            total={Math.min(rankPairs.length, 3)}
            left={leftRankCourse}
            right={rightRankCourse}
            onChoose={chooseRankWinner}
            onSkip={next}
          />
        ) : step === 'dreams' ? (
          <DreamCoursesStep
            query={dreamQuery}
            selectedIds={draft.dreamCourseIds}
            suggestions={dreamSuggestions}
            onQuery={setDreamQuery}
            onToggle={(courseId) => toggleList('dreamCourseIds', courseId)}
            onNext={next}
            onSkip={next}
          />
        ) : step === 'friends' ? (
          <FriendsStep draft={draft} onChange={patchDraft} onNext={next} onSkip={next} />
        ) : step === 'preferences' ? (
          <PreferenceStep selected={draft.preferences} onToggle={(value) => toggleList('preferences', value)} onNext={next} />
        ) : step === 'planning' ? (
          <PlanningStep draft={draft} onChange={patchDraft} onNext={next} />
        ) : step === 'notifications' ? (
          <NotificationsStep onAllow={() => { patchDraft({ notifications: true }); next() }} onSkip={() => { patchDraft({ notifications: false }); next() }} />
        ) : (
          <SuccessStep
            draft={draft}
            recommendation={selectedCourse([...draft.dreamCourseIds, ...draft.playedCourseIds])}
            playedCount={playedCourses.length}
            saving={saving}
            onExploreHome={() => finish('home')}
            onViewProfile={() => finish('profile')}
          />
        )}
      </Animated.View>

      {error ? (
        <Text accessibilityRole="alert" selectable style={styles.errorText}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

function ProfileStep({
  draft,
  onChange,
  onNext,
  saveProfile,
}: {
  draft: OnboardingDraft
  onChange: (patch: Partial<OnboardingDraft>) => void
  onNext: () => void
  saveProfile?: (profile: { firstName: string; lastName: string; username: string }) => Promise<void>
}) {
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const disabled = draft.firstName.trim().length < 2 || draft.lastName.trim().length < 2 || draft.username.trim().length < 2 || savingProfile

  async function continueWithProfile() {
    setSavingProfile(true)
    setProfileError(null)
    try {
      await saveProfile?.({
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        username: draft.username.trim(),
      })
      onNext()
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Unable to save your profile. Please try again.')
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <View style={styles.step}>
      <Heading title="Build Your Profile" subtitle="Add a few details to get started." />
      <View style={styles.previewCard}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange({ profilePhotoAdded: true })}
          style={styles.avatarLarge}
        >
          <Text style={styles.avatarLargeText}>{draft.profilePhotoAdded ? initials(`${draft.firstName} ${draft.lastName}`) : '+'}</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.previewName}>{`${draft.firstName} ${draft.lastName}`.trim() || 'Your name'}</Text>
          <Text style={styles.previewMeta}>@{draft.username || 'username'} / {draft.playedCourseIds.length} courses</Text>
        </View>
      </View>
      <Field label="First Name" value={draft.firstName} onChangeText={(firstName) => onChange({ firstName })} placeholder="Rohan" />
      <Field label="Last Name" value={draft.lastName} onChangeText={(lastName) => onChange({ lastName })} placeholder="Kohli" />
      <Field
        label="Username"
        value={draft.username}
        onChangeText={(username) => onChange({ username })}
        placeholder="rohank"
        autoCapitalize="none"
        rightIcon={draft.username.trim() ? <Ionicons name="checkmark-circle" size={20} color="#2C5F48" /> : null}
      />
      {profileError ? <Text accessibilityRole="alert" style={styles.errorText}>{profileError}</Text> : null}
      <PrimaryButton disabled={disabled} label={savingProfile ? 'Saving Profile' : 'Continue'} onPress={continueWithProfile} />
    </View>
  )
}

function HomeCourseStep({
  draft,
  suggestions,
  onChange,
  onNext,
  onQuery,
}: {
  draft: OnboardingDraft
  suggestions: CourseSeed[]
  onChange: (patch: Partial<OnboardingDraft>) => void
  onNext: () => void
  onQuery: (query: string) => void
}) {
  return (
    <View style={styles.step}>
      <Heading title="What's your home course?" subtitle="This helps us personalize your experience and find local friends." />
      <Field
        label="Home course"
        value={draft.homeCourseSearch}
        onChangeText={(homeCourseSearch) => {
          onQuery(homeCourseSearch)
          onChange({ homeCourseId: null, homeCourseSearch })
        }}
        placeholder="Search courses"
      />
      <View style={styles.listStack}>
        {suggestions.map((course) => (
          <CourseButton
            key={course.id}
            course={course}
            selected={draft.homeCourseId === course.id}
            onPress={() => onChange({ homeCourseId: course.id, homeCourseSearch: course.name })}
          />
        ))}
      </View>
      <PrimaryButton disabled={!draft.homeCourseId && draft.homeCourseSearch.trim().length < 2} label="Continue" onPress={onNext} />
    </View>
  )
}

function PlayedCoursesStep({
  query,
  selectedIds,
  suggestions,
  onQuery,
  onToggle,
  onNext,
}: {
  query: string
  selectedIds: string[]
  suggestions: CourseSeed[]
  onQuery: (query: string) => void
  onToggle: (courseId: string) => void
  onNext: () => void
}) {
  return (
    <View style={styles.step}>
      <Heading title="Which courses have you played?" subtitle="Select all that apply." />
      <Field label="Search" value={query} onChangeText={onQuery} placeholder="Search popular nearby courses" />
      <View style={styles.courseGrid}>
        {suggestions.map((course) => (
          <CourseCard key={course.id} course={course} selected={selectedIds.includes(course.id)} onPress={() => onToggle(course.id)} />
        ))}
      </View>
      <PrimaryButton label={selectedIds.length ? `Continue with ${selectedIds.length} selected` : 'Skip for now'} onPress={onNext} />
    </View>
  )
}

function RankStep({
  current,
  total,
  left,
  right,
  onChoose,
  onSkip,
}: {
  current: number
  total: number
  left: CourseSeed
  right: CourseSeed
  onChoose: (courseId: string) => void
  onSkip: () => void
}) {
  return (
    <View style={styles.step}>
      <Heading title="Which would you rather play again?" subtitle="Swipe or tap to choose." />
      <View style={styles.miniProgressTrack}>
        <View style={[styles.progressFill, { width: `${((current + 1) / total) * 100}%` }]} />
      </View>
      <CourseDuelButton course={left} onPress={() => onChoose(left.id)} />
      <Text style={styles.orText}>OR</Text>
      <CourseDuelButton course={right} onPress={() => onChoose(right.id)} />
      <InlineButton label="Skip" onPress={onSkip} />
    </View>
  )
}

function DreamCoursesStep({
  query,
  selectedIds,
  suggestions,
  onQuery,
  onToggle,
  onNext,
  onSkip,
}: {
  query: string
  selectedIds: string[]
  suggestions: CourseSeed[]
  onQuery: (query: string) => void
  onToggle: (courseId: string) => void
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <View style={styles.step}>
      <Heading title="What courses are on your bucket list?" subtitle="Save the courses you dream of playing one day." />
      <Field label="Search dream courses" value={query} onChangeText={onQuery} placeholder="Augusta, Bandon, Pinehurst" />
      <View style={styles.courseGrid}>
        {suggestions.map((course) => (
          <CourseCard key={course.id} course={course} selected={selectedIds.includes(course.id)} onPress={() => onToggle(course.id)} />
        ))}
      </View>
      <PrimaryButton label={selectedIds.length ? `Save ${selectedIds.length} dream courses` : 'Continue'} onPress={onNext} />
      <InlineButton label="Skip" onPress={onSkip} />
    </View>
  )
}

function FriendsStep({
  draft,
  onChange,
  onNext,
  onSkip,
}: {
  draft: OnboardingDraft
  onChange: (patch: Partial<OnboardingDraft>) => void
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <View style={styles.step}>
      <Heading title="Find your friends" subtitle="See where your friends play, compare scores, and rank together." />
      <View style={styles.avatarRow}>
        {['AK', 'RM', 'JL', 'SP'].map((label) => (
          <View key={label} style={styles.avatarSmall}>
            <Text style={styles.avatarSmallText}>{label}</Text>
          </View>
        ))}
      </View>
      <Field label="Search usernames" value={draft.friendSearch} onChangeText={(friendSearch) => onChange({ friendSearch })} placeholder="@username" autoCapitalize="none" />
      <SecondaryButton label="Import Contacts" onPress={onNext} />
      <SecondaryButton label="Invite Friends" onPress={onNext} />
      <InlineButton label="Skip" onPress={onSkip} />
    </View>
  )
}

function PreferenceStep({ selected, onToggle, onNext }: { selected: string[]; onToggle: (value: string) => void; onNext: () => void }) {
  return (
    <View style={styles.step}>
      <Heading title="What matters most in a golf experience?" subtitle="Select what you value most." />
      <View style={styles.chipWrap}>
        {preferenceOptions.map((option) => (
          <Chip key={option} label={option} selected={selected.includes(option)} onPress={() => onToggle(option)} />
        ))}
      </View>
      <PrimaryButton label="Continue" onPress={onNext} />
    </View>
  )
}

function PlanningStep({ draft, onChange, onNext }: { draft: OnboardingDraft; onChange: (patch: Partial<OnboardingDraft>) => void; onNext: () => void }) {
  return (
    <View style={styles.step}>
      <Heading title="Help our AI plan your perfect trips" subtitle="We'll use this to build better recommendations." />
      <Segmented label="Typical group size" options={['Solo', 'Twosome', 'Foursome']} selected={draft.groupSize} onSelect={(groupSize) => onChange({ groupSize })} />
      <Segmented label="Typical budget" options={['$', '$$', '$$$', '$$$$']} selected={draft.budget} onSelect={(budget) => onChange({ budget })} />
      <Field label="Distance willing to travel" value={draft.travelDistance} onChangeText={(travelDistance) => onChange({ travelDistance })} placeholder="Up to 45 minutes" />
      <Field label="Preferred tee time" value={draft.preferredTeeTime} onChangeText={(preferredTeeTime) => onChange({ preferredTeeTime })} placeholder="Weekend mornings" />
      <Segmented label="Transportation" options={['Walking', 'Cart', 'Either']} selected={draft.transportation} onSelect={(transportation) => onChange({ transportation })} />
      <PrimaryButton label="Continue" onPress={onNext} />
    </View>
  )
}

function NotificationsStep({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  return (
    <View style={styles.step}>
      <Heading title="Stay in the loop" subtitle="Get notified about your friends, tee times, and course updates." />
      {['Know when friends play nearby.', 'Get alerted when bucket list courses become available.', 'Receive AI weekend trip ideas.'].map((item) => (
        <View key={item} style={styles.valueRow}>
          <Text style={styles.checkMark}>OK</Text>
          <Text style={styles.valueText}>{item}</Text>
        </View>
      ))}
      <PrimaryButton label="Enable Notifications" onPress={onAllow} />
      <InlineButton label="Skip" onPress={onSkip} />
    </View>
  )
}

function SuccessStep({
  draft,
  recommendation,
  playedCount,
  saving,
  onExploreHome,
  onViewProfile,
}: {
  draft: OnboardingDraft
  recommendation: CourseSeed
  playedCount: number
  saving: boolean
  onExploreHome: () => void
  onViewProfile: () => void
}) {
  return (
    <View style={styles.step}>
      <Heading title="You're all set!" subtitle="Here's what we've built for you." />
      <View style={styles.summaryCard}>
        <SummaryLine text={`${playedCount} courses played`} />
        <SummaryLine text={`${draft.dreamCourseIds.length} dream courses saved`} />
        <SummaryLine text={draft.homeCourseId ? 'Home course selected' : 'Home region saved'} />
        <SummaryLine text="AI recommendations ready" />
        <SummaryLine text={draft.friendSearch ? 'Friends search queued' : 'Friends waiting'} />
      </View>
      <CourseCard course={recommendation} selected={false} onPress={() => undefined} />
      <PrimaryButton disabled={saving} label={saving ? 'Saving profile' : 'Explore Home'} onPress={onExploreHome} />
      <InlineButton disabled={saving} label="Go to My Profile" onPress={onViewProfile} />
    </View>
  )
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.heading}>
      <Text selectable style={styles.title}>{title}</Text>
      <Text selectable style={styles.subtitle}>{subtitle}</Text>
    </View>
  )
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'words',
  rightIcon,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder: string
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  rightIcon?: ReactNode
}) {
  return (
    <View style={styles.field}>
      <Text selectable style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#8B948D"
          style={[styles.input, rightIcon ? styles.inputWithIcon : null]}
          value={value}
        />
        {rightIcon ? <View pointerEvents="none" style={styles.fieldRightIcon}>{rightIcon}</View> : null}
      </View>
    </View>
  )
}

function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, disabled && styles.disabledButton, pressed && !disabled && styles.primaryPressed]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  )
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.secondaryButton, pressed && styles.softPressed]}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  )
}

function InlineButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={[styles.inlineButton, disabled && styles.disabledButton]}
    >
      <Text style={styles.inlineText}>{label}</Text>
    </Pressable>
  )
}

function CourseButton({ course, selected, onPress }: { course: CourseSeed; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${course.name} ${course.location}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.courseButton, selected && styles.selectedBorder, pressed && styles.softPressed]}
    >
      <View style={[styles.courseThumb, { backgroundColor: course.imageTone }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.courseName}>{course.name}</Text>
        <Text style={styles.courseLocation}>{course.location}</Text>
      </View>
    </Pressable>
  )
}

function CourseCard({ course, selected, onPress }: { course: CourseSeed; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${course.name} ${course.location}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.courseCard, selected && styles.selectedCard, pressed && styles.softPressed]}
    >
      <View style={[styles.courseImage, { backgroundColor: course.imageTone }]}>
        <Text style={styles.courseImageText}>{course.meta}</Text>
      </View>
      <Text style={styles.courseCardName}>{course.name}</Text>
      <Text style={styles.courseLocation}>{course.location}</Text>
    </Pressable>
  )
}

function CourseDuelButton({ course, onPress }: { course: CourseSeed; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`Choose ${course.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.duelButton, pressed && styles.softPressed]}
    >
      <View style={[styles.duelImage, { backgroundColor: course.imageTone }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.duelName}>{course.name}</Text>
        <Text style={styles.courseLocation}>{course.location}</Text>
      </View>
    </Pressable>
  )
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selectedChip, pressed && styles.softPressed]}
    >
      <Text style={[styles.chipText, selected && styles.selectedChipText]}>{label}</Text>
    </Pressable>
  )
}

function Segmented<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string
  options: readonly T[]
  selected: T | null
  onSelect: (option: T) => void
}) {
  return (
    <View style={styles.field}>
      <Text selectable style={styles.fieldLabel}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((option) => {
          const active = selected === option
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(option)}
              style={[styles.segment, active && styles.selectedSegment]}
            >
              <Text style={[styles.segmentText, active && styles.selectedSegmentText]}>{option}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function SummaryLine({ text }: { text: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.checkMark}>OK</Text>
      <Text style={styles.summaryText}>{text}</Text>
    </View>
  )
}

function initials(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return letters || '+'
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    gap: 12,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 48,
    paddingTop: 4,
  },
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  hiddenButton: {
    opacity: 0,
  },
  topBarSpacer: {
    width: 36,
  },
  progressSegments: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  progressSegment: {
    backgroundColor: '#D9DAD7',
    borderRadius: 99,
    height: 4,
    maxWidth: 34,
    width: '8%',
  },
  progressSegmentActive: {
    backgroundColor: '#214D3B',
  },
  progressTrack: {
    backgroundColor: '#E5EAE5',
    borderRadius: 999,
    flex: 1,
    height: 8,
    overflow: 'hidden',
  },
  miniProgressTrack: {
    backgroundColor: '#E5EAE5',
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#214D3B',
    borderRadius: 999,
    height: '100%',
  },
  progressText: {
    color: '#66736B',
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    flex: 1,
    paddingBottom: 8,
    paddingTop: 4,
  },
  step: {
    flex: 1,
    gap: 14,
  },
  heading: {
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
    paddingHorizontal: 14,
  },
  title: {
    color: '#173D30',
    fontFamily: 'Georgia',
    fontSize: 25,
    fontWeight: '700',
    lineHeight: 28,
    textAlign: 'center',
  },
  subtitle: {
    color: '#5E625F',
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 300,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#214D3B',
    borderRadius: 999,
    marginTop: 'auto',
    minHeight: 50,
    justifyContent: 'center',
    paddingVertical: 13,
  },
  primaryPressed: {
    backgroundColor: '#183C2D',
    transform: [{ scale: 0.99 }],
  },
  disabledButton: {
    backgroundColor: '#C8D1CB',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#EEF2EE',
    borderColor: '#DDE5DF',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
  },
  secondaryText: {
    color: '#102015',
    fontSize: 16,
    fontWeight: '800',
  },
  inlineButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  inlineText: {
    color: '#214D3B',
    fontSize: 15,
    fontWeight: '800',
  },
  previewCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E7ECE8',
    borderRadius: 70,
    borderWidth: 0,
    flexDirection: 'column',
    gap: 14,
    padding: 4,
  },
  avatarLarge: {
    alignItems: 'center',
    backgroundColor: '#EAF0EC',
    borderRadius: 48,
    height: 92,
    justifyContent: 'center',
    width: 92,
  },
  avatarLargeText: {
    color: '#214D3B',
    fontSize: 20,
    fontWeight: '900',
  },
  previewName: {
    color: '#102015',
    display: 'none',
    fontSize: 18,
    fontWeight: '800',
  },
  previewMeta: {
    color: '#68746D',
    display: 'none',
    fontSize: 14,
    marginTop: 4,
  },
  field: {
    gap: 5,
  },
  fieldLabel: {
    color: '#25352B',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 14,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE5DF',
    borderRadius: 14,
    borderWidth: 1,
    color: '#102015',
    fontSize: 14,
    paddingHorizontal: 16,
    minHeight: 50,
    paddingVertical: 12,
  },
  inputWrap: {
    position: 'relative',
  },
  inputWithIcon: {
    paddingRight: 46,
  },
  fieldRightIcon: {
    position: 'absolute',
    right: 15,
    top: 15,
  },
  listStack: {
    gap: 10,
  },
  courseButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E7E2',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 66,
    padding: 8,
  },
  courseThumb: {
    borderRadius: 14,
    height: 54,
    width: 64,
  },
  courseName: {
    color: '#102015',
    fontSize: 15,
    fontWeight: '800',
  },
  courseLocation: {
    color: '#66736B',
    fontSize: 13,
    marginTop: 4,
  },
  courseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  courseCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E7E2',
    borderRadius: 13,
    borderWidth: 1,
    padding: 7,
    width: '48%',
  },
  selectedCard: {
    backgroundColor: '#F0F6F1',
    borderColor: '#214D3B',
  },
  selectedBorder: {
    borderColor: '#214D3B',
    borderWidth: 2,
  },
  courseImage: {
    borderRadius: 9,
    height: 78,
    justifyContent: 'flex-end',
    marginBottom: 10,
    overflow: 'hidden',
    padding: 10,
  },
  courseImageText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  courseCardName: {
    color: '#102015',
    fontSize: 14,
    fontWeight: '800',
  },
  duelButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E7E2',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'column',
    gap: 14,
    padding: 12,
  },
  duelImage: {
    borderRadius: 12,
    height: 230,
    width: '100%',
  },
  duelName: {
    color: '#102015',
    fontSize: 15,
    fontWeight: '900',
  },
  orText: {
    color: '#7A837D',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  avatarRow: {
    flexDirection: 'row',
    paddingVertical: 8,
  },
  avatarSmall: {
    alignItems: 'center',
    backgroundColor: '#214D3B',
    borderColor: '#FBFAF7',
    borderRadius: 24,
    borderWidth: 2,
    height: 48,
    justifyContent: 'center',
    marginRight: -8,
    width: 48,
  },
  avatarSmallText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE5DF',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  selectedChip: {
    backgroundColor: '#214D3B',
    borderColor: '#214D3B',
  },
  chipText: {
    color: '#25352B',
    fontSize: 14,
    fontWeight: '800',
  },
  selectedChipText: {
    color: '#FFFFFF',
  },
  segmented: {
    backgroundColor: '#EEF2EE',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    paddingVertical: 10,
  },
  selectedSegment: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#1B3328',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  segmentText: {
    color: '#66736B',
    fontSize: 14,
    fontWeight: '800',
  },
  selectedSegmentText: {
    color: '#102015',
  },
  valueRow: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  checkMark: {
    color: '#214D3B',
    fontSize: 16,
    fontWeight: '900',
  },
  valueText: {
    color: '#25352B',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E7E2',
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  summaryLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  summaryText: {
    color: '#25352B',
    fontSize: 15,
    fontWeight: '800',
  },
  softPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  errorText: {
    color: '#B42318',
    fontSize: 15,
    lineHeight: 21,
  },
})

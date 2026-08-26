import * as SecureStore from 'expo-secure-store'
import { Feather, Ionicons } from '@expo/vector-icons'
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { Course, OnboardingPreferences } from '../types'

type Difficulty = OnboardingPreferences['difficulty']
type Access = OnboardingPreferences['access']

type CourseOption = {
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
  courseCatalog: Record<string, CourseOption>
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
  searchCourses: (query: string) => Promise<Course[]>
  checkUsername?: (username: string) => Promise<{ available: boolean; username: string }>
  submit: (input: OnboardingPreferences) => Promise<void>
  onComplete: (destination: 'home' | 'profile') => void
  onExit?: () => void
  saveProfile?: (profile: { firstName: string; lastName: string; username: string }) => Promise<void>
}

const DRAFT_KEY = 'golfrank_onboarding_draft'
const COURSE_SEARCH_MIN_CHARS = 3
const COURSE_TONES = ['#8EA58D', '#78918E', '#546C5A', '#6D8FA0', '#A28E6D', '#8A9368', '#4C7A4D', '#7F8A75', '#668187', '#B0976A']

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
  courseCatalog: {},
}

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

function courseOptionFromApi(course: Course): CourseOption {
  const city = course.city?.trim() || ''
  const region = course.admin1_code?.trim() || course.region?.trim() || ''
  const location = [city, region].filter(Boolean).join(', ') || course.region
  return {
    id: String(course.id),
    name: course.name,
    location,
    city: city || course.region,
    region: region || course.region,
    imageTone: COURSE_TONES[Math.abs(course.id) % COURSE_TONES.length],
    meta: course.difficulty ?? course.access ?? 'Course',
  }
}

function homeRegionForCourse(course: CourseOption | null, fallbackSearch: string) {
  if (!course) return fallbackSearch.trim()
  const city = course.city.trim()
  const region = course.region.trim()
  if (city && region && city !== region) return `${city}, ${region}`
  return city || region || fallbackSearch.trim()
}

function buildRankPairs(playedCourseIds: string[]): [string, string][] {
  const pairs: [string, string][] = []
  for (let index = 0; index + 1 < playedCourseIds.length && pairs.length < 3; index += 2) {
    pairs.push([playedCourseIds[index], playedCourseIds[index + 1]])
  }
  return pairs
}

function selectedCourse(ids: string[], catalog: Record<string, CourseOption>, fallback: CourseOption | null = null) {
  return ids.map((id) => catalog[id]).find(Boolean) ?? fallback
}

function toPreferences(draft: OnboardingDraft): OnboardingPreferences {
  const homeCourse = draft.homeCourseId ? draft.courseCatalog[draft.homeCourseId] ?? null : null
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
    home_region: homeRegionForCourse(homeCourse, draft.homeCourseSearch),
    max_green_fee: maxGreenFee,
    onboarding_data: {
      first_name: draft.firstName.trim(),
      last_name: draft.lastName.trim(),
      username: draft.username.trim().replace(/^@+/, '').toLowerCase(),
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

function useCourseSearch(searchCourses: (query: string) => Promise<Course[]>, query: string) {
  const [results, setResults] = useState<CourseOption[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const requestId = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    requestId.current += 1
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    requestId.current += 1
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (trimmed.length < COURSE_SEARCH_MIN_CHARS) {
      setResults([])
      setSearching(false)
      setSearchError(null)
      return
    }

    const currentRequest = requestId.current
    timer.current = setTimeout(() => {
      void (async () => {
        setSearching(true)
        setSearchError(null)
        try {
          const courses = await searchCourses(trimmed)
          if (currentRequest !== requestId.current) return
          setResults(courses.map(courseOptionFromApi))
        } catch (reason) {
          if (currentRequest !== requestId.current) return
          setResults([])
          setSearchError(reason instanceof Error ? reason.message : 'Unable to search courses.')
        } finally {
          if (currentRequest === requestId.current) setSearching(false)
        }
      })()
    }, 300)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, searchCourses])

  return { results, searching, searchError }
}

export function OnboardingForm({ searchCourses, checkUsername, submit, onComplete, onExit, saveProfile }: OnboardingFormProps) {
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
  const rankPairs = useMemo(() => buildRankPairs(draft.playedCourseIds), [draft.playedCourseIds])
  const homeSearch = useCourseSearch(searchCourses, draft.homeCourseSearch || courseQuery)
  const playedSearch = useCourseSearch(searchCourses, courseQuery)
  const dreamSearch = useCourseSearch(searchCourses, dreamQuery)

  useEffect(() => {
    SecureStore.getItemAsync(DRAFT_KEY)
      .then((stored) => {
        if (!stored) return
        const parsed = JSON.parse(stored) as Partial<OnboardingDraft> & { draftVersion?: number; name?: string; stepIndex?: number; rankIndex?: number }
        const [legacyFirstName = '', ...legacyLastNameParts] = parsed.name?.trim().split(/\s+/) ?? []
        const courseCatalog = parsed.courseCatalog ?? {}
        // Older drafts can carry course ids with no matching catalog entry (catalog
        // wasn't persisted yet, or the shape changed) — drop those so downstream steps
        // never look up an undefined course and dead-end.
        const playedCourseIds = (parsed.playedCourseIds ?? initialDraft.playedCourseIds).filter((id) => courseCatalog[id])
        const dreamCourseIds = (parsed.dreamCourseIds ?? initialDraft.dreamCourseIds).filter((id) => courseCatalog[id])
        const favoriteWins = (parsed.favoriteWins ?? initialDraft.favoriteWins).filter((id) => courseCatalog[id])
        const homeCourseId = parsed.homeCourseId && courseCatalog[parsed.homeCourseId] ? parsed.homeCourseId : null
        setDraft({
          ...initialDraft,
          ...parsed,
          firstName: parsed.firstName ?? legacyFirstName,
          lastName: parsed.lastName ?? legacyLastNameParts.join(' '),
          courseCatalog,
          playedCourseIds,
          dreamCourseIds,
          favoriteWins,
          homeCourseId,
        })
        if (typeof parsed.stepIndex === 'number') {
          const migratedStepIndex = parsed.draftVersion && parsed.draftVersion >= 2 ? parsed.stepIndex : Math.max(parsed.stepIndex - 2, 0)
          setStepIndex(Math.min(migratedStepIndex, steps.length - 1))
        }
        if (typeof parsed.rankIndex === 'number') setRankIndex(parsed.rankIndex)
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
    SecureStore.setItemAsync(DRAFT_KEY, JSON.stringify({ ...draft, draftVersion: 4, rankIndex, stepIndex })).catch(() => undefined)
  }, [draft, hydrated, rankIndex, stepIndex])

  useEffect(() => {
    if (step !== 'rank') return
    if (rankPairs.length === 0) {
      setStepIndex((current) => Math.min(current + 1, steps.length - 1))
      return
    }
    if (rankIndex >= rankPairs.length) setRankIndex(0)
  }, [rankIndex, rankPairs.length, step])

  const playedCourses = useMemo(
    () => draft.playedCourseIds.map((id) => draft.courseCatalog[id]).filter(Boolean) as CourseOption[],
    [draft.courseCatalog, draft.playedCourseIds],
  )
  const currentPair = rankPairs[rankIndex]
  const leftRankCourse = currentPair ? draft.courseCatalog[currentPair[0]] : null
  const rightRankCourse = currentPair ? draft.courseCatalog[currentPair[1]] : null
  const recommendation = selectedCourse(
    [...draft.dreamCourseIds, ...draft.playedCourseIds],
    draft.courseCatalog,
    draft.homeCourseId ? draft.courseCatalog[draft.homeCourseId] ?? null : null,
  )

  function patchDraft(patch: Partial<OnboardingDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function rememberCourses(courses: CourseOption[]) {
    setDraft((current) => {
      const courseCatalog = { ...current.courseCatalog }
      for (const course of courses) courseCatalog[course.id] = course
      return { ...current, courseCatalog }
    })
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

  function chooseCourse(course: CourseOption, mode: 'home' | 'played' | 'dream') {
    rememberCourses([course])
    if (mode === 'home') {
      patchDraft({ homeCourseId: course.id, homeCourseSearch: course.name })
      return
    }
    toggleList(mode === 'played' ? 'playedCourseIds' : 'dreamCourseIds', course.id)
  }

  function chooseRankWinner(courseId: string) {
    // Write at the current pair index so going back and re-answering replaces
    // stale wins instead of appending (seeding reads wins[i] for pair i).
    patchDraft({ favoriteWins: [...draft.favoriteWins.slice(0, rankIndex), courseId] })
    if (rankIndex >= rankPairs.length - 1) {
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
      const status = (reason as { status?: number })?.status
      const message = reason instanceof Error ? reason.message : 'Unable to save preferences. Please try again.'
      if (status === 409) {
        // Backend uniqueness only runs at final submit, after Clerk's username was
        // already claimed at the profile step — send the user back to pick a new one
        // instead of leaving them stuck at the end of onboarding.
        usernameAvailabilityCache.delete(normalizeUsernameInput(draft.username))
        setStepIndex(steps.indexOf('profile'))
        setError(message)
        return
      }
      setError(message)
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
          <ProfileStep draft={draft} onChange={patchDraft} onNext={next} saveProfile={saveProfile} checkUsername={checkUsername} />
        ) : step === 'home' ? (
          <HomeCourseStep
            draft={draft}
            searching={homeSearch.searching}
            searchError={homeSearch.searchError}
            suggestions={homeSearch.results.slice(0, 6)}
            onChange={patchDraft}
            onNext={next}
            onQuery={setCourseQuery}
            onSelect={(course) => chooseCourse(course, 'home')}
          />
        ) : step === 'played' ? (
          <PlayedCoursesStep
            catalog={draft.courseCatalog}
            query={courseQuery}
            searching={playedSearch.searching}
            searchError={playedSearch.searchError}
            selectedIds={draft.playedCourseIds}
            suggestions={playedSearch.results.slice(0, 8)}
            onQuery={setCourseQuery}
            onSelect={(course) => chooseCourse(course, 'played')}
            onNext={next}
          />
        ) : step === 'rank' && leftRankCourse && rightRankCourse ? (
          <RankStep
            current={rankIndex}
            total={rankPairs.length}
            left={leftRankCourse}
            right={rightRankCourse}
            onChoose={chooseRankWinner}
            onSkip={next}
          />
        ) : step === 'dreams' ? (
          <DreamCoursesStep
            catalog={draft.courseCatalog}
            query={dreamQuery}
            searching={dreamSearch.searching}
            searchError={dreamSearch.searchError}
            selectedIds={draft.dreamCourseIds}
            suggestions={dreamSearch.results.slice(0, 8)}
            onQuery={setDreamQuery}
            onSelect={(course) => chooseCourse(course, 'dream')}
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
        ) : step === 'success' ? (
          <SuccessStep
            draft={draft}
            recommendation={recommendation}
            playedCount={playedCourses.length}
            saving={saving}
            onExploreHome={() => finish('home')}
            onViewProfile={() => finish('profile')}
          />
        ) : null}
      </Animated.View>

      {error ? (
        <Text accessibilityRole="alert" selectable style={styles.errorText}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const USERNAME_CHECK_DEBOUNCE_MS = 550
const usernameAvailabilityCache = new Map<string, boolean>()

function ProfileStep({
  draft,
  onChange,
  onNext,
  saveProfile,
  checkUsername,
}: {
  draft: OnboardingDraft
  onChange: (patch: Partial<OnboardingDraft>) => void
  onNext: () => void
  saveProfile?: (profile: { firstName: string; lastName: string; username: string }) => Promise<void>
  checkUsername?: (username: string) => Promise<{ available: boolean; username: string }>
}) {
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const usernameRequest = useRef(0)
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightUsername = useRef<string | null>(null)
  const normalizedUsername = normalizeUsernameInput(draft.username)
  const checkUsernameRef = useRef(checkUsername)
  checkUsernameRef.current = checkUsername
  const disabled =
    draft.firstName.trim().length < 2
    || draft.lastName.trim().length < 2
    || normalizedUsername.length < 2
    || savingProfile
    || usernameStatus === 'taken'
    || usernameStatus === 'invalid'

  useEffect(() => () => {
    if (usernameTimer.current) clearTimeout(usernameTimer.current)
    usernameRequest.current += 1
  }, [])

  useEffect(() => {
    const check = checkUsernameRef.current
    if (!check) {
      setUsernameStatus(normalizedUsername.length >= 2 ? 'available' : 'idle')
      return
    }
    usernameRequest.current += 1
    if (usernameTimer.current) clearTimeout(usernameTimer.current)
    if (normalizedUsername.length < 2) {
      setUsernameStatus('idle')
      return
    }
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      setUsernameStatus('invalid')
      return
    }
    const cached = usernameAvailabilityCache.get(normalizedUsername)
    if (cached !== undefined) {
      setUsernameStatus(cached ? 'available' : 'taken')
      return
    }
    const request = usernameRequest.current
    // Keep prior status until debounce fires so brief typing pauses don't flicker/check.
    usernameTimer.current = setTimeout(() => {
      if (request !== usernameRequest.current) return
      if (inFlightUsername.current === normalizedUsername) return
      const freshCache = usernameAvailabilityCache.get(normalizedUsername)
      if (freshCache !== undefined) {
        setUsernameStatus(freshCache ? 'available' : 'taken')
        return
      }
      setUsernameStatus('checking')
      inFlightUsername.current = normalizedUsername
      void (async () => {
        try {
          const result = await check(normalizedUsername)
          usernameAvailabilityCache.set(result.username, result.available)
          if (request !== usernameRequest.current) return
          setUsernameStatus(result.available ? 'available' : 'taken')
        } catch (reason) {
          if (request !== usernameRequest.current) return
          // Allow Continue; continueWithProfile always re-checks and surfaces the error.
          setUsernameStatus('idle')
          setProfileError(reason instanceof Error ? reason.message : 'Unable to check that username.')
        } finally {
          if (inFlightUsername.current === normalizedUsername) inFlightUsername.current = null
        }
      })()
    }, USERNAME_CHECK_DEBOUNCE_MS)
  }, [normalizedUsername])

  async function continueWithProfile() {
    setSavingProfile(true)
    setProfileError(null)
    try {
      const check = checkUsernameRef.current
      if (check) {
        // Always revalidate on Continue — a cached "available" can go stale.
        const result = await check(normalizedUsername)
        usernameAvailabilityCache.set(result.username, result.available)
        if (!result.available) {
          setUsernameStatus('taken')
          setProfileError('That username is already taken.')
          return
        }
        setUsernameStatus('available')
      }
      onChange({ username: normalizedUsername })
      await saveProfile?.({
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        username: normalizedUsername,
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
          <Text style={styles.previewMeta}>@{normalizedUsername || 'username'} / {draft.playedCourseIds.length} courses</Text>
        </View>
      </View>
      <Field label="First Name" value={draft.firstName} onChangeText={(firstName) => onChange({ firstName })} placeholder="Rohan" />
      <Field label="Last Name" value={draft.lastName} onChangeText={(lastName) => onChange({ lastName })} placeholder="Kohli" />
      <Field
        label="Username"
        value={draft.username}
        onChangeText={(username) => {
          setProfileError(null)
          onChange({ username })
        }}
        placeholder="rohank"
        autoCapitalize="none"
        rightIcon={
          usernameStatus === 'checking' ? <ActivityIndicator color="#2C5F48" />
            : usernameStatus === 'available' ? <Ionicons name="checkmark-circle" size={20} color="#2C5F48" />
              : usernameStatus === 'taken' || usernameStatus === 'invalid' ? <Ionicons name="close-circle" size={20} color="#B42318" />
                : null
        }
      />
      {usernameStatus === 'taken' ? <Text accessibilityRole="alert" style={styles.errorText}>That username is already taken.</Text> : null}
      {usernameStatus === 'invalid' ? <Text accessibilityRole="alert" style={styles.errorText}>Use 2-64 letters, numbers, or underscores.</Text> : null}
      {profileError ? <Text accessibilityRole="alert" style={styles.errorText}>{profileError}</Text> : null}
      <PrimaryButton disabled={disabled} label={savingProfile ? 'Saving Profile' : 'Continue'} onPress={continueWithProfile} />
    </View>
  )
}

const USERNAME_PATTERN = /^[a-z0-9_]{2,64}$/

function normalizeUsernameInput(value: string) {
  return value.trim().replace(/^@+/, '').toLowerCase()
}

function HomeCourseStep({
  draft,
  searching,
  searchError,
  suggestions,
  onChange,
  onNext,
  onQuery,
  onSelect,
}: {
  draft: OnboardingDraft
  searching: boolean
  searchError: string | null
  suggestions: CourseOption[]
  onChange: (patch: Partial<OnboardingDraft>) => void
  onNext: () => void
  onQuery: (query: string) => void
  onSelect: (course: CourseOption) => void
}) {
  return (
    <View style={styles.step}>
      <Heading title="What's your home course?" subtitle="Search the catalog so we can personalize local friends and recommendations." />
      <Field
        label="Home course"
        value={draft.homeCourseSearch}
        onChangeText={(homeCourseSearch) => {
          onQuery(homeCourseSearch)
          onChange({ homeCourseId: null, homeCourseSearch })
        }}
        placeholder="Search courses"
      />
      <CourseSearchStatus
        searching={searching}
        searchError={searchError}
        query={draft.homeCourseSearch}
        emptyLabel="Type at least 3 characters to search the course catalog."
        noResultsLabel="No courses matched that search."
        resultCount={suggestions.length}
      />
      <View style={styles.listStack}>
        {suggestions.map((course) => (
          <CourseButton
            key={course.id}
            course={course}
            selected={draft.homeCourseId === course.id}
            onPress={() => onSelect(course)}
          />
        ))}
      </View>
      <PrimaryButton disabled={!draft.homeCourseId && draft.homeCourseSearch.trim().length < 2} label="Continue" onPress={onNext} />
    </View>
  )
}

function PlayedCoursesStep({
  catalog,
  query,
  searching,
  searchError,
  selectedIds,
  suggestions,
  onQuery,
  onSelect,
  onNext,
}: {
  catalog: Record<string, CourseOption>
  query: string
  searching: boolean
  searchError: string | null
  selectedIds: string[]
  suggestions: CourseOption[]
  onQuery: (query: string) => void
  onSelect: (course: CourseOption) => void
  onNext: () => void
}) {
  const selectedCourses = selectedIds.map((id) => catalog[id]).filter(Boolean) as CourseOption[]
  const suggestionIds = new Set(suggestions.map((course) => course.id))
  const visibleCourses = [
    ...selectedCourses.filter((course) => !suggestionIds.has(course.id)),
    ...suggestions,
  ]

  return (
    <View style={styles.step}>
      <Heading title="Which courses have you played?" subtitle="Search and select courses from the catalog." />
      <Field label="Search" value={query} onChangeText={onQuery} placeholder="Search courses you've played" />
      <CourseSearchStatus
        searching={searching}
        searchError={searchError}
        query={query}
        emptyLabel="Type at least 3 characters to find courses you've played."
        noResultsLabel="No courses matched that search."
        resultCount={suggestions.length}
      />
      <View style={styles.courseGrid}>
        {visibleCourses.map((course) => (
          <CourseCard key={course.id} course={course} selected={selectedIds.includes(course.id)} onPress={() => onSelect(course)} />
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
  left: CourseOption
  right: CourseOption
  onChoose: (courseId: string) => void
  onSkip: () => void
}) {
  return (
    <View style={styles.step}>
      <Heading title="Which would you rather play again?" subtitle="Choose between courses you've played." />
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
  catalog,
  query,
  searching,
  searchError,
  selectedIds,
  suggestions,
  onQuery,
  onSelect,
  onNext,
  onSkip,
}: {
  catalog: Record<string, CourseOption>
  query: string
  searching: boolean
  searchError: string | null
  selectedIds: string[]
  suggestions: CourseOption[]
  onQuery: (query: string) => void
  onSelect: (course: CourseOption) => void
  onNext: () => void
  onSkip: () => void
}) {
  const selectedCourses = selectedIds.map((id) => catalog[id]).filter(Boolean) as CourseOption[]
  const suggestionIds = new Set(suggestions.map((course) => course.id))
  const visibleCourses = [
    ...selectedCourses.filter((course) => !suggestionIds.has(course.id)),
    ...suggestions,
  ]

  return (
    <View style={styles.step}>
      <Heading title="What courses are on your bucket list?" subtitle="Search the catalog for courses you dream of playing." />
      <Field label="Search dream courses" value={query} onChangeText={onQuery} placeholder="Augusta, Bandon, Pinehurst" />
      <CourseSearchStatus
        searching={searching}
        searchError={searchError}
        query={query}
        emptyLabel="Type at least 3 characters to search dream courses."
        noResultsLabel="No courses matched that search."
        resultCount={suggestions.length}
      />
      <View style={styles.courseGrid}>
        {visibleCourses.map((course) => (
          <CourseCard key={course.id} course={course} selected={selectedIds.includes(course.id)} onPress={() => onSelect(course)} />
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
  recommendation: CourseOption | null
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
      {recommendation ? <CourseCard course={recommendation} selected={false} onPress={() => undefined} /> : null}
      <PrimaryButton disabled={saving} label={saving ? 'Saving profile' : 'Explore Home'} onPress={onExploreHome} />
      <InlineButton disabled={saving} label="Go to My Profile" onPress={onViewProfile} />
    </View>
  )
}

function CourseSearchStatus({
  searching,
  searchError,
  query,
  emptyLabel,
  noResultsLabel,
  resultCount,
}: {
  searching: boolean
  searchError: string | null
  query: string
  emptyLabel: string
  noResultsLabel: string
  resultCount: number
}) {
  if (searching) {
    return (
      <View style={styles.searchStatusRow}>
        <ActivityIndicator accessibilityLabel="Searching courses" color="#214D3B" />
        <Text style={styles.searchStatusText}>Searching courses…</Text>
      </View>
    )
  }
  if (searchError) {
    return <Text accessibilityRole="alert" style={styles.errorText}>{searchError}</Text>
  }
  if (query.trim().length < COURSE_SEARCH_MIN_CHARS) {
    return <Text style={styles.searchStatusText}>{emptyLabel}</Text>
  }
  if (resultCount === 0) {
    return <Text style={styles.searchStatusText}>{noResultsLabel}</Text>
  }
  return null
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

function CourseButton({ course, selected, onPress }: { course: CourseOption; selected: boolean; onPress: () => void }) {
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

function CourseCard({ course, selected, onPress }: { course: CourseOption; selected: boolean; onPress: () => void }) {
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

function CourseDuelButton({ course, onPress }: { course: CourseOption; onPress: () => void }) {
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
  searchStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  searchStatusText: {
    color: '#66736B',
    fontSize: 14,
    lineHeight: 20,
  },
})

import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { getCourseRegions, getProfile, searchCourses, submitCourseCandidate } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { BottomNav, DemoCourseRow, ProductScreen, ScreenHeader, SectionTitle } from '../src/components/ProductUI'
import { DemoCourse, demoCourses } from '../src/data/demo'
import { DEFAULT_COURSE_REGION, resolveCurrentLocation } from '../src/location/currentRegion'
import { loadSavedRegion, saveRegion } from '../src/location/regionPreference'
import { Course, CourseRegion } from '../src/types'
import { colors } from '../src/ui/theme'

type AccessFilter = 'any' | 'public' | 'private'
type DifficultyFilter = 'any' | 'beginner' | 'intermediate' | 'challenging'

export default function Discover() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [query, setQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [region, setRegion] = useState(DEFAULT_COURSE_REGION)
  const [homeRegion, setHomeRegion] = useState(DEFAULT_COURSE_REGION)
  const [regionReady, setRegionReady] = useState(false)
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null)
  const [radiusMiles, setRadiusMiles] = useState(50)
  const [access, setAccess] = useState<AccessFilter>('any')
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('any')
  const [maxGreenFee, setMaxGreenFee] = useState<number | undefined>()
  const [courses, setCourses] = useState<Course[]>([])
  const [regions, setRegions] = useState<CourseRegion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [missingOpen, setMissingOpen] = useState(false)
  const [missingName, setMissingName] = useState('')
  const [missingCity, setMissingCity] = useState('')
  const [missingNotes, setMissingNotes] = useState('')
  const [missingStatus, setMissingStatus] = useState<string | null>(null)
  const locationRequested = useRef(false)
  const requestVersion = useRef(0)

  useEffect(() => {
    let active = true
    Promise.all([
      getAuthHeaders().then(getProfile).catch(() => null),
      loadSavedRegion().catch(() => null),
    ]).then(([profile, saved]) => {
      if (!active) return
      const onboardingRegion = profile?.home_region?.trim() || DEFAULT_COURSE_REGION
      setHomeRegion(onboardingRegion)
      const savedRegion = saved?.trim() && saved !== 'All California' ? saved.trim() : null
      setRegion(savedRegion || onboardingRegion)
      setRegionReady(true)
    })
    getCourseRegions().then(setRegions).catch(() => undefined)
    return () => { active = false }
  }, [getAuthHeaders])

  const searchFilters = useMemo(() => {
    const normalizedQuery = query.trim() || undefined
    const searchingCatalog = normalizedQuery !== undefined
    return {
      q: normalizedQuery,
      region: !searchingCatalog && !coordinates && region !== DEFAULT_COURSE_REGION ? region : undefined,
      lat: !searchingCatalog ? coordinates?.latitude : undefined,
      lng: !searchingCatalog ? coordinates?.longitude : undefined,
      radius_miles: !searchingCatalog && coordinates ? radiusMiles : undefined,
      access,
      difficulty,
      max_green_fee: maxGreenFee,
      limit: 50,
    }
  }, [access, coordinates, difficulty, maxGreenFee, query, radiusMiles, region])

  const loadCourses = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const next = await searchCourses(searchFilters)
      if (requestVersion.current === version) setCourses(next)
    } catch (reason) {
      if (requestVersion.current === version) {
        setCourses([])
        setError(message(reason, 'Unable to load the course catalog.'))
      }
    } finally {
      if (requestVersion.current === version) setLoading(false)
    }
  }, [searchFilters])

  useEffect(() => {
    if (!regionReady) return
    const timeout = setTimeout(() => void loadCourses(), 250)
    return () => clearTimeout(timeout)
  }, [loadCourses, regionReady])

  const useCurrentLocation = useCallback(async () => {
    if (locationLoading) return
    setLocationLoading(true)
    setLocationMessage(null)
    try {
      const current = await resolveCurrentLocation()
      if (current) {
        setRegion(current.label)
        setCoordinates({ latitude: current.latitude, longitude: current.longitude })
      } else {
        setRegion(homeRegion)
        setCoordinates(null)
        setLocationMessage(`Location is unavailable. Showing courses for ${homeRegion}.`)
      }
    } catch {
      setRegion(homeRegion)
      setCoordinates(null)
      setLocationMessage(`Location is unavailable. Showing courses for ${homeRegion}.`)
    } finally {
      setLocationLoading(false)
    }
  }, [homeRegion, locationLoading])

  const activateSearch = () => {
    setSearchActive(true)
  }

  useEffect(() => {
    if (!searchActive || !regionReady || locationRequested.current) return
    locationRequested.current = true
    void useCurrentLocation()
  }, [regionReady, searchActive, useCurrentLocation])

  const updateRegion = (value: string) => {
    setRegion(value)
    setCoordinates(null)
    setLocationMessage(null)
  }

  const clearFilters = () => {
    setQuery('')
    setRegion(homeRegion)
    setCoordinates(null)
    setRadiusMiles(50)
    setAccess('any')
    setDifficulty('any')
    setMaxGreenFee(undefined)
    void saveRegion('')
  }

  const loadMore = async () => {
    const last = courses.at(-1)
    if (!last || courses.length < 50 || loadingMore) return
    setLoadingMore(true)
    try {
      const next = await searchCourses({ ...searchFilters, ...(searchFilters.lat !== undefined ? { offset: courses.length } : { cursor: last.id }) })
      setCourses((current) => [...current, ...next.filter((course) => !current.some((existing) => existing.id === course.id))])
    } catch (reason) {
      setError(message(reason, 'Unable to load more courses.'))
    } finally {
      setLoadingMore(false)
    }
  }

  const submitMissing = async () => {
    if (missingName.trim().length < 2) return
    setMissingStatus(null)
    try {
      await submitCourseCandidate({ name: missingName, city: missingCity || undefined, admin1_code: regionCode(region), notes: missingNotes || undefined }, await getAuthHeaders())
      setMissingStatus('Submitted for catalog review.')
      setMissingName('')
      setMissingCity('')
      setMissingNotes('')
    } catch (reason) {
      setMissingStatus(message(reason, 'Unable to submit this course.'))
    }
  }

  const activeFilterCount = Number(access !== 'any') + Number(difficulty !== 'any') + Number(maxGreenFee !== undefined) + Number(coordinates !== null)
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="Discover" />
      <View style={styles.searchWrap}><Feather name="search" size={16} color={colors.muted} /><TextInput accessibilityLabel="Search courses" value={query} onChangeText={setQuery} onFocus={activateSearch} placeholder="Search courses or cities" placeholderTextColor="#8C948F" style={styles.search} /><Pressable accessibilityRole="button" accessibilityLabel="Course filters" onPress={() => setFiltersOpen(true)}><Feather name="sliders" size={16} color={colors.ink} /></Pressable></View>

      {searchActive ? <View style={styles.regionSection}><Text style={styles.label}>REGION</Text><View style={styles.regionWrap}><Feather name="map-pin" size={16} color={colors.pine} /><TextInput accessibilityLabel="Region" value={region} onChangeText={updateRegion} onEndEditing={() => void saveRegion(region)} placeholder="City or region" placeholderTextColor={colors.muted} style={styles.regionInput} />{locationLoading ? <ActivityIndicator accessibilityLabel="Finding current location" color={colors.pine} size="small" /> : <Pressable accessibilityRole="button" accessibilityLabel="Use current location" onPress={() => void useCurrentLocation()}><Feather name="navigation" size={16} color={colors.pine} /></Pressable>}</View>{locationMessage ? <Text accessibilityRole="alert" style={styles.muted}>{locationMessage}</Text> : null}</View> : null}

      <View style={styles.chips}><FilterChip label={coordinates ? `Within ${radiusMiles} mi` : region} active /><FilterChip label={`${activeFilterCount} filters`} active={activeFilterCount > 0} onPress={() => setFiltersOpen(true)} />{activeFilterCount || query ? <FilterChip label="Clear all" onPress={clearFilters} /> : null}</View>

      <SectionTitle title={searchActive ? 'SEARCH RESULTS' : `${region} COURSES`} />
      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading courses" color={colors.pine} /><Text style={styles.muted}>Searching the catalog…</Text></View> : null}
      {!loading && error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void loadCourses()} style={styles.primary}><Text style={styles.primaryText}>Try again</Text></Pressable></View> : null}
      {!loading && !error && !courses.length ? <View style={styles.state}><Feather name="map" size={25} color={colors.muted} /><Text style={styles.emptyTitle}>{query || activeFilterCount ? 'No matching courses' : 'The catalog is empty'}</Text><Text style={styles.muted}>{query || activeFilterCount ? 'Try widening your region or clearing a filter.' : `Add catalog data for ${region} to make courses discoverable.`}</Text></View> : null}
      <View>{courses.map((course, index) => <DemoCourseRow key={course.id} course={toDisplayCourse(course, index)} index={index + 1} showReviewCount={false} onPress={() => router.push(`/course/${course.id}` as never)} />)}</View>
      {courses.length >= 50 ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={styles.loadMore}>{loadingMore ? <ActivityIndicator color={colors.pine} /> : <Text style={styles.link}>Load more courses</Text>}</Pressable> : null}
      <Pressable accessibilityRole="button" onPress={() => setMissingOpen(true)} style={styles.missing}><View><Text style={styles.missingTitle}>Can’t find a course?</Text><Text style={styles.muted}>Submit it for catalog review.</Text></View><Feather name="plus-circle" size={19} color={colors.pine} /></Pressable>
      <Text style={styles.attribution}>Course catalog data © OpenGolfAPI, ODbL 1.0</Text>
    </ProductScreen>
    <BottomNav />

    <FilterModal visible={filtersOpen} onClose={() => setFiltersOpen(false)} regions={regions} region={region} setRegion={updateRegion} radius={radiusMiles} setRadius={setRadiusMiles} access={access} setAccess={setAccess} difficulty={difficulty} setDifficulty={setDifficulty} maxFee={maxGreenFee} setMaxFee={setMaxGreenFee} clear={clearFilters} />
    <Modal visible={missingOpen} transparent animationType="slide" onRequestClose={() => setMissingOpen(false)}><View style={styles.overlay}><View style={styles.sheet}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Submit a missing course</Text><Pressable accessibilityRole="button" accessibilityLabel="Close missing course form" onPress={() => setMissingOpen(false)}><Feather name="x" size={20} color={colors.ink} /></Pressable></View><TextInput accessibilityLabel="Missing course name" value={missingName} onChangeText={setMissingName} placeholder="Course name" style={styles.field} /><TextInput accessibilityLabel="Missing course city" value={missingCity} onChangeText={setMissingCity} placeholder="City" style={styles.field} /><TextInput accessibilityLabel="Missing course notes" value={missingNotes} onChangeText={setMissingNotes} placeholder="Website or helpful details" multiline style={[styles.field, { minHeight: 76 }]} />{missingStatus ? <Text accessibilityRole="alert" style={styles.muted}>{missingStatus}</Text> : null}<Pressable accessibilityRole="button" disabled={missingName.trim().length < 2} onPress={() => void submitMissing()} style={styles.primary}><Text style={styles.primaryText}>Submit for review</Text></Pressable></View></View></Modal>
  </>
}

function FilterModal({ visible, onClose, regions, region, setRegion, radius, setRadius, access, setAccess, difficulty, setDifficulty, maxFee, setMaxFee, clear }: { visible: boolean; onClose: () => void; regions: CourseRegion[]; region: string; setRegion: (value: string) => void; radius: number; setRadius: (value: number) => void; access: AccessFilter; setAccess: (value: AccessFilter) => void; difficulty: DifficultyFilter; setDifficulty: (value: DifficultyFilter) => void; maxFee: number | undefined; setMaxFee: (value: number | undefined) => void; clear: () => void }) {
  const cities = regions.filter((item) => item.city).slice(0, 12)
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.overlay}><ScrollView style={styles.sheet} contentContainerStyle={{ gap: 15 }}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Course filters</Text><Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose}><Feather name="x" size={20} color={colors.ink} /></Pressable></View><Text style={styles.label}>REGION</Text><TextInput accessibilityLabel="Filter region" value={region} onChangeText={setRegion} onEndEditing={() => void saveRegion(region)} style={styles.field} /><View style={styles.chips}>{cities.map((item) => <FilterChip key={`${item.admin1_code}:${item.city}`} label={`${item.city} (${item.course_count})`} onPress={() => setRegion(`${item.city}${item.admin1_code ? `, ${item.admin1_code}` : ''}`)} />)}</View><Text style={styles.label}>DISTANCE</Text><OptionRow options={[10, 25, 50, 100]} selected={radius} onSelect={setRadius} suffix=" mi" /><Text style={styles.label}>ACCESS</Text><OptionRow options={['any', 'public', 'private']} selected={access} onSelect={(value) => setAccess(value as AccessFilter)} /><Text style={styles.label}>DIFFICULTY</Text><OptionRow options={['any', 'beginner', 'intermediate', 'challenging']} selected={difficulty} onSelect={(value) => setDifficulty(value as DifficultyFilter)} /><Text style={styles.label}>MAX GREEN FEE</Text><TextInput accessibilityLabel="Maximum green fee" value={maxFee === undefined ? '' : String(maxFee)} onChangeText={(value) => setMaxFee(value ? Number(value.replace(/\D/g, '')) : undefined)} keyboardType="number-pad" placeholder="Any price" style={styles.field} /><View style={styles.sheetActions}><Pressable accessibilityRole="button" onPress={clear}><Text style={styles.link}>Clear all</Text></Pressable><Pressable accessibilityRole="button" onPress={onClose} style={styles.primary}><Text style={styles.primaryText}>Show courses</Text></Pressable></View></ScrollView></View></Modal>
}

function OptionRow({ options, selected, onSelect, suffix = '' }: { options: (string | number)[]; selected: string | number; onSelect: (value: never) => void; suffix?: string }) { return <View style={styles.chips}>{options.map((option) => <FilterChip key={option} label={`${typeof option === 'string' ? capitalize(option) : option}${suffix}`} active={selected === option} onPress={() => onSelect(option as never)} />)}</View> }
function FilterChip({ label, active = false, onPress }: { label: string; active?: boolean; onPress?: () => void }) { return <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable> }
function toDisplayCourse(course: Course, index: number): DemoCourse { return { id: String(course.id), name: course.name, location: course.region, rating: course.community_rating ?? 0, reviews: '', distance: course.distance_miles == null ? (course.green_fee == null ? 'Fee unavailable' : `$${course.green_fee}`) : `${course.distance_miles.toFixed(1)} mi`, price: course.green_fee != null && course.green_fee > 500 ? '$$$$' : '$$$', accent: '#6E8B84', secondary: '#AEC3B7', image: demoCourses[index % demoCourses.length].image } }
function regionCode(value: string) { return /,\s*([A-Z]{2})\s*$/.exec(value)?.[1] }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  searchWrap: { alignItems: 'center', borderColor: '#D6D7D2', borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 9, paddingHorizontal: 13 }, search: { color: colors.ink, flex: 1, fontSize: 12, minHeight: 42 }, regionSection: { gap: 6 }, label: { color: colors.ink, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }, regionWrap: { alignItems: 'center', backgroundColor: '#F7F7F3', borderColor: colors.line, borderRadius: 9, borderWidth: 1, flexDirection: 'row', gap: 9, paddingHorizontal: 13 }, regionInput: { color: colors.ink, flex: 1, fontSize: 12, minHeight: 42 }, muted: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { backgroundColor: '#F0F1ED', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7 }, chipActive: { backgroundColor: colors.pine }, chipText: { color: colors.muted, fontSize: 9, fontWeight: '700' }, chipTextActive: { color: '#FFF' }, state: { alignItems: 'center', gap: 10, padding: 36 }, error: { color: '#9A3E3E', fontSize: 11, lineHeight: 17, textAlign: 'center' }, emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 18 }, primary: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 }, primaryText: { color: '#FFF', fontSize: 11, fontWeight: '800' }, link: { color: colors.pine, fontSize: 10, fontWeight: '800' }, loadMore: { alignItems: 'center', padding: 14 }, missing: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15 }, missingTitle: { color: colors.pine, fontFamily: 'Georgia', fontSize: 16 }, attribution: { color: colors.muted, fontSize: 8, textAlign: 'center' },
  overlay: { backgroundColor: 'rgba(11, 25, 17, 0.35)', flex: 1, justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '88%', padding: 20 }, sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, sheetTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 21 }, field: { borderColor: colors.line, borderRadius: 9, borderWidth: 1, color: colors.ink, fontSize: 12, minHeight: 44, paddingHorizontal: 12, textAlignVertical: 'top' }, sheetActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 18 },
})

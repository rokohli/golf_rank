import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { createPlan, deletePlan, getPlan, getPlans, savePlan, updatePlan } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { CourseVisual, ProductScreen, ScreenHeader, SectionTitle } from '../src/components/ProductUI'
import { DemoCourse } from '../src/data/demo'
import { GolfPlan, PlanInput, PlanSummary } from '../src/types'
import { colors } from '../src/ui/theme'

const today = new Date()
const tomorrow = new Date(today.getTime() + 86_400_000)

const initialInput: PlanInput = {
  title: '', start_date: isoDate(today), end_date: isoDate(tomorrow), party_size: 4,
  max_green_fee: null, access: 'any', difficulty: 'any', regions: [],
  origin_latitude: null, origin_longitude: null, radius_miles: null,
  transportation: 'either', tee_time_window: null, must_haves: [], max_candidates: 5,
}

export default function Planner() {
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const [input, setInput] = useState<PlanInput>(initialInput)
  const [startDateText, setStartDateText] = useState(() => usDate(initialInput.start_date))
  const [endDateText, setEndDateText] = useState(() => usDate(initialInput.end_date))
  const [regionText, setRegionText] = useState('')
  const [mustHaveText, setMustHaveText] = useState('')
  const [plan, setPlan] = useState<GolfPlan | null>(null)
  const [trips, setTrips] = useState<PlanSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [refining, setRefining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const summaries = await getPlans(headers)
      setTrips(summaries)
      if (params.id) {
        const loaded = await getPlan(Number(params.id), headers)
        showPlan(loaded)
      }
    } catch (reason) {
      setError(message(reason, 'Unable to load your trips.'))
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders, params.id])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  function showPlan(next: GolfPlan) {
    setPlan(next)
    const nextInput = { ...next.constraints, title: next.title, start_date: next.start_date, end_date: next.end_date }
    setInput(nextInput)
    setStartDateText(usDate(next.start_date))
    setEndDateText(usDate(next.end_date))
    setRegionText(nextInput.regions.join('; '))
    setMustHaveText(nextInput.must_haves.join(', '))
    setRefining(false)
  }

  function payload(): PlanInput {
    return {
      ...input,
      title: input.title.trim(),
      start_date: isoFromUsDate(startDateText),
      end_date: isoFromUsDate(endDateText),
      regions: regionText.split(';').map((value) => value.trim()).filter(Boolean),
      must_haves: mustHaveText.split(',').map((value) => value.trim()).filter(Boolean),
      access: 'any',
      difficulty: 'any',
      origin_latitude: null,
      origin_longitude: null,
      radius_miles: null,
      transportation: 'either',
      tee_time_window: null,
    }
  }

  async function generate() {
    const next = payload()
    const validation = validate(next)
    if (validation) { setError(validation); return }
    setWorking(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const result = plan ? await updatePlan(plan.id, next, headers) : await createPlan(next, headers)
      showPlan(result)
      setTrips(await getPlans(headers))
    } catch (reason) {
      setError(message(reason, 'Unable to build this trip.'))
    } finally {
      setWorking(false)
    }
  }

  async function save() {
    if (!plan) return
    setWorking(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const saved = await savePlan(plan.id, headers)
      showPlan(saved)
      setTrips(await getPlans(headers))
    } catch (reason) {
      setError(message(reason, 'Unable to save this trip.'))
    } finally {
      setWorking(false)
    }
  }

  async function remove() {
    if (!plan) return
    Alert.alert('Delete trip?', 'This removes the saved itinerary from your account.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void removeConfirmed() },
    ])
  }

  async function removeConfirmed() {
    if (!plan) return
    setWorking(true)
    try {
      const headers = await getAuthHeaders()
      await deletePlan(plan.id, headers)
      setPlan(null)
      setInput(initialInput)
      setStartDateText(usDate(initialInput.start_date))
      setEndDateText(usDate(initialInput.end_date))
      setRegionText('')
      setMustHaveText('')
      setRefining(false)
      setTrips(await getPlans(headers))
    } catch (reason) {
      setError(message(reason, 'Unable to delete this trip.'))
    } finally {
      setWorking(false)
    }
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="Trip planner" onBack={() => router.back()} />
      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading trips" color={colors.pine} /></View> : null}
      {error ? <View style={styles.errorBox}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{loading ? null : <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.link}>Retry</Text></Pressable>}</View> : null}

      {!plan || refining ? <>
        <SectionTitle title={plan ? 'REFINE TRIP' : 'PLAN A TRIP'} />
        <Field label="Trip name" value={input.title} onChangeText={(title) => setInput({ ...input, title })} placeholder="Monterey weekend" />
        <Field label="Destination or regions" value={regionText} onChangeText={setRegionText} placeholder="Monterey, CA; Santa Cruz, CA" help="The destination determines the geographic origin. Separate multiple regions with a semicolon." />
        <View style={styles.row}><View style={styles.flex}><Field label="Start date" value={startDateText} onChangeText={setStartDateText} placeholder="MM/DD/YYYY" keyboardType="number-pad" /></View><View style={styles.flex}><Field label="End date" value={endDateText} onChangeText={setEndDateText} placeholder="MM/DD/YYYY" keyboardType="number-pad" /></View></View>
        <View style={styles.row}><View style={styles.flex}><Field label="Party size" value={String(input.party_size)} onChangeText={(value) => setInput({ ...input, party_size: numeric(value, 1) })} keyboardType="number-pad" /></View><View style={styles.flex}><Field label="Maximum green fee" value={input.max_green_fee == null ? '' : String(input.max_green_fee)} onChangeText={(value) => setInput({ ...input, max_green_fee: nullableNumber(value) })} placeholder="Any" keyboardType="number-pad" /></View></View>
        <Field label="Must-haves" value={mustHaveText} onChangeText={setMustHaveText} placeholder="Walking friendly, ocean views" help="These remain unverified until confirmed by a current source." />
        <Pressable accessibilityRole="button" disabled={working} onPress={() => void generate()} style={styles.primary}>{working ? <ActivityIndicator color="#FFF" /> : <><Feather name="map" size={17} color="#FFF" /><Text style={styles.primaryText}>{plan ? 'Update trip' : 'Build trip'}</Text></>}</Pressable>
      </> : <Pressable accessibilityRole="button" onPress={() => setRefining(true)} style={styles.refine}><Feather name="sliders" size={15} color={colors.pine} /><Text style={styles.refineText}>Refine trip</Text></Pressable>}

      {plan ? <PlanResult plan={plan} onSave={() => void save()} onDelete={() => void remove()} working={working} /> : null}

      <SectionTitle title="MY TRIPS" />
      {!loading && !trips.length ? <View style={styles.empty}><Feather name="map-pin" size={22} color={colors.muted} /><Text style={styles.muted}>Draft and saved trips will appear here.</Text></View> : null}
      {trips.map((trip) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${trip.title}`} key={trip.id} onPress={() => router.push(`/planner?id=${trip.id}` as never)} style={styles.tripRow}><View><Text style={styles.tripTitle}>{trip.title}</Text><Text style={styles.muted}>{formatDateRange(trip.start_date, trip.end_date)} · {trip.candidate_count} courses</Text></View><View style={styles.status}><Text style={styles.statusText}>{trip.status}</Text></View></Pressable>)}
    </ProductScreen>
  </>
}

function PlanResult({ plan, onSave, onDelete, working }: { plan: GolfPlan; onSave: () => void; onDelete: () => void; working: boolean }) {
  return <View style={styles.result}>
    <View style={styles.resultHeader}><View><Text style={styles.resultTitle}>{plan.title}</Text><Text style={styles.resultDates}>{formatDateRange(plan.start_date, plan.end_date)}</Text></View><View style={styles.status}><Text style={styles.statusText}>{plan.status}</Text></View></View>
    {!plan.candidates.length ? <View style={styles.empty}><Text style={styles.muted}>No courses match this request. Try another destination, budget, or set of must-haves.</Text></View> : null}
    {plan.candidates.map((candidate) => <View key={candidate.course.id} style={styles.candidate}><View style={styles.thumb}><CourseVisual course={displayCourse(candidate.course)} height={64} /></View><View style={styles.flex}><Text style={styles.courseTitle}>{candidate.course.name}</Text><Text style={styles.muted}>{candidate.distance_miles == null ? candidate.course.region : `${candidate.distance_miles.toFixed(1)} mi · ${candidate.course.region}`}</Text>{candidate.reasons.map((reason) => <Text key={reason} style={styles.reason}>• {reason}</Text>)}{candidate.caveats.map((caveat) => <Text key={caveat} style={styles.caveat}>• {caveat}</Text>)}</View></View>)}
    {plan.itinerary.length ? <><Text style={styles.itineraryTitle}>ITINERARY</Text>{plan.itinerary.map((item) => <View key={item.id} style={styles.itineraryRow}><Text style={styles.itineraryDate}>{formatDate(item.date)}</Text><View style={styles.flex}><Text style={styles.courseTitle}>{item.title}</Text><Text style={styles.muted}>{item.details.availability_verified ? 'Availability verified' : 'Tee-time availability unverified'}{item.course?.tee_time_url ? ' · Official booking link available' : ''}</Text></View></View>)}</> : null}
    <View style={styles.actions}><Pressable accessibilityRole="button" disabled={working || plan.status === 'saved'} onPress={onSave} style={[styles.secondary, plan.status === 'saved' && styles.disabled]}><Feather name="bookmark" size={15} color={colors.pine} /><Text style={styles.secondaryText}>{plan.status === 'saved' ? 'Saved' : 'Save trip'}</Text></Pressable><Pressable accessibilityRole="button" disabled={working} onPress={onDelete} style={styles.delete}><Text style={styles.deleteText}>Delete</Text></Pressable></View>
  </View>
}

function Field({ label, help, ...props }: { label: string; help?: string } & React.ComponentProps<typeof TextInput>) { return <View style={styles.fieldWrap}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={styles.field} {...props} />{help ? <Text style={styles.help}>{help}</Text> : null}</View> }
function displayCourse(course: GolfPlan['candidates'][number]['course']): DemoCourse { const hero = course.images?.find((image) => image.is_hero && image.url) ?? course.images?.find((image) => image.url); return { id: String(course.id), name: course.name, location: course.region, rating: course.community_rating ?? 0, reviews: '', distance: '', price: '', accent: '#6E8B84', secondary: '#AEC3B7', image: hero?.url ? { uri: hero.url } : undefined } }
function validate(input: PlanInput) { if (!input.title) return 'Enter a trip name.'; if (!input.start_date || !input.end_date) return 'Use MM/DD/YYYY for both dates.'; if (input.end_date < input.start_date) return 'End date must be on or after the start date.'; return null }
function nullableNumber(value: string) { const trimmed = value.trim(); if (!trimmed) return null; const number = Number(trimmed); return Number.isFinite(number) ? number : null }
function numeric(value: string, fallback: number) { const number = Number(value.replace(/\D/g, '')); return number || fallback }
function isoDate(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function usDate(value: string) { const [year, month, day] = value.split('-'); return year && month && day ? `${month}/${day}/${year}` : '' }
function isoFromUsDate(value: string) { const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim()); if (!match) return ''; const month = Number(match[1]); const day = Number(match[2]); const year = Number(match[3]); const date = new Date(year, month - 1, day); if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return ''; return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
function formatDate(value: string) { return usDate(value) }
function formatDateRange(start: string, end: string) { return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}` }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 }, flex: { flex: 1 }, fieldWrap: { gap: 6 }, label: { color: colors.ink, fontSize: 10, fontWeight: '800' }, field: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 9, borderWidth: 1, color: colors.ink, fontSize: 12, minHeight: 44, paddingHorizontal: 12 }, help: { color: colors.muted, fontSize: 9, lineHeight: 14 },
  primary: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: 22, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 46 }, primaryText: { color: '#FFF', fontSize: 12, fontWeight: '800' }, state: { alignItems: 'center', padding: 30 }, errorBox: { alignItems: 'center', backgroundColor: '#F8ECE8', borderRadius: 9, gap: 6, padding: 11 }, error: { color: colors.error, fontSize: 10, textAlign: 'center' }, link: { color: colors.pine, fontSize: 10, fontWeight: '800' },
  result: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, gap: 12, padding: 14 }, resultHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, resultTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 20 }, resultDates: { color: colors.muted, fontSize: 10, marginTop: 4 }, status: { backgroundColor: colors.pineSoft, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 }, statusText: { color: colors.pine, fontSize: 8, fontWeight: '800', textTransform: 'uppercase' }, candidate: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, paddingTop: 12 }, thumb: { borderRadius: 8, overflow: 'hidden', width: 76 }, courseTitle: { color: colors.ink, fontSize: 11, fontWeight: '800' }, muted: { color: colors.muted, fontSize: 9, lineHeight: 14 }, reason: { color: colors.pineDark, fontSize: 9, lineHeight: 14, marginTop: 3 }, caveat: { color: '#8A6844', fontSize: 9, lineHeight: 14, marginTop: 2 }, itineraryTitle: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, itineraryRow: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, paddingTop: 10 }, itineraryDate: { color: colors.pine, fontSize: 9, fontWeight: '800', width: 46 }, actions: { flexDirection: 'row', gap: 10 }, secondary: { alignItems: 'center', borderColor: colors.pine, borderRadius: 20, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 40 }, secondaryText: { color: colors.pine, fontSize: 10, fontWeight: '800' }, delete: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, deleteText: { color: colors.error, fontSize: 10, fontWeight: '800' }, disabled: { opacity: 0.55 },
  empty: { alignItems: 'center', gap: 8, padding: 18 }, tripRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 }, tripTitle: { color: colors.ink, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  refine: { alignItems: 'center', alignSelf: 'flex-start', borderColor: colors.pine, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 7, paddingHorizontal: 13, paddingVertical: 8 }, refineText: { color: colors.pine, fontSize: 10, fontWeight: '800' },
})

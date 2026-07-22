import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { createSavedList, getCourse, getCourseRating, getSavedLists, removeCourseFromList, saveCourseToList, updateRound } from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { CourseVisual, IconButton, ProductScreen } from '../../src/components/ProductUI'
import { DemoCourse, demoCourses } from '../../src/data/demo'
import { Course, CourseRatingState, RoundPatch, SavedList } from '../../src/types'
import { colors } from '../../src/ui/theme'

const seededDemoCourseIds: Record<string, number> = {
  pebble: 1,
  pasatiempo: 3,
}

export default function CourseDetail() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getAuthHeaders } = useAuthHeaders()
  const mounted = useRef(true)
  const ratingRequestVersion = useRef(0)
  const savedRequestVersion = useRef(0)
  const demoCourse = useMemo(() => demoCourses.find((item) => item.id === id) ?? null, [id])
  const isNumericRoute = Boolean(id && /^\d+$/.test(id))
  const numericCourseId = isNumericRoute ? Number(id) : id ? seededDemoCourseIds[id] ?? null : null
  const [course, setCourse] = useState<DemoCourse | null>(demoCourse && !numericCourseId ? demoCourse : null)
  const [publicCourse, setPublicCourse] = useState<Course | null>(null)
  const [courseError, setCourseError] = useState<string | null>(null)
  const [courseLoading, setCourseLoading] = useState(Boolean(numericCourseId))
  const [rating, setRating] = useState<CourseRatingState | null>(null)
  const [ratingError, setRatingError] = useState<string | null>(null)
  const [ratingLoading, setRatingLoading] = useState(Boolean(numericCourseId))
  const [savedLists, setSavedLists] = useState<SavedList[] | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [utilityError, setUtilityError] = useState<string | null>(null)
  const [openDetails, setOpenDetails] = useState<'personal' | 'friends' | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      ratingRequestVersion.current += 1
      savedRequestVersion.current += 1
    }
  }, [])

  const loadCourse = useCallback(async () => {
    if (demoCourse && !numericCourseId) {
      setCourse(demoCourse)
      setPublicCourse(null)
      setCourseError(null)
      setCourseLoading(false)
      return
    }
    if (!numericCourseId) {
      setCourse(null)
      setPublicCourse(null)
      setCourseError('Course not found.')
      setCourseLoading(false)
      return
    }

    setCourse(null)
    setPublicCourse(null)
    setCourseError(null)
    setCourseLoading(true)
    try {
      const nextCourse = await getCourse(numericCourseId)
      if (!mounted.current) return
      setPublicCourse(nextCourse)
      setCourse(toDemoCourse(nextCourse))
    } catch (reason) {
      if (mounted.current) setCourseError(errorMessage(reason, 'Unable to load this course.'))
    } finally {
      if (mounted.current) setCourseLoading(false)
    }
  }, [demoCourse, numericCourseId])

  useEffect(() => {
    void loadCourse()
  }, [loadCourse])

  useEffect(() => {
    ratingRequestVersion.current += 1
    setRating(null)
    setRatingError(null)
    setRatingLoading(Boolean(numericCourseId))
  }, [numericCourseId])

  const refreshRating = useCallback(async () => {
    const requestVersion = ++ratingRequestVersion.current
    if (!numericCourseId) {
      if (mounted.current && requestVersion === ratingRequestVersion.current) {
        setRating(null)
        setRatingError(null)
        setRatingLoading(false)
      }
      return
    }

    setRatingError(null)
    setRatingLoading(true)
    try {
      const headers = await getAuthHeaders()
      const nextRating = await getCourseRating(numericCourseId, headers)
      if (mounted.current && requestVersion === ratingRequestVersion.current) setRating(nextRating)
    } catch (reason) {
      if (mounted.current && requestVersion === ratingRequestVersion.current) setRatingError(errorMessage(reason, 'Unable to load your rating.'))
    } finally {
      if (mounted.current && requestVersion === ratingRequestVersion.current) setRatingLoading(false)
    }
  }, [getAuthHeaders, numericCourseId])

  const refreshSavedState = useCallback(async () => {
    const requestVersion = ++savedRequestVersion.current
    if (!numericCourseId) {
      if (mounted.current && requestVersion === savedRequestVersion.current) {
        setSavedLists([])
        setSaveError(null)
      }
      return
    }

    setSaveError(null)
    try {
      const headers = await getAuthHeaders()
      const lists = await getSavedLists(headers)
      if (mounted.current && requestVersion === savedRequestVersion.current) setSavedLists(lists)
    } catch (reason) {
      if (mounted.current && requestVersion === savedRequestVersion.current) {
        setSaveError(errorMessage(reason, 'Unable to load saved courses.'))
      }
    }
  }, [getAuthHeaders, numericCourseId])

  const updatePersonalDetail = useCallback(async (field: EditableDetail, value: number | string | null) => {
    const roundId = rating?.round?.id
    if (!roundId) throw new Error('Log or rate a round before adding course details.')
    const patch: RoundPatch = field === 'score'
      ? { score: value as number | null }
      : field === 'note'
        ? { note: value as string | null }
        : { favorite_hole: value as number | null }
    await updateRound(roundId, patch, await getAuthHeaders())
    await refreshRating()
  }, [getAuthHeaders, rating?.round?.id, refreshRating])

  const toggleSaved = useCallback(async () => {
    if (!numericCourseId || saveLoading) return
    // Invalidate a focus refresh that may still be loading the older state.
    savedRequestVersion.current += 1
    setSaveLoading(true)
    setSaveError(null)
    try {
      const headers = await getAuthHeaders()
      let lists = savedLists ?? await getSavedLists(headers)
      let target = lists.find((list) => list.is_default) ?? lists[0]
      if (!target) {
        target = await createSavedList({ name: 'Saved', visibility: 'private', is_default: true }, headers)
        lists = [...lists, target]
      }
      const alreadySaved = target.courses.some((item) => item.course.id === numericCourseId)
      if (alreadySaved) {
        await removeCourseFromList(target.id, numericCourseId, headers)
        target = { ...target, courses: target.courses.filter((item) => item.course.id !== numericCourseId) }
      } else {
        target = await saveCourseToList(target.id, numericCourseId, headers)
      }
      if (mounted.current) setSavedLists(lists.map((list) => list.id === target.id ? target : list))
    } catch (reason) {
      if (mounted.current) setSaveError(errorMessage(reason, 'Unable to update this saved course.'))
    } finally {
      if (mounted.current) setSaveLoading(false)
    }
  }, [getAuthHeaders, numericCourseId, saveLoading, savedLists])

  const shareCourse = useCallback(async () => {
    if (!course) return
    setUtilityError(null)
    try {
      await Share.share({ message: `${course.name}\n${course.location}` })
    } catch (reason) {
      setUtilityError(errorMessage(reason, 'Unable to share this course.'))
    }
  }, [course])

  const viewTeeTimes = useCallback(async () => {
    if (!course) return
    setUtilityError(null)
    const url = publicCourse?.tee_time_url ?? `https://www.google.com/search?q=${encodeURIComponent(`${course.name} ${course.location} tee times`)}`
    try {
      await Linking.openURL(url)
    } catch (reason) {
      setUtilityError(errorMessage(reason, 'Unable to open tee times.'))
    }
  }, [course, publicCourse?.tee_time_url])

  // Expo Router's focus effect runs on first display and again after the rating flow closes.
  useFocusEffect(useCallback(() => {
    void refreshRating()
    void refreshSavedState()
    return () => {
      ratingRequestVersion.current += 1
      savedRequestVersion.current += 1
    }
  }, [refreshRating, refreshSavedState]))

  if (!course) {
    return <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductScreen>
        <IconButton icon="arrow-left" label="Go back" onPress={() => router.back()} />
        {courseLoading ? <ActivityIndicator accessibilityLabel="Loading course" color={colors.pine} /> : null}
        <Text accessibilityRole={courseError ? 'alert' : undefined} style={styles.loadingText}>
          {courseError ?? 'Loading course...'}
        </Text>
        {courseError ? <Pressable accessibilityRole="button" onPress={() => void loadCourse()} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable> : null}
      </ProductScreen>
    </>
  }

  const communityRating = rating?.community_rating ?? (publicCourse ? publicCourse.community_rating : course.rating)
  const ratingCount = rating?.rating_count ?? publicCourse?.rating_count ?? parseRatingCount(course.reviews)
  const hasPersonalRating = rating?.personal_rating != null
  const hasKnownRatingState = rating != null
  const defaultSavedList = savedLists?.find((list) => list.is_default) ?? savedLists?.[0]
  const isSaved = Boolean(defaultSavedList?.courses.some((item) => item.course.id === numericCourseId))
  const facts = courseFacts(course, publicCourse)
  const photos = publicCourse?.images?.filter((image) => image.url) ?? []

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen edgeToEdge>
      <View style={styles.hero}>
        <CourseVisual course={course} height={245} squareTop />
        <View style={[styles.back, { top: insets.top + 12 }]}><HeroButton icon="arrow-left" label="Go back" onPress={() => router.back()} /></View>
        <View style={[styles.heroActions, { top: insets.top + 12 }]}><HeroButton disabled={!numericCourseId || saveLoading} icon="bookmark" label={isSaved ? 'Remove saved course' : 'Save course'} onPress={() => void toggleSaved()} /><HeroButton icon="share" label="Share course" onPress={() => void shareCourse()} /></View>
      </View>
      <View style={styles.coursePanel}><Text style={styles.title}>{course.name}</Text><Text style={styles.location}>{course.location}</Text><Text style={styles.access}>{facts.accessLabel}</Text>{facts.items.length ? <View style={styles.facts}>{facts.items.map((fact, index) => <View key={fact.label} style={[styles.fact, index > 0 && styles.factBorder]}><Text style={styles.factValue}>{fact.value}</Text><Text style={styles.factLabel}>{fact.label}</Text>{fact.secondary ? <Text style={styles.factSecondary}>{fact.secondary}</Text> : null}</View>)}</View> : null}</View>

      <View style={styles.ratingSummary}>
        <View style={styles.ratingBlock}>
          <Text accessibilityLabel={communityRating == null ? 'No community rating yet' : `Community rating ${communityRating} out of 10`} style={styles.ratingValue}>
            {communityRating == null ? '—' : formatRating(communityRating)}<Text style={styles.ratingScale}>/10</Text>
          </Text>
          <Text style={styles.ratingLabel}>Community</Text>
          <Text style={styles.ratingCount}>{ratingCount === 1 ? '1 rating' : `${ratingCount} ratings`}</Text>
        </View>
        <View style={styles.ratingDivider} />
        <View style={styles.ratingBlock}>
          {hasKnownRatingState ? hasPersonalRating ?
            <Text accessibilityLabel={`Your rating ${rating.personal_rating} out of 10`} style={styles.ratingValue}>{formatRating(rating.personal_rating!)}<Text style={styles.ratingScale}>/10</Text></Text> :
            <Text style={styles.notRated}>Not rated yet</Text> : ratingLoading ?
            <ActivityIndicator accessibilityLabel="Loading your rating" color={colors.pine} size="small" style={styles.personalLoader} /> :
            <Text style={styles.notRated}>Personal rating unavailable</Text>}
          <Text style={styles.ratingLabel}>Your rating</Text>
          {ratingError ? <><Text accessibilityRole="alert" style={styles.ratingError}>{ratingError}</Text><Pressable accessibilityRole="button" onPress={() => void refreshRating()}><Text style={styles.retryText}>Retry rating</Text></Pressable></> : null}
        </View>
      </View>

      {!numericCourseId ? <Text style={styles.unavailable}>Personal rating is unavailable for this demo-only course.</Text> : null}
      <View style={styles.actions}>
        {numericCourseId && hasKnownRatingState ? <CourseAction icon={hasPersonalRating ? 'check-circle' : 'bar-chart-2'} label={hasPersonalRating ? 'Rated' : 'Rate'} onPress={() => router.push(`/rate/${numericCourseId}` as never)} /> : null}
        {numericCourseId ? <CourseAction disabled={saveLoading} icon={isSaved ? 'check-circle' : 'bookmark'} label={saveLoading ? 'Saving' : isSaved ? 'Saved' : 'Save'} onPress={() => void toggleSaved()} /> : null}
        {numericCourseId ? <CourseAction icon="edit-3" label="Log round" onPress={() => router.push(`/round/new?courseId=${numericCourseId}` as never)} /> : null}
      </View>
      {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void viewTeeTimes()} style={({ pressed }) => [styles.teeTimes, pressed && styles.pressed]}><Feather name="calendar" size={18} color={colors.pineDark} /><Text style={styles.teeTimesText}>View tee times</Text></Pressable>
      {utilityError ? <Text accessibilityRole="alert" style={styles.saveError}>{utilityError}</Text> : null}
      <View style={styles.photoSection}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Course photos</Text></View>{photos.length ? <><View style={styles.photoRow}>{photos.slice(0, 3).map((image) => <Image accessibilityLabel={image.alt_text ?? `${course.name} course photo`} key={image.id} source={{ uri: image.url! }} style={styles.photo} />)}</View>{photos[0].source_name ? <Text style={styles.photoCredit}>Photos: {photos[0].source_name}</Text> : null}</> : <View style={styles.emptyPhotos}><Feather name="camera" size={20} color={colors.muted} /><Text style={styles.emptyText}>No course photos yet.</Text></View>}</View>
      <View style={styles.disclosures}>
        <DisclosureRow expanded={openDetails === 'personal'} icon="edit-3" label="Your thoughts & details" onPress={() => setOpenDetails((current) => current === 'personal' ? null : 'personal')} />
        {openDetails === 'personal' ? <PersonalDetails onSave={updatePersonalDetail} rating={rating} /> : null}
        <DisclosureRow expanded={openDetails === 'friends'} icon="users" label="Friends’ thoughts & details" onPress={() => setOpenDetails((current) => current === 'friends' ? null : 'friends')} />
        {openDetails === 'friends' ? <View style={styles.disclosureBody}><Text style={styles.emptyText}>Friends’ thoughts aren’t available yet.</Text></View> : null}
      </View>
    </ProductScreen>
  </>
}

function HeroButton({ disabled = false, icon, label, onPress }: { disabled?: boolean; icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.heroButton, disabled && styles.actionDisabled]}><Feather name={icon} size={19} color="#FFF" /></Pressable> }

function CourseAction({ disabled = false, icon, label, onPress }: { disabled?: boolean; icon: keyof typeof Feather.glyphMap; label: string; onPress?: () => void }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.actionDisabled]}>{({ pressed }) => <><View style={[styles.actionIcon, pressed && styles.actionIconPressed]}><Feather name={icon} size={18} color={pressed ? '#FFF' : colors.pine} /></View><Text style={[styles.actionLabel, pressed && styles.actionLabelPressed]}>{label}</Text></>}</Pressable>
}

function DisclosureRow({ expanded, icon, label, onPress }: { expanded: boolean; icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={styles.disclosureRow}><Feather name={icon} size={18} color={colors.pineDark} /><Text style={styles.disclosureLabel}>{label}</Text><Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={colors.pineDark} /></Pressable> }
type EditableDetail = 'score' | 'note' | 'favorite_hole'

function PersonalDetails({ onSave, rating }: { onSave: (field: EditableDetail, value: number | string | null) => Promise<void>; rating: CourseRatingState | null }) {
  const [expanded, setExpanded] = useState<'score' | 'notes' | 'favoriteHole' | null>(null)
  const [scoreInput, setScoreInput] = useState('')
  const [noteInput, setNoteInput] = useState('')
  const [favoriteHoleInput, setFavoriteHoleInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  useEffect(() => {
    setScoreInput(rating?.round?.score == null ? '' : String(rating.round.score))
    setNoteInput(rating?.round?.note ?? '')
    setFavoriteHoleInput(rating?.round?.favorite_hole == null ? '' : String(rating.round.favorite_hole))
  }, [rating?.round?.favorite_hole, rating?.round?.note, rating?.round?.score])
  if (!rating) return <View style={styles.disclosureBody}><Text style={styles.emptyText}>Your details are unavailable.</Text></View>
  const note = rating.round?.note?.trim() || null
  const score = rating.round?.score ?? null
  const favoriteHole = rating.round?.favorite_hole ?? null
  const toggle = (field: typeof expanded) => {
    setEditError(null)
    setExpanded((current) => current === field ? null : field)
  }
  const persist = async (field: EditableDetail, value: number | string | null) => {
    setSaving(true)
    setEditError(null)
    try {
      await onSave(field, value)
      setExpanded(null)
    } catch (reason) {
      setEditError(errorMessage(reason, 'Unable to update this detail.'))
    } finally {
      setSaving(false)
    }
  }
  const saveNumber = (field: 'score' | 'favorite_hole', rawValue: string) => {
    const value = rawValue.trim() ? Number(rawValue) : null
    const valid = value === null || Number.isInteger(value) && (field === 'score' ? value >= 40 && value <= 250 : value >= 1 && value <= 18)
    if (!valid) {
      setEditError(field === 'score' ? 'Enter a score from 40 to 250.' : 'Enter a hole from 1 to 18.')
      return
    }
    void persist(field, value)
  }
  return <View style={styles.personalDetails}>
    <DetailDisclosureRow disabled={!rating.round} expanded={expanded === 'score'} label="Score" onPress={() => toggle('score')} value={score == null ? 'Not recorded' : String(score)} />
    {expanded === 'score' ? <View style={styles.detailDropdown}><Text style={styles.detailHelp}>Score for the round linked to this rating.</Text><TextInput accessibilityLabel="Edit score" keyboardType="number-pad" maxLength={3} onChangeText={setScoreInput} placeholder="Score" style={styles.detailInput} value={scoreInput} /><SaveDetailButton label="Save score" loading={saving} onPress={() => saveNumber('score', scoreInput)} /></View> : null}
    <DetailDisclosureRow disabled={!rating.round} expanded={expanded === 'notes'} label="Notes" onPress={() => toggle('notes')} value={note ? 'Added' : 'Not added'} />
    {expanded === 'notes' ? <View style={styles.detailDropdown}><TextInput accessibilityLabel="Edit notes" maxLength={5000} multiline onChangeText={setNoteInput} placeholder="Add notes about the course" style={[styles.detailInput, styles.notesInput]} value={noteInput} /><SaveDetailButton label="Save notes" loading={saving} onPress={() => void persist('note', noteInput.trim() || null)} /></View> : null}
    <DetailDisclosureRow disabled={!rating.round} expanded={expanded === 'favoriteHole'} label="Favorite hole" onPress={() => toggle('favoriteHole')} value={favoriteHole == null ? 'Not added' : `Hole ${favoriteHole}`} />
    {expanded === 'favoriteHole' ? <View style={styles.detailDropdown}><TextInput accessibilityLabel="Edit favorite hole" keyboardType="number-pad" maxLength={2} onChangeText={setFavoriteHoleInput} placeholder="1–18" style={styles.detailInput} value={favoriteHoleInput} /><SaveDetailButton label="Save favorite hole" loading={saving} onPress={() => saveNumber('favorite_hole', favoriteHoleInput)} /></View> : null}
    {editError ? <Text accessibilityRole="alert" style={styles.detailError}>{editError}</Text> : null}
    <View accessibilityLabel="Add photos, coming soon" style={styles.detailDisabledRow}><Feather name="camera" size={17} color={colors.muted} /><Text style={styles.detailRowLabel}>Add photos</Text><Text style={styles.detailDisabledValue}>Coming soon</Text></View>
  </View>
}
function DetailDisclosureRow({ disabled = false, expanded, label, onPress, value }: { disabled?: boolean; expanded: boolean; label: string; onPress: () => void; value: string }) { return <Pressable accessibilityLabel={`${label}, ${value}`} accessibilityRole="button" accessibilityState={{ disabled, expanded }} disabled={disabled} onPress={onPress} style={[styles.detailDisclosureRow, disabled && styles.actionDisabled]}><Text style={styles.detailRowLabel}>{label}</Text><Text style={styles.detailRowValue}>{value}</Text><Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={17} color={colors.pineDark} /></Pressable> }
function SaveDetailButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled: loading }} disabled={loading} onPress={onPress} style={styles.detailSave}>{loading ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.detailSaveText}>{label}</Text>}</Pressable> }

const styles = StyleSheet.create({
  hero: { marginHorizontal: -18, marginTop: -18, position: 'relative' }, back: { left: 14, position: 'absolute', top: 14 }, heroActions: { flexDirection: 'row', gap: 8, position: 'absolute', right: 14, top: 14 }, heroButton: { alignItems: 'center', backgroundColor: 'rgba(16,56,42,0.88)', borderColor: 'rgba(255,255,255,0.35)', borderRadius: 22, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  coursePanel: { backgroundColor: colors.pine, borderRadius: 14, marginHorizontal: -18, marginTop: -38, paddingHorizontal: 22, paddingTop: 24, zIndex: 2 }, title: { color: '#F8F7F3', fontFamily: 'Georgia', fontSize: 25, lineHeight: 31 }, location: { color: '#D0DAD4', fontSize: 12, marginTop: 7 }, access: { color: '#D0DAD4', fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginTop: 15, textTransform: 'uppercase' },
  facts: { borderTopColor: 'rgba(255,255,255,0.23)', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginTop: 18 }, fact: { alignItems: 'center', flex: 1, minHeight: 94, paddingHorizontal: 4, paddingTop: 17 }, factBorder: { borderLeftColor: 'rgba(255,255,255,0.23)', borderLeftWidth: StyleSheet.hairlineWidth }, factValue: { color: '#F8F7F3', fontFamily: 'Georgia', fontSize: 22 }, factLabel: { color: '#D0DAD4', fontSize: 7, fontWeight: '800', letterSpacing: 1, marginTop: 7, textAlign: 'center', textTransform: 'uppercase' }, factSecondary: { color: '#D0DAD4', fontSize: 8, marginTop: 4, textAlign: 'center' },
  ratingSummary: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingBottom: 18 }, ratingBlock: { alignItems: 'center', flex: 1, minHeight: 92 }, ratingDivider: { backgroundColor: colors.line, marginHorizontal: 14, width: StyleSheet.hairlineWidth }, ratingLabel: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 6, textTransform: 'uppercase' }, ratingValue: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 32, marginTop: 4 }, ratingScale: { color: colors.pineDark, fontSize: 15 }, ratingCount: { color: colors.muted, fontSize: 10, marginTop: 5 }, notRated: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 8, marginTop: 18 }, personalLoader: { marginBottom: 8, marginTop: 18 }, ratingError: { color: colors.error, fontSize: 9, marginTop: 5 }, unavailable: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around' }, action: { alignItems: 'center', gap: 7, minWidth: 70 }, actionIcon: { alignItems: 'center', borderColor: colors.pineDark, borderRadius: 24, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 }, actionIconPressed: { backgroundColor: colors.pine, borderColor: colors.pine }, actionLabel: { color: colors.ink, fontSize: 10 }, actionLabelPressed: { color: colors.pine, fontWeight: '700' }, actionDisabled: { opacity: 0.55 }, saveError: { color: colors.error, fontSize: 10, textAlign: 'center' },
  teeTimes: { alignItems: 'center', borderColor: colors.pineDark, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 9, justifyContent: 'center', minHeight: 46 }, teeTimesText: { color: colors.pineDark, fontSize: 13, fontWeight: '700' }, pressed: { opacity: 0.7 },
  photoSection: { gap: 12 }, sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, sectionTitle: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }, photoRow: { flexDirection: 'row', gap: 8 }, photo: { aspectRatio: 1.25, borderRadius: 7, flex: 1 }, photoCredit: { color: colors.muted, fontSize: 9 }, emptyPhotos: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 9, minHeight: 58 }, emptyText: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  disclosures: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }, disclosureRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 58, paddingHorizontal: 2 }, disclosureLabel: { color: colors.pineDark, flex: 1, fontFamily: 'Georgia', fontSize: 14 }, disclosureBody: { backgroundColor: '#F1EEE5', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8, padding: 14 }, personalDetails: { backgroundColor: '#F7F5EF', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, detailDisclosureRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 52, paddingHorizontal: 14 }, detailDisabledRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 52, opacity: 0.65, paddingHorizontal: 14 }, detailRowLabel: { color: colors.ink, flex: 1, fontSize: 12, fontWeight: '700' }, detailRowValue: { color: colors.pineDark, fontSize: 10, fontWeight: '700' }, detailDisabledValue: { color: colors.muted, fontSize: 10, fontWeight: '700' }, detailDropdown: { backgroundColor: '#EFECE3', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, paddingHorizontal: 14, paddingVertical: 13 }, detailHelp: { color: colors.muted, fontSize: 10, lineHeight: 15 }, detailInput: { backgroundColor: '#FFF', borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontSize: 12, minHeight: 42, paddingHorizontal: 11 }, notesInput: { minHeight: 82, paddingTop: 10, textAlignVertical: 'top' }, detailSave: { alignItems: 'center', alignSelf: 'flex-end', backgroundColor: colors.pine, borderRadius: 17, minWidth: 104, paddingHorizontal: 14, paddingVertical: 9 }, detailSaveText: { color: '#FFF', fontSize: 10, fontWeight: '800' }, detailError: { color: colors.error, fontSize: 10, paddingHorizontal: 14, paddingVertical: 10 },
  loadingText: { color: colors.muted, fontSize: 14, paddingVertical: 16, textAlign: 'center' }, retryButton: { alignItems: 'center', alignSelf: 'center', borderColor: colors.pine, borderRadius: 20, borderWidth: 1, minWidth: 92, paddingHorizontal: 16, paddingVertical: 10 }, retryText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
})

function toDemoCourse(course: Course): DemoCourse {
  const heroImage = course.images?.find((image) => image.is_hero && image.url) ?? course.images?.find((image) => image.url)
  return {
    id: String(course.id),
    location: course.region,
    name: course.name,
    rating: course.community_rating ?? 0,
    reviews: String(course.rating_count ?? 0),
    distance: '',
    price: priceTier(course.green_fee),
    accent: '#6E8B84',
    secondary: '#AEC3B7',
    image: heroImage?.url ? { uri: heroImage.url } : undefined,
  }
}

function courseFacts(course: DemoCourse, publicCourse: Course | null) {
  const accessLabel = publicCourse
    ? publicCourse.access
      ? `${titleCase(publicCourse.access)} course`
      : publicCourse.is_public == null
        ? 'Access unavailable'
        : publicCourse.is_public ? 'Public course' : 'Private course'
    : 'Public course'
  const items: { label: string; value: string; secondary?: string }[] = []
  if (publicCourse?.hole_count != null) items.push({ label: 'Holes', value: String(publicCourse.hole_count) })
  if (publicCourse?.par != null) items.push({ label: 'Par', value: String(publicCourse.par) })
  if (publicCourse?.green_fee != null) items.push({ label: 'Green fee', value: priceTier(publicCourse.green_fee) })
  if (publicCourse?.slope_rating != null) items.push({ label: 'Slope', value: String(publicCourse.slope_rating), secondary: publicCourse.difficulty ? titleCase(publicCourse.difficulty) : undefined })
  return {
    accessLabel,
    items: publicCourse ? items.slice(0, 2) : [{ label: 'Green fee', value: course.price }],
  }
}

function priceTier(value: number | null) { if (value == null) return '—'; if (value <= 75) return '$'; if (value <= 150) return '$$'; if (value <= 300) return '$$$'; return '$$$$' }

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function parseRatingCount(value: string): number {
  const normalized = value.toLowerCase().replace(/,/g, '')
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed)) return 0
  return normalized.endsWith('k') ? Math.round(parsed * 1000) : Math.round(parsed)
}

function formatRating(value: number): string {
  return value.toFixed(1)
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

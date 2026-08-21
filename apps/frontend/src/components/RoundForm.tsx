import { Feather } from '@expo/vector-icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'

import { Course, FriendSummary, GolfRound, RoundInput, RoundVisibility } from '../types'
import { colors } from '../ui/theme'

type Props = {
  initialRound?: GolfRound
  initialCourse?: Course | null
  defaultVisibility?: RoundVisibility
  friends: FriendSummary[]
  searchCourses: (query: string) => Promise<Course[]>
  onSubmit: (input: RoundInput) => Promise<void>
  submitLabel: string
}

type DetailSection = 'people' | 'notes' | 'visibility'

export function RoundForm({ initialRound, initialCourse = null, defaultVisibility = 'friends', friends, searchCourses, onSubmit, submitLabel }: Props) {
  const [course, setCourse] = useState<Course | null>(initialRound?.course ?? initialCourse)
  const [courseQuery, setCourseQuery] = useState(initialRound?.course.name ?? initialCourse?.name ?? '')
  const [courseResults, setCourseResults] = useState<Course[]>([])
  const [playedOn, setPlayedOn] = useState(formatDateInput(initialRound?.played_on ?? localToday()))
  const [score, setScore] = useState(initialRound?.score == null ? '' : String(initialRound.score))
  const [favoriteHole, setFavoriteHole] = useState(initialRound?.favorite_hole == null ? '' : String(initialRound.favorite_hole))
  const [note, setNote] = useState(initialRound?.note ?? '')
  const [friendIds, setFriendIds] = useState<number[]>(initialRound?.companions.flatMap((item) => item.friend_user_id == null ? [] : [item.friend_user_id]) ?? [])
  const [guestNames] = useState(initialRound?.companions.flatMap((item) => item.guest_name ? [item.guest_name] : []).join(', ') ?? '')
  const [friendQuery, setFriendQuery] = useState('')
  const [visibility, setVisibility] = useState<RoundVisibility>(initialRound?.visibility ?? defaultVisibility)
  const [favorite, setFavorite] = useState(initialRound?.is_favorite ?? false)
  const [openSection, setOpenSection] = useState<DetailSection | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => monthStart(parseDateInput(playedOn) ?? localToday()))
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchRequest = useRef(0)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchRequest.current += 1
  }, [])

  const parsedDate = parseDateInput(playedOn)
  const scoreNumber = score.trim() ? Number(score) : null
  const favoriteHoleNumber = favoriteHole.trim() ? Number(favoriteHole) : null
  const guests = useMemo(() => listNames(guestNames), [guestNames])
  const visibleFriends = useMemo(() => {
    const normalized = friendQuery.trim().toLocaleLowerCase()
    if (normalized) return friends.filter((friend) => `${friend.display_name} ${friend.username ?? ''}`.toLocaleLowerCase().includes(normalized)).slice(0, 6)
    const selected = friends.filter((friend) => friendIds.includes(friend.id))
    return [...selected, ...friends].filter((friend, index, items) => items.findIndex((item) => item.id === friend.id) === index).slice(0, 4)
  }, [friendIds, friendQuery, friends])
  const courseDateValid = Boolean(course && parsedDate && parsedDate <= localToday())
  const scoreValid = scoreNumber === null || (Number.isInteger(scoreNumber) && scoreNumber >= 40 && scoreNumber <= 250)
  const favoriteHoleValid = favoriteHoleNumber === null || (Number.isInteger(favoriteHoleNumber) && favoriteHoleNumber >= 1 && favoriteHoleNumber <= 18)
  const valid = courseDateValid && scoreValid && favoriteHoleValid
  const peopleCount = friendIds.length + guests.length
  const detailsSummary = favoriteHoleNumber ? `Hole ${favoriteHoleNumber} added` : note.trim() ? 'Notes added' : 'Add details'

  async function runCourseSearch(rawQuery = courseQuery) {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
    const query = rawQuery.trim()
    if (query.length < 3) {
      setCourseResults([])
      setSearching(false)
      return
    }
    const request = ++searchRequest.current
    setSearching(true)
    setError(null)
    try {
      const results = await searchCourses(query)
      if (request === searchRequest.current) setCourseResults(results)
    } catch (reason) {
      if (request === searchRequest.current) setError(message(reason, 'Unable to search courses.'))
    } finally {
      if (request === searchRequest.current) setSearching(false)
    }
  }

  function updateCourseQuery(value: string) {
    setCourseQuery(value)
    if (value !== course?.name) setCourse(null)
    // Invalidate an in-flight response immediately, not only when the next
    // debounced request begins.
    searchRequest.current += 1
    if (value.trim().length < 3) {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchTimer.current = null
      setCourseResults([])
      setSearching(false)
      return
    }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void runCourseSearch(value), 300)
  }

  function openCalendar() {
    setCalendarMonth(monthStart(parseDateInput(playedOn) ?? localToday()))
    setCalendarOpen(true)
  }

  function selectDate(value: string) {
    setPlayedOn(formatDateInput(value))
    setCalendarOpen(false)
  }

  async function submit() {
    if (!valid || !course || !parsedDate || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        course_id: course.id,
        played_on: parsedDate,
        score: scoreNumber,
        note: note.trim() || null,
        favorite_hole: favoriteHoleNumber,
        friend_user_ids: friendIds,
        guest_names: guests,
        visibility,
        is_favorite: favorite,
      })
    } catch (reason) {
      setError(message(reason, 'Unable to save this round.'))
    } finally {
      setSaving(false)
    }
  }

  function toggleSection(section: DetailSection) { setOpenSection((current) => current === section ? null : section) }

  return <View style={styles.form}>
    <Text style={styles.sectionLabel}>Essentials</Text>
    {initialRound ? <SelectedCourse course={course} /> : <>
      <View style={styles.courseSearch}>
        <Feather name="search" color={colors.pineDark} size={20} />
        <TextInput accessibilityLabel="Course" onChangeText={updateCourseQuery} onSubmitEditing={() => void runCourseSearch()} placeholder="Search for a course" placeholderTextColor={colors.muted} returnKeyType="search" style={styles.courseSearchInput} value={courseQuery} />
        <Pressable accessibilityRole="button" accessibilityLabel="Search courses" onPress={() => void runCourseSearch()} style={styles.searchButton}>{searching ? <ActivityIndicator color={colors.pine} size="small" /> : <Feather name="arrow-right" color={colors.pine} size={18} />}</Pressable>
      </View>
      {courseResults.length ? <View style={styles.results}>{courseResults.slice(0, 8).map((result) => <Pressable accessibilityRole="button" accessibilityLabel={`Select ${result.name}`} key={result.id} onPress={() => { setCourse(result); setCourseQuery(result.name); setCourseResults([]) }} style={styles.result}><Text style={styles.resultName}>{result.name}</Text><Text style={styles.help}>{result.region}</Text></Pressable>)}</View> : null}
      {course ? <SelectedCourse course={course} /> : null}
    </>}

    <View style={styles.twoColumns}>
      <View style={styles.essentialField}><FieldLabel text="Date" /><Pressable accessibilityLabel="Played date" accessibilityRole="button" onPress={openCalendar} style={styles.dateButton}><Text style={styles.dateValue}>{playedOn}</Text><Feather name="calendar" color={colors.pine} size={17} /></Pressable></View>
      <View style={styles.essentialField}><FieldLabel text="Score" /><TextInput accessibilityLabel="Score" keyboardType="number-pad" onChangeText={setScore} placeholder="84" placeholderTextColor={colors.muted} style={styles.lineInput} value={score} /></View>
    </View>

    <Text style={[styles.sectionLabel, styles.detailsLabel]}>Round details</Text>
    <View style={styles.detailsList}>
      <DetailRow expanded={openSection === 'people'} label="Played with" onPress={() => toggleSection('people')} value={peopleCount ? `${peopleCount} selected` : 'Add players'} />
      {openSection === 'people' ? <View style={styles.detailEditor}>
        {friends.length > 4 ? <View style={styles.friendSearch}><Feather name="search" color={colors.muted} size={14} /><TextInput accessibilityLabel="Search friends" onChangeText={setFriendQuery} placeholder="Search your friends" placeholderTextColor={colors.muted} style={styles.friendSearchInput} value={friendQuery} /></View> : null}
        {friends.length ? <View style={styles.chips}>{visibleFriends.map((friend) => { const active = friendIds.includes(friend.id); return <Pressable accessibilityRole="button" accessibilityLabel={`${active ? 'Remove' : 'Add'} ${friend.display_name}`} key={friend.id} onPress={() => setFriendIds((current) => active ? current.filter((id) => id !== friend.id) : [...current, friend.id])} style={[styles.chip, active && styles.chipActive]}><Text numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]}>{friend.display_name}</Text></Pressable> })}</View> : <Text style={styles.help}>Follow golfers to add them to a round.</Text>}
      </View> : null}

      <DetailRow expanded={openSection === 'notes'} label="Favorite hole & notes" onPress={() => toggleSection('notes')} value={detailsSummary} />
      {openSection === 'notes' ? <View style={styles.detailEditor}>
        <FieldLabel text="Favorite hole" /><TextInput accessibilityLabel="Favorite hole" keyboardType="number-pad" onChangeText={setFavoriteHole} placeholder="1–18" placeholderTextColor={colors.muted} style={styles.input} value={favoriteHole} />
        <FieldLabel text="Notes" /><TextInput accessibilityLabel="Round notes" multiline onChangeText={setNote} placeholder="What stood out?" placeholderTextColor={colors.muted} style={[styles.input, styles.notes]} value={note} />
      </View> : null}

      <DetailRow expanded={openSection === 'visibility'} icon="users" label="Visibility" onPress={() => toggleSection('visibility')} value={capitalize(visibility)} />
      {openSection === 'visibility' ? <View style={styles.detailEditor}><View style={styles.visibility}>{(['private', 'friends', 'public'] as RoundVisibility[]).map((value) => { const disabled = initialRound?.is_rating_round && value === 'public'; return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected: visibility === value }} disabled={disabled} key={value} onPress={() => setVisibility(value)} style={[styles.visibilityChoice, visibility === value && styles.visibilityActive, disabled && styles.disabled]}><Text style={[styles.visibilityText, visibility === value && styles.visibilityTextActive]}>{capitalize(value)}</Text></Pressable> })}</View></View> : null}

      <View style={styles.favoriteRow}><View style={styles.favoriteLabel}><Text style={styles.detailLabel}>Favorite round</Text><Feather name="star" color={colors.muted} size={19} /></View><Switch accessibilityLabel="Favorite round" onValueChange={setFavorite} trackColor={{ false: colors.line, true: colors.pineSoft }} thumbColor={favorite ? colors.pine : '#FFF'} value={favorite} /></View>
    </View>

    {!courseDateValid ? <Text style={styles.requirement}>Course and a past date are required.</Text> : <Text style={styles.requirement}>Course and date are required.</Text>}
    {!scoreValid ? <Text accessibilityRole="alert" style={styles.validation}>Score must be between 40 and 250.</Text> : null}
    {!favoriteHoleValid ? <Text accessibilityRole="alert" style={styles.validation}>Favorite hole must be between 1 and 18.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !valid || saving }} disabled={!valid || saving} onPress={() => void submit()} style={[styles.submit, (!valid || saving) && styles.disabled]}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitText}>{submitLabel}</Text>}</Pressable>
    <DatePicker calendarMonth={calendarMonth} onClose={() => setCalendarOpen(false)} onMonthChange={setCalendarMonth} onSelect={selectDate} open={calendarOpen} selectedDate={parsedDate} />
  </View>
}

function FieldLabel({ text }: { text: string }) { return <Text style={styles.label}>{text}</Text> }
function SelectedCourse({ course }: { course: Course | null }) { return course ? <View style={styles.selectedCourse}><View style={{ flex: 1, gap: 3 }}><Text style={styles.selectedCourseName}>{course.name}</Text><Text style={styles.selectedCourseRegion}>{course.region}</Text></View><Feather name="check" color={colors.pine} size={22} /></View> : null }
function DetailRow({ expanded, icon, label, onPress, value }: { expanded: boolean; icon?: keyof typeof Feather.glyphMap; label: string; onPress: () => void; value: string }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={({ pressed }) => [styles.detailRow, pressed && styles.pressed]}><Text style={styles.detailLabel}>{label}</Text><View style={styles.detailValue}><Text numberOfLines={1} style={styles.detailValueText}>{value}</Text>{icon ? <Feather name={icon} color={colors.muted} size={17} /> : null}<Feather name={expanded ? 'chevron-down' : 'chevron-right'} color={colors.ink} size={18} /></View></Pressable> }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }
function listNames(value: string) { return listUnique(value.split(',').map((item) => item.trim()).filter(Boolean)) }
function listUnique(values: string[]) { return [...new Set(values)] }
function localToday() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
export function formatDateInput(value: string) { const [year, month, day] = value.split('-'); return year && month && day ? `${month}/${day}/${year}` : value }
export function parseDateInput(value: string) { const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim()); if (!match) return null; const [, month, day, year] = match; const candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`; const date = new Date(`${candidate}T12:00:00`); return date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) && date.getDate() === Number(day) ? candidate : null }

function DatePicker({ calendarMonth, onClose, onMonthChange, onSelect, open, selectedDate }: { calendarMonth: Date; onClose: () => void; onMonthChange: (month: Date) => void; onSelect: (value: string) => void; open: boolean; selectedDate: string | null }) {
  const today = localToday()
  const days = calendarDays(calendarMonth)
  return <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}><View style={styles.calendarOverlay}><View accessibilityLabel="Choose round date" style={styles.calendarCard}><View style={styles.calendarHeader}><View><Text style={styles.calendarKicker}>Round date</Text><Text style={styles.calendarTitle}>{calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text></View><Pressable accessibilityLabel="Close calendar" accessibilityRole="button" onPress={onClose} style={styles.calendarClose}><Feather color={colors.pineDark} name="x" size={20} /></Pressable></View><View style={styles.calendarNav}><Pressable accessibilityLabel="Previous month" accessibilityRole="button" onPress={() => onMonthChange(addMonths(calendarMonth, -1))} style={styles.calendarNavButton}><Feather color={colors.pine} name="chevron-left" size={21} /></Pressable><Text style={styles.calendarHint}>Choose the day you played</Text><Pressable accessibilityLabel="Next month" accessibilityRole="button" onPress={() => onMonthChange(addMonths(calendarMonth, 1))} style={styles.calendarNavButton}><Feather color={colors.pine} name="chevron-right" size={21} /></Pressable></View><View style={styles.weekdays}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View><View style={styles.calendarGrid}>{days.map((day, index) => { if (!day) return <View key={`blank-${index}`} style={styles.calendarDay} />; const value = dateKey(day); const selected = value === selectedDate; const disabled = value > today; return <Pressable accessibilityLabel={`Select ${day.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`} accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} key={value} onPress={() => onSelect(value)} style={[styles.calendarDay, selected && styles.calendarDaySelected, disabled && styles.calendarDayDisabled]}><Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected, disabled && styles.calendarDayTextDisabled]}>{day.getDate()}</Text></Pressable> })}</View><Pressable accessibilityLabel="Select today" accessibilityRole="button" onPress={() => onSelect(today)} style={styles.todayButton}><Text style={styles.todayButtonText}>Today</Text></Pressable></View></View></Modal>
}

function monthStart(value: string) { const date = new Date(`${value}T12:00:00`); return new Date(date.getFullYear(), date.getMonth(), 1) }
function addMonths(value: Date, amount: number) { return new Date(value.getFullYear(), value.getMonth() + amount, 1) }
function dateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function calendarDays(month: Date) { const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); return [...Array(month.getDay()).fill(null), ...Array.from({ length: count }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1))] }

const styles = StyleSheet.create({
  form: { gap: 14 },
  sectionLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  detailsLabel: { marginTop: 14 },
  label: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  courseSearch: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 54, paddingHorizontal: 14 },
  courseSearchInput: { color: colors.ink, flex: 1, fontSize: 14, minHeight: 52, paddingVertical: 12 },
  searchButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  results: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  result: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2, padding: 12 },
  resultName: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  selectedCourse: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, paddingHorizontal: 2, paddingVertical: 12 },
  selectedCourseName: { color: colors.pineDark, fontSize: 15, fontWeight: '800' },
  selectedCourseRegion: { color: colors.muted, fontSize: 11 },
  twoColumns: { flexDirection: 'row', gap: 28 },
  essentialField: { flex: 1, gap: 4 },
  lineInput: { borderBottomColor: colors.muted, borderBottomWidth: StyleSheet.hairlineWidth, color: colors.pineDark, fontSize: 15, minHeight: 42, paddingHorizontal: 0, paddingVertical: 8 }, dateButton: { alignItems: 'center', borderBottomColor: colors.muted, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 42, paddingVertical: 8 }, dateValue: { color: colors.pineDark, fontSize: 15 },
  detailsList: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  detailRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 2 },
  detailLabel: { color: colors.pineDark, fontSize: 14, fontWeight: '700' },
  detailValue: { alignItems: 'center', flexDirection: 'row', gap: 8, marginLeft: 12 },
  detailValueText: { color: colors.muted, fontSize: 12, maxWidth: 106 },
  detailEditor: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, paddingHorizontal: 2, paddingVertical: 14 },
  input: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontSize: 13, minHeight: 44, paddingHorizontal: 13, paddingVertical: 10 },
  notes: { minHeight: 88, textAlignVertical: 'top' },
  friendSearch: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 7, minHeight: 38, paddingHorizontal: 11 },
  friendSearchInput: { color: colors.ink, flex: 1, fontSize: 11, paddingVertical: 7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 16, borderWidth: 1, maxWidth: 150, paddingHorizontal: 10, paddingVertical: 7 },
  chipActive: { backgroundColor: colors.pine, borderColor: colors.pine },
  chipText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  chipTextActive: { color: '#FFF' },
  visibility: { flexDirection: 'row', gap: 7 },
  visibilityChoice: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 18, borderWidth: 1, flex: 1, paddingVertical: 9 },
  visibilityActive: { backgroundColor: colors.pine, borderColor: colors.pine },
  visibilityText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  visibilityTextActive: { color: '#FFF' },
  favoriteRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 2 },
  favoriteLabel: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  help: { color: colors.muted, fontSize: 10, lineHeight: 14 },
  requirement: { color: colors.muted, fontSize: 10, marginTop: 8 },
  validation: { color: colors.error, fontSize: 10 },
  error: { color: colors.error, fontSize: 11, textAlign: 'center' },
  submit: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: 12, justifyContent: 'center', minHeight: 50 },
  submitText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.65 },
  calendarOverlay: { alignItems: 'center', backgroundColor: 'rgba(28, 37, 32, 0.42)', flex: 1, justifyContent: 'center', padding: 22 }, calendarCard: { backgroundColor: colors.background, borderRadius: 20, elevation: 8, maxWidth: 380, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 18, width: '100%' }, calendarHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, calendarKicker: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' }, calendarTitle: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 25, marginTop: 3 }, calendarClose: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 }, calendarNav: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 19 }, calendarNavButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 }, calendarHint: { color: colors.muted, fontSize: 10 }, weekdays: { flexDirection: 'row', marginTop: 12 }, weekday: { color: colors.muted, flex: 1, fontSize: 10, fontWeight: '800', textAlign: 'center' }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 7 }, calendarDay: { alignItems: 'center', height: 40, justifyContent: 'center', width: '14.2857%' }, calendarDaySelected: { backgroundColor: colors.pine, borderRadius: 20 }, calendarDayDisabled: { opacity: 0.3 }, calendarDayText: { color: colors.ink, fontSize: 13, fontWeight: '700' }, calendarDayTextSelected: { color: '#FFF' }, calendarDayTextDisabled: { color: colors.muted }, todayButton: { alignItems: 'center', borderColor: colors.pine, borderRadius: 16, borderWidth: 1, marginTop: 14, minHeight: 34, justifyContent: 'center' }, todayButtonText: { color: colors.pine, fontSize: 11, fontWeight: '800' },
})

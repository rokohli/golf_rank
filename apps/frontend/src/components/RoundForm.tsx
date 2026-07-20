import { Feather } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'

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
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  const valid = Boolean(course && parsedDate && parsedDate <= localToday()
    && (scoreNumber === null || (Number.isInteger(scoreNumber) && scoreNumber >= 40 && scoreNumber <= 250))
    && (favoriteHoleNumber === null || (Number.isInteger(favoriteHoleNumber) && favoriteHoleNumber >= 1 && favoriteHoleNumber <= 18)))

  async function runCourseSearch() {
    const query = courseQuery.trim()
    if (!query) return
    setSearching(true)
    setError(null)
    try {
      setCourseResults(await searchCourses(query))
    } catch (reason) {
      setError(message(reason, 'Unable to search courses.'))
    } finally {
      setSearching(false)
    }
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

  return <View style={styles.form}>
    <FieldLabel text="Course" />
    {initialRound ? <View style={styles.fixedCourse}><Text style={styles.resultName}>{course?.name}</Text><Text style={styles.help}>{course?.region}</Text></View> : <>
      <View style={styles.searchRow}>
        <TextInput accessibilityLabel="Course" onChangeText={(value) => { setCourseQuery(value); if (value !== course?.name) setCourse(null) }} placeholder="Search courses" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1 }]} value={courseQuery} />
        <Pressable accessibilityRole="button" accessibilityLabel="Search courses" onPress={() => void runCourseSearch()} style={styles.searchButton}>{searching ? <ActivityIndicator color="#FFF" size="small" /> : <Feather name="search" color="#FFF" size={17} />}</Pressable>
      </View>
      {courseResults.length ? <View style={styles.results}>{courseResults.slice(0, 8).map((result) => <Pressable accessibilityRole="button" accessibilityLabel={`Select ${result.name}`} key={result.id} onPress={() => { setCourse(result); setCourseQuery(result.name); setCourseResults([]) }} style={styles.result}><Text style={styles.resultName}>{result.name}</Text><Text style={styles.help}>{result.region}</Text></Pressable>)}</View> : null}
    </>}
    {course ? <Text style={styles.selected}>Selected: {course.name} · {course.region}</Text> : <Text style={styles.help}>Choose a course before saving.</Text>}

    <View style={styles.twoColumns}>
      <View style={{ flex: 1 }}><FieldLabel text="Date" /><TextInput accessibilityLabel="Played date" autoCapitalize="none" keyboardType="numbers-and-punctuation" onChangeText={setPlayedOn} placeholder="MM/DD/YYYY" placeholderTextColor={colors.muted} style={styles.input} value={playedOn} /></View>
      <View style={{ flex: 1 }}><FieldLabel text={initialRound ? 'Score' : 'Score (optional)'} /><TextInput accessibilityLabel="Score" keyboardType="number-pad" onChangeText={setScore} placeholder="84" placeholderTextColor={colors.muted} style={styles.input} value={score} /></View>
    </View>
    <FieldLabel text={initialRound ? 'Favorite hole' : 'Favorite hole (optional)'} /><TextInput accessibilityLabel="Favorite hole" keyboardType="number-pad" onChangeText={setFavoriteHole} placeholder="1–18" placeholderTextColor={colors.muted} style={styles.input} value={favoriteHole} />
    <FieldLabel text={initialRound ? 'Notes' : 'Notes (optional)'} /><TextInput accessibilityLabel="Round notes" multiline onChangeText={setNote} placeholder="What stood out?" placeholderTextColor={colors.muted} style={[styles.input, styles.notes]} value={note} />

    <FieldLabel text="Friends" />
    {friends.length > 4 ? <View style={styles.friendSearch}><Feather name="search" color={colors.muted} size={14} /><TextInput accessibilityLabel="Search friends" onChangeText={setFriendQuery} placeholder="Search your friends" placeholderTextColor={colors.muted} style={styles.friendSearchInput} value={friendQuery} /></View> : null}
    {friends.length ? <View style={styles.chips}>{visibleFriends.map((friend) => { const active = friendIds.includes(friend.id); return <Pressable accessibilityRole="button" accessibilityLabel={`${active ? 'Remove' : 'Add'} ${friend.display_name}`} key={friend.id} onPress={() => setFriendIds((current) => active ? current.filter((id) => id !== friend.id) : [...current, friend.id])} style={[styles.chip, active && styles.chipActive]}><Text numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]}>{friend.display_name}</Text></Pressable> })}</View> : <Text style={styles.help}>Follow golfers to add them to a round.</Text>}

    <FieldLabel text="Who can see this?" /><View style={styles.visibility}>{(['private', 'friends', 'public'] as RoundVisibility[]).map((value) => { const disabled = initialRound?.is_rating_round && value === 'public'; return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected: visibility === value }} disabled={disabled} key={value} onPress={() => setVisibility(value)} style={[styles.visibilityChoice, visibility === value && styles.visibilityActive, disabled && styles.disabled]}><Text style={[styles.visibilityText, visibility === value && styles.visibilityTextActive]}>{capitalize(value)}</Text></Pressable> })}</View>
    <View style={styles.favoriteRow}><View><Text style={styles.label}>Favorite round</Text><Text style={styles.help}>Show this round in your Favorites filter.</Text></View><Switch accessibilityLabel="Favorite round" onValueChange={setFavorite} trackColor={{ false: colors.line, true: colors.pineSoft }} thumbColor={favorite ? colors.pine : '#FFF'} value={favorite} /></View>

    {!valid ? <Text style={styles.validation}>Select a course, use a past date, and enter scores from 40–250 or holes from 1–18.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !valid || saving }} disabled={!valid || saving} onPress={() => void submit()} style={[styles.submit, (!valid || saving) && styles.disabled]}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitText}>{submitLabel}</Text>}</Pressable>
  </View>
}

function FieldLabel({ text }: { text: string }) { return <Text style={styles.label}>{text}</Text> }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }
function listNames(value: string) { return listUnique(value.split(',').map((item) => item.trim()).filter(Boolean)) }
function listUnique(values: string[]) { return [...new Set(values)] }
function localToday() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
export function formatDateInput(value: string) { const [year, month, day] = value.split('-'); return year && month && day ? `${month}/${day}/${year}` : value }
export function parseDateInput(value: string) { const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim()); if (!match) return null; const [, month, day, year] = match; const candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`; const date = new Date(`${candidate}T12:00:00`); return date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) && date.getDate() === Number(day) ? candidate : null }

const styles = StyleSheet.create({
  form: { gap: 10 }, label: { color: colors.ink, fontSize: 11, fontWeight: '800', marginTop: 4 }, input: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 11, borderWidth: 1, color: colors.ink, fontSize: 13, minHeight: 46, paddingHorizontal: 13, paddingVertical: 10 }, notes: { minHeight: 96, textAlignVertical: 'top' }, fixedCourse: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 11, borderWidth: 1, gap: 2, padding: 12 }, searchRow: { flexDirection: 'row', gap: 8 }, searchButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: 11, justifyContent: 'center', width: 48 }, results: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 11, borderWidth: 1, overflow: 'hidden' }, result: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2, padding: 11 }, resultName: { color: colors.ink, fontSize: 12, fontWeight: '800' }, selected: { color: colors.pine, fontSize: 10, fontWeight: '700' }, help: { color: colors.muted, fontSize: 10, lineHeight: 14 }, twoColumns: { flexDirection: 'row', gap: 10 }, friendSearch: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 7, minHeight: 38, paddingHorizontal: 11 }, friendSearchInput: { color: colors.ink, flex: 1, fontSize: 11, paddingVertical: 7 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 16, borderWidth: 1, maxWidth: 150, paddingHorizontal: 10, paddingVertical: 7 }, chipActive: { backgroundColor: colors.pine, borderColor: colors.pine }, chipText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, chipTextActive: { color: '#FFF' }, visibility: { flexDirection: 'row', gap: 7 }, visibilityChoice: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 18, borderWidth: 1, flex: 1, paddingVertical: 9 }, visibilityActive: { backgroundColor: colors.pine, borderColor: colors.pine }, visibilityText: { color: colors.muted, fontSize: 10, fontWeight: '800' }, visibilityTextActive: { color: '#FFF' }, favoriteRow: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 11, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 12 }, validation: { color: colors.error, fontSize: 10 }, error: { color: colors.error, fontSize: 11, textAlign: 'center' }, submit: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: 24, justifyContent: 'center', minHeight: 48, marginTop: 8 }, submitText: { color: '#FFF', fontSize: 13, fontWeight: '800' }, disabled: { opacity: 0.45 },
})

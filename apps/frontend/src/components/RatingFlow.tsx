import { Feather } from '@expo/vector-icons'
import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'

import {
  ComparisonResult,
  Course,
  CourseRatingInput,
  CourseRatingState,
  FriendSummary,
  RatingCandidate,
  RatingDetailsInput,
  RatingTier,
} from '../types'
import { colors } from '../ui/theme'

type Guest = { name: string; phone: string | null }
type Stage = 'tier' | 'round' | 'comparison' | 'reveal'
type RoundEditor = 'played' | 'score' | 'notes' | 'favorite' | 'people' | null

export type RatingFlowProps = {
  course: Course
  initialRating: CourseRatingState
  friends: FriendSummary[]
  getCandidate: (tier: RatingTier) => Promise<RatingCandidate>
  saveRating: (input: CourseRatingInput) => Promise<CourseRatingState>
  saveDetails: (input: RatingDetailsInput) => Promise<CourseRatingState>
  onClose: () => void
  today?: string
}

const tiers: { key: RatingTier; name: string; range: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'green', name: 'Green', range: '8.5–10', icon: 'flag' },
  { key: 'fairway', name: 'Fairway', range: '7–8.4', icon: 'compass' },
  { key: 'rough', name: 'Rough', range: '5–6.9', icon: 'wind' },
  { key: 'bunker', name: 'Bunker', range: '1–4.9', icon: 'circle' },
]

const courseImages = [
  require('../../assets/course-images/coastal-course.png'),
  require('../../assets/course-images/parkland-course.png'),
  require('../../assets/course-images/dunes-course.png'),
]

function localToday() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function RatingFlow({
  course,
  initialRating,
  friends,
  getCandidate,
  saveRating,
  saveDetails,
  onClose,
  today = localToday(),
}: RatingFlowProps) {
  const initialFriendIds = initialRating.companions.flatMap((item) => item.friend_user_id == null ? [] : [item.friend_user_id])
  const initialGuests = initialRating.companions.flatMap((item) => item.guest_name ? [{ name: item.guest_name, phone: null }] : [])
  const initialDetails = detailsPayload(
    initialRating.round?.note ?? '',
    initialRating.round?.favorite_hole == null ? '' : String(initialRating.round.favorite_hole),
    initialFriendIds,
    initialGuests,
    initialRating.round?.visibility === 'friends',
  )

  const [stage, setStage] = useState<Stage>('tier')
  const [tier, setTier] = useState<RatingTier | null>(initialRating.tier)
  const [playedOnInput, setPlayedOnInput] = useState(formatDateInput(initialRating.round?.played_on ?? today))
  const [score, setScore] = useState(initialRating.round?.score == null ? '' : String(initialRating.round.score))
  const [candidate, setCandidate] = useState<RatingCandidate>(null)
  const [ratingState, setRatingState] = useState(initialRating)
  const [coreBaseline, setCoreBaseline] = useState({
    tier: initialRating.tier,
    playedOn: initialRating.round?.played_on ?? null,
    score: initialRating.round?.score == null ? '' : String(initialRating.round.score),
  })
  const [detailsBaseline, setDetailsBaseline] = useState(initialDetails)
  const [note, setNote] = useState(initialRating.round?.note ?? '')
  const [favoriteHole, setFavoriteHole] = useState(initialRating.round?.favorite_hole == null ? '' : String(initialRating.round.favorite_hole))
  const [friendIds, setFriendIds] = useState<number[]>(initialFriendIds)
  const [friendQuery, setFriendQuery] = useState('')
  const [guests] = useState<Guest[]>(initialGuests)
  const [shareWithFriends, setShareWithFriends] = useState(initialRating.round?.visibility === 'friends')
  const [roundEditor, setRoundEditor] = useState<RoundEditor>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guestMessage, setGuestMessage] = useState<string | null>(null)
  const savingRef = useRef(false)

  const currentDetails = detailsPayload(note, favoriteHole, friendIds, guests, shareWithFriends)
  const visibleFriends = useMemo(() => {
    const normalized = friendQuery.trim().toLocaleLowerCase()
    if (normalized) return friends.filter((friend) => `${friend.display_name} ${friend.username ?? ''}`.toLocaleLowerCase().includes(normalized)).slice(0, 6)
    const selected = friends.filter((friend) => friendIds.includes(friend.id))
    return [...selected, ...friends].filter((friend, index, items) => items.findIndex((item) => item.id === friend.id) === index).slice(0, 4)
  }, [friendIds, friendQuery, friends])
  const detailsChanged = JSON.stringify(detailsBaseline) !== JSON.stringify(currentDetails)
  const playedOn = parseUsDate(playedOnInput)
  const coreUnchanged = coreBaseline.tier === tier
    && coreBaseline.playedOn === playedOn
    && coreBaseline.score === score.trim()
  const scoreNumber = score.trim() ? Number(score) : null
  const roundValid = playedOn !== null
    && playedOn <= today
    && (scoreNumber === null || (Number.isInteger(scoreNumber) && scoreNumber >= 40 && scoreNumber <= 250))
  const favoriteHoleValid = currentDetails.favorite_hole === null
    || (Number.isInteger(currentDetails.favorite_hole) && currentDetails.favorite_hole >= 1 && currentDetails.favorite_hole <= 18)

  async function continueFromRound() {
    if (!tier || !playedOn || !roundValid || !favoriteHoleValid) return
    setError(null)
    if (coreUnchanged && ratingState.personal_rating != null) {
      if (!detailsChanged) {
        setStage('reveal')
        return
      }
      setBusy(true)
      try {
        const saved = await saveDetails(currentDetails)
        setRatingState(saved)
        setDetailsBaseline(currentDetails)
        setStage('reveal')
      } catch (reason) {
        setError(errorMessage(reason, 'Unable to save your round details. Your answers are still here.'))
      } finally {
        setBusy(false)
      }
      return
    }
    if (tier === coreBaseline.tier) {
      await persistRating(null, null)
      return
    }
    setCandidate(null)
    setBusy(true)
    try {
      const nextCandidate = await getCandidate(tier)
      setCandidate(nextCandidate)
      if (nextCandidate) setStage('comparison')
      else await persistRating(null, null, true)
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to load a comparison. Your answers are still here.'))
    } finally {
      setBusy(false)
    }
  }

  async function persistRating(comparisonCourseId: number | null, result: ComparisonResult | null, alreadyBusy = false) {
    if (!tier || !playedOn || savingRef.current) return
    savingRef.current = true
    setError(null)
    if (!alreadyBusy) setBusy(true)
    const input: CourseRatingInput = comparisonCourseId && result
      ? { tier, played_on: playedOn, score: scoreNumber, comparison_course_id: comparisonCourseId, comparison_result: result }
      : { tier, played_on: playedOn, score: scoreNumber }
    let saved: CourseRatingState
    try {
      saved = await saveRating(input)
      setRatingState(saved)
      setCoreBaseline({ tier, playedOn, score: score.trim() })
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to save your rating. Your answers are still here.'))
      savingRef.current = false
      setBusy(false)
      return
    }

    if (detailsChanged) {
      try {
        saved = await saveDetails(currentDetails)
        setRatingState(saved)
        setDetailsBaseline(currentDetails)
      } catch (reason) {
        setError(errorMessage(reason, 'Your rating was saved, but the round details were not. Tap Continue to retry.'))
        setStage('round')
        savingRef.current = false
        setBusy(false)
        return
      }
    }
    setStage('reveal')
    savingRef.current = false
    setBusy(false)
  }

  const title = useMemo(() => {
    if (stage === 'tier') return 'Where does it sit?'
    if (stage === 'round') return 'About the round'
    if (stage === 'comparison') return 'Which would you play again?'
    return `${shortCourseName(course.name)} lands at`
  }, [course.name, stage])

  function goBack() {
    setError(null)
    if (stage === 'tier') onClose()
    else if (stage === 'round') setStage('tier')
    else if (stage === 'comparison') setStage('round')
    else setStage('round')
  }

  function selectTier(nextTier: RatingTier) {
    setTier(nextTier)
    setCandidate(null)
    setError(null)
  }

  function toggleEditor(editor: RoundEditor) {
    setRoundEditor((current) => current === editor ? null : editor)
    setGuestMessage(null)
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={goBack} style={styles.iconButton}>
            <Feather name="arrow-left" size={21} color={colors.ink} />
          </Pressable>
          <Text numberOfLines={1} style={styles.courseName}>{course.name}</Text>
          <Pressable accessibilityLabel="Close rating" accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.iconButton}>
            <Feather name="x" size={21} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.headingBlock, stage === 'reveal' && styles.revealHeading]}>
            <Text style={[styles.title, stage === 'reveal' && styles.revealTitle]}>{title}</Text>
            {stage === 'tier' ? <Text style={styles.subtitle}>Start with the group that feels right.</Text> : null}
          </View>

          {stage === 'tier' ? (
            <View style={styles.stageBody}>
              <View style={styles.tierList}>
                {tiers.map((item) => {
                  const selected = tier === item.key
                  return <Pressable
                    key={item.key}
                    accessibilityLabel={`${item.name} ${item.range}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => selectTier(item.key)}
                    style={({ pressed }) => [styles.tierRow, pressed && styles.pressed]}
                  >
                    <View style={[styles.tierIcon, selected && styles.tierIconSelected]}><Feather name={item.icon} size={20} color={colors.pine} /></View>
                    <Text style={styles.tierName}>{item.name}</Text>
                    <Text style={styles.tierRange}>{item.range}</Text>
                    <View style={styles.tierCheck}>{selected ? <Feather name="check" size={22} color={colors.pine} /> : null}</View>
                  </Pressable>
                })}
              </View>
              <ActionButton disabled={!tier} label="Continue" onPress={() => setStage('round')} />
            </View>
          ) : null}

          {stage === 'round' ? (
            <View style={styles.stageBody}>
              <View style={styles.roundList}>
                <RoundRow expanded={roundEditor === 'played'} icon="calendar" label="Played" onPress={() => toggleEditor('played')} value={playedOn ? formatPlayedDate(playedOn) : playedOnInput} />
                {roundEditor === 'played' ? <InlineField accessibilityLabel="Date played" keyboardType="numbers-and-punctuation" value={playedOnInput} onChangeText={setPlayedOnInput} placeholder="MM/DD/YYYY" /> : null}
                <RoundRow expanded={roundEditor === 'score'} icon="file-text" label="Score" onPress={() => toggleEditor('score')} />
                {roundEditor === 'score' ? <InlineField accessibilityLabel="Golf score" keyboardType="number-pad" value={score} onChangeText={setScore} placeholder="e.g. 82" /> : null}
                <RoundRow expanded={roundEditor === 'notes'} icon="edit-3" label="Notes" onPress={() => toggleEditor('notes')} />
                {roundEditor === 'notes' ? <InlineField accessibilityLabel="Round notes" multiline value={note} onChangeText={setNote} placeholder="What stood out?" /> : null}
                <RoundRow expanded={roundEditor === 'favorite'} icon="flag" label="Favorite hole" onPress={() => toggleEditor('favorite')} />
                {roundEditor === 'favorite' ? <InlineField accessibilityLabel="Round favorite hole" keyboardType="number-pad" value={favoriteHole} onChangeText={setFavoriteHole} placeholder="1–18" /> : null}
                <RoundRow expanded={roundEditor === 'people'} icon="users" label="Friends" onPress={() => toggleEditor('people')} />
                {roundEditor === 'people' ? <View style={styles.peopleEditor}>
                  {friends.length > 4 ? <View style={styles.friendSearch}><Feather name="search" size={14} color={colors.muted} /><TextInput accessibilityLabel="Search friends" onChangeText={setFriendQuery} placeholder="Search your friends" placeholderTextColor={colors.muted} style={styles.friendSearchInput} value={friendQuery} /></View> : null}
                  {friends.length ? <View style={styles.friendWrap}>{visibleFriends.map((friend) => {
                    const selected = friendIds.includes(friend.id)
                    return <Pressable key={friend.id} accessibilityLabel={`${selected ? 'Remove' : 'Select'} ${friend.display_name}`} accessibilityRole="button" onPress={() => setFriendIds((current) => selected ? current.filter((id) => id !== friend.id) : [...current, friend.id])} style={[styles.friendChip, selected && styles.friendChipSelected]}><Text style={[styles.friendChipText, selected && styles.friendChipTextSelected]}>{friend.display_name}</Text></Pressable>
                  })}</View> : <Text style={styles.help}>No friends added yet.</Text>}
                  <View style={styles.switchRow}><Text style={styles.shareLabel}>Share with friends</Text><Switch accessibilityLabel="Share with friends" onValueChange={setShareWithFriends} trackColor={{ false: colors.line, true: colors.pineSoft }} thumbColor={shareWithFriends ? colors.pine : '#FFFFFF'} value={shareWithFriends} /></View>
                </View> : null}
                <RoundRow icon="camera" label="Photos" onPress={() => setGuestMessage('Photo upload is coming soon.')} />
              </View>
              {!roundValid ? <Text accessibilityRole="alert" style={styles.error}>Enter a valid date in MM/DD/YYYY (not in the future) and a score from 40 to 250.</Text> : null}
              {!favoriteHoleValid ? <Text accessibilityRole="alert" style={styles.error}>Favorite hole must be between 1 and 18.</Text> : null}
              <ActionButton disabled={!roundValid || !favoriteHoleValid || busy} label={busy ? 'Saving...' : error ? 'Retry' : 'Continue'} onPress={continueFromRound} />
            </View>
          ) : null}

          {stage === 'comparison' && candidate ? (
            <View style={styles.comparisonStage}>
              <CourseChoice course={course} disabled={busy} imageIndex={0} onPress={() => persistRating(candidate.id, 'course_a')} />
              <View style={styles.versusRow}><View style={styles.versusLine} /><Text style={styles.versus}>VS.</Text><View style={styles.versusLine} /></View>
              <CourseChoice course={candidate} disabled={busy} imageIndex={1} onPress={() => persistRating(candidate.id, 'course_b')} />
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => persistRating(candidate.id, 'too_close')} style={styles.tooClose}><Text style={styles.tooCloseText}>Too close</Text></Pressable>
            </View>
          ) : null}

          {stage === 'reveal' ? (
            <View style={styles.reveal}>
              <Text accessibilityLabel={`Your rating is ${ratingState.personal_rating} out of 10`} style={styles.ratingValue}>
                {ratingState.personal_rating ?? '—'} <Text style={styles.outOf}>/ 10</Text>
              </Text>
              <View style={styles.goldRule} />
              <Text style={styles.revealMeta}>{tierName(ratingState.tier)}  ·  Your course rating</Text>
              <View style={styles.revealSpacer} />
              <ActionButton label="Done" onPress={onClose} />
            </View>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {guestMessage ? <Text accessibilityRole="alert" style={styles.message}>{guestMessage}</Text> : null}
          {busy ? <ActivityIndicator accessibilityLabel="Loading" color={colors.pine} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function RoundRow({ expanded = false, icon, label, value, onPress }: { expanded?: boolean; icon: keyof typeof Feather.glyphMap; label: string; value?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} onPress={onPress} style={({ pressed }) => [styles.roundRow, pressed && styles.pressed]}>
    <Feather name={icon} size={21} color={colors.pineDark} />
    <Text style={styles.roundLabel}>{label}</Text>
    {value ? <Text numberOfLines={1} style={styles.roundValue}>{value}</Text> : null}
    <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={colors.pineDark} />
  </Pressable>
}

function InlineField(props: React.ComponentProps<typeof TextInput>) {
  return <View style={styles.inlineFieldWrap}><TextInput placeholderTextColor="#929A95" style={[styles.inlineField, props.multiline && styles.multiline]} {...props} /></View>
}

function CourseChoice({ course, imageIndex, disabled, onPress }: { course: Course; imageIndex: number; disabled: boolean; onPress: () => void }) {
  return <Pressable
    accessibilityLabel={course.name}
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.courseChoice, pressed && styles.courseChoicePressed]}
  >
    <ImageBackground source={courseImages[imageIndex % courseImages.length]} style={styles.courseImage} imageStyle={styles.courseImageRadius} />
    <View style={styles.courseCopy}><Text style={styles.comparisonName}>{course.name}</Text><Text style={styles.courseRegion}>{course.region}</Text></View>
  </Pressable>
}

function ActionButton({ disabled, label, onPress }: { disabled?: boolean; label: string; onPress: () => void | Promise<void> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && !disabled && styles.actionPressed]}><Text style={styles.actionButtonText}>{label}</Text></Pressable>
}

function detailsPayload(note: string, favoriteHole: string, friendIds: number[], guests: Guest[], shareWithFriends: boolean): RatingDetailsInput {
  return {
    note: note.trim() || null,
    favorite_hole: favoriteHole.trim() ? Number(favoriteHole) : null,
    friend_user_ids: friendIds,
    guest_names: guests.map((guest) => guest.name),
    visibility: shareWithFriends ? 'friends' : 'private',
  }
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

function formatPlayedDate(value: string) {
  if (!isValidDate(value)) return value
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)))
}

function formatDateInput(value: string) {
  if (!isValidDate(value)) return value
  const [year, month, day] = value.split('-')
  return `${month}/${day}/${year}`
}

function parseUsDate(value: string) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  const [, month, day, year] = match
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return isValidDate(iso) ? iso : null
}

function tierName(tier: RatingTier | null) {
  return tiers.find((item) => item.key === tier)?.name ?? 'Rated'
}

function shortCourseName(name: string) {
  return name.replace(/\s+(Golf Links|Golf Club)$/i, '')
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#FBF8F1', flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  courseName: { color: colors.ink, flex: 1, fontSize: 13, fontWeight: '700', marginHorizontal: 10, textAlign: 'center' },
  content: { flexGrow: 1, gap: 24, padding: 24, paddingBottom: 28 },
  headingBlock: { gap: 8, marginTop: 18 },
  title: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 35, letterSpacing: -0.8, lineHeight: 41, textAlign: 'center' },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  stageBody: { flex: 1, gap: 22 },
  tierList: { borderTopColor: '#D8D3C7', borderTopWidth: StyleSheet.hairlineWidth },
  tierRow: { alignItems: 'center', borderBottomColor: '#D8D3C7', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 82, paddingHorizontal: 10 },
  tierIcon: { alignItems: 'center', borderColor: '#A8B9B0', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, height: 48, justifyContent: 'center', width: 48 },
  tierIconSelected: { borderColor: colors.gold },
  tierName: { color: colors.pineDark, flex: 1, fontFamily: 'Georgia', fontSize: 20, marginLeft: 18 },
  tierRange: { color: colors.ink, fontSize: 14 },
  tierCheck: { alignItems: 'flex-end', width: 34 },
  actionButton: { alignItems: 'center', backgroundColor: colors.pineDark, borderRadius: 2, justifyContent: 'center', marginTop: 'auto', minHeight: 54, paddingHorizontal: 20 },
  actionButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  actionPressed: { opacity: 0.86 },
  disabled: { opacity: 0.35 },
  pressed: { backgroundColor: 'rgba(23, 76, 56, 0.045)' },
  roundList: { borderTopColor: '#D8D3C7', borderTopWidth: StyleSheet.hairlineWidth },
  roundRow: { alignItems: 'center', borderBottomColor: '#D8D3C7', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 16, minHeight: 70, paddingHorizontal: 14 },
  roundLabel: { color: colors.pineDark, flex: 1, fontSize: 15, fontWeight: '600' },
  roundValue: { color: colors.muted, fontSize: 13, maxWidth: 118 },
  inlineFieldWrap: { borderBottomColor: '#D8D3C7', borderBottomWidth: StyleSheet.hairlineWidth, padding: 12 },
  inlineField: { backgroundColor: '#FFFFFF', borderColor: '#D8D3C7', borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, color: colors.ink, fontSize: 15, minHeight: 46, paddingHorizontal: 13, paddingVertical: 11 },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  peopleEditor: { borderBottomColor: '#D8D3C7', borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, padding: 14 },
  friendSearch: { alignItems: 'center', borderColor: colors.line, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 7, minHeight: 38, paddingHorizontal: 11 },
  friendSearchInput: { color: colors.ink, flex: 1, fontSize: 11, paddingVertical: 7 },
  friendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  friendChip: { borderColor: '#C9CBC5', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  friendChipSelected: { backgroundColor: colors.pine, borderColor: colors.pine },
  friendChipText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  friendChipTextSelected: { color: '#FFFFFF' },
  switchRow: { alignItems: 'center', borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8 },
  shareLabel: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.error, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  message: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  comparisonStage: { gap: 18 },
  courseChoice: { alignItems: 'center', borderColor: colors.pineDark, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 16, minHeight: 136, padding: 12 },
  courseChoicePressed: { backgroundColor: colors.pineSoft, borderWidth: 1, transform: [{ scale: 0.995 }] },
  courseImage: { height: 112, width: 140 },
  courseImageRadius: { borderRadius: 3 },
  courseCopy: { flex: 1, gap: 8 },
  comparisonName: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 20, lineHeight: 24 },
  courseRegion: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  versusRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  versusLine: { backgroundColor: '#D8D3C7', flex: 1, height: StyleSheet.hairlineWidth },
  versus: { color: colors.gold, fontFamily: 'Georgia', fontSize: 17 },
  tooClose: { alignItems: 'center', alignSelf: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: 18 },
  tooCloseText: { borderBottomColor: colors.pineDark, borderBottomWidth: StyleSheet.hairlineWidth, color: colors.pineDark, fontSize: 14, fontWeight: '700', paddingBottom: 3 },
  revealHeading: { marginTop: 95 },
  revealTitle: { fontSize: 28, lineHeight: 34 },
  reveal: { alignItems: 'center', flex: 1, gap: 20 },
  ratingValue: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 76, letterSpacing: -2.5 },
  outOf: { color: colors.pineDark, fontSize: 32, letterSpacing: -1 },
  goldRule: { backgroundColor: colors.gold, height: StyleSheet.hairlineWidth, width: '72%' },
  revealMeta: { color: colors.pineDark, fontSize: 13, fontWeight: '600' },
  revealSpacer: { flex: 1, minHeight: 120 },
})

import { Feather } from '@expo/vector-icons'
import * as Contacts from 'expo-contacts'
import * as SMS from 'expo-sms'
import { ReactNode, useMemo, useState } from 'react'
import {
  ActivityIndicator,
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
import { colors, radii } from '../ui/theme'

type Guest = { name: string; phone: string | null }

export type ContactsAdapter = {
  requestPermission: () => Promise<'granted' | 'denied'>
  pickContact: () => Promise<Guest | null>
}

export type SmsAdapter = {
  isAvailable: () => Promise<boolean>
  send: (phone: string, message: string) => Promise<void>
}

export type RatingFlowProps = {
  course: Course
  initialRating: CourseRatingState
  friends: FriendSummary[]
  getCandidate: (tier: RatingTier) => Promise<RatingCandidate>
  saveRating: (input: CourseRatingInput) => Promise<CourseRatingState>
  saveDetails: (input: RatingDetailsInput) => Promise<CourseRatingState>
  onClose: () => void
  contacts?: ContactsAdapter
  sms?: SmsAdapter
  platform?: 'android' | 'ios' | 'web'
  today?: string
}

type Stage = 'tier' | 'round' | 'comparison' | 'reveal' | 'details'

const tiers: { key: RatingTier; name: string; range: string; description: string }[] = [
  { key: 'green', name: 'Green', range: '8.5–10', description: 'One of your very best' },
  { key: 'fairway', name: 'Fairway', range: '7–8.4', description: 'A course you really enjoyed' },
  { key: 'rough', name: 'Rough', range: '5–6.9', description: 'Good, with some reservations' },
  { key: 'bunker', name: 'Bunker', range: '1–4.9', description: 'Not one you would rush back to' },
]

const comparisonOptions: { value: ComparisonResult; label: string }[] = [
  { value: 'course_a', label: 'Prefer this course' },
  { value: 'course_b', label: 'Prefer the other course' },
  { value: 'too_close', label: 'Too close' },
  { value: 'not_sure', label: 'Not sure' },
]

function localToday() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

const defaultContacts: ContactsAdapter = {
  async requestPermission() {
    const response = await Contacts.requestPermissionsAsync()
    return response.status === 'granted' ? 'granted' : 'denied'
  },
  async pickContact() {
    const contact = await Contacts.presentContactPickerAsync()
    if (!contact) return null
    const name = contact.name?.trim() || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim()
    if (!name) return null
    return { name, phone: contact.phoneNumbers?.[0]?.number ?? null }
  },
}

const defaultSms: SmsAdapter = {
  isAvailable: SMS.isAvailableAsync,
  async send(phone, message) {
    await SMS.sendSMSAsync(phone, message)
  },
}

export function RatingFlow({
  course,
  initialRating,
  friends,
  getCandidate,
  saveRating,
  saveDetails,
  onClose,
  contacts = defaultContacts,
  sms = defaultSms,
  platform = Platform.OS as 'android' | 'ios' | 'web',
  today = localToday(),
}: RatingFlowProps) {
  const initialFriendIds = initialRating.companions.flatMap((item) => item.friend_user_id == null ? [] : [item.friend_user_id])
  const initialGuests = initialRating.companions.flatMap((item) => item.guest_name ? [{ name: item.guest_name, phone: null }] : [])
  const [stage, setStage] = useState<Stage>('tier')
  const [tier, setTier] = useState<RatingTier | null>(initialRating.tier)
  const [playedOn, setPlayedOn] = useState(initialRating.round?.played_on ?? today)
  const [score, setScore] = useState(initialRating.round?.score == null ? '' : String(initialRating.round.score))
  const [candidate, setCandidate] = useState<RatingCandidate>(null)
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [ratingState, setRatingState] = useState(initialRating)
  const [coreBaseline, setCoreBaseline] = useState({
    tier: initialRating.tier,
    playedOn: initialRating.round?.played_on ?? null,
    score: initialRating.round?.score == null ? '' : String(initialRating.round.score),
  })
  const [note, setNote] = useState(initialRating.round?.note ?? '')
  const [favoriteHole, setFavoriteHole] = useState(initialRating.round?.favorite_hole == null ? '' : String(initialRating.round.favorite_hole))
  const [friendIds, setFriendIds] = useState<number[]>(initialFriendIds)
  const [guests, setGuests] = useState<Guest[]>(initialGuests)
  const [shareWithFriends, setShareWithFriends] = useState(initialRating.round?.visibility === 'friends')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guestMessage, setGuestMessage] = useState<string | null>(null)

  const coreUnchanged = coreBaseline.tier === tier
    && coreBaseline.playedOn === playedOn
    && coreBaseline.score === score.trim()
  const scoreNumber = score.trim() ? Number(score) : null
  const roundValid = isValidDate(playedOn)
    && playedOn <= today
    && (scoreNumber === null || (Number.isInteger(scoreNumber) && scoreNumber >= 40 && scoreNumber <= 250))

  async function continueFromRound() {
    if (!tier || !roundValid) return
    setError(null)
    if (coreUnchanged && ratingState.personal_rating != null) {
      setStage('reveal')
      return
    }
    if (tier === coreBaseline.tier) {
      await persistRating(null, null)
      return
    }
    setCandidate(null)
    setComparison(null)
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
    if (!tier) return
    setError(null)
    if (!alreadyBusy) setBusy(true)
    const input: CourseRatingInput = comparisonCourseId && result
      ? { tier, played_on: playedOn, score: scoreNumber, comparison_course_id: comparisonCourseId, comparison_result: result }
      : { tier, played_on: playedOn, score: scoreNumber }
    try {
      const saved = await saveRating(input)
      setRatingState(saved)
      setCoreBaseline({ tier, playedOn, score: score.trim() })
      setStage('reveal')
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to save your rating. Your answers are still here.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveOptionalDetails() {
    const hole = favoriteHole.trim() ? Number(favoriteHole) : null
    if (hole !== null && (!Number.isInteger(hole) || hole < 1 || hole > 18)) {
      setError('Favorite hole must be between 1 and 18.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await saveDetails({
        note: note.trim() || null,
        favorite_hole: hole,
        friend_user_ids: friendIds,
        guest_names: guests.map((guest) => guest.name),
        visibility: shareWithFriends ? 'friends' : 'private',
      })
      setRatingState(saved)
      onClose()
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to save your details. Your answers are still here.'))
    } finally {
      setBusy(false)
    }
  }

  async function addGuest() {
    setGuestMessage(null)
    try {
      if (platform === 'android' && await contacts.requestPermission() !== 'granted') {
        setGuestMessage('Contacts permission was denied. You can continue without adding a guest.')
        return
      }
      const contact = await contacts.pickContact()
      if (contact) setGuests((current) => current.some((guest) => guest.name === contact.name) ? current : [...current, contact])
    } catch {
      setGuestMessage('Unable to open contacts on this device.')
    }
  }

  async function sendInvite(guest: Guest) {
    if (!guest.phone) return
    setGuestMessage(null)
    try {
      if (!await sms.isAvailable()) {
        setGuestMessage('Text messaging is unavailable on this device.')
        return
      }
      await sms.send(guest.phone, `Join me on GolfRank to rate ${course.name}.`)
    } catch {
      setGuestMessage('Unable to open the text message composer.')
    }
  }

  const title = useMemo(() => {
    if (stage === 'tier') return `How did ${course.name} feel?`
    if (stage === 'round') return 'When did you play?'
    if (stage === 'comparison') return 'Which course do you prefer?'
    if (stage === 'reveal') return 'Your rating'
    return 'Remember the round'
  }, [course.name, stage])

  function goBack() {
    setError(null)
    if (stage === 'tier') onClose()
    else if (stage === 'round') setStage('tier')
    else if (stage === 'comparison') setStage('round')
    else if (stage === 'reveal') setStage('round')
    else setStage('reveal')
  }

  function selectTier(nextTier: RatingTier) {
    setTier(nextTier)
    setCandidate(null)
    setComparison(null)
    setError(null)
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={platform === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={4} onPress={goBack} style={styles.iconButton}>
            <Feather name="arrow-left" size={19} color={colors.ink} />
          </Pressable>
          <Text numberOfLines={1} style={styles.courseName}>{course.name}</Text>
          <Pressable accessibilityLabel="Close rating" accessibilityRole="button" hitSlop={4} onPress={onClose} style={styles.iconButton}>
            <Feather name="x" size={19} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.headingBlock}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle(stage, candidate?.name)}</Text>
          </View>

          {stage === 'tier' ? (
            <View style={styles.options}>
              {tiers.map((item) => <Choice
                key={item.key}
                label={`${item.name} ${item.range}`}
                selected={tier === item.key}
                onPress={() => selectTier(item.key)}
              >
                <View style={styles.tierContent}>
                  <View style={styles.tierCopy}><Text style={styles.choiceTitle}>{item.name}</Text><Text style={styles.range}>{item.range}</Text></View>
                  <Text style={styles.choiceDescription}>{item.description}</Text>
                </View>
              </Choice>)}
              <ActionButton disabled={!tier} label="Continue" onPress={() => setStage('round')} />
            </View>
          ) : null}

          {stage === 'round' ? (
            <View style={styles.form}>
              <Field label="Date played" value={playedOn} onChangeText={setPlayedOn} placeholder="YYYY-MM-DD" />
              <Text style={styles.help}>Use YYYY-MM-DD. Today is selected by default.</Text>
              <Field keyboardType="number-pad" label="Golf score (optional)" value={score} onChangeText={setScore} placeholder="e.g. 82" />
              {!roundValid ? <Text accessibilityRole="alert" style={styles.error}>Enter a valid date (not in the future) and a score from 40 to 250.</Text> : null}
              <ActionButton disabled={!roundValid || busy} label={busy ? 'Saving...' : error ? 'Retry' : 'Continue'} onPress={continueFromRound} />
            </View>
          ) : null}

          {stage === 'comparison' && candidate ? (
            <View style={styles.options}>
              <View style={styles.comparisonCard}><Text style={styles.comparisonName}>{course.name}</Text><Text style={styles.versus}>or</Text><Text style={styles.comparisonName}>{candidate.name}</Text></View>
              {comparisonOptions.map((option) => <Choice key={option.value} label={option.label} selected={comparison === option.value} onPress={() => setComparison(option.value)}>
                <Text style={styles.choiceTitle}>{option.label}</Text>
              </Choice>)}
              <ActionButton disabled={!comparison || busy} label={busy ? 'Saving...' : error ? 'Retry save' : 'Save rating'} onPress={() => comparison && persistRating(candidate.id, comparison)} />
            </View>
          ) : null}

          {stage === 'reveal' ? (
            <View style={styles.reveal}>
              <Text accessibilityLabel={`Your rating is ${ratingState.personal_rating} out of 10`} style={styles.ratingValue}>
                {ratingState.personal_rating ?? '—'}<Text style={styles.outOf}>/10</Text>
              </Text>
              <Text style={styles.revealCopy}>Based on your tier and how this course compares with the courses you know.</Text>
              <ActionButton label="Add round details" onPress={() => setStage('details')} />
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.textControl}><Text style={styles.textButton}>Done</Text></Pressable>
            </View>
          ) : null}

          {stage === 'details' ? (
            <View style={styles.form}>
              <Field label="Notes (optional)" multiline value={note} onChangeText={setNote} placeholder="What stood out?" />
              <Field keyboardType="number-pad" label="Favorite hole (optional)" value={favoriteHole} onChangeText={setFavoriteHole} placeholder="1–18" />
              <View><Text style={styles.fieldLabel}>Photo</Text><Pressable accessibilityLabel="Add a photo, Coming soon" accessibilityRole="button" onPress={() => setGuestMessage('Photo upload is Coming soon.')} style={styles.photoButton}><Feather name="camera" size={20} color={colors.pine} /><Text style={styles.photoText}>Add photo</Text><Text style={styles.comingSoon}>Coming soon</Text></Pressable></View>
              {friends.length ? <View><Text style={styles.fieldLabel}>Friends who played</Text><View style={styles.friendWrap}>{friends.map((friend) => {
                const selected = friendIds.includes(friend.id)
                return <Pressable key={friend.id} accessibilityLabel={`${selected ? 'Remove' : 'Select'} ${friend.display_name}`} accessibilityRole="button" onPress={() => setFriendIds((current) => selected ? current.filter((id) => id !== friend.id) : [...current, friend.id])} style={[styles.friendChip, selected && styles.friendChipSelected]}><Text style={[styles.friendChipText, selected && styles.friendChipTextSelected]}>{friend.display_name}</Text></Pressable>
              })}</View></View> : null}
              <View>
                <Pressable accessibilityLabel="Add guest" accessibilityRole="button" onPress={addGuest} style={styles.smallTextControl}><Text style={styles.addGuest}>+ Add guest</Text></Pressable>
                {guests.map((guest) => <View key={guest.name} style={styles.guestRow}><Text style={styles.guestName}>{guest.name}</Text>{guest.phone ? <Pressable accessibilityLabel={`Send invite to ${guest.name}`} accessibilityRole="button" onPress={() => sendInvite(guest)} style={styles.smallTextControl}><Text style={styles.addGuest}>Send invite</Text></Pressable> : null}</View>)}
              </View>
              <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.fieldLabel}>Share with friends</Text><Text style={styles.help}>Off by default. Your rating stays private.</Text></View><Switch accessibilityLabel="Share with friends" onValueChange={setShareWithFriends} trackColor={{ false: colors.line, true: colors.pineSoft }} thumbColor={shareWithFriends ? colors.pine : '#FFFFFF'} value={shareWithFriends} /></View>
              <ActionButton disabled={busy} label={busy ? 'Saving...' : error ? 'Retry save' : 'Save details'} onPress={saveOptionalDetails} />
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

function subtitle(stage: Stage, candidateName?: string) {
  if (stage === 'tier') return 'Choose the tier that fits. We will calculate the number for you.'
  if (stage === 'round') return 'A rating means you played this course. Score is optional.'
  if (stage === 'comparison') return candidateName ? `One quick comparison with ${candidateName}.` : ''
  if (stage === 'reveal') return 'Your personal course rating is ready.'
  return 'Everything here is optional.'
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

function Choice({ children, label, selected, onPress }: { children: ReactNode; label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>{children}<Feather name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? colors.pine : colors.muted} /></Pressable>
}

function ActionButton({ disabled, label, onPress }: { disabled?: boolean; label: string; onPress: () => void | Promise<void> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={[styles.actionButton, disabled && styles.disabled]}><Text style={styles.actionButtonText}>{label}</Text></Pressable>
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#929A95" style={[styles.input, props.multiline && styles.multiline]} {...props} /></View>
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  iconButton: { alignItems: 'center', backgroundColor: '#EFF0EC', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  courseName: { color: colors.muted, flex: 1, fontSize: 12, fontWeight: '700', marginHorizontal: 12, textAlign: 'center' },
  content: { flexGrow: 1, gap: 22, padding: 24, paddingBottom: 48 },
  headingBlock: { gap: 9, marginTop: 20 },
  title: { color: colors.ink, fontFamily: 'Georgia', fontSize: 34, letterSpacing: -0.9, lineHeight: 40 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  options: { gap: 12 }, form: { gap: 17 },
  choice: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.card, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 72, padding: 16 },
  choiceSelected: { backgroundColor: colors.pineSoft, borderColor: colors.pine },
  tierContent: { flex: 1, gap: 4 }, tierCopy: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  choiceTitle: { color: colors.ink, flex: 1, fontSize: 16, fontWeight: '800' },
  choiceDescription: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  range: { color: colors.pine, fontSize: 13, fontWeight: '800' },
  actionButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, justifyContent: 'center', marginTop: 6, minHeight: 52, paddingHorizontal: 20 },
  actionButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' }, disabled: { opacity: 0.4 },
  fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: '800', marginBottom: 8 },
  input: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, color: colors.ink, fontSize: 15, minHeight: 50, paddingHorizontal: 14, paddingVertical: 12 },
  multiline: { minHeight: 105, textAlignVertical: 'top' }, help: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.error, fontSize: 12, lineHeight: 18, textAlign: 'center' }, message: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  comparisonCard: { alignItems: 'center', backgroundColor: colors.pineSoft, borderRadius: radii.card, gap: 4, padding: 18 },
  comparisonName: { color: colors.ink, fontFamily: 'Georgia', fontSize: 19, textAlign: 'center' }, versus: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  reveal: { alignItems: 'center', flex: 1, gap: 22, justifyContent: 'center', paddingVertical: 32 },
  ratingValue: { color: colors.pine, fontFamily: 'Georgia', fontSize: 80, letterSpacing: -3 }, outOf: { color: colors.muted, fontSize: 28, letterSpacing: -1 },
  revealCopy: { color: colors.muted, fontSize: 14, lineHeight: 21, maxWidth: 300, textAlign: 'center' }, textControl: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 72 }, textButton: { color: colors.pine, fontSize: 14, fontWeight: '800' },
  photoButton: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 54, paddingHorizontal: 14 },
  photoText: { color: colors.ink, flex: 1, fontSize: 13, fontWeight: '700' }, comingSoon: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  friendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, friendChip: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 }, friendChipSelected: { backgroundColor: colors.pine, borderColor: colors.pine },
  friendChipText: { color: colors.ink, fontSize: 11, fontWeight: '700' }, friendChipTextSelected: { color: '#FFFFFF' }, smallTextControl: { alignItems: 'center', alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44, minWidth: 72 }, addGuest: { color: colors.pine, fontSize: 12, fontWeight: '800' },
  guestRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 42 }, guestName: { color: colors.ink, fontSize: 13 },
  switchRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
})

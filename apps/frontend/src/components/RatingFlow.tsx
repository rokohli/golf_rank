import { Feather } from '@expo/vector-icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
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
  CourseImage,
  CourseRatingInput,
  CourseRatingState,
  FriendSummary,
  RatingCandidate,
  RatingDetailsInput,
  RatingTier,
} from '../types'
import { CoursePhotoContentType } from '../api/client'
import { MAX_PHOTOS_PER_ROUND, isRetryableConfirmFailure, pickCoursePhotoAsset } from '../api/coursePhotoUpload'
import { attributedCourseImage } from '../coursePresentation'
import { colors } from '../ui/theme'

type Guest = { name: string; phone: string | null }
type Stage = 'tier' | 'round' | 'comparison' | 'reveal'
type RoundEditor = 'played' | 'score' | 'notes' | 'favorite' | 'people' | null
type StagedPhoto = {
  id: string
  imageUri: string
  contentType: CoursePhotoContentType
  dimensions?: { width: number; height: number }
  status: 'uploading' | 'ready' | 'error'
  storageKey?: string
}

export type RatingFlowProps = {
  course: Course
  initialRating: CourseRatingState
  friends: FriendSummary[]
  getCandidate: (tier: RatingTier) => Promise<RatingCandidate>
  saveRating: (input: CourseRatingInput) => Promise<CourseRatingState>
  saveDetails: (input: RatingDetailsInput) => Promise<CourseRatingState>
  startPhotoUpload: (imageUri: string, contentType: CoursePhotoContentType) => Promise<{ storageKey: string }>
  confirmPhotoUpload: (storageKey: string, roundId: number, dimensions?: { width: number; height: number }) => Promise<CourseImage>
  discardPhotoUpload: (storageKey: string) => Promise<void>
  onClose: () => void
  today?: string
}

const tiers: { key: RatingTier; name: string; range: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'green', name: 'Green', range: '8.5–10', icon: 'flag' },
  { key: 'fairway', name: 'Fairway', range: '7–8.4', icon: 'compass' },
  { key: 'rough', name: 'Rough', range: '5–6.9', icon: 'wind' },
  { key: 'bunker', name: 'Bunker', range: '1–4.9', icon: 'circle' },
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
  startPhotoUpload,
  confirmPhotoUpload,
  discardPhotoUpload,
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
    initialRating.round ? initialRating.round.visibility !== 'private' : true,
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
  const [shareWithFollowers, setShareWithFollowers] = useState(initialRating.round ? initialRating.round.visibility !== 'private' : true)
  const [roundEditor, setRoundEditor] = useState<RoundEditor>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guestMessage, setGuestMessage] = useState<string | null>(null)
  const [existingPhotos, setExistingPhotos] = useState<CourseImage[]>(initialRating.round?.photos ?? [])
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([])
  const savingRef = useRef(false)
  const totalPhotoCount = existingPhotos.length + stagedPhotos.length
  const photoUploadInFlight = stagedPhotos.some((photo) => photo.status === 'uploading')

  // The upload to R2 doesn't need a round_id -- only confirming it does, and a
  // brand-new round doesn't exist until Continue saves it. So the slow part
  // (the file transfer) starts immediately in the background here; the fast
  // confirm call is deferred to finalizePhotos, once a round_id is known.
  // Ids removed by the user while their upload was still in flight -- the
  // upload's success handler checks this before adding the photo to state,
  // so a photo removed mid-upload gets discarded (not silently kept) once
  // the storage key becomes known.
  const removedWhileUploadingRef = useRef<Set<string>>(new Set())

  async function pickAndUploadPhoto() {
    if (totalPhotoCount >= MAX_PHOTOS_PER_ROUND) return
    const picked = await pickCoursePhotoAsset()
    if (!picked) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setStagedPhotos((current) => [...current, { id, imageUri: picked.uri, contentType: picked.contentType, dimensions: picked.dimensions, status: 'uploading' }])
    setGuestMessage(null)
    try {
      const { storageKey } = await startPhotoUpload(picked.uri, picked.contentType)
      if (removedWhileUploadingRef.current.delete(id)) {
        void discardPhotoUpload(storageKey)
        return
      }
      setStagedPhotos((current) => current.map((photo) => (photo.id === id ? { ...photo, status: 'ready', storageKey } : photo)))
    } catch (reason) {
      removedWhileUploadingRef.current.delete(id)
      setStagedPhotos((current) => current.map((photo) => (photo.id === id ? { ...photo, status: 'error' } : photo)))
      setGuestMessage(errorMessage(reason, 'Unable to upload photo. Please try again.'))
    }
  }

  function removeStagedPhoto(id: string) {
    const photo = stagedPhotos.find((item) => item.id === id)
    if (photo?.status === 'uploading') {
      // storageKey isn't known yet -- flag it so the upload's own completion
      // handler discards the object once it lands, instead of staging it.
      removedWhileUploadingRef.current.add(id)
    } else if (photo?.storageKey) {
      void discardPhotoUpload(photo.storageKey)
    }
    setStagedPhotos((current) => current.filter((item) => item.id !== id))
  }

  async function finalizePhotos(roundId: number) {
    const ready = stagedPhotos.filter((photo) => photo.status === 'ready' && photo.storageKey)
    if (!ready.length) return
    const outcomes = await Promise.all(ready.map((photo) =>
      confirmPhotoUpload(photo.storageKey as string, roundId, photo.dimensions)
        .then((image) => ({ id: photo.id, ok: true as const, image }))
        .catch((reason) => ({ id: photo.id, ok: false as const, retryable: isRetryableConfirmFailure(reason) }))
    ))
    // Confirmation is idempotent per storage_key (server-side), so a photo
    // that failed to confirm for a transient reason (rate limiting, a
    // network error) stays staged -- the next Continue retries it instead
    // of silently abandoning its already-uploaded R2 object. A photo the
    // server rejected (bad type/size, round mismatch, cap exceeded) is
    // different: confirm_upload deletes that R2 object before responding,
    // so its storage_key is already gone and retrying can only ever fail
    // the same way -- drop it instead of retrying forever.
    const failures = outcomes.filter((outcome): outcome is Extract<typeof outcome, { ok: false }> => !outcome.ok)
    const retryableIds = new Set(failures.filter((failure) => failure.retryable).map((failure) => failure.id))
    const rejectedCount = failures.length - retryableIds.size
    // existingPhotos was previously frozen from the initial rating -- a
    // successfully confirmed photo has to be added to it, not just dropped
    // from stagedPhotos, so totalPhotoCount and the round preview stay
    // correct if the user navigates back to this stage from reveal (the
    // header back button allows that) instead of finishing the flow.
    const confirmedImages = outcomes
      .filter((outcome): outcome is Extract<typeof outcome, { ok: true }> => outcome.ok)
      .map((outcome) => outcome.image)
    if (confirmedImages.length) setExistingPhotos((current) => [...current, ...confirmedImages])
    setStagedPhotos((current) => current.filter((photo) => retryableIds.has(photo.id)))
    if (rejectedCount && retryableIds.size) {
      setGuestMessage('Your round was saved. Some photos could not be attached and were removed; others can be retried.')
    } else if (rejectedCount) {
      setGuestMessage('Your round was saved, but one or more photos could not be attached.')
    } else if (retryableIds.size) {
      setGuestMessage('Your round was saved, but one or more photos could not be attached. You can try again.')
    }
  }

  // Cleans up any staged-but-unconfirmed uploads so leaving the flow without
  // finishing doesn't strand permanent R2 objects (e.g. closing after
  // picking photos but before Continue saves the round). Takes an explicit
  // list rather than reading `stagedPhotos` from closure so the unmount
  // effect below can pass a ref value instead of a stale snapshot.
  function discardStagedPhotos(photos: StagedPhoto[]) {
    photos.forEach((photo) => {
      if (photo.status === 'uploading') {
        removedWhileUploadingRef.current.add(photo.id)
      } else if (photo.storageKey) {
        void discardPhotoUpload(photo.storageKey)
      }
    })
  }

  // handleClose covers the flow's own close/back controls, but the screen
  // can also be dismissed without either running -- Android system back, a
  // native swipe/navigation gesture, a parent navigation change -- which
  // unmounts this component directly. Effect cleanup is the one place that
  // still runs in that case. stagedPhotosRef mirrors state into a ref so the
  // cleanup (registered once, on mount) reads the latest staged photos
  // instead of the empty array from its first render's closure. Re-running
  // this after handleClose already discarded the same photos is harmless --
  // discardPhotoUpload is a best-effort, fire-and-forget call the client
  // never inspects the result of.
  const stagedPhotosRef = useRef<StagedPhoto[]>(stagedPhotos)
  useEffect(() => {
    stagedPhotosRef.current = stagedPhotos
  }, [stagedPhotos])
  useEffect(() => () => discardStagedPhotos(stagedPhotosRef.current), [])

  function handleClose() {
    discardStagedPhotos(stagedPhotos)
    onClose()
  }

  const currentDetails = detailsPayload(note, favoriteHole, friendIds, guests, shareWithFollowers)
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
  const dateValid = playedOn !== null && playedOn <= today
  const scoreValid = scoreNumber === null || (Number.isInteger(scoreNumber) && scoreNumber >= 20 && scoreNumber <= 200)
  const roundValid = dateValid && scoreValid
  const favoriteHoleValid = currentDetails.favorite_hole === null
    || (Number.isInteger(currentDetails.favorite_hole) && currentDetails.favorite_hole >= 1 && currentDetails.favorite_hole <= 18)

  async function continueFromRound() {
    if (!tier || !playedOn || !roundValid || !favoriteHoleValid) return
    setError(null)
    if (coreUnchanged && ratingState.personal_rating != null) {
      if (!detailsChanged && !stagedPhotos.length) {
        setStage('reveal')
        return
      }
      setBusy(true)
      try {
        if (detailsChanged) {
          const saved = await saveDetails(currentDetails)
          setRatingState(saved)
          setDetailsBaseline(currentDetails)
        }
        if (ratingState.round?.id) await finalizePhotos(ratingState.round.id)
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
    if (saved.round?.id) await finalizePhotos(saved.round.id)
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
    if (stage === 'tier') handleClose()
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
          <Pressable accessibilityLabel="Close rating" accessibilityRole="button" hitSlop={8} onPress={handleClose} style={styles.iconButton}>
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
                  <View style={styles.switchRow}><Text style={styles.shareLabel}>Share with followers</Text><Switch accessibilityLabel="Share with followers" onValueChange={setShareWithFollowers} trackColor={{ false: colors.line, true: colors.pineSoft }} thumbColor={shareWithFollowers ? colors.pine : '#FFFFFF'} value={shareWithFollowers} /></View>
                </View> : null}
                <RoundRow
                  disabled={photoUploadInFlight || totalPhotoCount >= MAX_PHOTOS_PER_ROUND}
                  icon="camera"
                  label="Photos"
                  onPress={() => void pickAndUploadPhoto()}
                  value={photoUploadInFlight ? 'Uploading…' : totalPhotoCount > 0 ? `${totalPhotoCount} photo${totalPhotoCount === 1 ? '' : 's'} added` : undefined}
                />
                {totalPhotoCount > 0 ? (
                  <ScrollView contentContainerStyle={styles.photoStrip} horizontal showsHorizontalScrollIndicator={false}>
                    {existingPhotos.map((photo) => (
                      photo.url ? <Image key={`existing-${photo.id}`} accessibilityLabel="Photo already added" source={{ uri: photo.url }} style={styles.photoThumb} /> : null
                    ))}
                    {stagedPhotos.map((photo) => (
                      <View key={photo.id} style={styles.photoThumbWrap}>
                        <Image accessibilityLabel="Staged photo" source={{ uri: photo.imageUri }} style={[styles.photoThumb, photo.status !== 'ready' && styles.photoThumbFaded]} />
                        {photo.status === 'uploading' ? <ActivityIndicator color={colors.pine} style={styles.photoThumbSpinner} /> : null}
                        {photo.status === 'error' ? <View style={styles.photoThumbErrorBadge}><Feather color="#FFFFFF" name="alert-circle" size={12} /></View> : null}
                        {/* Disabled while busy (Continue -> finalizePhotos may be confirming this
                            exact photo right now): removing it here can't stop a confirmation
                            already in flight, and there's no way to un-publish a photo that lands
                            in existingPhotos after the "removal" already appeared to succeed. */}
                        <Pressable accessibilityLabel="Remove photo" accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} hitSlop={6} onPress={() => removeStagedPhoto(photo.id)} style={styles.photoRemoveButton}>
                          <Feather color="#FFFFFF" name="x" size={12} />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                ) : null}
              </View>
              {!dateValid ? <Text accessibilityRole="alert" style={styles.error}>Enter a valid date in MM/DD/YYYY (not in the future).</Text> : null}
              {!scoreValid ? <Text accessibilityRole="alert" style={styles.error}>Enter a score from 20 to 200.</Text> : null}
              {!favoriteHoleValid ? <Text accessibilityRole="alert" style={styles.error}>Favorite hole must be between 1 and 18.</Text> : null}
              <ActionButton disabled={!roundValid || !favoriteHoleValid || busy || photoUploadInFlight} label={busy ? 'Saving...' : error ? 'Retry' : 'Continue'} onPress={continueFromRound} />
            </View>
          ) : null}

          {stage === 'comparison' && candidate ? (
            <View style={styles.comparisonStage}>
              <CourseChoice course={course} disabled={busy} onPress={() => persistRating(candidate.id, 'course_a')} />
              <View style={styles.versusRow}><View style={styles.versusLine} /><Text style={styles.versus}>VS.</Text><View style={styles.versusLine} /></View>
              <CourseChoice course={candidate} disabled={busy} onPress={() => persistRating(candidate.id, 'course_b')} />
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
              <ActionButton label="Done" onPress={handleClose} />
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

function RoundRow({ disabled = false, expanded = false, icon, label, value, onPress }: { disabled?: boolean; expanded?: boolean; icon: keyof typeof Feather.glyphMap; label: string; value?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, expanded }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.roundRow, pressed && styles.pressed]}>
    <Feather name={icon} size={21} color={colors.pineDark} />
    <Text style={styles.roundLabel}>{label}</Text>
    {value ? <Text numberOfLines={1} style={styles.roundValue}>{value}</Text> : null}
    <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={colors.pineDark} />
  </Pressable>
}

function InlineField(props: React.ComponentProps<typeof TextInput>) {
  return <View style={styles.inlineFieldWrap}><TextInput placeholderTextColor="#929A95" style={[styles.inlineField, props.multiline && styles.multiline]} {...props} /></View>
}

function CourseChoice({ course, disabled, onPress }: { course: Course; disabled: boolean; onPress: () => void }) {
  const image = attributedCourseImage(course)
  return <Pressable
    accessibilityLabel={course.name}
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.courseChoice, pressed && styles.courseChoicePressed]}
  >
    {image
      ? <ImageBackground accessibilityLabel={`${course.name} course photo`} source={image} style={styles.courseImage} imageStyle={styles.courseImageRadius} />
      : <View accessibilityLabel={`${course.name} image unavailable`} style={[styles.courseImage, styles.courseImagePlaceholder]}><Feather name="flag" size={25} color={colors.pine} /></View>}
    <View style={styles.courseCopy}><Text style={styles.comparisonName}>{course.name}</Text><Text style={styles.courseRegion}>{course.region}</Text></View>
  </Pressable>
}

function ActionButton({ disabled, label, onPress }: { disabled?: boolean; label: string; onPress: () => void | Promise<void> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && !disabled && styles.actionPressed]}><Text style={styles.actionButtonText}>{label}</Text></Pressable>
}

function detailsPayload(note: string, favoriteHole: string, friendIds: number[], guests: Guest[], shareWithFollowers: boolean): RatingDetailsInput {
  return {
    note: note.trim() || null,
    favorite_hole: favoriteHole.trim() ? Number(favoriteHole) : null,
    friend_user_ids: friendIds,
    guest_names: guests.map((guest) => guest.name),
    visibility: shareWithFollowers ? 'public' : 'private',
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
  photoStrip: { borderBottomColor: '#D8D3C7', borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  photoThumbWrap: { position: 'relative' },
  photoThumb: { backgroundColor: colors.pineSoft, borderRadius: 6, height: 64, width: 64 },
  photoThumbFaded: { opacity: 0.5 },
  photoThumbSpinner: { alignSelf: 'center', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  photoThumbErrorBadge: { alignItems: 'center', backgroundColor: colors.error, borderRadius: 9, bottom: 4, height: 18, justifyContent: 'center', position: 'absolute', right: 4, width: 18 },
  photoRemoveButton: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 9, height: 18, justifyContent: 'center', position: 'absolute', right: -5, top: -5, width: 18 },
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
  courseImagePlaceholder: { alignItems: 'center', backgroundColor: colors.pineSoft, borderRadius: 3, justifyContent: 'center' },
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

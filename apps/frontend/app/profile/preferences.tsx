import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityActionEvent, ActivityIndicator, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'

import { getProfile, savePreferences } from '../../src/api/client'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../../src/components/ProductUI'
import { OnboardingPreferences } from '../../src/types'
import { colors, radii } from '../../src/ui/theme'

type Access = OnboardingPreferences['access']
type Difficulty = OnboardingPreferences['difficulty']
type GroupSize = NonNullable<NonNullable<OnboardingPreferences['onboarding_data']>['group_size']>
type Transportation = NonNullable<NonNullable<OnboardingPreferences['onboarding_data']>['transportation']>
type SheetKey = 'group' | 'transportation' | 'teeTime' | 'travel' | null

const MIN_FEE = 50
const MAX_FEE = 500
const FEE_STEP = 25

const accessOptions: Array<{ label: string; value: Access }> = [
  { label: 'Any', value: 'any' }, { label: 'Public', value: 'public' }, { label: 'Private', value: 'private' },
]
const difficultyOptions: Array<{ label: string; value: Difficulty }> = [
  { label: 'Any', value: 'any' }, { label: 'Beginner', value: 'beginner' }, { label: 'Intermediate', value: 'intermediate' }, { label: 'Challenging', value: 'challenging' },
]
const groupOptions = ['Solo', 'Twosome', 'Foursome'] as const
const transportationOptions = ['Walking', 'Cart', 'Either'] as const
const teeTimeOptions = ['Early morning', 'Morning', 'Weekend mornings', 'Midday', 'Afternoon', 'Twilight', 'Flexible'] as const
const travelOptions = ['Up to 15 minutes', 'Up to 30 minutes', 'Up to 45 minutes', 'Up to 60 minutes', '90+ minutes'] as const

export default function GolfPreferences() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [profile, setProfile] = useState<OnboardingPreferences | null>(null)
  const [access, setAccess] = useState<Access>('any')
  const [difficulty, setDifficulty] = useState<Difficulty>('any')
  const [maxFee, setMaxFee] = useState(350)
  const [groupSize, setGroupSize] = useState<GroupSize>('Foursome')
  const [transportation, setTransportation] = useState<Transportation>('Either')
  const [teeTime, setTeeTime] = useState('Flexible')
  const [travelDistance, setTravelDistance] = useState('Up to 45 minutes')
  const [sheet, setSheet] = useState<SheetKey>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await getProfile(await getAuthHeaders())
      setProfile(next)
      setAccess(next.access)
      setDifficulty(next.difficulty)
      setMaxFee(clampFee(next.max_green_fee))
      setGroupSize(next.onboarding_data?.group_size ?? 'Foursome')
      setTransportation(next.onboarding_data?.transportation ?? 'Either')
      setTeeTime(next.onboarding_data?.preferred_tee_time || 'Flexible')
      setTravelDistance(next.onboarding_data?.travel_distance || 'Up to 45 minutes')
    } catch (reason) {
      setError(message(reason, 'Unable to load golf preferences.'))
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const save = async () => {
    if (!profile?.onboarding_data) {
      setError('Your saved profile is incomplete. Please try again.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await savePreferences({
        ...profile,
        access,
        difficulty,
        max_green_fee: maxFee,
        onboarding_data: {
          ...profile.onboarding_data,
          group_size: groupSize,
          preferred_tee_time: teeTime,
          transportation,
          travel_distance: travelDistance,
        },
      }, await getAuthHeaders())
      router.back()
    } catch (reason) {
      setError(message(reason, 'Unable to save golf preferences. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader onBack={() => router.back()} title="Golf preferences" />
      {loading ? <ActivityIndicator accessibilityLabel="Loading golf preferences" color={colors.pine} /> : <>
        <PreferenceSection title="COURSE ACCESS">
          <SegmentedOptions<Access> options={accessOptions} selected={access} accessibilityPrefix="Course access" onSelect={setAccess} />
        </PreferenceSection>

        <PreferenceSection title="COURSE DIFFICULTY">
          <View style={styles.chips}>{difficultyOptions.map((option) => <ChoiceChip key={option.value} label={option.label} selected={difficulty === option.value} onPress={() => setDifficulty(option.value)} />)}</View>
        </PreferenceSection>

        <PreferenceSection title="MAX GREEN FEE">
          <FeeSlider value={maxFee} onChange={setMaxFee} />
        </PreferenceSection>

        <PreferenceSection title="HOW YOU PLAY">
          <View style={styles.tileGroup}>
            <PreferenceTile icon="users" label="Usual group" value={groupSize} onPress={() => setSheet('group')} />
            <PreferenceTile icon="truck" label="Getting around" value={transportation} onPress={() => setSheet('transportation')} />
          </View>
        </PreferenceSection>

        <PreferenceSection title="WHEN & WHERE">
          <View style={styles.tileGroup}>
            <PreferenceTile icon="clock" label="Preferred tee time" value={teeTime} onPress={() => setSheet('teeTime')} />
            <PreferenceTile icon="navigation" label="Travel distance" value={travelDistance} onPress={() => setSheet('travel')} />
          </View>
        </PreferenceSection>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}>
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save changes</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={saving} hitSlop={8} onPress={() => router.back()}><Text style={styles.cancel}>Cancel</Text></Pressable>
      </>}
    </ProductScreen>

    <PreferenceSheet description="Choose the group size you play with most often." options={[...groupOptions]} selected={groupSize} title="Usual group" visible={sheet === 'group'} onClose={() => setSheet(null)} onDone={(value) => { setGroupSize(value as GroupSize); setSheet(null) }} />
    <PreferenceSheet description="Choose how you usually get around the course." options={[...transportationOptions]} selected={transportation} title="Getting around" visible={sheet === 'transportation'} onClose={() => setSheet(null)} onDone={(value) => { setTransportation(value as Transportation); setSheet(null) }} />
    <PreferenceSheet description="Choose the time you most often want to play." options={[...teeTimeOptions]} selected={teeTime} title="Preferred tee time" visible={sheet === 'teeTime'} onClose={() => setSheet(null)} onDone={(value) => { setTeeTime(value); setSheet(null) }} />
    <PreferenceSheet description="Choose how long you are willing to travel for a round." options={withCurrent([...travelOptions], travelDistance)} selected={travelDistance} title="Travel distance" visible={sheet === 'travel'} onClose={() => setSheet(null)} onDone={(value) => { setTravelDistance(value); setSheet(null) }} />
  </>
}

function PreferenceSection({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.section}><Text style={styles.sectionLabel}>{title}</Text>{children}</View>
}

function SegmentedOptions<T extends string>({ accessibilityPrefix, onSelect, options, selected }: { accessibilityPrefix: string; onSelect: (value: T) => void; options: Array<{ label: string; value: T }>; selected: T }) {
  return <View style={styles.segmented}>{options.map((option) => {
    const active = selected === option.value
    return <Pressable accessibilityLabel={`${accessibilityPrefix} ${option.label}`} accessibilityRole="button" accessibilityState={{ selected: active }} key={option.value} onPress={() => onSelect(option.value)} style={[styles.segment, active && styles.segmentActive]}><Text style={[styles.segmentText, active && styles.selectedText]}>{option.label}</Text></Pressable>
  })}</View>
}

function ChoiceChip({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipActive]}><Text style={[styles.chipText, selected && styles.selectedText]}>{label}</Text></Pressable>
}

function FeeSlider({ onChange, value }: { onChange: (value: number) => void; value: number }) {
  const [width, setWidth] = useState(0)
  const startValue = useRef(value)
  const updateFromDelta = useCallback((delta: number) => {
    if (!width) return
    onChange(clampFee(startValue.current + (delta / width) * (MAX_FEE - MIN_FEE)))
  }, [onChange, width])
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { startValue.current = value },
    onPanResponderMove: (_event, gesture) => updateFromDelta(gesture.dx),
  }), [updateFromDelta, value])
  const percent = ((value - MIN_FEE) / (MAX_FEE - MIN_FEE)) * 100
  const adjust = (event: AccessibilityActionEvent) => {
    const action = event.nativeEvent.actionName
    onChange(clampFee(value + (action === 'decrement' ? -FEE_STEP : FEE_STEP)))
  }
  return <View style={styles.feeCard}>
    <View style={styles.feeHeading}><Text style={styles.feeValue}>${value}</Text><Text style={styles.feeUnit}>per round</Text></View>
    <View accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} accessibilityLabel="Maximum green fee" accessibilityRole="adjustable" accessibilityValue={{ min: MIN_FEE, max: MAX_FEE, now: value, text: `$${value} per round` }} onAccessibilityAction={adjust} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.sliderTouch} {...responder.panHandlers}>
      <View style={styles.sliderTrack}><View style={[styles.sliderActive, { width: `${percent}%` }]} /><View style={[styles.sliderThumb, { left: `${percent}%` }]} /></View>
    </View>
    <View style={styles.sliderLabels}><Text style={styles.sliderLabel}>$50</Text><Text style={styles.sliderLabel}>$500+</Text></View>
  </View>
}

function PreferenceTile({ icon, label, onPress, value }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; value: string }) {
  return <Pressable accessibilityLabel={`${label}, ${value}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}><Feather name={icon} size={21} color={colors.pine} /><Text style={styles.tileLabel}>{label}</Text><Text numberOfLines={1} style={styles.tileValue}>{value}</Text><Feather name="chevron-right" size={18} color={colors.muted} /></Pressable>
}

function PreferenceSheet({ description, onClose, onDone, options, selected, title, visible }: { description: string; onClose: () => void; onDone: (value: string) => void; options: string[]; selected: string; title: string; visible: boolean }) {
  const [draft, setDraft] = useState(selected)
  useEffect(() => { if (visible) setDraft(selected) }, [selected, visible])
  return <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel={`Close ${title}`} accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>{title}</Text>
        <Text style={styles.sheetDescription}>{description}</Text>
        <View style={styles.sheetOptions}>{options.map((option) => <Pressable accessibilityRole="button" accessibilityState={{ selected: draft === option }} key={option} onPress={() => setDraft(option)} style={styles.sheetOption}><Text style={[styles.sheetOptionText, draft === option && styles.sheetOptionTextActive]}>{option}</Text>{draft === option ? <Feather name="check" size={20} color={colors.pine} /> : null}</Pressable>)}</View>
        <Pressable accessibilityRole="button" onPress={() => onDone(draft)} style={styles.doneButton}><Text style={styles.saveText}>Done</Text></Pressable>
      </View>
    </View>
  </Modal>
}

function clampFee(value: number) { return Math.min(MAX_FEE, Math.max(MIN_FEE, Math.round(value / FEE_STEP) * FEE_STEP)) }
function withCurrent(options: string[], current: string) { return options.includes(current) ? options : [current, ...options] }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  section: { gap: 9 },
  sectionLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  segmented: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  segment: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 46 },
  segmentActive: { backgroundColor: colors.pine },
  segmentText: { color: colors.ink, fontSize: 13 },
  selectedText: { color: '#FFFFFF' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, flexGrow: 1, justifyContent: 'center', minHeight: 43, paddingHorizontal: 12 },
  chipActive: { backgroundColor: colors.pine, borderColor: colors.pine },
  chipText: { color: colors.ink, fontSize: 12 },
  feeCard: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, padding: 15 },
  feeHeading: { alignItems: 'baseline', flexDirection: 'row', gap: 10 },
  feeValue: { color: colors.ink, fontFamily: 'Georgia', fontSize: 27 },
  feeUnit: { color: colors.muted, fontSize: 11 },
  sliderTouch: { justifyContent: 'center', minHeight: 40 },
  sliderTrack: { backgroundColor: colors.line, borderRadius: 3, height: 5, position: 'relative' },
  sliderActive: { backgroundColor: colors.pine, borderRadius: 3, bottom: 0, left: 0, position: 'absolute', top: 0 },
  sliderThumb: { backgroundColor: colors.pine, borderColor: '#FFFFFF', borderRadius: 11, borderWidth: 3, height: 22, marginLeft: -11, marginTop: -8, position: 'absolute', top: 0, width: 22 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderLabel: { color: colors.muted, fontSize: 10 },
  tileGroup: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, overflow: 'hidden' },
  tile: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 55, paddingHorizontal: 13 },
  tileLabel: { color: colors.ink, flex: 1, fontFamily: 'Georgia', fontSize: 14 },
  tileValue: { color: colors.muted, fontSize: 11, maxWidth: '38%', textAlign: 'right' },
  saveButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, justifyContent: 'center', minHeight: 50 },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cancel: { color: colors.pine, fontSize: 12, fontWeight: '800', marginTop: -10, textAlign: 'center' },
  error: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  overlay: { backgroundColor: 'rgba(10, 18, 14, 0.28)', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 12, maxHeight: '82%', paddingBottom: 28, paddingHorizontal: 18, paddingTop: 10 },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#C9CDC9', borderRadius: 2, height: 4, marginBottom: 2, width: 38 },
  sheetTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 25 },
  sheetDescription: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  sheetOptions: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, overflow: 'hidden' },
  sheetOption: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 49, paddingHorizontal: 14 },
  sheetOptionText: { color: colors.ink, fontSize: 14 },
  sheetOptionTextActive: { color: colors.pine, fontWeight: '700' },
  doneButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, justifyContent: 'center', minHeight: 48, marginTop: 2 },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.55 },
})

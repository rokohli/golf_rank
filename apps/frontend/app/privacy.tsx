import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { getProfile, savePreferences } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { OnboardingPreferences, RoundVisibility } from '../src/types'
import { colors, radii } from '../src/ui/theme'

type ProfileVisibility = NonNullable<NonNullable<OnboardingPreferences['onboarding_data']>['profile_visibility']>

const profileOptions: Array<{ description: string; icon: keyof typeof Feather.glyphMap; label: string; value: ProfileVisibility }> = [
  { description: 'Anyone can find your profile.', icon: 'globe', label: 'Public', value: 'public' },
  { description: 'Only mutual friends can find your profile.', icon: 'users', label: 'Friends', value: 'friends' },
  { description: 'Your profile is hidden from golfer search.', icon: 'lock', label: 'Private', value: 'private' },
]
const roundOptions: Array<{ description: string; icon: keyof typeof Feather.glyphMap; label: string; value: RoundVisibility }> = [
  { description: 'Only you can see new rounds.', icon: 'lock', label: 'Private', value: 'private' },
  { description: 'Mutual friends can see new rounds.', icon: 'users', label: 'Friends', value: 'friends' },
  { description: 'Followers can see new rounds.', icon: 'globe', label: 'Public', value: 'public' },
]

export default function Privacy() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [profile, setProfile] = useState<OnboardingPreferences | null>(null)
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('public')
  const [roundVisibility, setRoundVisibility] = useState<RoundVisibility>('friends')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await getProfile(await getAuthHeaders())
      setProfile(next)
      setProfileVisibility(next.onboarding_data?.profile_visibility ?? 'public')
      setRoundVisibility(next.onboarding_data?.default_round_visibility ?? 'friends')
    } catch (reason) {
      setError(message(reason, 'Unable to load privacy settings.'))
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
        onboarding_data: {
          ...profile.onboarding_data,
          default_round_visibility: roundVisibility,
          profile_visibility: profileVisibility,
        },
      }, await getAuthHeaders())
      router.back()
    } catch (reason) {
      setError(message(reason, 'Unable to save privacy settings.'))
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="Privacy & visibility" onBack={() => router.back()} />
      {loading ? <ActivityIndicator accessibilityLabel="Loading privacy settings" color={colors.pine} /> : <>
        <PrivacySection description="Choose who can discover you in golfer search." title="PROFILE VISIBILITY">
          <OptionGroup options={profileOptions} selected={profileVisibility} onSelect={(value) => setProfileVisibility(value as ProfileVisibility)} />
        </PrivacySection>
        <PrivacySection description="This becomes the starting visibility for rounds you log. You can still change each round before saving." title="DEFAULT ROUND VISIBILITY">
          <OptionGroup options={roundOptions} selected={roundVisibility} onSelect={(value) => setRoundVisibility(value as RoundVisibility)} />
        </PrivacySection>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save changes</Text>}</Pressable>
        <Pressable accessibilityRole="button" disabled={saving} hitSlop={8} onPress={() => router.back()}><Text style={styles.cancel}>Cancel</Text></Pressable>
      </>}
    </ProductScreen>
  </>
}

function PrivacySection({ children, description, title }: { children: React.ReactNode; description: string; title: string }) {
  return <View style={styles.section}><Text style={styles.sectionLabel}>{title}</Text><Text style={styles.sectionDescription}>{description}</Text>{children}</View>
}

function OptionGroup({ onSelect, options, selected }: { onSelect: (value: string) => void; options: Array<{ description: string; icon: keyof typeof Feather.glyphMap; label: string; value: string }>; selected: string }) {
  return <View style={styles.group}>{options.map((option) => {
    const active = selected === option.value
    return <Pressable accessibilityLabel={`${option.label}: ${option.description}`} accessibilityRole="radio" accessibilityState={{ checked: active }} key={option.value} onPress={() => onSelect(option.value)} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
      <View style={[styles.icon, active && styles.iconActive]}><Feather name={option.icon} size={18} color={active ? '#FFFFFF' : colors.pine} /></View>
      <View style={styles.optionCopy}><Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{option.label}</Text><Text style={styles.optionDescription}>{option.description}</Text></View>
      <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  })}</View>
}

function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  sectionDescription: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  group: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, overflow: 'hidden' },
  option: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 67, padding: 11 },
  icon: { alignItems: 'center', backgroundColor: colors.pineSoft, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  iconActive: { backgroundColor: colors.pine },
  optionCopy: { flex: 1, gap: 3 },
  optionLabel: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14 },
  optionLabelActive: { color: colors.pine },
  optionDescription: { color: colors.muted, fontSize: 9, lineHeight: 13 },
  radio: { alignItems: 'center', borderColor: '#AEB5B0', borderRadius: 9, borderWidth: 1.5, height: 18, justifyContent: 'center', width: 18 },
  radioActive: { borderColor: colors.pine },
  radioDot: { backgroundColor: colors.pine, borderRadius: 5, height: 10, width: 10 },
  error: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  saveButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, justifyContent: 'center', minHeight: 50 },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cancel: { color: colors.pine, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
})

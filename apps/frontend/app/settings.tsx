import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { getProfile } from '../src/api/client'
import { useAuthGate } from '../src/auth/AuthProvider'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { OnboardingPreferences } from '../src/types'
import { colors, radii } from '../src/ui/theme'

export default function Settings() {
  const router = useRouter()
  const { signOut } = useAuthGate()
  const { getAuthHeaders } = useAuthHeaders()
  const [profile, setProfile] = useState<OnboardingPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProfile(await getProfile(await getAuthHeaders()))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load settings.')
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in at any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { void signOut().then(() => router.replace('/')) } },
    ])
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader onBack={() => router.back()} title="Settings" />
      {loading ? <ActivityIndicator accessibilityLabel="Loading settings" color={colors.pine} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <SettingsSection title="GOLF">
        <SettingsRow icon="flag" label="Golf preferences" meta={preferenceSummary(profile)} onPress={() => router.push('/profile/preferences' as never)} />
        <SettingsRow icon="map-pin" label="Home region" meta={profile?.home_region ?? 'Not set'} onPress={() => router.push('/profile/edit' as never)} />
      </SettingsSection>

      <SettingsSection title="APP">
        <SettingsRow icon="bell" label="Notifications" meta={profile?.onboarding_data?.notifications === false ? 'Off' : 'On'} onPress={() => router.push('/notifications')} />
        <SettingsRow icon="lock" label="Privacy & visibility" meta={visibilitySummary(profile)} onPress={() => router.push('/privacy' as never)} />
        <SettingsRow icon="slash" label="Blocked accounts" onPress={() => router.push('/friends')} />
      </SettingsSection>

      <SettingsSection title="ACCOUNT">
        <SettingsRow icon="shield" label="Email & security" meta="Managed by Clerk" />
        <SettingsRow icon="help-circle" label="Help & support" onPress={() => void Linking.openURL('mailto:support@golfrank.app?subject=GolfRank%20support')} />
      </SettingsSection>

      <Pressable accessibilityRole="button" onPress={confirmSignOut} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}><Feather name="log-out" size={18} color={colors.error} /><Text style={styles.signOutText}>Sign out</Text></Pressable>
    </ProductScreen>
  </>
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.section}><Text style={styles.sectionLabel}>{title}</Text><View style={styles.group}>{children}</View></View>
}

function SettingsRow({ icon, label, meta, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; meta?: string; onPress?: () => void }) {
  const content = <><Feather name={icon} size={19} color={colors.pine} /><Text style={styles.rowLabel}>{label}</Text>{meta ? <Text numberOfLines={1} style={styles.rowMeta}>{meta}</Text> : <View style={{ flex: 1 }} />}{onPress ? <Feather name="chevron-right" size={17} color={colors.muted} /> : null}</>
  if (!onPress) return <View style={styles.row}>{content}</View>
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>{content}</Pressable>
}

function preferenceSummary(profile: OnboardingPreferences | null) {
  if (!profile) return 'Access, difficulty, budget'
  const labels = [profile.access === 'any' ? 'Any access' : profile.access, profile.difficulty === 'any' ? 'Any difficulty' : profile.difficulty]
  const budget = profile.onboarding_data?.budget
  if (budget) labels.push(budget)
  return labels.join(', ')
}

function visibilitySummary(profile: OnboardingPreferences | null) {
  const visibility = profile?.onboarding_data?.profile_visibility ?? 'public'
  return visibility.charAt(0).toUpperCase() + visibility.slice(1)
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: 4 },
  group: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 58, paddingHorizontal: 14 },
  rowLabel: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14 },
  rowMeta: { color: colors.muted, flex: 1, fontSize: 10, textAlign: 'right' },
  signOut: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 10, minHeight: 44, paddingHorizontal: 4 },
  signOutText: { color: colors.error, fontSize: 13, fontWeight: '700' },
  error: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  pressed: { opacity: 0.65 },
})

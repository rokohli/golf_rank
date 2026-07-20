import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native'

import { getProfile, savePreferences } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { OnboardingPreferences } from '../src/types'
import { colors, radii } from '../src/ui/theme'

export default function Notifications() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const [profile, setProfile] = useState<OnboardingPreferences | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await getProfile(await getAuthHeaders())
      setProfile(next)
      setEnabled(next.onboarding_data?.notifications !== false)
    } catch (reason) {
      setError(message(reason, 'Unable to load notification settings.'))
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
      await savePreferences({ ...profile, onboarding_data: { ...profile.onboarding_data, notifications: enabled } }, await getAuthHeaders())
      router.back()
    } catch (reason) {
      setError(message(reason, 'Unable to save notification settings.'))
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader title="Notifications" onBack={() => router.back()} />
      {loading ? <ActivityIndicator accessibilityLabel="Loading notification settings" color={colors.pine} /> : <>
        <View style={styles.heroIcon}><Feather name="bell" size={26} color={colors.pine} /></View>
        <View style={styles.intro}><Text style={styles.introTitle}>Stay in the loop</Text><Text style={styles.introBody}>Control whether GolfRank can notify you about relevant activity and updates.</Text></View>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowCopy}><Text style={styles.rowTitle}>Allow notifications</Text><Text style={styles.rowBody}>{enabled ? 'Notifications are enabled for your account.' : 'You will not receive GolfRank notifications.'}</Text></View>
            <Switch accessibilityLabel="Allow notifications" onValueChange={setEnabled} trackColor={{ false: '#D4D7D4', true: colors.pineSoft }} thumbColor={enabled ? colors.pine : '#FFFFFF'} value={enabled} />
          </View>
        </View>
        <Text style={styles.note}>Device-level notification permission is managed in iOS Settings.</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save changes</Text>}</Pressable>
        <Pressable accessibilityRole="button" disabled={saving} hitSlop={8} onPress={() => router.back()}><Text style={styles.cancel}>Cancel</Text></Pressable>
      </>}
    </ProductScreen>
  </>
}

function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  heroIcon: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.pineSoft, borderRadius: 29, height: 58, justifyContent: 'center', marginTop: 8, width: 58 },
  intro: { alignItems: 'center', gap: 7, paddingHorizontal: 24 },
  introTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 22 },
  introBody: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  group: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 15, minHeight: 76, paddingHorizontal: 15, paddingVertical: 12 },
  rowCopy: { flex: 1, gap: 5 },
  rowTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 15 },
  rowBody: { color: colors.muted, fontSize: 10, lineHeight: 14 },
  note: { color: colors.muted, fontSize: 10, lineHeight: 15, paddingHorizontal: 4 },
  error: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  saveButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, justifyContent: 'center', minHeight: 50, marginTop: 'auto' },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cancel: { color: colors.pine, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.55 },
})

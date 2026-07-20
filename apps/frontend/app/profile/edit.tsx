import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { getProfile, savePreferences } from '../../src/api/client'
import { useAuthGate } from '../../src/auth/AuthProvider'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { Avatar, ProductScreen, ScreenHeader } from '../../src/components/ProductUI'
import { OnboardingPreferences } from '../../src/types'
import { colors, radii } from '../../src/ui/theme'

export default function EditProfile() {
  const router = useRouter()
  const { profileImageUrl, updateProfileImage, updateUserProfile } = useAuthGate()
  const { getAuthHeaders } = useAuthHeaders()
  const [profile, setProfile] = useState<OnboardingPreferences | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [homeRegion, setHomeRegion] = useState('')
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await getProfile(await getAuthHeaders())
      setProfile(next)
      setFirstName(next.onboarding_data?.first_name ?? '')
      setLastName(next.onboarding_data?.last_name ?? '')
      setUsername(next.onboarding_data?.username ?? '')
      setHomeRegion(next.home_region)
    } catch (reason) {
      setError(message(reason, 'Unable to load your profile.'))
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const choosePhoto = async () => {
    setError(null)
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ['images'],
      quality: 0.85,
    })
    if (!result.canceled && result.assets[0]?.uri) setPendingImageUri(result.assets[0].uri)
  }

  const save = async () => {
    const normalizedFirst = firstName.trim()
    const normalizedLast = lastName.trim()
    const normalizedUsername = username.trim().replace(/^@+/, '')
    const normalizedRegion = homeRegion.trim()
    if ([normalizedFirst, normalizedLast, normalizedUsername, normalizedRegion].some((value) => value.length < 2)) {
      setError('Complete each profile field before saving.')
      return
    }
    if (!profile?.onboarding_data) {
      setError('Your saved profile is incomplete. Please try again.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const nextProfile: OnboardingPreferences = {
        ...profile,
        home_region: normalizedRegion,
        onboarding_data: {
          ...profile.onboarding_data,
          first_name: normalizedFirst,
          last_name: normalizedLast,
          profile_photo_added: profile.onboarding_data.profile_photo_added || Boolean(pendingImageUri),
          username: normalizedUsername,
        },
      }
      const tasks: Promise<unknown>[] = [
        updateUserProfile({ firstName: normalizedFirst, lastName: normalizedLast, username: normalizedUsername }),
        getAuthHeaders().then((headers) => savePreferences(nextProfile, headers)),
      ]
      if (pendingImageUri) tasks.push(updateProfileImage(pendingImageUri))
      await Promise.all(tasks)
      router.back()
    } catch (reason) {
      setError(message(reason, 'Unable to save your profile. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  const displayName = `${firstName} ${lastName}`.trim() || 'Golfer'

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader onBack={() => router.back()} title="Edit profile" />
      {loading ? <ActivityIndicator accessibilityLabel="Loading profile editor" color={colors.pine} /> : <>
        <View style={styles.photoBlock}>
          <View style={styles.photoWrap}>
            <Avatar imageUrl={pendingImageUri ?? profileImageUrl} initials={initials(displayName)} size={82} />
            <Pressable accessibilityLabel="Choose profile photo" accessibilityRole="button" onPress={() => void choosePhoto()} style={styles.camera}><Feather name="camera" size={16} color={colors.pine} /></Pressable>
          </View>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void choosePhoto()}><Text style={styles.changePhoto}>Change photo</Text></Pressable>
        </View>

        <View style={styles.form}>
          <ProfileField autoCapitalize="words" label="First name" onChangeText={setFirstName} value={firstName} />
          <ProfileField autoCapitalize="words" label="Last name" onChangeText={setLastName} value={lastName} />
          <ProfileField autoCapitalize="none" label="Username" onChangeText={setUsername} prefix="@" value={username} />
          <Text style={styles.helper}>This is how friends find you.</Text>
          <ProfileField autoCapitalize="words" icon="map-pin" label="Home region" onChangeText={setHomeRegion} value={homeRegion} />
        </View>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}>
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save changes</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={saving} hitSlop={8} onPress={() => router.back()}><Text style={styles.cancel}>Cancel</Text></Pressable>
      </>}
    </ProductScreen>
  </>
}

function ProfileField({ autoCapitalize, icon, label, onChangeText, prefix, value }: { autoCapitalize: 'none' | 'words'; icon?: keyof typeof Feather.glyphMap; label: string; onChangeText: (value: string) => void; prefix?: string; value: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.inputShell}>{prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}<TextInput accessibilityLabel={label} autoCapitalize={autoCapitalize} autoCorrect={false} onChangeText={onChangeText} style={styles.input} value={value} />{icon ? <Feather name={icon} size={18} color={colors.pine} /> : null}</View></View>
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'GR' }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }

const styles = StyleSheet.create({
  photoBlock: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  photoWrap: { position: 'relative' },
  camera: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 18, borderWidth: 1, bottom: -2, height: 34, justifyContent: 'center', position: 'absolute', right: -6, width: 34 },
  changePhoto: { color: colors.pine, fontSize: 12, fontWeight: '800' },
  form: { gap: 14 },
  field: { gap: 7 },
  label: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  inputShell: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, flexDirection: 'row', minHeight: 50, paddingHorizontal: 14 },
  prefix: { color: colors.muted, fontSize: 15, paddingRight: 9 },
  input: { color: colors.ink, flex: 1, fontSize: 14, paddingVertical: 0 },
  helper: { color: colors.muted, fontSize: 10, marginTop: -7 },
  error: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  saveButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, justifyContent: 'center', minHeight: 50, marginTop: 4 },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cancel: { color: colors.pine, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.55 },
})

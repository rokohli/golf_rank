import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { getProfile, savePreferences, searchCourses } from '../../src/api/client'
import { useAuthGate } from '../../src/auth/AuthProvider'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { Avatar, ProductScreen, ScreenHeader } from '../../src/components/ProductUI'
import { Course, OnboardingPreferences } from '../../src/types'
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
  const [homeCourseSearch, setHomeCourseSearch] = useState('')
  const [homeCourseId, setHomeCourseId] = useState<string | null>(null)
  const [courseSuggestions, setCourseSuggestions] = useState<Course[]>([])
  const [searchingCourses, setSearchingCourses] = useState(false)
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
      setHomeCourseSearch(next.onboarding_data?.home_course_search ?? '')
      setHomeCourseId(next.onboarding_data?.home_course_id ?? null)
    } catch (reason) {
      setError(message(reason, 'Unable to load your profile.'))
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const handleHomeCourseChange = (text: string) => {
    setHomeCourseSearch(text)
    setHomeCourseId(null)
  }

  const selectCourse = (course: Course) => {
    setHomeCourseId(String(course.id))
    setHomeCourseSearch(course.name)
    setCourseSuggestions([])
    if (!homeRegion.trim() && course.region) {
      setHomeRegion(course.region)
    }
  }

  useEffect(() => {
    const trimmed = homeCourseSearch.trim()
    if (trimmed.length < 2 || homeCourseId) {
      setCourseSuggestions([])
      setSearchingCourses(false)
      return
    }
    let active = true
    setSearchingCourses(true)
    const timeout = setTimeout(() => {
      searchCourses({ q: trimmed, limit: 5 })
        .then((courses) => {
          if (active) setCourseSuggestions(courses)
        })
        .catch(() => {
          if (active) setCourseSuggestions([])
        })
        .finally(() => {
          if (active) setSearchingCourses(false)
        })
    }, 250)
    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [homeCourseSearch, homeCourseId])

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
    const normalizedUsername = username.trim().replace(/^@+/, '').toLowerCase()
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

    let resolvedCourseId = homeCourseId
    let resolvedCourseName = homeCourseSearch.trim()

    if (resolvedCourseName) {
      if (!resolvedCourseId) {
        try {
          const matches = await searchCourses({ q: resolvedCourseName, limit: 5 })
          const normalized = resolvedCourseName.toLowerCase()
          const exactMatch = matches.find((c) => c.name.toLowerCase() === normalized)
          const fuzzyMatch = matches.find(
            (c) => c.name.toLowerCase().includes(normalized) || normalized.includes(c.name.toLowerCase())
          )
          const target = exactMatch || (matches.length === 1 ? matches[0] : fuzzyMatch)
          if (target) {
            resolvedCourseId = String(target.id)
            resolvedCourseName = target.name
          } else {
            setError('Please select your home course from the suggestions.')
            setSaving(false)
            return
          }
        } catch {
          setError('Unable to verify home course. Please select a suggestion.')
          setSaving(false)
          return
        }
      }
    } else {
      resolvedCourseId = null
      resolvedCourseName = ''
    }

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
          home_course_id: resolvedCourseId,
          home_course_search: resolvedCourseName,
        },
      }
      await savePreferences(nextProfile, await getAuthHeaders())
      // The backend save above is the source of truth and has already committed —
      // a failure past this point must not be reported as "unable to save", since
      // that would be false and would invite a confusing, unnecessary retry.
      try {
        await updateUserProfile({
          firstName: normalizedFirst,
          lastName: normalizedLast,
          username: nextProfile.onboarding_data.username,
        })
        if (pendingImageUri) await updateProfileImage(pendingImageUri)
      } catch (reason) {
        // No background retry exists — the only way this actually gets retried is
        // the user pressing Save again, so don't promise more than that.
        setError(message(reason, 'Your profile was saved, but syncing your name and photo to your account failed. Tap Save changes to try again.'))
        return
      }
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
          <ProfileField autoCapitalize="words" icon="flag" label="Home course" onChangeText={handleHomeCourseChange} placeholder="Search your home course" value={homeCourseSearch} />
          {searchingCourses ? <ActivityIndicator color={colors.pine} size="small" style={{ marginTop: 2 }} /> : null}
          {courseSuggestions.length > 0 ? (
            <View style={styles.suggestionsContainer}>
              {courseSuggestions.map((course) => (
                <Pressable
                  key={course.id}
                  accessibilityLabel={`Select ${course.name}`}
                  accessibilityRole="button"
                  onPress={() => selectCourse(course)}
                  style={({ pressed }) => [styles.suggestionItem, pressed && styles.pressed]}
                >
                  <Feather name="flag" size={14} color={colors.pine} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.suggestionName}>{course.name}</Text>
                    <Text numberOfLines={1} style={styles.suggestionMeta}>{course.region}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
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

function ProfileField({ autoCapitalize, icon, label, onChangeText, placeholder, prefix, value }: { autoCapitalize: 'none' | 'words'; icon?: keyof typeof Feather.glyphMap; label: string; onChangeText: (value: string) => void; placeholder?: string; prefix?: string; value: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.inputShell}>{prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}<TextInput accessibilityLabel={label} autoCapitalize={autoCapitalize} autoCorrect={false} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input} value={value} />{icon ? <Feather name={icon} size={18} color={colors.pine} /> : null}</View></View>
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
  suggestionsContainer: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.small,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: -6,
  },
  suggestionItem: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionName: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  suggestionMeta: { color: colors.muted, fontSize: 11 },
  error: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  saveButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, justifyContent: 'center', minHeight: 50, marginTop: 4 },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cancel: { color: colors.pine, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.55 },
})

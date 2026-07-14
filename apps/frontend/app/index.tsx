import { Stack, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ApiResponseError, getProfile, savePreferences } from '../src/api/client'
import { useAuthGate } from '../src/auth/AuthProvider'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { OnboardingForm } from '../src/components/OnboardingForm'
import { colors } from '../src/ui/theme'

type ProfileState = 'checking' | 'needs-onboarding' | 'error'

export default function Index() {
  const router = useRouter()
  const { returnToGetStarted, updateUserProfile } = useAuthGate()
  const { getAuthHeaders } = useAuthHeaders()
  const [profileState, setProfileState] = useState<ProfileState>('checking')

  const checkSavedProfile = useCallback(async () => {
    setProfileState('checking')
    try {
      await getProfile(await getAuthHeaders())
      router.replace('/home')
    } catch (reason) {
      if (reason instanceof ApiResponseError && reason.status === 404) {
        setProfileState('needs-onboarding')
        return
      }
      setProfileState('error')
    }
  }, [getAuthHeaders, router])

  useEffect(() => {
    void checkSavedProfile()
  }, [checkSavedProfile])

  const goBack = () => {
    if (returnToGetStarted()) return
    if (router.canGoBack()) router.back()
  }

  if (profileState === 'checking') {
    return (
      <SafeAreaView style={styles.statusScreen}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.pine} size="large" />
        <Text style={styles.statusText}>Loading your profile…</Text>
      </SafeAreaView>
    )
  }

  if (profileState === 'error') {
    return (
      <SafeAreaView style={styles.statusScreen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>We couldn’t load your profile.</Text>
          <Text style={styles.errorText}>Check your connection and try again.</Text>
          <Pressable accessibilityRole="button" onPress={() => void checkSavedProfile()} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ backgroundColor: '#FBFAF7', flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 18 }}
        >
          <OnboardingForm
            submit={async (input) => savePreferences(input, await getAuthHeaders())}
            saveProfile={updateUserProfile}
            onComplete={(destination) => router.replace(destination === 'profile' ? '/profile' : '/home')}
            onExit={goBack}
          />
        </ScrollView>
      </SafeAreaView>
    </>
  )
}

const styles = StyleSheet.create({
  statusScreen: { alignItems: 'center', backgroundColor: '#FBFAF7', flex: 1, justifyContent: 'center', padding: 24 },
  statusText: { color: colors.muted, fontSize: 14, marginTop: 14 },
  errorCard: { alignItems: 'center', gap: 10, maxWidth: 360 },
  errorTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 22, textAlign: 'center' },
  errorText: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  retryButton: { backgroundColor: colors.pine, borderRadius: 8, marginTop: 8, paddingHorizontal: 22, paddingVertical: 12 },
  retryText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
})

import { Stack, useRouter } from 'expo-router'
import { ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { savePreferences } from '../src/api/client'
import { useAuthGate } from '../src/auth/AuthProvider'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { OnboardingForm } from '../src/components/OnboardingForm'

export default function Index() {
  const router = useRouter()
  const { returnToGetStarted, updateUserProfile } = useAuthGate()
  const { getAuthHeaders } = useAuthHeaders()
  const goBack = () => {
    if (returnToGetStarted()) return
    if (router.canGoBack()) router.back()
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

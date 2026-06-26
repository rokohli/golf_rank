import { Stack, useRouter } from 'expo-router'
import { Pressable, ScrollView, Text } from 'react-native'

import { savePreferences } from '../src/api/client'
import { useAuthGate } from '../src/auth/AuthProvider'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { OnboardingForm } from '../src/components/OnboardingForm'

export default function Index() {
  const router = useRouter()
  const { returnToGetStarted } = useAuthGate()
  const { getAuthHeaders } = useAuthHeaders()
  const goBack = () => {
    if (returnToGetStarted()) return
    if (router.canGoBack()) router.back()
  }

  return (
    <>
      <Stack.Screen options={{ title: 'GolfRank' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 20 }}
      >
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={goBack}
          style={({ pressed }) => ({
            alignItems: 'center',
            alignSelf: 'flex-start',
            backgroundColor: pressed ? '#DDE5DF' : '#EAF0EC',
            borderRadius: 18,
            height: 36,
            justifyContent: 'center',
            marginBottom: 12,
            width: 36,
          })}
        >
          <Text style={{ color: '#102015', fontSize: 30, fontWeight: '500', lineHeight: 32 }}>‹</Text>
        </Pressable>
        <OnboardingForm
          submit={async (input) => savePreferences(input, await getAuthHeaders())}
          onComplete={() => router.replace('/discover')}
        />
      </ScrollView>
    </>
  )
}

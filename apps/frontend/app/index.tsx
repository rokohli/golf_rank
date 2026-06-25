import { Stack, useRouter } from 'expo-router'
import { ScrollView } from 'react-native'

import { savePreferences } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { OnboardingForm } from '../src/components/OnboardingForm'

export default function Index() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()

  return (
    <>
      <Stack.Screen options={{ title: 'GolfRank' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 20 }}
      >
        <OnboardingForm
          submit={async (input) => savePreferences(input, await getAuthHeaders())}
          onComplete={() => router.replace('/discover')}
        />
      </ScrollView>
    </>
  )
}

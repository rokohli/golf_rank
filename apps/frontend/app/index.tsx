import { Stack, useRouter } from 'expo-router'
import { ScrollView } from 'react-native'

import { OnboardingForm } from '../src/components/OnboardingForm'
import { savePreferences } from '../src/api/client'

export default function Index() {
  const router = useRouter()

  return (
    <>
      <Stack.Screen options={{ title: 'GolfRank' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 20 }}
      >
        <OnboardingForm submit={savePreferences} onComplete={() => router.replace('/discover')} />
      </ScrollView>
    </>
  )
}

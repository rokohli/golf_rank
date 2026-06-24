import { useState } from 'react'
import { Button, Text, TextInput, View } from 'react-native'
import { OnboardingPreferences } from '../types'

export function OnboardingForm({ submit, onComplete }: { submit: (input: OnboardingPreferences) => Promise<void>; onComplete: () => void }) {
  const [homeRegion, setHomeRegion] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setSaving(true); setError(null)
    try {
      await submit({ home_region: homeRegion, max_green_fee: 250, difficulty: 'any', access: 'any' })
      onComplete()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save preferences. Please try again.')
    } finally { setSaving(false) }
  }
  return <View><Text>Tell us about your golf</Text><TextInput accessibilityLabel="Home region" value={homeRegion} onChangeText={setHomeRegion} placeholder="Monterey, CA" />{error ? <Text accessibilityRole="alert">{error}</Text> : null}<Button title={saving ? 'Saving…' : 'Save preferences'} disabled={saving || homeRegion.trim().length < 2} onPress={save} /></View>
}

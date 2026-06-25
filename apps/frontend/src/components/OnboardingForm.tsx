import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
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

  const disabled = saving || homeRegion.trim().length < 2

  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 24 }}>
      <View style={{ gap: 8 }}>
        <Text selectable style={{ color: '#102015', fontSize: 34, fontWeight: '800', letterSpacing: -0.8 }}>
          Tell us about your golf
        </Text>
        <Text selectable style={{ color: '#53605A', fontSize: 17, lineHeight: 24 }}>
          Start with your home region. We’ll use it to seed nearby course discovery.
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        <Text selectable style={{ color: '#25352B', fontSize: 15, fontWeight: '600' }}>
          Home region
        </Text>
        <TextInput
          accessibilityLabel="Home region"
          autoCapitalize="words"
          autoCorrect={false}
          value={homeRegion}
          onChangeText={setHomeRegion}
          placeholder="Monterey, CA"
          placeholderTextColor="#8A948E"
          style={{
            backgroundColor: '#FFFFFF',
            borderColor: '#D8E0DA',
            borderRadius: 16,
            borderWidth: 1,
            color: '#102015',
            fontSize: 18,
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        />
      </View>

      {error ? (
        <Text accessibilityRole="alert" selectable style={{ color: '#B42318', fontSize: 15, lineHeight: 21 }}>
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={save}
        style={{
          alignItems: 'center',
          backgroundColor: disabled ? '#C9D2CC' : '#176B3A',
          borderRadius: 999,
          paddingVertical: 16,
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>{saving ? 'Saving…' : 'Save preferences'}</Text>
      </Pressable>
    </View>
  )
}

import { useAuth, useUser } from '@clerk/expo'
import { Feather } from '@expo/vector-icons'
import { useState } from 'react'
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { normalizeAccountPhone } from '../contactIdentifiers'

const { height: screenHeight } = Dimensions.get('window')
const compactAuth = screenHeight < 780

type PhoneResource = {
  id: string
  phoneNumber?: string | null
  prepareVerification: (params: { strategy: 'phone_code' }) => Promise<unknown>
  attemptVerification: (params: { code: string }) => Promise<{ verification?: { status?: string | null } | null }>
}

type ClerkUserWithPhone = {
  createPhoneNumber: (params: { phoneNumber: string }) => Promise<{ id: string }>
  reload: () => Promise<unknown>
  phoneNumbers: PhoneResource[]
}

export function hasVerifiedPhone(user: { phoneNumbers?: { verification?: { status?: string | null } | null }[] } | null | undefined) {
  return Boolean(user?.phoneNumbers?.some((phone) => phone.verification?.status === 'verified'))
}

export function PhoneSetupScreen() {
  const { signOut } = useAuth()
  const { user } = useUser()
  const [step, setStep] = useState<'collect' | 'verify'>('collect')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [pendingPhone, setPendingPhone] = useState<PhoneResource | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const normalizedPhone = normalizeAccountPhone(phoneNumber)

  async function sendCode() {
    if (!user || !normalizedPhone) {
      setErrorMessage('Enter a valid phone number. Outside the US, start with your country code, e.g. +44.')
      return
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const clerkUser = user as unknown as ClerkUserWithPhone
      // Resend / same-number retries must reuse the existing Clerk phone resource;
      // createPhoneNumber rejects duplicates.
      let phone = clerkUser.phoneNumbers.find((item) => item.phoneNumber === normalizedPhone) ?? null
      if (!phone) {
        const created = await clerkUser.createPhoneNumber({ phoneNumber: normalizedPhone })
        await clerkUser.reload()
        phone = clerkUser.phoneNumbers.find((item) => item.id === created.id) ?? null
      }
      if (!phone) throw new Error('Phone number was added, but Clerk did not return it for verification.')
      await phone.prepareVerification({ strategy: 'phone_code' })
      setPendingPhone(phone)
      setVerificationCode('')
      setStep('verify')
    } catch (reason) {
      setErrorMessage(phoneErrorMessage(reason, 'Unable to send an SMS code to that phone number.'))
    } finally {
      setLoading(false)
    }
  }

  async function verifyCode() {
    if (!pendingPhone) {
      setErrorMessage('Request a new SMS code and try again.')
      return
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const result = await pendingPhone.attemptVerification({ code: verificationCode.trim() })
      if (result.verification?.status === 'verified') {
        await (user as unknown as ClerkUserWithPhone).reload()
        return
      }
      setErrorMessage('That code did not verify. Please try again.')
    } catch (reason) {
      setErrorMessage(phoneErrorMessage(reason, 'Unable to verify that SMS code. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.formStack}>
          <View style={styles.headingBlock}>
            <Text selectable style={styles.title}>
              {step === 'collect' ? 'Add your phone' : 'Verify your phone'}
            </Text>
            <Text selectable style={styles.subtitle}>
              {step === 'collect'
                ? 'We use a verified phone number to help you find friends who already play Fairway.'
                : `Enter the SMS code we sent to ${normalizedPhone ?? phoneNumber.trim()}.`}
            </Text>
          </View>

          {step === 'collect' ? (
            <>
              <PhoneField
                autoFocus
                label="Phone number"
                onChangeText={setPhoneNumber}
                placeholder="(415) 555-0100"
                value={phoneNumber}
              />
              <Text style={styles.fieldHint}>Outside the US? Start with your country code, e.g. +44 7911 123456.</Text>
              <PrimaryButton
                disabled={loading || !normalizedPhone}
                label={loading ? 'Sending Code...' : 'Send SMS Code'}
                onPress={sendCode}
              />
            </>
          ) : (
            <>
              <PhoneField
                autoFocus
                icon="hash"
                inputMode="numeric"
                keyboardType="number-pad"
                label="SMS verification code"
                onChangeText={setVerificationCode}
                placeholder="123456"
                value={verificationCode}
              />
              <PrimaryButton
                disabled={loading || verificationCode.trim().length < 1}
                label={loading ? 'Verifying...' : 'Verify Phone'}
                onPress={verifyCode}
              />
              <Pressable
                accessibilityRole="button"
                disabled={loading}
                hitSlop={8}
                onPress={() => {
                  setStep('collect')
                  setVerificationCode('')
                  setPendingPhone(null)
                  setErrorMessage(null)
                }}
              >
                <Text style={styles.secondaryLink}>Use a different number</Text>
              </Pressable>
            </>
          )}

          <Pressable accessibilityRole="button" disabled={loading} hitSlop={8} onPress={() => void signOut()}>
            <Text style={styles.secondaryLink}>Sign out</Text>
          </Pressable>

          {errorMessage ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {errorMessage}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function PhoneField({
  autoFocus,
  icon = 'phone',
  inputMode = 'tel',
  keyboardType = 'phone-pad',
  label,
  onChangeText,
  placeholder,
  value,
}: {
  autoFocus?: boolean
  icon?: 'phone' | 'hash'
  inputMode?: 'tel' | 'numeric'
  keyboardType?: 'phone-pad' | 'number-pad'
  label: string
  onChangeText: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputShell}>
        <Feather name={icon} size={20} color="#6C746F" />
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          inputMode={inputMode}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#8A8F8B"
          style={styles.input}
          textContentType={inputMode === 'tel' ? 'telephoneNumber' : undefined}
          value={value}
        />
      </View>
    </View>
  )
}

function PrimaryButton({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, pressed && !disabled ? styles.pressed : null, disabled ? styles.disabled : null]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  )
}

function phoneErrorMessage(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object' && 'errors' in reason) {
    const [firstError] = (reason as { errors?: { longMessage?: string; message?: string }[] }).errors ?? []
    return firstError?.longMessage ?? firstError?.message ?? fallback
  }

  return reason instanceof Error ? reason.message : fallback
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#F8F6F1',
    flex: 1,
  },
  scrollContent: {
    backgroundColor: '#F8F6F1',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: screenHeight,
    paddingBottom: compactAuth ? 18 : 28,
    paddingHorizontal: 24,
    paddingTop: compactAuth ? 12 : 18,
  },
  formStack: {
    gap: compactAuth ? 12 : 16,
  },
  headingBlock: {
    alignItems: 'center',
    gap: 7,
    marginBottom: 4,
  },
  title: {
    color: '#214D3B',
    fontSize: compactAuth ? 29 : 34,
    fontWeight: '900',
    lineHeight: compactAuth ? 35 : 40,
    textAlign: 'center',
  },
  subtitle: {
    color: '#606864',
    fontSize: compactAuth ? 15 : 16,
    lineHeight: compactAuth ? 21 : 23,
    maxWidth: 320,
    textAlign: 'center',
  },
  fieldWrap: {
    gap: compactAuth ? 7 : 9,
  },
  fieldLabel: {
    color: '#1C2420',
    fontSize: 14,
    fontWeight: '800',
  },
  fieldHint: {
    color: '#6C746F',
    fontSize: 12,
    lineHeight: 17,
    marginTop: -4,
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#FDFCF9',
    borderColor: '#D8D7D1',
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: compactAuth ? 48 : 54,
    paddingHorizontal: 14,
  },
  input: {
    color: '#101816',
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 0,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#214D3B',
    borderRadius: 999,
    height: compactAuth ? 54 : 58,
    justifyContent: 'center',
    marginTop: compactAuth ? 2 : 6,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  secondaryLink: {
    color: '#214D3B',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.55,
  },
  errorText: {
    color: '#A04431',
    fontSize: 14,
    lineHeight: 20,
  },
})

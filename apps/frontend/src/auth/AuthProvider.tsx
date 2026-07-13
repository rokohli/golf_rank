import { ClerkProvider, Show, useSSO, useUser } from '@clerk/expo'
import { useSignIn, useSignUp } from '@clerk/expo/legacy'
import { tokenCache } from '@clerk/expo/token-cache'
import { Feather, Ionicons } from '@expo/vector-icons'
import * as AuthSession from 'expo-auth-session'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { createContext, ReactNode, useContext, useState } from 'react'
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { GetStartedScreen } from '../components/GetStartedScreen'

const ssoRedirectScheme = 'golfrank'
const ssoRedirectPath = 'sso-callback'

WebBrowser.maybeCompleteAuthSession()

type AuthGateActions = {
  returnToGetStarted: () => boolean
  updateUserProfile: (profile: { firstName: string; lastName: string; username: string }) => Promise<void>
}

const AuthGateContext = createContext<AuthGateActions>({
  returnToGetStarted: () => false,
  updateUserProfile: async () => undefined,
})

export function useAuthGate() {
  return useContext(AuthGateContext)
}

function DevelopmentAuthGate({ children }: { children: ReactNode }) {
  return <>{children}</>
}

const { height: screenHeight } = Dimensions.get('window')
const compactAuth = screenHeight < 780

function ClerkAuthActions({ initialMode }: { initialMode: 'sign-in' | 'sign-up' }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loadingAction, setLoadingAction] = useState<'sign-in' | 'sign-up' | 'email-sign-in' | 'email-sign-up' | 'verify-email' | null>(null)
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(initialMode)
  const [emailAddress, setEmailAddress] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationPending, setVerificationPending] = useState(false)
  const { startSSOFlow } = useSSO()
  const signInState = useSignIn()
  const signUpState = useSignUp()

  const formDisabled = loadingAction !== null || !emailAddress.trim() || password.length < 1
  const signUpDisabled = formDisabled

  const authenticate = async (action: 'sign-in' | 'sign-up', strategy: 'oauth_google' | 'oauth_apple') => {
    setErrorMessage(null)
    setLoadingAction(action)

    try {
      const redirectUrl = AuthSession.makeRedirectUri({ path: ssoRedirectPath, scheme: ssoRedirectScheme })
      let fallbackRedirectUrl: string | null = null
      const redirectSubscription = Linking.addEventListener('url', (event) => {
        if (event.url.startsWith(redirectUrl)) fallbackRedirectUrl = event.url
      })
      const ssoResult = await startSSOFlow({
        redirectUrl,
        strategy,
      }).finally(() => redirectSubscription.remove())
      const { authSessionResult, createdSessionId, setActive, signIn, signUp } = ssoResult
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId })
        return
      }

      const recoveredSessionId = await recoverSsoSessionFromRedirect(fallbackRedirectUrl, signIn, signUp)
      if (recoveredSessionId && setActive) {
        await setActive({ session: recoveredSessionId })
        return
      }

      if (authSessionResult?.type === 'success') {
        setErrorMessage(ssoMissingSessionMessage(redirectUrl, signIn, signUp))
        return
      }

      setErrorMessage(ssoIncompleteAuthSessionMessage(redirectUrl, authSessionResult))
    } catch (reason) {
      console.info('Clerk SSO failed before returning an auth session', {
        message: authErrorMessage(reason, 'Unknown SSO error'),
        reason,
      })
      setErrorMessage(`Unable to open Clerk authentication. ${authErrorMessage(reason, 'Check your Clerk provider settings and try again.')}`)
    } finally {
      setLoadingAction(null)
    }
  }

  const signInWithEmail = async () => {
    if (!signInState.isLoaded) return
    setErrorMessage(null)
    setLoadingAction('email-sign-in')

    try {
      const result = await signInState.signIn.create({
        identifier: emailAddress.trim(),
        password,
        strategy: 'password',
      })

      if (result.createdSessionId) {
        await signInState.setActive({ session: result.createdSessionId })
        return
      }

      setErrorMessage('Clerk needs another verification step before this sign-in can finish.')
    } catch (reason) {
      setErrorMessage(authErrorMessage(reason, 'Unable to sign in with that email and password.'))
    } finally {
      setLoadingAction(null)
    }
  }

  const signUpWithEmail = async () => {
    if (!signUpState.isLoaded) return
    setErrorMessage(null)
    setLoadingAction('email-sign-up')

    try {
      const temporaryUsername = `golfer_${Date.now().toString(36)}`
      const result = await signUpState.signUp.create({
        emailAddress: emailAddress.trim(),
        firstName: 'Golfer',
        password,
        username: temporaryUsername,
      })

      if (result.createdSessionId) {
        await signUpState.setActive({ session: result.createdSessionId })
        return
      }

      await signUpState.signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      setVerificationPending(true)
    } catch (reason) {
      setErrorMessage(authErrorMessage(reason, 'Unable to create an account with that email and password.'))
    } finally {
      setLoadingAction(null)
    }
  }

  const verifyEmail = async () => {
    if (!signUpState.isLoaded) return
    setErrorMessage(null)
    setLoadingAction('verify-email')

    try {
      const result = await signUpState.signUp.attemptEmailAddressVerification({ code: verificationCode.trim() })
      if (result.createdSessionId) {
        await signUpState.setActive({ session: result.createdSessionId })
        return
      }

      setErrorMessage('Email verified, but Clerk did not return a session yet.')
    } catch (reason) {
      setErrorMessage(authErrorMessage(reason, 'Unable to verify that code. Please try again.'))
    } finally {
      setLoadingAction(null)
    }
  }

  function switchMode(nextMode: 'sign-in' | 'sign-up') {
    setMode(nextMode)
    setVerificationPending(false)
    setErrorMessage(null)
  }

  return (
    <View style={authStyles.formStack}>
      <View style={authStyles.headingBlock}>
        <Text selectable style={mode === 'sign-in' ? authStyles.signInTitle : authStyles.signUpTitle}>
          {mode === 'sign-in' ? 'Welcome back.' : 'Create Account'}
        </Text>
        <Text selectable style={authStyles.authSubtitle}>
          {mode === 'sign-in'
            ? 'Sign in to continue your golf journey.'
            : 'Join Fairway and start tracking, ranking, and discovering amazing courses.'}
        </Text>
      </View>

      <View style={authStyles.socialStack}>
        <SocialButton
          disabled={loadingAction !== null}
          icon={<Ionicons name="logo-apple" size={19} color="#FFFFFF" />}
          label={loadingAction === 'sign-in' || loadingAction === 'sign-up' ? 'Opening Clerk...' : 'Continue with Apple'}
          onPress={() => authenticate(mode, 'oauth_apple')}
          tone="dark"
        />
        <SocialButton
          disabled={loadingAction !== null}
          icon={<Text style={authStyles.googleMark}>G</Text>}
          label="Continue with Google"
          onPress={() => authenticate(mode, 'oauth_google')}
          tone="light"
        />
        <SocialButton
          disabled={false}
          icon={<Feather name="mail" size={21} color="#1C2420" />}
          label="Continue with Email"
          onPress={() => undefined}
          tone="light"
        />
      </View>

      <Divider />

      <AuthField
        autoCapitalize="none"
        autoComplete="email"
        icon={mode === 'sign-in' ? <Feather name="user" size={21} color="#6C746F" /> : <Feather name="mail" size={21} color="#6C746F" />}
        inputMode="email"
        keyboardType="email-address"
        label={mode === 'sign-in' ? 'Email or Username' : 'Email'}
        onChangeText={setEmailAddress}
        placeholder={mode === 'sign-in' ? 'Enter your email or username' : 'Enter your email'}
        textContentType="emailAddress"
        value={emailAddress}
      />
      <AuthField
        autoCapitalize="none"
        autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
        icon={<Feather name="lock" size={20} color="#6C746F" />}
        label="Password"
        onChangeText={setPassword}
        placeholder={mode === 'sign-in' ? 'Enter your password' : 'Create a password'}
        rightIcon={(
          <Pressable
            accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setPasswordVisible((visible) => !visible)}
          >
            <Feather name={passwordVisible ? 'eye' : 'eye-off'} size={20} color="#6C746F" />
          </Pressable>
        )}
        secureTextEntry={!passwordVisible}
        textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
        value={password}
      />

      {mode === 'sign-in' ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setErrorMessage('Password reset will be added once Clerk reset flow is configured.')}>
          <Text style={authStyles.forgotText}>Forgot password?</Text>
        </Pressable>
      ) : (
        <PasswordChecklist password={password} />
      )}

      {verificationPending ? (
        <View style={authStyles.verifyStack}>
          <Text style={authStyles.verifyText}>
            Enter the verification code Clerk sent to {emailAddress.trim()}.
          </Text>
          <AuthField
            autoCapitalize="none"
            icon={<Feather name="hash" size={20} color="#6C746F" />}
            inputMode="numeric"
            keyboardType="number-pad"
            label="Verification code"
            onChangeText={setVerificationCode}
            placeholder="123456"
            value={verificationCode}
          />
          <PrimaryAuthButton
            disabled={loadingAction !== null || verificationCode.trim().length < 1}
            label={loadingAction === 'verify-email' ? 'Verifying...' : 'Verify Email'}
            onPress={verifyEmail}
          />
        </View>
      ) : (
        <PrimaryAuthButton
          disabled={mode === 'sign-in' ? formDisabled : signUpDisabled}
          label={
            mode === 'sign-in'
              ? loadingAction === 'email-sign-in'
                ? 'Signing In'
                : 'Sign In'
              : loadingAction === 'email-sign-up'
                ? 'Creating Account'
                : 'Create Account'
          }
          onPress={mode === 'sign-in' ? signInWithEmail : signUpWithEmail}
        />
      )}

      <View style={authStyles.modeFooter}>
        <Text style={authStyles.modeFooterMuted}>
          {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
        </Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
          <Text style={authStyles.modeFooterLink}>{mode === 'sign-in' ? 'Sign Up' : 'Sign In'}</Text>
        </Pressable>
      </View>

      {mode === 'sign-in' ? <GolfScene /> : null}

      {errorMessage ? (
        <Text accessibilityRole="alert" style={authStyles.errorText}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  )
}

function Divider() {
  return (
    <View style={authStyles.dividerRow}>
      <View style={authStyles.dividerLine} />
      <Text style={authStyles.dividerText}>or</Text>
      <View style={authStyles.dividerLine} />
    </View>
  )
}

function SocialButton({
  disabled,
  icon,
  label,
  onPress,
  tone,
}: {
  disabled: boolean
  icon: ReactNode
  label: string
  onPress: () => void
  tone: 'dark' | 'light'
}) {
  const dark = tone === 'dark'

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        authStyles.socialButton,
        dark ? authStyles.socialButtonDark : authStyles.socialButtonLight,
        pressed && !disabled ? authStyles.pressed : null,
        disabled ? authStyles.disabled : null,
      ]}
    >
      <View style={authStyles.socialIcon}>{icon}</View>
      <Text style={[authStyles.socialText, dark ? authStyles.socialTextDark : authStyles.socialTextLight]}>{label}</Text>
    </Pressable>
  )
}

function AuthField({
  autoCapitalize,
  autoComplete,
  icon,
  inputMode,
  keyboardType,
  label,
  onChangeText,
  placeholder,
  rightIcon,
  secureTextEntry,
  textContentType,
  value,
}: {
  autoCapitalize: 'none' | 'sentences' | 'words' | 'characters'
  autoComplete?: 'email' | 'current-password' | 'new-password'
  icon: ReactNode
  inputMode?: 'email' | 'numeric' | 'text'
  keyboardType?: 'default' | 'email-address' | 'number-pad'
  label: string
  onChangeText: (value: string) => void
  placeholder: string
  rightIcon?: ReactNode
  secureTextEntry?: boolean
  textContentType?: 'emailAddress' | 'password' | 'newPassword'
  value: string
}) {
  return (
    <View style={authStyles.fieldWrap}>
      <Text style={authStyles.fieldLabel}>{label}</Text>
      <View style={authStyles.inputShell}>
        {icon}
        <TextInput
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={false}
          inputMode={inputMode}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#8A8F8B"
          secureTextEntry={secureTextEntry}
          style={authStyles.input}
          textContentType={textContentType}
          value={value}
        />
        {rightIcon}
      </View>
    </View>
  )
}

function PrimaryAuthButton({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [authStyles.primaryButton, pressed && !disabled ? authStyles.pressed : null, disabled ? authStyles.disabled : null]}
    >
      <Text style={authStyles.primaryText}>{label}</Text>
    </Pressable>
  )
}

function PasswordChecklist({ password }: { password: string }) {
  const checks = [
    ['At least 8 characters', password.length >= 8],
    ['One number', /\d/.test(password)],
    ['One uppercase letter', /[A-Z]/.test(password)],
  ] as const

  return (
    <View style={authStyles.checklist}>
      {checks.map(([label, passed]) => (
        <View key={label} style={authStyles.checkRow}>
          <Ionicons name={passed ? 'checkmark-circle' : 'ellipse-outline'} size={17} color="#2C5F48" />
          <Text style={authStyles.checkText}>{label}</Text>
        </View>
      ))}
    </View>
  )
}

function GolfScene() {
  return (
    <View style={authStyles.golfScene}>
      <View style={authStyles.skyBand} />
      <View style={authStyles.hillBack} />
      <View style={authStyles.fairwayOne} />
      <View style={authStyles.fairwayTwo} />
      <View style={authStyles.bunker} />
      <View style={authStyles.water} />
    </View>
  )
}

function authErrorMessage(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object' && 'errors' in reason) {
    const [firstError] = (reason as { errors?: { longMessage?: string; message?: string }[] }).errors ?? []
    return firstError?.longMessage ?? firstError?.message ?? fallback
  }

  return reason instanceof Error ? reason.message : fallback
}

function ssoMissingSessionMessage(redirectUrl: string, signIn: unknown, signUp: unknown) {
  const signInStatus = clerkResourceStatus(signIn)
  const signUpStatus = clerkResourceStatus(signUp)
  const firstFactorStatus = clerkNestedStatus(signIn, 'firstFactorVerification')
  const secondFactorStatus = clerkNestedStatus(signIn, 'secondFactorVerification')
  const emailVerificationStatus = clerkNestedStatus(clerkObjectField(signUp, 'verifications'), 'emailAddress')
  const missingFields = clerkStringArrayField(signUp, 'missingFields')
  const unverifiedFields = clerkStringArrayField(signUp, 'unverifiedFields')
  const details = [
    `Sign-in status: ${signInStatus}.`,
    `Sign-up status: ${signUpStatus}.`,
    firstFactorStatus ? `First factor status: ${firstFactorStatus}.` : null,
    secondFactorStatus ? `Second factor status: ${secondFactorStatus}.` : null,
    emailVerificationStatus ? `Email verification status: ${emailVerificationStatus}.` : null,
  ].filter((detail): detail is string => detail !== null)
  const missingFieldsMessage = missingFields.length > 0 ? ` Missing fields: ${missingFields.join(', ')}.` : ''
  const unverifiedFieldsMessage = unverifiedFields.length > 0 ? ` Unverified fields: ${unverifiedFields.join(', ')}.` : ''

  console.info('Clerk SSO completed without a session', {
    redirectUrl,
    signInStatus,
    signUpStatus,
    firstFactorStatus,
    secondFactorStatus,
    emailVerificationStatus,
    missingFields,
    unverifiedFields,
  })

  return `Clerk completed OAuth but did not create a session. ${details.join(' ')}${missingFieldsMessage}${unverifiedFieldsMessage}`
}

function ssoIncompleteAuthSessionMessage(redirectUrl: string, authSessionResult: unknown) {
  const resultType = clerkResourceType(authSessionResult)

  console.info('Clerk SSO did not complete before session creation', {
    redirectUrl,
    authSessionResult,
    resultType,
  })

  return `Clerk SSO did not complete before session creation. Auth session result: ${resultType}. Redirect URL: ${redirectUrl}.`
}

async function recoverSsoSessionFromRedirect(redirectUrl: string | null, signIn: unknown, signUp: unknown) {
  if (!redirectUrl) return null

  const rotatingTokenNonce = new URL(redirectUrl).searchParams.get('rotating_token_nonce')
  const reload = clerkFunctionField(signIn, 'reload')
  if (!rotatingTokenNonce || !reload) return null

  await reload({ rotatingTokenNonce })

  if (clerkNestedStatus(signIn, 'firstFactorVerification') === 'transferable') {
    const create = clerkFunctionField(signUp, 'create')
    if (create) await create({ transfer: true })
  }

  return clerkStringField(signUp, 'createdSessionId') ?? clerkStringField(signIn, 'createdSessionId')
}

function clerkFunctionField(resource: unknown, field: string) {
  if (resource && typeof resource === 'object' && field in resource) {
    const value = (resource as Record<string, unknown>)[field]
    if (typeof value === 'function') return value
  }

  return null
}

function clerkStringField(resource: unknown, field: string) {
  if (resource && typeof resource === 'object' && field in resource) {
    const value = (resource as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.length > 0) return value
  }

  return null
}

function clerkResourceType(resource: unknown) {
  if (resource && typeof resource === 'object' && 'type' in resource) {
    const type = (resource as { type?: unknown }).type
    if (typeof type === 'string' && type.length > 0) return type
  }

  return 'unknown'
}

function clerkResourceStatus(resource: unknown) {
  if (resource && typeof resource === 'object' && 'status' in resource) {
    const status = (resource as { status?: unknown }).status
    if (typeof status === 'string' && status.length > 0) return status
  }

  return 'unknown'
}

function clerkNestedStatus(resource: unknown, field: string) {
  const nestedResource = clerkObjectField(resource, field)
  if (!nestedResource) return null

  return clerkResourceStatus(nestedResource)
}

function clerkObjectField(resource: unknown, field: string) {
  if (resource && typeof resource === 'object' && field in resource) {
    const value = (resource as Record<string, unknown>)[field]
    if (value && typeof value === 'object') return value
  }

  return null
}

function clerkStringArrayField(resource: unknown, field: string) {
  if (resource && typeof resource === 'object' && field in resource) {
    const value = (resource as Record<string, unknown>)[field]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  }

  return []
}

function ClerkSignedOutScreen() {
  const [readyForAuth, setReadyForAuth] = useState(false)
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')

  if (!readyForAuth) {
    return (
      <GetStartedScreen
        onGetStarted={() => {
          setAuthMode('sign-up')
          setReadyForAuth(true)
        }}
        onLogin={() => {
          setAuthMode('sign-in')
          setReadyForAuth(true)
        }}
      />
    )
  }

  return (
    <SafeAreaView style={authStyles.safeArea}>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={[authStyles.scrollContent, authMode === 'sign-in' ? authStyles.signInContent : authStyles.signUpContent]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => setReadyForAuth(false)}
          style={({ pressed }) => [authStyles.backButton, pressed ? authStyles.backButtonPressed : null]}
        >
          <Feather name="arrow-left" size={24} color="#101816" />
        </Pressable>
        <ClerkAuthActions initialMode={authMode} />
      </ScrollView>
    </SafeAreaView>
  )
}

const authStyles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#F8F6F1',
    flex: 1,
  },
  scrollContent: {
    backgroundColor: '#F8F6F1',
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  signInContent: {
    justifyContent: 'flex-start',
    minHeight: screenHeight,
    paddingBottom: compactAuth ? 12 : 18,
    paddingTop: compactAuth ? 12 : 18,
  },
  signUpContent: {
    justifyContent: 'center',
    minHeight: screenHeight,
    paddingBottom: compactAuth ? 18 : 28,
    paddingTop: compactAuth ? 12 : 18,
  },
  backButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginBottom: compactAuth ? 8 : 14,
    width: 36,
  },
  backButtonPressed: {
    backgroundColor: '#EAF0EC',
  },
  formStack: {
    gap: compactAuth ? 10 : 14,
  },
  headingBlock: {
    alignItems: 'center',
    gap: 7,
  },
  signInTitle: {
    color: '#171B19',
    fontSize: compactAuth ? 28 : 31,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: compactAuth ? 34 : 38,
  },
  signUpTitle: {
    color: '#214D3B',
    fontSize: compactAuth ? 29 : 34,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: compactAuth ? 35 : 40,
    textAlign: 'center',
  },
  authSubtitle: {
    color: '#606864',
    fontSize: compactAuth ? 15 : 16,
    lineHeight: compactAuth ? 21 : 23,
    maxWidth: 310,
    textAlign: 'center',
  },
  socialStack: {
    gap: compactAuth ? 8 : 10,
  },
  socialButton: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    height: compactAuth ? 46 : 50,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  socialButtonDark: {
    backgroundColor: '#101111',
  },
  socialButtonLight: {
    backgroundColor: '#FDFCF9',
    borderColor: '#D9D8D2',
    borderWidth: 1,
  },
  socialIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    width: 22,
  },
  socialText: {
    fontSize: 16,
    fontWeight: '800',
  },
  socialTextDark: {
    color: '#FFFFFF',
  },
  socialTextLight: {
    color: '#1C2420',
  },
  googleMark: {
    color: '#4285F4',
    fontSize: 19,
    fontWeight: '900',
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    paddingHorizontal: 22,
    paddingVertical: compactAuth ? 4 : 8,
  },
  dividerLine: {
    backgroundColor: '#DBD9D2',
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: '#1C2420',
    fontSize: 14,
    fontWeight: '700',
  },
  fieldWrap: {
    gap: compactAuth ? 7 : 9,
  },
  fieldLabel: {
    color: '#1C2420',
    fontSize: 14,
    fontWeight: '800',
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
  forgotText: {
    color: '#214D3B',
    fontSize: 14,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  checklist: {
    gap: compactAuth ? 6 : 8,
  },
  checkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  checkText: {
    color: '#214D3B',
    fontSize: 13,
    fontWeight: '800',
  },
  verifyStack: {
    gap: 10,
  },
  verifyText: {
    color: '#53605A',
    fontSize: 14,
    lineHeight: 20,
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
  modeFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: compactAuth ? 4 : 8,
  },
  modeFooterMuted: {
    color: '#606864',
    fontSize: 15,
  },
  modeFooterLink: {
    color: '#214D3B',
    fontSize: 15,
    fontWeight: '900',
  },
  golfScene: {
    backgroundColor: '#DCD9CC',
    borderRadius: 26,
    height: compactAuth ? 135 : 185,
    marginHorizontal: -10,
    marginTop: compactAuth ? 4 : 10,
    overflow: 'hidden',
  },
  skyBand: {
    backgroundColor: '#D9DED6',
    height: '42%',
    width: '100%',
  },
  hillBack: {
    backgroundColor: '#A9A999',
    borderRadius: 160,
    height: 120,
    position: 'absolute',
    right: -50,
    top: compactAuth ? 34 : 58,
    transform: [{ rotate: '-8deg' }],
    width: 300,
  },
  fairwayOne: {
    backgroundColor: '#6F8E55',
    borderRadius: 180,
    bottom: -68,
    height: compactAuth ? 142 : 175,
    left: 45,
    position: 'absolute',
    transform: [{ rotate: '-10deg' }],
    width: 360,
  },
  fairwayTwo: {
    backgroundColor: '#3E6A3D',
    borderRadius: 140,
    bottom: -38,
    height: compactAuth ? 94 : 125,
    left: 110,
    position: 'absolute',
    transform: [{ rotate: '8deg' }],
    width: 230,
  },
  bunker: {
    backgroundColor: '#D8D2BC',
    borderRadius: 999,
    bottom: compactAuth ? 35 : 54,
    height: compactAuth ? 20 : 28,
    left: 178,
    position: 'absolute',
    transform: [{ rotate: '-7deg' }],
    width: compactAuth ? 82 : 110,
  },
  water: {
    backgroundColor: '#526F73',
    borderRadius: 110,
    bottom: -48,
    height: compactAuth ? 118 : 150,
    left: -54,
    position: 'absolute',
    transform: [{ rotate: '-17deg' }],
    width: compactAuth ? 130 : 170,
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

function ClerkUserControls({ children }: { children: ReactNode }) {
  const { user } = useUser()

  return (
    <AuthGateContext.Provider
      value={{
        returnToGetStarted: () => false,
        updateUserProfile: async ({ firstName, lastName, username }) => {
          if (!user) throw new Error('Your account is not ready yet. Please try again.')
          await user.update({ firstName, lastName, username })
        },
      }}
    >
      {children}
    </AuthGateContext.Provider>
  )
}

function ClerkAuthGate({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-out">
        <ClerkSignedOutScreen />
      </Show>
      <Show when="signed-in">
        <ClerkUserControls>{children}</ClerkUserControls>
      </Show>
    </>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (process.env.EXPO_PUBLIC_AUTH_MODE === 'development') {
    return <DevelopmentAuthGate>{children}</DevelopmentAuthGate>
  }

  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
  if (!publishableKey) {
    throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required when EXPO_PUBLIC_AUTH_MODE is not development')
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkAuthGate>{children}</ClerkAuthGate>
    </ClerkProvider>
  )
}

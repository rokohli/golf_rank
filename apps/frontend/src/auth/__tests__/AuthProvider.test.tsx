import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Pressable, Text } from 'react-native'

import { AuthProvider, useAuthGate } from '../AuthProvider'

const mockStartSSOFlow = jest.fn()
const mockSetActive = jest.fn()
const mockSignInCreate = jest.fn()
const mockAttemptFirstFactor = jest.fn()
const mockPrepareFirstFactor = jest.fn()
const mockAttemptSecondFactor = jest.fn()
const mockPrepareSecondFactor = jest.fn()
const mockResetPassword = jest.fn()
const mockSignUpCreate = jest.fn()
const mockSetProfileImage = jest.fn()
const mockReadAsStringAsync = jest.fn()
let mockUrlListener: ((event: { url: string }) => void) | null = null
let mockUser: {
  firstName: string
  hasImage: boolean
  imageUrl: string
  phoneNumbers: { verification: { status: string } }[]
  setProfileImage: jest.Mock
} | null = null

jest.mock('@clerk/expo', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Show: ({ children, when }: { children: React.ReactNode; when: string }) =>
    when === (mockUser ? 'signed-in' : 'signed-out') ? <>{children}</> : null,
  useAuth: () => ({ signOut: jest.fn() }),
  useSSO: () => ({ startSSOFlow: mockStartSSOFlow }),
  useUser: () => ({ isLoaded: true, isSignedIn: mockUser !== null, user: mockUser }),
}))

jest.mock('expo-file-system', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
}))

jest.mock('@clerk/expo/legacy', () => ({
  useSignIn: () => ({
    isLoaded: true,
    setActive: mockSetActive,
    signIn: {
      attemptFirstFactor: mockAttemptFirstFactor,
      attemptSecondFactor: mockAttemptSecondFactor,
      create: mockSignInCreate,
      prepareFirstFactor: mockPrepareFirstFactor,
      prepareSecondFactor: mockPrepareSecondFactor,
      resetPassword: mockResetPassword,
    },
  }),
  useSignUp: () => ({
    isLoaded: true,
    setActive: mockSetActive,
    signUp: {
      create: mockSignUpCreate,
    },
  }),
}))

jest.mock('@clerk/expo/token-cache', () => ({
  tokenCache: {},
}))

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'golfrank://sso-callback'),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: jest.fn(),
  }),
}))

jest.mock('expo-linking', () => ({
  addEventListener: jest.fn((_type: string, listener: (event: { url: string }) => void) => {
    mockUrlListener = listener
    return { remove: jest.fn() }
  }),
}))

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
}))

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return {
    Feather: ({ name }: { name: string }) => <Text>{name}</Text>,
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
    MaterialCommunityIcons: ({ name }: { name: string }) => <Text>{name}</Text>,
  }
})

describe('AuthProvider', () => {
  const originalAuthMode = process.env.EXPO_PUBLIC_AUTH_MODE
  const originalPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY

  afterEach(() => {
    // `process.env.X = undefined` coerces to the string "undefined" in Node,
    // not deletion -- restoring an originally-unset var this way leaves a
    // truthy value behind for later tests.
    if (originalAuthMode === undefined) delete process.env.EXPO_PUBLIC_AUTH_MODE
    else process.env.EXPO_PUBLIC_AUTH_MODE = originalAuthMode
    if (originalPublishableKey === undefined) delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPublishableKey
    mockUrlListener = null
    mockUser = null
    jest.clearAllMocks()
  })

  it('converts a picked local file to a base64 data URI before handing it to Clerk', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockUser = {
      firstName: 'Rohan',
      hasImage: false,
      imageUrl: '',
      phoneNumbers: [{ verification: { status: 'verified' } }],
      setProfileImage: mockSetProfileImage,
    }
    mockReadAsStringAsync.mockResolvedValue('ZmFrZWJhc2U2NA==')

    function ProfileImageProbe() {
      const { updateProfileImage } = useAuthGate()
      return (
        <Pressable onPress={() => void updateProfileImage('file:///picked-photo.jpg')}>
          <Text>Update photo</Text>
        </Pressable>
      )
    }

    render(
      <AuthProvider>
        <ProfileImageProbe />
      </AuthProvider>,
    )

    fireEvent.press(screen.getByText('Update photo'))

    await waitFor(() => expect(mockReadAsStringAsync).toHaveBeenCalledWith('file:///picked-photo.jpg', { encoding: 'base64' }))
    expect(mockSetProfileImage).toHaveBeenCalledWith({ file: 'data:image/jpeg;base64,ZmFrZWJhc2U2NA==' })
  })

  it('does not support admin-development as a no-Clerk auth mode', () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'admin-development'

    expect(() =>
      render(
        <AuthProvider>
          <Text>Onboarding form</Text>
        </AuthProvider>,
      ),
    ).toThrow('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required when EXPO_PUBLIC_AUTH_MODE is not development')
  })

  it('enters the app immediately in development mode', () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'development'

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    expect(screen.getByText('Onboarding form')).toBeOnTheScreen()
  })

  it('shows the premium get started screen before Clerk auth for signed-out users', () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    expect(screen.getByText(/Your Game/)).toBeOnTheScreen()
    expect(screen.getByText('Get Started')).toBeOnTheScreen()
    expect(screen.getByText('9.5/10')).toBeOnTheScreen()
    expect(screen.queryByText('4.8')).toBeNull()
    expect(screen.queryByText('Welcome back.')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))

    expect(screen.getByText('Welcome back.')).toBeOnTheScreen()
  })

  it('does not show the Fairway brand lockup on the Clerk sign-in screen', () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))

    expect(screen.getByText('Welcome back.')).toBeOnTheScreen()
    expect(screen.queryByText('Fairway.')).toBeNull()
  })

  it('reveals and focuses the email form from the Continue with Email CTA', () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    expect(screen.queryByLabelText('Email or Username')).toBeNull()
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))

    expect(screen.getByLabelText('Email or Username')).toHaveProp('autoFocus', true)
  })

  it('returns from the Clerk auth screen to the premium get started screen', () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    expect(screen.getByText('Welcome back.')).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))

    expect(screen.getByText(/Your Game/)).toBeOnTheScreen()
    expect(screen.queryByText('Welcome back.')).toBeNull()
  })

  it('starts Clerk SSO with the Expo SSO callback URL and reports auth-session dismissals', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockStartSSOFlow.mockResolvedValue({
      authSessionResult: { type: 'dismiss' },
      createdSessionId: null,
      setActive: mockSetActive,
    })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }))

    await waitFor(() =>
      expect(mockStartSSOFlow).toHaveBeenCalledWith({
        redirectUrl: 'golfrank://sso-callback',
        strategy: 'oauth_google',
      }),
    )
    expect(mockSetActive).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Clerk SSO did not complete before session creation. Auth session result: dismiss. Redirect URL: golfrank://sso-callback.',
    )
  })

  it('uses the native app scheme for SSO and identifies Clerk incomplete state when no session is created', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    const AuthSession = require('expo-auth-session')
    mockStartSSOFlow.mockResolvedValue({
      authSessionResult: { type: 'success', url: 'golfrank://sso-callback?rotating_token_nonce=nonce_123' },
      createdSessionId: null,
      setActive: mockSetActive,
      signIn: { firstFactorVerification: { status: 'transferable' }, status: 'needs_first_factor' },
      signUp: {
        missingFields: ['first_name', 'username'],
        status: 'missing_requirements',
        unverifiedFields: ['email_address'],
        verifications: { emailAddress: { status: 'unverified' } },
      },
    })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }))

    await waitFor(() =>
      expect(AuthSession.makeRedirectUri).toHaveBeenCalledWith({
        path: 'sso-callback',
        scheme: 'golfrank',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Clerk completed OAuth but did not create a session. Sign-in status: needs_first_factor. Sign-up status: missing_requirements. First factor status: transferable. Email verification status: unverified. Missing fields: first_name, username. Unverified fields: email_address.',
    )
  })

  it('recovers a Clerk session when Android reports dismiss before the redirect event wins the race', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    const mockReload = jest.fn(async () => {
      signInResource.createdSessionId = 'sess_recovered'
      signInResource.status = 'complete'
    })
    const signInResource = {
      createdSessionId: null as string | null,
      firstFactorVerification: { status: 'verified' },
      reload: mockReload,
      status: 'needs_first_factor',
    }
    mockStartSSOFlow.mockImplementation(async () => {
      mockUrlListener?.({ url: 'golfrank://sso-callback?rotating_token_nonce=nonce_123' })
      return {
        authSessionResult: { type: 'dismiss' },
        createdSessionId: null,
        setActive: mockSetActive,
        signIn: signInResource,
        signUp: { createdSessionId: null },
      }
    })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }))

    await waitFor(() => {
      expect(mockReload).toHaveBeenCalledWith({ rotatingTokenNonce: 'nonce_123' })
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_recovered' })
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('signs in with Clerk email and password', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockSignInCreate.mockResolvedValue({ createdSessionId: 'sess_123' })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.changeText(screen.getByLabelText('Email or Username'), 'rohan@example.com')
    fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery staple')
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true)
    fireEvent.press(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false)
    fireEvent.press(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true)
    fireEvent.press(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => {
      expect(mockSignInCreate).toHaveBeenCalledWith({
        identifier: 'rohan@example.com',
        password: 'correct horse battery staple',
        strategy: 'password',
      })
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_123' })
    })
  })

  it('completes sign-in with an emailed verification code when Clerk requires a first factor', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockSignInCreate.mockResolvedValue({
      status: 'needs_first_factor',
      supportedFirstFactors: [{ emailAddressId: 'idn_email_1', strategy: 'email_code' }],
    })
    mockPrepareFirstFactor.mockResolvedValue({ status: 'needs_first_factor' })
    mockAttemptFirstFactor.mockResolvedValue({ createdSessionId: 'sess_verified', status: 'complete' })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.changeText(screen.getByLabelText('Email or Username'), 'rohan@example.com')
    fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery staple')
    fireEvent.press(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByLabelText('Enter the code sent to your email')).toBeOnTheScreen()
    await waitFor(() => expect(mockPrepareFirstFactor).toHaveBeenCalledWith({ strategy: 'email_code', emailAddressId: 'idn_email_1' }))

    fireEvent.changeText(screen.getByLabelText('Enter the code sent to your email'), '654321')
    fireEvent.press(screen.getByRole('button', { name: 'Verify Code' }))

    await waitFor(() => {
      expect(mockAttemptFirstFactor).toHaveBeenCalledWith({ strategy: 'email_code', code: '654321' })
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_verified' })
    })
  })

  it('retries password as a pending first factor when create() leaves it unvalidated', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockSignInCreate.mockResolvedValue({
      status: 'needs_first_factor',
      supportedFirstFactors: [{ strategy: 'password' }, { strategy: 'reset_password_phone_code' }],
    })
    mockAttemptFirstFactor.mockResolvedValue({ createdSessionId: 'sess_password_retry', status: 'complete' })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.changeText(screen.getByLabelText('Email or Username'), 'rohan@example.com')
    fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery staple')
    fireEvent.press(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => {
      expect(mockAttemptFirstFactor).toHaveBeenCalledWith({ strategy: 'password', password: 'correct horse battery staple' })
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_password_retry' })
    })
  })

  it('completes sign-in through Clerk Device Trust when signing in from an unrecognized device', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockSignInCreate.mockResolvedValue({
      status: 'needs_client_trust',
      supportedFirstFactors: [],
      supportedSecondFactors: [{ phoneNumberId: 'idn_phone_1', strategy: 'phone_code' }],
    })
    mockPrepareSecondFactor.mockResolvedValue({ status: 'needs_client_trust' })
    mockAttemptSecondFactor.mockResolvedValue({ createdSessionId: 'sess_trusted', status: 'complete' })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.changeText(screen.getByLabelText('Email or Username'), 'rohan@example.com')
    fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery staple')
    fireEvent.press(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByLabelText('Enter the code sent to your phone to verify this device')).toBeOnTheScreen()
    await waitFor(() => expect(mockPrepareSecondFactor).toHaveBeenCalledWith({ strategy: 'phone_code', phoneNumberId: 'idn_phone_1' }))

    fireEvent.changeText(screen.getByLabelText('Enter the code sent to your phone to verify this device'), '112233')
    fireEvent.press(screen.getByRole('button', { name: 'Verify Code' }))

    await waitFor(() => {
      expect(mockAttemptSecondFactor).toHaveBeenCalledWith({ strategy: 'phone_code', code: '112233' })
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_trusted' })
    })
  })

  it('resets a Clerk password with an emailed verification code and signs in', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockSignInCreate.mockResolvedValue({ status: 'needs_first_factor' })
    mockAttemptFirstFactor.mockResolvedValue({ status: 'needs_new_password' })
    mockResetPassword.mockResolvedValue({ createdSessionId: 'sess_reset', status: 'complete' })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Log In' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.changeText(screen.getByLabelText('Email or Username'), 'rohan@example.com')
    fireEvent.press(screen.getByRole('button', { name: 'Forgot password?' }))
    fireEvent.press(screen.getByRole('button', { name: 'Send Reset Code' }))

    await waitFor(() => {
      expect(mockSignInCreate).toHaveBeenCalledWith({
        identifier: 'rohan@example.com',
        strategy: 'reset_password_email_code',
      })
    })

    fireEvent.changeText(screen.getByLabelText('Reset code'), '123456')
    fireEvent.press(screen.getByRole('button', { name: 'Verify Code' }))

    await waitFor(() => {
      expect(mockAttemptFirstFactor).toHaveBeenCalledWith({
        code: '123456',
        strategy: 'reset_password_email_code',
      })
    })

    fireEvent.changeText(screen.getByLabelText('New password'), 'New password 1')
    fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'New password 1')
    fireEvent.press(screen.getByRole('button', { name: 'Update Password' }))

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({ password: 'New password 1' })
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_reset' })
    })
  })

  it('creates a Clerk email and password account without email OTP', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockSignUpCreate.mockResolvedValue({ createdSessionId: 'sess_new' })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Get Started' }))
    expect(screen.getAllByText('Create Account').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Full Name')).not.toBeOnTheScreen()
    expect(screen.queryByLabelText('Username')).not.toBeOnTheScreen()
    expect(screen.queryByLabelText('Phone number')).not.toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com')
    fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery staple')
    expect(screen.queryByLabelText('Phone number')).not.toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => {
      expect(mockSignUpCreate).toHaveBeenCalledWith(expect.objectContaining({
        emailAddress: 'new@example.com',
        firstName: 'Golfer',
        password: 'correct horse battery staple',
        username: expect.stringMatching(/^golfer_/),
      }))
      expect(mockSignUpCreate.mock.calls[0][0].phoneNumber).toBeUndefined()
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_new' })
    })

    expect(screen.queryByLabelText('Verification code')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Verify Email' })).toBeNull()
  })

  it('explains when Clerk still requires a phone number at sign-up', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockSignUpCreate.mockResolvedValue({
      createdSessionId: null,
      missingFields: ['phone_number'],
      requiredFields: ['email_address', 'phone_number', 'password'],
      status: 'missing_requirements',
      unverifiedFields: [],
    })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Get Started' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com')
    fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery staple')
    fireEvent.press(screen.getByRole('button', { name: 'Create Account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Clerk still requires a phone number at sign-up. In the Clerk dashboard, open User & authentication → Phone and set phone to optional (we collect and verify it after account creation).',
    )
  })
})

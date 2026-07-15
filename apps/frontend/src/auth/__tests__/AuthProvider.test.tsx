import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'

import { AuthProvider } from '../AuthProvider'

const mockStartSSOFlow = jest.fn()
const mockSetActive = jest.fn()
const mockSignInCreate = jest.fn()
const mockSignUpCreate = jest.fn()
const mockPrepareEmailAddressVerification = jest.fn()
const mockAttemptEmailAddressVerification = jest.fn()
let mockUrlListener: ((event: { url: string }) => void) | null = null

jest.mock('@clerk/expo', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Show: ({ children, when }: { children: React.ReactNode; when: string }) =>
    when === 'signed-out' ? <>{children}</> : null,
  useAuth: () => ({ signOut: jest.fn() }),
  useSSO: () => ({ startSSOFlow: mockStartSSOFlow }),
  useUser: () => ({ user: null }),
}))

jest.mock('@clerk/expo/legacy', () => ({
  useSignIn: () => ({
    isLoaded: true,
    setActive: mockSetActive,
    signIn: {
      create: mockSignInCreate,
    },
  }),
  useSignUp: () => ({
    isLoaded: true,
    setActive: mockSetActive,
    signUp: {
      attemptEmailAddressVerification: mockAttemptEmailAddressVerification,
      create: mockSignUpCreate,
      prepareEmailAddressVerification: mockPrepareEmailAddressVerification,
    },
  }),
}))

jest.mock('@clerk/expo/token-cache', () => ({
  tokenCache: {},
}))

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'golfrank://sso-callback'),
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
    process.env.EXPO_PUBLIC_AUTH_MODE = originalAuthMode
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPublishableKey
    mockUrlListener = null
    jest.clearAllMocks()
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

  it('creates a Clerk email and password account and completes email code verification', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'clerk'
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123'
    mockSignUpCreate.mockResolvedValue({ createdSessionId: null })
    mockPrepareEmailAddressVerification.mockResolvedValue(undefined)
    mockAttemptEmailAddressVerification.mockResolvedValue({ createdSessionId: 'sess_new' })

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    fireEvent.press(screen.getByRole('button', { name: 'Get Started' }))
    expect(screen.getAllByText('Create Account').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Full Name')).not.toBeOnTheScreen()
    expect(screen.queryByLabelText('Username')).not.toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com')
    fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery staple')
    fireEvent.press(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => {
      expect(mockSignUpCreate).toHaveBeenCalledWith(expect.objectContaining({
        emailAddress: 'new@example.com',
        firstName: 'Golfer',
        password: 'correct horse battery staple',
        username: expect.stringMatching(/^golfer_/),
      }))
      expect(mockPrepareEmailAddressVerification).toHaveBeenCalledWith({ strategy: 'email_code' })
    })

    fireEvent.changeText(screen.getByLabelText('Verification code'), '123456')
    fireEvent.press(screen.getByRole('button', { name: 'Verify Email' }))

    await waitFor(() => {
      expect(mockAttemptEmailAddressVerification).toHaveBeenCalledWith({ code: '123456' })
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_new' })
    })
  })
})

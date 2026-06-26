import { createContext, ReactNode, useContext, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { GetStartedScreen } from '../components/GetStartedScreen'

type AuthGateActions = {
  returnToGetStarted: () => boolean
}

const AuthGateContext = createContext<AuthGateActions>({
  returnToGetStarted: () => false,
})

export function useAuthGate() {
  return useContext(AuthGateContext)
}

function DevelopmentAuthGate({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function AdminDevelopmentAuthGate({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(false)
  const actions = useMemo(
    () => ({
      returnToGetStarted: () => {
        setEntered(false)
        return true
      },
    }),
    [],
  )

  if (entered) return <AuthGateContext.Provider value={actions}>{children}</AuthGateContext.Provider>

  return (
    <AuthGateContext.Provider value={actions}>
      <GetStartedScreen onGetStarted={() => setEntered(true)} onLogin={() => setEntered(true)} />
    </AuthGateContext.Provider>
  )
}

function ClerkAuthGate() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#F8FAF7' }}>
      <Text selectable style={{ color: '#102015', fontSize: 30, fontWeight: '800' }}>
        Sign in to GolfRank
      </Text>
      <Text selectable style={{ color: '#53605A', fontSize: 16, lineHeight: 22 }}>
        Clerk is configured, but the sign-in screens are intentionally minimal in this first auth slice.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled
        style={{ alignItems: 'center', backgroundColor: '#C9D2CC', borderRadius: 999, paddingVertical: 16 }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>Sign in setup pending</Text>
      </Pressable>
    </View>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (process.env.EXPO_PUBLIC_AUTH_MODE === 'development') {
    return <DevelopmentAuthGate>{children}</DevelopmentAuthGate>
  }

  if (process.env.EXPO_PUBLIC_AUTH_MODE === 'admin-development') {
    return <AdminDevelopmentAuthGate>{children}</AdminDevelopmentAuthGate>
  }

  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
  if (!publishableKey) {
    throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required when EXPO_PUBLIC_AUTH_MODE is not development')
  }

  return <ClerkAuthGate />
}

import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-expo'
import * as SecureStore from 'expo-secure-store'
import { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key)
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value)
  },
}

function DevelopmentAuthGate({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function ClerkAuthGate({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuth()
  if (!isLoaded) return null

  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
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
      </SignedOut>
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

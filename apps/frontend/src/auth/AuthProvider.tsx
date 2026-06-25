import * as SecureStore from 'expo-secure-store'
import { ReactNode, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

type ClerkExpo = typeof import('@clerk/clerk-expo')

declare const require: (moduleName: string) => ClerkExpo

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

function AdminDevelopmentAuthGate({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(false)
  if (entered) return <>{children}</>

  return (
    <View style={styles.getStartedScreen}>
      <View style={styles.orbitStage}>
        <View style={[styles.orbitRing, styles.outerOrbit]} />
        <View style={[styles.orbitRing, styles.middleOrbit]} />
        <View style={[styles.orbitRing, styles.innerOrbit]} />
        <View style={styles.spark}>
          <View style={styles.sparkVertical} />
          <View style={styles.sparkHorizontal} />
        </View>
        <View style={[styles.avatarBubble, styles.avatarOne]}>
          <Text style={styles.avatarText}>RK</Text>
        </View>
        <View style={[styles.avatarBubble, styles.avatarTwo]}>
          <Text style={styles.avatarText}>72</Text>
        </View>
        <View style={[styles.avatarBubble, styles.avatarThree]}>
          <Text style={styles.avatarText}>18</Text>
        </View>
        <View style={[styles.floatingToken, styles.pinToken]}>
          <Text style={styles.tokenText}>9</Text>
        </View>
        <View style={[styles.floatingToken, styles.flagToken]}>
          <Text style={styles.tokenText}>F</Text>
        </View>
        <View style={[styles.floatingToken, styles.globeToken]}>
          <Text style={styles.tokenText}>GR</Text>
        </View>
      </View>

      <View style={styles.titleBlock}>
        <Text selectable style={styles.brand}>
          GolfRank
        </Text>
        <Text selectable style={styles.headline}>
          Find Your Round
        </Text>
        <Text selectable style={styles.gradientLine}>
          Start Here
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => setEntered(true)}
        style={({ pressed }) => [styles.getStartedButton, pressed && styles.getStartedButtonPressed]}
      >
        <Text style={styles.getStartedButtonText}>Get Started</Text>
      </Pressable>
    </View>
  )
}

function ClerkAuthGate({ children }: { children: ReactNode }) {
  const { SignedIn, SignedOut, useAuth } = require('@clerk/clerk-expo')
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

  if (process.env.EXPO_PUBLIC_AUTH_MODE === 'admin-development') {
    return <AdminDevelopmentAuthGate>{children}</AdminDevelopmentAuthGate>
  }

  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
  if (!publishableKey) {
    throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required when EXPO_PUBLIC_AUTH_MODE is not development')
  }

  const { ClerkProvider } = require('@clerk/clerk-expo')

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkAuthGate>{children}</ClerkAuthGate>
    </ClerkProvider>
  )
}

const styles = StyleSheet.create({
  getStartedScreen: {
    alignItems: 'center',
    backgroundColor: '#F9F7F3',
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    padding: 28,
  },
  orbitStage: {
    alignItems: 'center',
    aspectRatio: 1,
    justifyContent: 'center',
    marginBottom: 34,
    maxWidth: 440,
    position: 'relative',
    width: '112%',
  },
  orbitRing: {
    borderColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 999,
    borderWidth: 2,
    position: 'absolute',
  },
  outerOrbit: {
    height: '112%',
    width: '112%',
  },
  middleOrbit: {
    height: '74%',
    width: '74%',
  },
  innerOrbit: {
    height: '36%',
    width: '36%',
  },
  spark: {
    alignItems: 'center',
    height: 76,
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
    width: 76,
  },
  sparkHorizontal: {
    backgroundColor: '#FFB44D',
    borderRadius: 999,
    height: 18,
    position: 'absolute',
    width: 76,
  },
  sparkVertical: {
    backgroundColor: '#CC4FD5',
    borderRadius: 999,
    height: 76,
    position: 'absolute',
    width: 18,
  },
  avatarBubble: {
    alignItems: 'center',
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 3,
    height: 68,
    justifyContent: 'center',
    position: 'absolute',
    shadowColor: '#31223A',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    width: 68,
  },
  avatarOne: {
    backgroundColor: '#FFE386',
    right: '4%',
    top: '22%',
  },
  avatarTwo: {
    backgroundColor: '#BDF8B7',
    right: '33%',
    top: '32%',
  },
  avatarThree: {
    backgroundColor: '#C8DFFF',
    bottom: '23%',
    left: '12%',
  },
  avatarText: {
    color: '#2C2431',
    fontSize: 20,
    fontWeight: '800',
  },
  floatingToken: {
    alignItems: 'center',
    borderRadius: 18,
    justifyContent: 'center',
    position: 'absolute',
    shadowColor: '#512072',
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },
  pinToken: {
    backgroundColor: '#C450D9',
    height: 84,
    top: '10%',
    transform: [{ rotate: '18deg' }],
    width: 62,
  },
  flagToken: {
    backgroundColor: '#FFB86B',
    height: 64,
    right: '8%',
    top: '58%',
    transform: [{ rotate: '-24deg' }],
    width: 74,
  },
  globeToken: {
    backgroundColor: '#B447D8',
    bottom: '3%',
    height: 82,
    left: '31%',
    width: 82,
  },
  tokenText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  titleBlock: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 42,
  },
  brand: {
    color: '#9A9A9E',
    fontSize: 34,
    fontWeight: '800',
  },
  headline: {
    color: '#151217',
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 54,
    textAlign: 'center',
  },
  gradientLine: {
    color: '#4B8CFF',
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 54,
    textAlign: 'center',
  },
  getStartedButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#151217',
    borderRadius: 999,
    justifyContent: 'center',
    marginBottom: 28,
    minHeight: 70,
  },
  getStartedButtonPressed: {
    backgroundColor: '#2A252C',
  },
  getStartedButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
})

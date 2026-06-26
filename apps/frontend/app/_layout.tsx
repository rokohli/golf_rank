import { Stack } from 'expo-router'

import { AuthProvider } from '../src/auth/AuthProvider'

export default function Layout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: '#F8FAF7' },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#F8FAF7' },
        }}
      />
    </AuthProvider>
  )
}

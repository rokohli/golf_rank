import { Stack } from 'expo-router'

import { AuthProvider } from '../src/auth/AuthProvider'

export default function Layout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          animation: 'fade',
          contentStyle: { backgroundColor: '#F8F7F3' },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#F8FAF7' },
        }}
      >
        <Stack.Screen
          name="rate/[id]"
          options={{ headerShown: false, presentation: 'fullScreenModal' }}
        />
      </Stack>
    </AuthProvider>
  )
}

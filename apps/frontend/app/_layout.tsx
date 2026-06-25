import { Stack } from 'expo-router'

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: '#F8FAF7' },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: '#F8FAF7' },
      }}
    />
  )
}

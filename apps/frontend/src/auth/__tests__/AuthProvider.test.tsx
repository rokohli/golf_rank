import { fireEvent, render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'

import { AuthProvider } from '../AuthProvider'

describe('AuthProvider', () => {
  const originalAuthMode = process.env.EXPO_PUBLIC_AUTH_MODE

  afterEach(() => {
    process.env.EXPO_PUBLIC_AUTH_MODE = originalAuthMode
  })

  it('shows an admin get started gate before entering the app in admin development mode', () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'admin-development'

    render(
      <AuthProvider>
        <Text>Onboarding form</Text>
      </AuthProvider>,
    )

    expect(screen.getByText('GolfRank')).toBeOnTheScreen()
    expect(screen.getByText('Get Started')).toBeOnTheScreen()
    expect(screen.queryByText('Onboarding form')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Get Started' }))

    expect(screen.getByText('Onboarding form')).toBeOnTheScreen()
  })
})

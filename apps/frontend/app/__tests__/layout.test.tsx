import { render } from '@testing-library/react-native'
import { Stack } from 'expo-router'

import Layout from '../_layout'

jest.mock('expo-router', () => {
  const Stack = jest.fn(({ children }: { children?: React.ReactNode }) => children ?? null)
  Object.assign(Stack, { Screen: jest.fn(() => null) })
  return { Stack }
})

jest.mock('../../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('root route configuration', () => {
  it('declares the rating modal options statically on the root stack', () => {
    render(<Layout />)

    expect(Stack.Screen).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'rate/[id]',
        options: { headerShown: false, presentation: 'fullScreenModal' },
      }),
      undefined,
    )
  })
})

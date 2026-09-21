import { fireEvent, render, screen } from '@testing-library/react-native'
import { Linking } from 'react-native'

import Support from '../support'

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() }
const mockOpenBrowserAsync = jest.fn().mockResolvedValue({ type: 'opened' })
const mockOpenUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never)

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}))

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
}))

describe('Support screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.EXPO_PUBLIC_WEB_URL
  })

  it('renders support header, hero, and FAQ questions', () => {
    render(<Support />)

    expect(screen.getByText('Help & support')).toBeOnTheScreen()
    expect(screen.getByText('How can we help?')).toBeOnTheScreen()
    expect(screen.getByText('Email support')).toBeOnTheScreen()
    expect(screen.getByText('support@fairway.app')).toBeOnTheScreen()

    expect(screen.getByText('How do course rankings work?')).toBeOnTheScreen()
    expect(screen.getByText('How do I log a round?')).toBeOnTheScreen()
    expect(screen.getByText('How do green fee estimates work?')).toBeOnTheScreen()
    expect(screen.getByText('How are course photos moderated?')).toBeOnTheScreen()
    expect(screen.getByText('How do I export or delete my data?')).toBeOnTheScreen()

    expect(screen.getByText('Terms of service')).toBeOnTheScreen()
    expect(screen.getByText('Privacy policy')).toBeOnTheScreen()
    expect(screen.getByText('Fairway v1.0.0')).toBeOnTheScreen()
  })

  it('expands and collapses FAQ items when pressed', () => {
    render(<Support />)

    const questionText = 'How do course rankings work?'
    expect(screen.queryByText(/Fairway uses pairwise head-to-head comparisons/)).toBeNull()

    // Press to expand
    fireEvent.press(screen.getByText(questionText))
    expect(screen.getByText(/Fairway uses pairwise head-to-head comparisons/)).toBeOnTheScreen()

    // Press again to collapse
    fireEvent.press(screen.getByText(questionText))
    expect(screen.queryByText(/Fairway uses pairwise head-to-head comparisons/)).toBeNull()
  })

  it('launches mailto:support@fairway.app when email support button is pressed', () => {
    render(<Support />)

    fireEvent.press(screen.getByLabelText('Email Fairway support'))

    expect(mockOpenUrl).toHaveBeenCalledWith('mailto:support@fairway.app?subject=Fairway%20Support')
  })

  it('opens Terms of service in in-app browser', async () => {
    render(<Support />)

    fireEvent.press(screen.getByLabelText('Terms of service'))

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://fairway-web.onrender.com/terms.html')
  })

  it('opens Privacy policy in in-app browser', async () => {
    render(<Support />)

    fireEvent.press(screen.getByLabelText('Privacy policy'))

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://fairway-web.onrender.com/privacy.html')
  })

  it('navigates back when back button is pressed', () => {
    render(<Support />)

    fireEvent.press(screen.getByLabelText('Go back'))

    expect(mockRouter.back).toHaveBeenCalled()
  })
})

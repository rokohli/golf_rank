import * as WebBrowser from 'expo-web-browser'
import { Linking } from 'react-native'

export function getWebBaseUrl(): string {
  const rawWebUrl = process.env.EXPO_PUBLIC_WEB_URL?.trim()
  const configuredWebUrl = rawWebUrl && rawWebUrl !== 'undefined' ? rawWebUrl : ''
  return (configuredWebUrl || 'https://fairway-web.onrender.com').replace(/\/+$/, '')
}

export async function openWebUrl(path: string): Promise<void> {
  const webBaseUrl = getWebBaseUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const url = `${webBaseUrl}${cleanPath}`
  try {
    await WebBrowser.openBrowserAsync(url)
  } catch {
    void Linking.openURL(url)
  }
}

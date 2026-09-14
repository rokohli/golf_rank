import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { registerPushToken, unregisterPushToken } from '../api/client'
import { ApiHeaders } from '../auth/useAuthToken'

// Push registration is a background nicety, never something that should
// surface an error to the user or block sign-in/out -- every entry point
// here swallows its own failures.

async function currentExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) return null
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
  return data
}

export async function requestAndRegisterPushToken(getAuthHeaders: () => Promise<ApiHeaders>): Promise<void> {
  try {
    if (!Device.isDevice) return
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }
    const existingPermission = await Notifications.getPermissionsAsync()
    let status = existingPermission.status
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync()
      status = requested.status
    }
    if (status !== 'granted') return
    const token = await currentExpoPushToken()
    if (!token) return
    await registerPushToken({ token, platform: Platform.OS }, await getAuthHeaders())
  } catch {
    // Permission denial, an unsupported environment (simulator, Expo Go
    // without a projectId), or a transient network error are all expected,
    // silent paths -- push is additive to the existing in-app inbox.
  }
}

export async function unregisterCurrentPushToken(getAuthHeaders: () => Promise<ApiHeaders>): Promise<void> {
  try {
    const token = await currentExpoPushToken()
    if (!token) return
    await unregisterPushToken(token, await getAuthHeaders())
  } catch {
    // Best-effort -- sign-out and the notification-settings toggle must not
    // fail just because the device couldn't unregister its token.
  }
}

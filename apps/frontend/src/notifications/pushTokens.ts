import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { registerPushToken, unregisterPushToken } from '../api/client'
import { ApiHeaders } from '../auth/useAuthToken'

// Push registration is a background nicety, never something that should
// surface an error to the user or block sign-in/out -- every entry point
// here swallows its own failures and is bounded by PUSH_OPERATION_TIMEOUT_MS
// so a stalled OS call or network request can never hang a caller (notably
// sign-out) indefinitely.

const PUSH_OPERATION_TIMEOUT_MS = 5000

class PushOperationTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PushOperationTimeoutError('push operation timed out')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (reason) => { clearTimeout(timer); reject(reason) },
    )
  })
}

async function currentExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) return null
  const { data } = await withTimeout(Notifications.getExpoPushTokenAsync({ projectId }), PUSH_OPERATION_TIMEOUT_MS)
  return data
}

async function registerCurrentToken(getAuthHeaders: () => Promise<ApiHeaders>): Promise<void> {
  const token = await currentExpoPushToken()
  if (!token) return
  await withTimeout(registerPushToken({ token, platform: Platform.OS }, await getAuthHeaders()), PUSH_OPERATION_TIMEOUT_MS)
}

// Silent, non-prompting registration: only (re-)registers when the OS
// permission was already granted in an earlier session (e.g. a returning
// user opening the app on a new device, or after reinstalling). Never calls
// requestPermissionsAsync, so it can safely run unconditionally on sign-in
// without popping an unsolicited native dialog before the user has chosen
// anything in the app. Use requestAndRegisterPushToken for the explicit
// opt-in moment instead.
export async function registerPushTokenIfPermissionGranted(getAuthHeaders: () => Promise<ApiHeaders>): Promise<void> {
  try {
    if (!Device.isDevice) return
    const existingPermission = await withTimeout(Notifications.getPermissionsAsync(), PUSH_OPERATION_TIMEOUT_MS)
    if (existingPermission.status !== 'granted') return
    await registerCurrentToken(getAuthHeaders)
  } catch {
    // Timeout, an unsupported environment (simulator, Expo Go without a
    // projectId), or a transient network error are all expected, silent
    // paths -- push is additive to the existing in-app inbox.
  }
}

// Prompting registration: shows the native permission dialog if the user
// hasn't answered yet. Call this only from an explicit in-app opt-in --
// the onboarding notifications step's Enable button, or turning the
// notification-settings toggle back on -- never unconditionally on mount,
// so the OS prompt always follows the user's own in-app choice.
export async function requestAndRegisterPushToken(getAuthHeaders: () => Promise<ApiHeaders>): Promise<void> {
  try {
    if (!Device.isDevice) return
    if (Platform.OS === 'android') {
      await withTimeout(Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      }), PUSH_OPERATION_TIMEOUT_MS)
    }
    const existingPermission = await withTimeout(Notifications.getPermissionsAsync(), PUSH_OPERATION_TIMEOUT_MS)
    let status = existingPermission.status
    if (status !== 'granted') {
      const requested = await withTimeout(Notifications.requestPermissionsAsync(), PUSH_OPERATION_TIMEOUT_MS)
      status = requested.status
    }
    if (status !== 'granted') return
    await registerCurrentToken(getAuthHeaders)
  } catch {
    // Timeout, permission denial, an unsupported environment (simulator,
    // Expo Go without a projectId), or a transient network error are all
    // expected, silent paths -- push is additive to the existing in-app inbox.
  }
}

export async function unregisterCurrentPushToken(getAuthHeaders: () => Promise<ApiHeaders>): Promise<void> {
  try {
    const token = await currentExpoPushToken()
    if (!token) return
    await withTimeout(unregisterPushToken(token, await getAuthHeaders()), PUSH_OPERATION_TIMEOUT_MS)
  } catch {
    // Best-effort, and bounded by the timeout above -- sign-out and the
    // notification-settings toggle must not hang or fail just because the
    // device couldn't unregister its token.
  }
}

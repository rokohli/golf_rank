import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { registerPushToken, unregisterPushToken } from '../api/client'
import { ApiHeaders } from '../auth/useAuthToken'

// Without this, Expo does not present a push at all while the app is in
// the foreground (no banner, no sound) -- it's silently dropped rather
// than deferred. This module is imported by AuthProvider.tsx, which is
// always rendered from the root layout, so this side effect runs once on
// every app boot regardless of sign-in state, before any push can arrive.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

// Push registration is a background nicety, never something that should
// surface an error to the user or block sign-in/out -- every entry point
// here swallows its own failures. Non-cancellable calls (OS permission
// checks, the Expo push-token fetch, the auth-header fetch) are bounded by
// a race so a stall can't hang the caller forever. The state-mutating
// register/unregister network calls get more than that: an AbortController
// tied to the same timeout actually cancels the in-flight fetch, so a
// caller that gave up waiting doesn't leave that request running to
// complete later and silently undo whatever the caller did next -- notably,
// AuthProvider's sign-out awaiting a timed-out registration and then
// issuing its unregister DELETE, only for the abandoned PUT to land
// afterward and re-associate the token with the account that just signed
// out. A plain race (reject-on-timeout without cancelling) can't prevent
// that; only actually aborting the request can.

const PUSH_OPERATION_TIMEOUT_MS = 5000

class PushOperationTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PushOperationTimeoutError('push operation timed out')), ms)
    timer.unref?.()
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (reason) => { clearTimeout(timer); reject(reason) },
    )
  })
}

// Both aborts the underlying request (so a signal-respecting call, like
// fetch, actually cancels the in-flight network request) and independently
// races it (so this still settles even if the operation doesn't -- or
// can't -- react to the abort promptly). Relying on abort() alone would
// still hang here if `operation` ignored the signal.
async function withAbortTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new PushOperationTimeoutError('push operation timed out'))
    }, ms)
    timer.unref?.()
    operation(controller.signal).then(
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
  const headers = await withTimeout(getAuthHeaders(), PUSH_OPERATION_TIMEOUT_MS)
  await withAbortTimeout(
    (signal) => registerPushToken({ token, platform: Platform.OS }, headers, signal),
    PUSH_OPERATION_TIMEOUT_MS,
  )
}

// Requests permission (prompting only if the user hasn't answered yet --
// getPermissionsAsync already-granted skips straight past
// requestPermissionsAsync, so this is silent for anyone who's already said
// yes) and registers the device token. Call this only once this specific
// account has its own confirmed opt-in: onboarding's Enable button, turning
// the notification-settings toggle back on, or -- for a returning,
// already-onboarded user -- after confirming their saved preference has
// notifications enabled. Never call this from an unconditional mount
// effect keyed only on OS permission: permission is device-wide, not
// per-account consent, so a different account that previously granted it
// on this device is not evidence *this* account opted in.
// Returns whether the token was actually registered -- callers that only
// want the existing fire-and-forget behavior can ignore it (`void
// registerPushToken()`), but a caller that needs to know whether to retry
// (e.g. the startup check below) has no other way to tell success from a
// swallowed failure, since every failure path here is intentionally silent.
export async function requestAndRegisterPushToken(getAuthHeaders: () => Promise<ApiHeaders>): Promise<boolean> {
  try {
    if (!Device.isDevice) return false
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
    if (status !== 'granted') return false
    await registerCurrentToken(getAuthHeaders)
    return true
  } catch {
    // Timeout, permission denial, an unsupported environment (simulator,
    // Expo Go without a projectId), or a transient network error are all
    // expected, silent paths -- push is additive to the existing in-app inbox.
    return false
  }
}

// Deliberately unlike registration (never retried): a failed unregister
// leaves the token pointed at the account that's about to sign out, so a
// second attempt right here is worth the extra time -- it's the last
// chance to fix it while we still hold this account's own credentials. A
// device that's fully offline fails both attempts identically (retrying
// can't manufacture connectivity); this only helps a momentary blip right
// as the user signs out. It cannot help at all once the app has fully
// signed out and this account's session is gone -- there is no
// unauthenticated revocation endpoint, so a token stuck orphaned past this
// point stays that way until something else (a different account
// registering the same device, or that account re-enabling notifications)
// reassigns it. See docs/product/next-features-handoff.md.
const UNREGISTER_ATTEMPTS = 2

export async function unregisterCurrentPushToken(getAuthHeaders: () => Promise<ApiHeaders>): Promise<void> {
  // Clears this device's notification tray independently of whether the
  // server-side unregister below succeeds -- otherwise a push delivered to
  // this account moments before sign-out (or before another account signs
  // in on the same shared device) stays visible in the tray, readable by
  // whoever uses the device next. Fire-and-forget: dismissal has no server
  // round trip to fail and nothing downstream depends on its result.
  Notifications.dismissAllNotificationsAsync().catch(() => {})
  try {
    const token = await currentExpoPushToken()
    if (!token) return
    const headers = await withTimeout(getAuthHeaders(), PUSH_OPERATION_TIMEOUT_MS)
    for (let attempt = 1; attempt <= UNREGISTER_ATTEMPTS; attempt++) {
      try {
        await withAbortTimeout(
          (signal) => unregisterPushToken(token, headers, signal),
          PUSH_OPERATION_TIMEOUT_MS,
        )
        return
      } catch (error) {
        if (attempt === UNREGISTER_ATTEMPTS) throw error
      }
    }
  } catch {
    // Best-effort, and bounded by the timeout above -- sign-out and the
    // notification-settings toggle must not hang or fail just because the
    // device couldn't unregister its token.
  }
}

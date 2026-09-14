const mockRegisterPushToken = jest.fn()
const mockUnregisterPushToken = jest.fn()
const mockGetExpoPushTokenAsync = jest.fn()
const mockGetPermissionsAsync = jest.fn()
const mockRequestPermissionsAsync = jest.fn()
const mockSetNotificationChannelAsync = jest.fn()
let mockIsDevice = true

jest.mock('../../api/client', () => ({
  registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args),
  unregisterPushToken: (...args: unknown[]) => mockUnregisterPushToken(...args),
}))

jest.mock('expo-device', () => ({ get isDevice() { return mockIsDevice } }))

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'test-project-id' } } } },
}))

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  // A plain inline jest.fn(), not a reference to an outer "mock"-prefixed
  // const: pushTokens.ts calls this at module *import* time (a top-level
  // side effect, unlike the other calls above which only ever run lazily
  // inside a later requestAndRegisterPushToken() invocation), and import
  // hoisting can execute this factory before an outer const initializes.
  setNotificationHandler: jest.fn(),
}))

import * as Notifications from 'expo-notifications'

import { requestAndRegisterPushToken, unregisterCurrentPushToken } from '../pushTokens'

const headers = { 'Content-Type': 'application/json' as const }
const getAuthHeaders = async () => headers

describe('foreground notification handler', () => {
  it('is installed at module load, so a push arriving while the app is foregrounded is actually shown', async () => {
    // Must run before any other test's beforeEach clears mock call history --
    // this checks the *module-import-time* side effect, which only fires once.
    const setNotificationHandler = Notifications.setNotificationHandler as jest.Mock
    expect(setNotificationHandler).toHaveBeenCalledTimes(1)
    const handler = setNotificationHandler.mock.calls[0][0]
    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    })
  })
})

describe('requestAndRegisterPushToken', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockIsDevice = true
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' })
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' })
  })

  it('registers the current Expo push token once permission is granted, without prompting again', async () => {
    // getPermissionsAsync already returns 'granted' in beforeEach -- this is
    // the same call path a returning, already-opted-in user goes through,
    // and it must stay silent (no OS dialog) for them.
    await requestAndRegisterPushToken(getAuthHeaders)

    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project-id' })
    expect(mockRegisterPushToken).toHaveBeenCalledWith(
      { token: 'ExponentPushToken[abc]', platform: 'ios' },
      headers,
      expect.any(AbortSignal),
    )
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled()
  })

  it('requests permission when not already granted, and registers if the user allows it', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' })
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' })

    await requestAndRegisterPushToken(getAuthHeaders)

    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
  })

  it('never registers, and never throws, when permission is denied', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' })
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' })

    await expect(requestAndRegisterPushToken(getAuthHeaders)).resolves.toBeUndefined()
    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })

  it('skips registration entirely on a non-device (simulator)', async () => {
    mockIsDevice = false

    await requestAndRegisterPushToken(getAuthHeaders)

    expect(mockGetPermissionsAsync).not.toHaveBeenCalled()
    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })

  it('swallows a registration API failure instead of throwing', async () => {
    mockRegisterPushToken.mockRejectedValue(new Error('network down'))

    await expect(requestAndRegisterPushToken(getAuthHeaders)).resolves.toBeUndefined()
  })

  it('never hangs forever if an Expo/OS call stalls -- resolves once the internal timeout fires', async () => {
    jest.useFakeTimers()
    try {
      mockGetPermissionsAsync.mockReturnValue(new Promise(() => undefined)) // never resolves
      const settled = requestAndRegisterPushToken(getAuthHeaders)
      await jest.advanceTimersByTimeAsync(5000)
      await expect(settled).resolves.toBeUndefined()
      expect(mockRegisterPushToken).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('aborts a stalled registration request rather than merely giving up on it -- so an abandoned PUT cannot land later and revive a signed-out token', async () => {
    jest.useFakeTimers()
    try {
      let capturedSignal: AbortSignal | undefined
      mockRegisterPushToken.mockImplementation((..._args: unknown[]) => {
        const signal = _args[2] as AbortSignal
        capturedSignal = signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })

      const settled = requestAndRegisterPushToken(getAuthHeaders)
      await jest.advanceTimersByTimeAsync(5000)
      await expect(settled).resolves.toBeUndefined()
      expect(capturedSignal?.aborted).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('unregisterCurrentPushToken', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockIsDevice = true
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' })
  })

  it('unregisters the current token', async () => {
    await unregisterCurrentPushToken(getAuthHeaders)
    expect(mockUnregisterPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]', headers, expect.any(AbortSignal))
  })

  it('swallows an unregister API failure instead of throwing', async () => {
    mockUnregisterPushToken.mockRejectedValue(new Error('network down'))
    await expect(unregisterCurrentPushToken(getAuthHeaders)).resolves.toBeUndefined()
  })

  it('never hangs forever if the unregister call stalls -- bounded so sign-out can never block on it indefinitely', async () => {
    // Two full timeout cycles: unregister retries once on failure.
    jest.useFakeTimers()
    try {
      mockUnregisterPushToken.mockReturnValue(new Promise(() => undefined)) // never resolves
      const settled = unregisterCurrentPushToken(getAuthHeaders)
      await jest.advanceTimersByTimeAsync(5000)
      await jest.advanceTimersByTimeAsync(5000)
      await expect(settled).resolves.toBeUndefined()
    } finally {
      jest.useRealTimers()
    }
  })

  it('aborts every stalled unregister attempt rather than merely giving up on it', async () => {
    jest.useFakeTimers()
    try {
      const capturedSignals: AbortSignal[] = []
      mockUnregisterPushToken.mockImplementation((..._args: unknown[]) => {
        const signal = _args[2] as AbortSignal
        capturedSignals.push(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })

      const settled = unregisterCurrentPushToken(getAuthHeaders)
      await jest.advanceTimersByTimeAsync(5000)
      await jest.advanceTimersByTimeAsync(5000)
      await expect(settled).resolves.toBeUndefined()
      expect(capturedSignals).toHaveLength(2)
      expect(capturedSignals.every((signal) => signal.aborted)).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('retries once after a failed attempt and succeeds if the retry lands', async () => {
    mockUnregisterPushToken
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(undefined)

    await expect(unregisterCurrentPushToken(getAuthHeaders)).resolves.toBeUndefined()
    expect(mockUnregisterPushToken).toHaveBeenCalledTimes(2)
  })
})

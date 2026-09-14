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
}))

import { requestAndRegisterPushToken, unregisterCurrentPushToken } from '../pushTokens'

const headers = { 'Content-Type': 'application/json' as const }
const getAuthHeaders = async () => headers

describe('requestAndRegisterPushToken', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDevice = true
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' })
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' })
  })

  it('registers the current Expo push token once permission is granted', async () => {
    await requestAndRegisterPushToken(getAuthHeaders)

    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project-id' })
    expect(mockRegisterPushToken).toHaveBeenCalledWith(
      { token: 'ExponentPushToken[abc]', platform: 'ios' },
      headers,
    )
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
})

describe('unregisterCurrentPushToken', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDevice = true
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' })
  })

  it('unregisters the current token', async () => {
    await unregisterCurrentPushToken(getAuthHeaders)
    expect(mockUnregisterPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]', headers)
  })

  it('swallows an unregister API failure instead of throwing', async () => {
    mockUnregisterPushToken.mockRejectedValue(new Error('network down'))
    await expect(unregisterCurrentPushToken(getAuthHeaders)).resolves.toBeUndefined()
  })
})

import * as SecureStore from 'expo-secure-store'

import { isLegacyRegionSentinel } from './currentRegion'

const REGION_KEY = 'discover.explicit-region'

export async function loadSavedRegion(): Promise<string | null> {
  const saved = await SecureStore.getItemAsync(REGION_KEY)
  if (isLegacyRegionSentinel(saved)) {
    return null
  }
  return saved!.trim()
}

export async function saveRegion(region: string): Promise<void> {
  if (!isLegacyRegionSentinel(region)) {
    await SecureStore.setItemAsync(REGION_KEY, region.trim())
  } else {
    await SecureStore.deleteItemAsync(REGION_KEY)
  }
}

// This key is device-scoped, not account-scoped: without clearing it on
// sign-out, a region explicitly saved by one account (e.g. from tapping
// "use current location") silently overrides every subsequent account's
// actual home region on this device, with no indication it's happening.
// Called from the sign-out path as best-effort cleanup -- swallow failures
// (e.g. a keychain access error) so a full sign-out is never blocked by this.
export async function clearSavedRegion(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REGION_KEY)
  } catch {
    // Best effort -- see comment above.
  }
}

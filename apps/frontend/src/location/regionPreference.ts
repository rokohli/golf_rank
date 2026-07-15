import * as SecureStore from 'expo-secure-store'

const REGION_KEY = 'discover.explicit-region'

export async function loadSavedRegion(): Promise<string | null> {
  return SecureStore.getItemAsync(REGION_KEY)
}

export async function saveRegion(region: string): Promise<void> {
  const value = region.trim()
  if (value) await SecureStore.setItemAsync(REGION_KEY, value)
  else await SecureStore.deleteItemAsync(REGION_KEY)
}

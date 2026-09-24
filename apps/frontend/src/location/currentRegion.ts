import * as Location from 'expo-location'

export const DEFAULT_COURSE_REGION = 'All regions'

export function isAllRegions(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return (
    !normalized ||
    normalized === 'all' ||
    normalized === 'all region' ||
    normalized === 'all regions' ||
    normalized === 'all california'
  )
}

// Pre-rename/malformed values only -- deliberately excludes "all regions"
// itself (the current canonical DEFAULT_COURSE_REGION), which is a real,
// persistable choice a user can explicitly make in the filter sheet, not
// stale data to discard. Used where a saved value is being read back and
// must be distinguished from "nothing was ever saved" -- isAllRegions above
// stays broader for filtering/display, where the canonical value should be
// treated the same as legacy garbage (both mean "show the unfiltered
// catalog").
export function isLegacyRegionSentinel(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return !normalized || normalized === 'all' || normalized === 'all region' || normalized === 'all california'
}

export type CurrentRegion = {
  label: string
  latitude: number
  longitude: number
}

export async function resolveCurrentLocation(): Promise<CurrentRegion | null> {
  const permission = await Location.requestForegroundPermissionsAsync()
  if (permission.status !== Location.PermissionStatus.GRANTED) return null

  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  const [address] = await Location.reverseGeocodeAsync(position.coords)
  const label = address ? formatGeocodedRegion(address) : null
  return label ? {
    label,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  } : null
}

export async function resolveCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync()
    if (permission.status !== Location.PermissionStatus.GRANTED) return null

    const position = (await Location.getLastKnownPositionAsync().catch(() => null))
      ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null))
    if (!position?.coords) return null

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    }
  } catch {
    return null
  }
}

export function formatGeocodedRegion(address: Location.LocationGeocodedAddress): string | null {
  const locality = address.city ?? address.subregion ?? address.district
  const administrativeRegion = address.region === 'California' ? 'CA' : address.region

  if (locality && administrativeRegion) return `${locality}, ${administrativeRegion}`
  return locality ?? administrativeRegion ?? null
}

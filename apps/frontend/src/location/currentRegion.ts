import * as Location from 'expo-location'

export const CALIFORNIA_FALLBACK_REGION = 'All California'

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

export function formatGeocodedRegion(address: Location.LocationGeocodedAddress): string | null {
  const locality = address.city ?? address.subregion ?? address.district
  const administrativeRegion = address.region === 'California' ? 'CA' : address.region

  if (locality && administrativeRegion) return `${locality}, ${administrativeRegion}`
  return locality ?? administrativeRegion ?? null
}

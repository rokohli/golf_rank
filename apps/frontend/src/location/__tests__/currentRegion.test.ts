import * as Location from 'expo-location'
import { formatGeocodedRegion, resolveCoordinates, MAX_CACHED_LOCATION_AGE_MS } from '../currentRegion'

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' },
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}))

describe('formatGeocodedRegion', () => {
  it('formats California locations with the familiar state abbreviation', () => {
    expect(formatGeocodedRegion({ city: 'San Diego', region: 'California' } as never)).toBe('San Diego, CA')
  })

  it('uses a subregion when a city is unavailable', () => {
    expect(formatGeocodedRegion({ city: null, subregion: 'Monterey County', region: 'California' } as never)).toBe('Monterey County, CA')
  })

  it('returns null when reverse geocoding has no useful region data', () => {
    expect(formatGeocodedRegion({ city: null, subregion: null, district: null, region: null } as never)).toBeNull()
  })
})

describe('resolveCoordinates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null when location permissions are not granted', async () => {
    ;(Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: Location.PermissionStatus.DENIED })
    const coords = await resolveCoordinates()
    expect(coords).toBeNull()
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled()
  })

  it('returns fresh and accurate last-known position without requesting current position', async () => {
    ;(Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: Location.PermissionStatus.GRANTED })
    ;(Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      timestamp: Date.now() - 60_000, // 1 minute ago
      coords: { latitude: 36.568, longitude: -121.95, accuracy: 50 },
    })

    const coords = await resolveCoordinates()
    expect(coords).toEqual({ latitude: 36.568, longitude: -121.95 })
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled()
  })

  it('rejects stale last-known position and fetches current position', async () => {
    ;(Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: Location.PermissionStatus.GRANTED })
    ;(Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      timestamp: Date.now() - (MAX_CACHED_LOCATION_AGE_MS + 60_000), // 16 minutes ago (stale)
      coords: { latitude: 21.3, longitude: -157.8, accuracy: 50 }, // Hawaii vacation coordinates
    })
    ;(Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 36.568, longitude: -121.95 },
    })

    const coords = await resolveCoordinates()
    expect(coords).toEqual({ latitude: 36.568, longitude: -121.95 })
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced })
  })

  it('rejects inaccurate last-known position and fetches current position', async () => {
    ;(Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: Location.PermissionStatus.GRANTED })
    ;(Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      timestamp: Date.now() - 60_000,
      coords: { latitude: 36.568, longitude: -121.95, accuracy: 10_000 }, // 10km accuracy (inaccurate)
    })
    ;(Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 37.77, longitude: -122.41 },
    })

    const coords = await resolveCoordinates()
    expect(coords).toEqual({ latitude: 37.77, longitude: -122.41 })
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced })
  })

  it('returns null if last-known position is stale and current position fetch fails', async () => {
    ;(Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: Location.PermissionStatus.GRANTED })
    ;(Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      timestamp: Date.now() - (MAX_CACHED_LOCATION_AGE_MS + 60_000),
      coords: { latitude: 21.3, longitude: -157.8 },
    })
    ;(Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('Location timeout'))

    const coords = await resolveCoordinates()
    expect(coords).toBeNull()
  })
})

import { formatGeocodedRegion } from '../currentRegion'

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

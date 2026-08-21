import { contactIdentifiers } from '../contactIdentifiers'

describe('contactIdentifiers', () => {
  it('normalizes local phone numbers using each contact country', () => {
    expect(contactIdentifiers([
      {
        emails: [{ email: ' Golfer@Example.com ', label: 'home' }],
        phoneNumbers: [
          { countryCode: 'au', label: 'mobile', number: '0412 345 678' },
          { countryCode: 'GB', label: 'mobile', number: '020 7946 0018' },
        ],
      },
    ])).toEqual(['golfer@example.com', '+61412345678', '+442079460018'])
  })

  it('deduplicates canonical values and skips invalid country-qualified phones', () => {
    expect(contactIdentifiers([
      {
        emails: [],
        phoneNumbers: [
          { countryCode: 'US', label: 'mobile', number: '(415) 555-1212' },
          { countryCode: 'US', label: 'mobile', number: '+1 415 555 1212' },
          { countryCode: 'AU', label: 'mobile', number: 'not a phone' },
        ],
      },
    ])).toEqual(['+14155551212'])
  })
})

import type { Contact } from 'expo-contacts'
import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min'

type ContactIdentifiers = Pick<Contact, 'emails' | 'phoneNumbers'>

export function contactIdentifiers(contacts: ContactIdentifiers[]): string[] {
  const identifiers = contacts.flatMap((contact) => [
    ...(contact.emails?.map((item) => item.email?.trim().toLowerCase() ?? '') ?? []),
    ...(contact.phoneNumbers?.map(normalizePhoneNumber) ?? []),
  ])
  return [...new Set(identifiers.filter((value): value is string => Boolean(value)))]
}

function normalizePhoneNumber(phone: NonNullable<Contact['phoneNumbers']>[number]): string | null {
  const value = phone.number?.trim() || phone.digits?.trim()
  if (!value) return null

  const region = phone.countryCode?.trim().toUpperCase()
  const country = region && isSupportedCountry(region) ? region as CountryCode : undefined
  const parsed = parsePhoneNumberFromString(value, country)
  if (parsed?.isValid()) return parsed.number

  // Some platforms omit country metadata. Preserve those local values so the
  // API can apply its configured deployment-region fallback; never reinterpret
  // a number when the device supplied an explicit country.
  return country || value.startsWith('+') || value.startsWith('00') ? null : value
}

import { Feather } from '@expo/vector-icons'
import * as Contacts from 'expo-contacts'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native'

import { deleteLinkedContacts, getLinkedContactStatus, getProfile, savePreferences, syncLinkedContacts } from '../src/api/client'
import { useAuthGate } from '../src/auth/AuthProvider'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { contactIdentifiers } from '../src/contactIdentifiers'
import { unregisterCurrentPushToken } from '../src/notifications/pushTokens'
import { OnboardingPreferences } from '../src/types'
import { colors, radii } from '../src/ui/theme'

export default function NotificationSettings() {
  const router = useRouter(); const { getAuthHeaders } = useAuthHeaders(); const { registerPushToken } = useAuthGate(); const [profile, setProfile] = useState<OnboardingPreferences | null>(null); const [enabled, setEnabled] = useState(true); const [touchedEnabled, setTouchedEnabled] = useState(false); const [wasExplicitlyEnabled, setWasExplicitlyEnabled] = useState(false); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [linking, setLinking] = useState(false); const [linked, setLinked] = useState(false); const [error, setError] = useState<string | null>(null)
  // The switch shows "on" for a legacy/never-chosen (null) preference too --
  // matching notifications_enabled()'s "not false" default for the in-app
  // feed -- but that must not read as consent for push: merely opening this
  // screen and pressing Save without ever touching the switch would
  // otherwise call registerPushToken() (and surface the native OS prompt)
  // for someone who never made an explicit choice. touchedEnabled tracks
  // whether the switch itself was actually interacted with this visit, so
  // save() below can tell "still on, untouched" apart from "just switched
  // on". But an untouched, already-true preference is a different case --
  // consent already exists on record, so a device that lost its token (a
  // prior registration failed transiently, or the OS permission was
  // granted later in Settings) must still be able to re-register just by
  // opening this screen and saving; wasExplicitlyEnabled tracks that.
  const load = useCallback(async () => { setLoading(true); setError(null); try { const headers = await getAuthHeaders(); const [next, contactStatus] = await Promise.all([getProfile(headers), getLinkedContactStatus(headers)]); setProfile(next); setEnabled(next.onboarding_data?.notifications !== false); setTouchedEnabled(false); setWasExplicitlyEnabled(next.onboarding_data?.notifications === true); setLinked(contactStatus.linked) } catch (reason) { setError(message(reason, 'Unable to load notification settings.')) } finally { setLoading(false) } }, [getAuthHeaders])
  useFocusEffect(useCallback(() => { void load() }, [load]))
  const toggleEnabled = (value: boolean) => { setEnabled(value); setTouchedEnabled(true) }
  const save = async () => { if (!profile?.onboarding_data) return setError('Your saved profile is incomplete. Please try again.'); setSaving(true); setError(null); try {
    // Untouched, persist the original value verbatim -- `enabled` defaults
    // to true for display on a legacy/never-chosen (null) preference, but
    // writing that true back would read as explicit consent on the next
    // app mount and silently trigger registration there (see
    // wasExplicitlyEnabled above; touching the switch is the only thing
    // that should ever turn a null preference into a real true or false).
    const notificationsToPersist = touchedEnabled ? enabled : profile.onboarding_data.notifications
    await savePreferences({ ...profile, onboarding_data: { ...profile.onboarding_data, notifications: notificationsToPersist } }, await getAuthHeaders())
    if (enabled && (touchedEnabled || wasExplicitlyEnabled)) await registerPushToken(); else if (!enabled) await unregisterCurrentPushToken(getAuthHeaders)
    router.back()
  } catch (reason) { setError(message(reason, 'Unable to save notification settings.')) } finally { setSaving(false) } }
  const linkContacts = async () => { setLinking(true); setError(null); try { const permission = await Contacts.requestPermissionsAsync(); if (permission.status !== 'granted') throw new Error('Contacts permission is needed to find friends who join Fairway.'); const result = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers] }); const identifiers = contactIdentifiers(result.data); await syncLinkedContacts({ contact_identifiers: identifiers }, await getAuthHeaders()); setLinked(identifiers.length > 0) } catch (reason) { setError(message(reason, 'Unable to link contacts.')) } finally { setLinking(false) } }
  const removeContacts = async () => { setLinking(true); setError(null); try { await deleteLinkedContacts(await getAuthHeaders()); setLinked(false) } catch (reason) { setError(message(reason, 'Unable to remove linked contacts.')) } finally { setLinking(false) } }
  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen><ScreenHeader title="Notification settings" onBack={() => router.back()} />{loading ? <ActivityIndicator accessibilityLabel="Loading notification settings" color={colors.pine} /> : <><View style={styles.heroIcon}><Feather name="bell" size={26} color={colors.pine} /></View><View style={styles.intro}><Text style={styles.introTitle}>Stay in the loop</Text><Text style={styles.introBody}>Control whether GolfRank can notify you about relevant activity and updates.</Text></View><View style={styles.group}><View style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>Allow notifications</Text><Text style={styles.rowBody}>{enabled ? 'Notifications are enabled for your account.' : 'You will not receive GolfRank notifications.'}</Text></View><Switch accessibilityLabel="Allow notifications" onValueChange={toggleEnabled} trackColor={{ false: '#D4D7D4', true: colors.pineSoft }} thumbColor={enabled ? colors.pine : '#FFFFFF'} value={enabled} /></View><Pressable accessibilityRole="button" disabled={linking} onPress={() => void linkContacts()} style={styles.contactRow}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{linked ? 'Update linked contacts' : 'Link contacts'}</Text><Text style={styles.rowBody}>{linked ? 'Contacts are linked. Sync again to refresh who can be matched.' : 'Securely uploads your contacts’ email addresses and phone numbers to match people who join Fairway.'}</Text></View>{linking ? <ActivityIndicator color={colors.pine} /> : <Feather name={linked ? 'check' : 'users'} size={19} color={colors.pine} />}</Pressable>{linked ? <Pressable accessibilityRole="button" disabled={linking} onPress={() => void removeContacts()} style={styles.removeRow}><Text style={styles.removeText}>Remove linked contacts</Text></Pressable> : null}</View><Text style={styles.note}>Contact identifiers are hashed before storage. Removing linked contacts deletes those stored hashes. Device-level permission is managed in iOS Settings.</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" disabled={saving} onPress={() => void save()} style={[styles.saveButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save changes</Text>}</Pressable></>}</ProductScreen></>
}
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback }
const styles = StyleSheet.create({ heroIcon: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.pineSoft, borderRadius: 29, height: 58, justifyContent: 'center', marginTop: 8, width: 58 }, intro: { alignItems: 'center', gap: 7, paddingHorizontal: 24 }, introTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 22 }, introBody: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' }, group: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1 }, row: { alignItems: 'center', flexDirection: 'row', gap: 15, minHeight: 76, paddingHorizontal: 15, paddingVertical: 12 }, contactRow: { alignItems: 'center', borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 15, minHeight: 68, paddingHorizontal: 15, paddingVertical: 10 }, removeRow: { alignItems: 'center', borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 44, justifyContent: 'center' }, removeText: { color: colors.error, fontSize: 11, fontWeight: '700' }, rowCopy: { flex: 1, gap: 5 }, rowTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 15 }, rowBody: { color: colors.muted, fontSize: 10, lineHeight: 14 }, note: { color: colors.muted, fontSize: 10, lineHeight: 15, paddingHorizontal: 4 }, error: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' }, saveButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, justifyContent: 'center', minHeight: 50, marginTop: 'auto' }, saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.55 } })

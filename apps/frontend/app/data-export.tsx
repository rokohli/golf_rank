import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Stack, useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, Text } from 'react-native'
import { getDataExport } from '../src/api/client'
import { useAuthHeaders } from '../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../src/components/ProductUI'

export default function DataExport() {
  const router = useRouter(); const { getAuthHeaders } = useAuthHeaders(); const [working, setWorking] = useState(false); const [message, setMessage] = useState<string | null>(null)
  const download = async () => { setWorking(true); setMessage(null); try { const data = await getDataExport(await getAuthHeaders()); const uri = `${FileSystem.cacheDirectory}golfrank-data-export.json`; await FileSystem.writeAsStringAsync(uri, JSON.stringify(data, null, 2)); if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save your GolfRank data' }); else setMessage('Your export is ready, but sharing is not available on this device.') } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to prepare your data export.') } finally { setWorking(false) } }
  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen><ScreenHeader title="Your data" onBack={() => router.back()} /><Text>Download a JSON copy of your GolfRank profile, rounds, ratings, plans, saves, and account relationships. Clerk identity and security data are not included.</Text>{message ? <Text accessibilityRole="alert">{message}</Text> : null}<Pressable accessibilityRole="button" disabled={working} onPress={() => void download()}><Text>{working ? 'Preparing export…' : 'Download my data'}</Text></Pressable>{working ? <ActivityIndicator accessibilityLabel="Preparing data export" /> : null}</ProductScreen></>
}

import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { Avatar, CourseVisual, ProductScreen, ScreenHeader, SectionTitle } from '../src/components/ProductUI'
import { demoCourses } from '../src/data/demo'
import { colors } from '../src/ui/theme'

export default function Notifications() {
  const router = useRouter()
  const items = [
    { icon: 'JT', title: 'Jake Thompson played Torrey Pines', detail: '82 (+10) · 2h ago', course: demoCourses[3] },
    { icon: 'bell', title: 'Pasatiempo has tee times this weekend', detail: '3h ago', course: null },
    { icon: 'MP', title: 'Maya Patel ranked Bandon Dunes #1', detail: 'Yesterday', course: demoCourses[2] },
    { icon: 'check', title: 'Your Pebble Beach round was processed', detail: 'Yesterday', course: null },
  ]
  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen><ScreenHeader title="Notifications" onBack={() => router.back()} action={<Text style={styles.mark}>Mark all read</Text>} /><SectionTitle title="Recent" /><View style={styles.list}>{items.map((item) => <View key={item.title} style={styles.item}>{item.icon.length === 2 ? <Avatar initials={item.icon} size={38} color={item.icon === 'JT' ? '#496C5D' : '#A27655'} /> : <View style={styles.bell}><Feather name={item.icon as never} size={17} color={colors.pine} /></View>}<View style={{ flex: 1 }}><Text style={styles.title}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text></View>{item.course ? <View style={{ width: 72 }}><CourseVisual course={item.course} height={54} /></View> : null}</View>)}</View></ProductScreen></>
}
const styles = StyleSheet.create({ mark: { color: colors.pine, fontSize: 10, fontWeight: '700' }, list: { gap: 9 }, item: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 11 }, bell: { alignItems: 'center', backgroundColor: colors.pineSoft, borderRadius: 19, height: 38, justifyContent: 'center', width: 38 }, title: { color: colors.ink, fontSize: 11, fontWeight: '700', lineHeight: 16 }, detail: { color: colors.muted, fontSize: 9, marginTop: 4 } })

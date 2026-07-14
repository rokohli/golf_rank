import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { Avatar, BottomNav, IconButton, ProductScreen, ScreenHeader, Segmented } from '../src/components/ProductUI'
import { friends } from '../src/data/demo'
import { colors } from '../src/ui/theme'

export default function Friends() {
  const router = useRouter(); const [tab, setTab] = useState('Following')
  return <><Stack.Screen options={{ headerShown: false }} /><ProductScreen>
    <ScreenHeader title="Friends" onBack={() => router.back()} action={<View style={styles.actions}><IconButton icon="search" label="Search friends" /><IconButton icon="user-plus" label="Add friends" /></View>} />
    <Segmented options={['Following','Followers','Requests']} selected={tab} onSelect={setTab} />
    <View>{friends.map((friend, index) => <View key={friend.name} style={styles.row}><Avatar initials={friend.initials} color={friend.accent} /><View style={{ flex: 1 }}><Text style={styles.name}>{friend.name}</Text><Text style={styles.meta}>{friend.course}</Text></View><View style={{ alignItems: 'flex-end' }}><Text style={styles.time}>{index ? `${index}d ago` : 'Today'}</Text><Text style={styles.score}>{friend.score}</Text></View><Feather name="chevron-right" size={16} color={colors.muted} /></View>)}</View>
  </ProductScreen><BottomNav /></>
}

const styles = StyleSheet.create({ actions: { flexDirection: 'row', gap: 7 }, row: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 11, paddingVertical: 13 }, name: { color: colors.ink, fontSize: 13, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 10, marginTop: 4 }, time: { color: colors.muted, fontSize: 9 }, score: { color: colors.ink, fontSize: 11, fontWeight: '700', marginTop: 4 } })

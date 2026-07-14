import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Avatar, BottomNav, CourseVisual, IconButton, ProductScreen, SectionTitle } from '../src/components/ProductUI'
import { demoCourses, friends } from '../src/data/demo'
import { colors } from '../src/ui/theme'

export default function Home() {
  const router = useRouter()
  const recent = [
    { person: 'Maya ranked', course: 'Bandon Dunes', detail: '74 (+2)', when: 'Yesterday' },
    { person: 'Alex saved', course: 'Pinehurst No. 2', detail: '', when: '2d ago' },
    { person: 'Chris played', course: 'Pasatiempo GC', detail: '78 (+6)', when: '3d ago' },
  ]

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductScreen>
        <View style={styles.topRow}>
          <Text style={styles.title}>Good morning,{`\n`}Rohan</Text>
          <View style={styles.topActions}>
            <IconButton icon="bell" label="Notifications" onPress={() => router.push('/notifications')} />
            <Pressable onPress={() => router.push('/profile')}><Avatar initials="RK" /></Pressable>
          </View>
        </View>

        <SectionTitle title="FRIENDS ACTIVITY" action="See all" onPress={() => router.push('/friends')} />
        <Pressable onPress={() => router.push('/round/torrey-may')}>
          <CourseVisual course={demoCourses[3]} height={228}>
            <View style={styles.storyScrim} />
            <View style={styles.storyContent}>
              <View style={styles.storyIdentity}><Avatar initials={friends[0].initials} color={friends[0].accent} size={36} /><View><Text style={styles.storyKicker}>Jake played</Text><Text style={styles.storyTitle}>Torrey Pines (South)</Text><Text style={styles.storyMeta}>San Diego, CA</Text></View></View>
              <View style={styles.storyScore}><Text style={styles.score}>82</Text><Text style={styles.storyMeta}>(+10)</Text></View>
            </View>
          </CourseVisual>
        </Pressable>
        <View style={styles.socialProof}><View style={styles.avatarStack}>{friends.slice(1, 4).map((friend, index) => <View key={friend.name} style={{ marginLeft: index ? -7 : 0 }}><Avatar initials={friend.initials} color={friend.accent} size={25} /></View>)}</View><Text style={styles.muted}>Evan and 8 others liked this</Text><Feather name="heart" size={18} color={colors.pine} style={{ marginLeft: 'auto' }} /></View>

        <SectionTitle title="RECENT ACTIVITY" />
        <View>{recent.map((item, index) => <View key={item.person} style={[styles.activityRow, index === recent.length - 1 && styles.lastRow]}><Avatar initials={friends[index + 1].initials} color={friends[index + 1].accent} size={38} /><View style={{ flex: 1 }}><Text style={styles.activityPerson}>{item.person}</Text><Text style={styles.activityCourse}>{item.course}</Text></View><View style={{ alignItems: 'flex-end' }}><Text style={styles.activityDetail}>{item.detail}</Text><Text style={styles.muted}>{item.when}</Text></View></View>)}</View>

        <SectionTitle title="RECOMMENDED FOR YOU" />
        <Pressable onPress={() => router.push('/course/pasatiempo')} style={styles.recommendation}><View style={styles.recommendationImage}><CourseVisual course={demoCourses[1]} height={78} /></View><View style={{ flex: 1 }}><Text style={styles.recommendationTitle}>Pasatiempo Golf Club</Text><Text style={styles.muted}>Santa Cruz, CA</Text><Text style={styles.rating}>★ 4.8  <Text style={styles.muted}>(392)</Text></Text></View><Feather name="chevron-right" size={18} color={colors.muted} /></Pressable>

        <Pressable onPress={() => router.push('/planner')} style={styles.planLink}><View><Text style={styles.planTitle}>Plan a golf weekend</Text><Text style={styles.muted}>Built around your courses and constraints</Text></View><Feather name="arrow-up-right" size={20} color={colors.pine} /></Pressable>
      </ProductScreen>
      <BottomNav />
    </>
  )
}

const styles = StyleSheet.create({
  topRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  topActions: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  title: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 31, fontWeight: '400', letterSpacing: -0.8, lineHeight: 36 },
  storyScrim: { backgroundColor: 'rgba(5, 21, 13, 0.62)', bottom: 0, height: 92, left: 0, position: 'absolute', right: 0 },
  storyContent: { alignItems: 'center', bottom: 13, flexDirection: 'row', left: 13, position: 'absolute', right: 13 },
  storyIdentity: { alignItems: 'center', flexDirection: 'row', flex: 1, gap: 9 },
  storyKicker: { color: '#DCE5DE', fontSize: 9 }, storyTitle: { color: '#FFF', fontFamily: 'Georgia', fontSize: 18, marginTop: 2 }, storyMeta: { color: '#E4E9E5', fontSize: 10, marginTop: 2 },
  storyScore: { alignItems: 'flex-end' }, score: { color: '#FFF', fontFamily: 'Georgia', fontSize: 33 },
  socialProof: { alignItems: 'center', borderBottomColor: '#DCDDD8', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingBottom: 13 }, avatarStack: { flexDirection: 'row', marginRight: 9 }, muted: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  activityRow: { alignItems: 'center', borderBottomColor: '#DCDDD8', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, paddingVertical: 12 }, lastRow: { borderBottomWidth: 0 }, activityPerson: { color: colors.muted, fontSize: 10 }, activityCourse: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14, marginTop: 3 }, activityDetail: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  recommendation: { alignItems: 'center', borderColor: '#D8D9D4', borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, overflow: 'hidden', paddingRight: 12 }, recommendationImage: { width: 108 }, recommendationTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 15 }, rating: { color: colors.gold, fontSize: 10, fontWeight: '700', marginTop: 7 },
  planLink: { alignItems: 'center', borderBottomColor: '#D8D9D4', borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8D9D4', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15 }, planTitle: { color: colors.pine, fontFamily: 'Georgia', fontSize: 17, marginBottom: 3 },
})

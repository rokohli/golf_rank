import { Feather } from '@expo/vector-icons'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Avatar, CourseVisual, IconButton, Pill, PrimaryButton, ProductScreen, SectionTitle } from '../../src/components/ProductUI'
import { demoCourses, friends } from '../../src/data/demo'
import { colors } from '../../src/ui/theme'

export default function CourseDetail() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const course = demoCourses.find((item) => item.id === id) ?? demoCourses[0]
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <View style={styles.hero}>
        <CourseVisual course={course} height={260} />
        <View style={styles.back}><IconButton icon="arrow-left" label="Go back" onPress={() => router.back()} /></View>
        <View style={styles.heroActions}><IconButton icon="heart" label="Save course" /><IconButton icon="share" label="Share course" /></View>
      </View>
      <View style={styles.titleRow}><View style={{ flex: 1 }}><Text style={styles.title}>{course.name}</Text><Text style={styles.location}>{course.location}</Text></View>{course.personalRank ? <Pill label={`Your #${course.personalRank}`} /> : null}</View>
      <View style={styles.ratingRow}><Text style={styles.rating}>{course.rating}</Text><Text style={styles.stars}>★★★★★</Text><Text style={styles.location}>({course.reviews})</Text></View>
      <View style={styles.actions}>{[['star','Rate'],['message-circle','Review'],['check-circle','Played'],['heart','Save'],['share','Share']].map(([icon,label]) => <Pressable key={label} style={styles.action}><View style={styles.actionIcon}><Feather name={icon as never} size={18} color={colors.pine} /></View><Text style={styles.actionLabel}>{label}</Text></Pressable>)}</View>
      <View style={styles.facts}><View><Text style={styles.factValue}>18</Text><Text style={styles.factLabel}>Holes</Text></View><View><Text style={styles.factValue}>72.4</Text><Text style={styles.factLabel}>Rating</Text></View><View><Text style={styles.factValue}>135</Text><Text style={styles.factLabel}>Slope</Text></View><View><Text style={styles.factValue}>{course.price}</Text><Text style={styles.factLabel}>Price</Text></View></View>
      <SectionTitle title="Overview" />
      <Text style={styles.body}>A memorable routing shaped by its landscape, with strategic approaches and a finish that rewards thoughtful play. Ranked highly by golfers whose taste aligns with yours.</Text>
      <SectionTitle title="Friends who played" action="See all" onPress={() => router.push('/friends')} />
      <View style={styles.friendRow}>{friends.slice(0,4).map((friend) => <Avatar key={friend.name} initials={friend.initials} color={friend.accent} size={42} />)}<View style={styles.more}><Text style={styles.moreText}>+24</Text></View></View>
      <PrimaryButton label="View tee-time options" icon="calendar" />
    </ProductScreen>
  </>
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: -18, marginTop: -18, position: 'relative' }, back: { left: 14, position: 'absolute', top: 14 }, heroActions: { flexDirection: 'row', gap: 8, position: 'absolute', right: 14, top: 14 },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 }, title: { color: colors.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 }, location: { color: colors.muted, fontSize: 11, marginTop: 5 },
  ratingRow: { alignItems: 'center', flexDirection: 'row', gap: 6 }, rating: { color: colors.ink, fontSize: 18, fontWeight: '800' }, stars: { color: colors.gold, fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'space-between' }, action: { alignItems: 'center', gap: 5 }, actionIcon: { alignItems: 'center', borderColor: colors.line, borderRadius: 23, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 }, actionLabel: { color: colors.muted, fontSize: 9 },
  facts: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-around', padding: 14 }, factValue: { color: colors.ink, fontSize: 16, fontWeight: '800', textAlign: 'center' }, factLabel: { color: colors.muted, fontSize: 9, marginTop: 3, textAlign: 'center' },
  body: { color: colors.muted, fontSize: 13, lineHeight: 20 }, friendRow: { flexDirection: 'row', gap: 8 }, more: { alignItems: 'center', backgroundColor: '#E7E9E4', borderRadius: 22, height: 42, justifyContent: 'center', width: 42 }, moreText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
})

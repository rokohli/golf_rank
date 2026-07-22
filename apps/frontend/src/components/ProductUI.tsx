import { Feather } from '@expo/vector-icons'
import { usePathname, useRouter } from 'expo-router'
import { ReactElement, ReactNode } from 'react'
import { Image, ImageBackground, Pressable, RefreshControlProps, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'

import { DemoCourse } from '../data/demo'
import { colors, radii } from '../ui/theme'

export function ProductScreen({ children, edgeToEdge = false, scroll = true, refreshControl }: { children: ReactNode; edgeToEdge?: boolean; scroll?: boolean; refreshControl?: ReactElement<RefreshControlProps> }) {
  const content = scroll ? (
    <ScrollView contentInsetAdjustmentBehavior={edgeToEdge ? 'never' : 'automatic'} refreshControl={refreshControl} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  ) : <View style={styles.content}>{children}</View>
  if (edgeToEdge) return <View style={styles.safe}>{content}</View>
  return <SafeAreaView style={styles.safe}>{content}</SafeAreaView>
}

export function ScreenHeader({ title, action, onBack }: { title: string; action?: ReactNode; onBack?: () => void }) {
  return (
    <View style={styles.header}>
      {onBack ? <IconButton icon="arrow-left" label="Go back" onPress={onBack} /> : null}
      <Text style={[styles.screenTitle, onBack && { flex: 1 }]}>{title}</Text>
      {action ?? (onBack ? <View style={{ width: 38 }} /> : null)}
    </View>
  )
}

export function BottomNav() {
  const router = useRouter()
  const pathname = usePathname()
  const tabs = [
    { label: 'Home', icon: 'home', path: '/home' },
    { label: 'Discover', icon: 'search', path: '/discover' },
    { label: 'Play', icon: 'flag', path: '/rounds' },
    { label: 'Rankings', icon: 'bar-chart-2', path: '/rankings' },
    { label: 'Profile', icon: 'user', path: '/profile' },
  ] as const
  return (
    <View style={styles.nav}>
      {tabs.map((tab) => {
        const active = pathname === tab.path || pathname.startsWith(`${tab.path}/`)
        return (
          <Pressable key={tab.path} accessibilityRole="button" accessibilityLabel={tab.label} onPress={() => router.replace(tab.path as never)} style={styles.navItem}>
            <Feather name={tab.icon} color={active ? colors.pine : colors.muted} size={19} />
            <Text style={[styles.navLabel, active && styles.navLabelActive]}>{tab.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function CourseVisual({ course, height = 116, squareTop = false, children }: { course: DemoCourse; height?: number; squareTop?: boolean; children?: ReactNode }) {
  const visualStyle = [styles.courseVisual, squareTop && styles.courseVisualSquareTop, { height }]
  if (!course.image) {
    return (
      <View style={[visualStyle, styles.coursePlaceholder]}>
        <Feather accessibilityLabel="Course image unavailable" name="flag" size={24} color={colors.pine} />
        {children}
      </View>
    )
  }
  return (
    <ImageBackground source={course.image} resizeMode="cover" style={visualStyle}>
      <View style={styles.photoWash} />
      {children}
    </ImageBackground>
  )
}

export function CourseCard({ course, compact = false, onPress, badge }: { course: DemoCourse; compact?: boolean; onPress?: () => void; badge?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, compact && styles.compactCard, pressed && styles.pressed]}>
      <CourseVisual course={course} height={compact ? 92 : 132}>
        {badge ? <Pill label={badge} style={{ position: 'absolute', left: 10, bottom: 10 }} /> : null}
      </CourseVisual>
      <View style={styles.cardBody}>
        <Text numberOfLines={1} style={styles.cardTitle}>{course.name}</Text>
        <Text numberOfLines={1} style={styles.meta}>{course.location}</Text>
        <View style={styles.inlineRow}>
          <Text accessibilityLabel={course.rating ? `Community rating ${course.rating} out of 10` : 'No community rating yet'} style={styles.rating}>{course.rating ? course.rating : '—'}/10</Text>
          <Text style={styles.meta}>({course.reviews})</Text>
          <Text numberOfLines={1} style={[styles.meta, { marginLeft: 'auto', maxWidth: compact ? 62 : 150 }]}>{course.distance}</Text>
        </View>
      </View>
    </Pressable>
  )
}

export function DemoCourseRow({ course, index, onPress, trailing, showRating = true, showReviewCount = true }: { course: DemoCourse; index?: number; onPress?: () => void; trailing?: ReactNode; showRating?: boolean; showReviewCount?: boolean }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.courseRow, pressed && styles.pressed]}>
    {index ? <Text style={styles.courseRowIndex}>{index}</Text> : null}
    <View style={styles.courseRowImage}><CourseVisual course={course} height={52} /></View>
    <View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.courseRowTitle}>{course.name}</Text><Text numberOfLines={1} style={styles.meta}>{course.location}</Text>{showRating ? <Text accessibilityLabel={course.rating ? `Community rating ${course.rating} out of 10` : 'No community rating yet'} style={styles.rating}>{course.rating ? course.rating : '—'}/10{showReviewCount && course.reviews ? <Text style={styles.meta}>  {course.reviews}</Text> : null}</Text> : null}</View>
    {trailing ?? <Feather name="chevron-right" size={16} color={colors.muted} />}
  </Pressable>
}

export function SectionTitle({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Pressable onPress={onPress}><Text style={styles.link}>{action}</Text></Pressable> : null}
    </View>
  )
}

export function Pill({ label, active = true, style }: { label: string; active?: boolean; style?: object }) {
  return <View style={[styles.pill, !active && styles.pillMuted, style]}><Text style={[styles.pillText, !active && styles.pillTextMuted]}>{label}</Text></View>
}

export function Segmented({ options, selected, onSelect }: { options: string[]; selected: string; onSelect: (value: string) => void }) {
  return <View style={styles.segmented}>{options.map((option) => <Pressable key={option} onPress={() => onSelect(option)} style={[styles.segment, selected === option && styles.segmentActive]}><Text style={[styles.segmentText, selected === option && styles.segmentTextActive]}>{option}</Text></Pressable>)}</View>
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return <View style={styles.statCard}><Text style={styles.meta}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>
}

export function PrimaryButton({ label, onPress, icon }: { label: string; onPress?: () => void; icon?: keyof typeof Feather.glyphMap }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>{icon ? <Feather name={icon} size={17} color="#FFF" /> : null}<Text style={styles.primaryButtonText}>{label}</Text></Pressable>
}

export function IconButton({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress?: () => void }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><Feather name={icon} size={18} color={colors.ink} /></Pressable>
}

export function Avatar({ initials, color = colors.pine, imageUrl, size = 42 }: { initials: string; color?: string; imageUrl?: string | null; size?: number }) {
  const shape = { borderRadius: size / 2, height: size, width: size }
  if (imageUrl) return <Image accessibilityLabel={`${initials} profile photo`} source={{ uri: imageUrl }} style={shape} />
  return <View style={[styles.avatar, shape, { backgroundColor: color }]}><Text style={styles.avatarText}>{initials}</Text></View>
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  content: { flexGrow: 1, gap: 18, padding: 18, paddingBottom: 92 },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 42, gap: 10 },
  screenTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 29, fontWeight: '400', letterSpacing: -0.7 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  link: { color: colors.pine, fontSize: 10, fontWeight: '700' },
  nav: { backgroundColor: '#FBFAF7', borderTopColor: '#DDDCD6', borderTopWidth: StyleSheet.hairlineWidth, bottom: 0, flexDirection: 'row', height: 72, left: 0, paddingBottom: 10, paddingTop: 8, position: 'absolute', right: 0, width: '100%' },
  navItem: { alignItems: 'center', gap: 4, justifyContent: 'center', width: '20%' },
  navLabel: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  navLabelActive: { color: colors.pine, fontWeight: '800' },
  courseVisual: { borderRadius: 10, overflow: 'hidden', position: 'relative' },
  coursePlaceholder: { alignItems: 'center', backgroundColor: colors.pineSoft, justifyContent: 'center' },
  courseVisualSquareTop: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  photoWash: { backgroundColor: 'rgba(8, 25, 17, 0.05)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  card: { backgroundColor: colors.card, borderRadius: 10, overflow: 'hidden' },
  compactCard: { flex: 1, minWidth: 148 },
  cardBody: { gap: 5, padding: 12 },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  inlineRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  rating: { color: colors.gold, fontSize: 11, fontWeight: '800' },
  courseRow: { alignItems: 'center', borderBottomColor: '#DCDDD8', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, paddingVertical: 10 },
  courseRowIndex: { color: colors.pineDark, fontFamily: 'Georgia', fontSize: 23, textAlign: 'center', width: 22 },
  courseRowImage: { borderRadius: 6, overflow: 'hidden', width: 76 },
  courseRowTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 14, marginBottom: 2 },
  pill: { backgroundColor: colors.pine, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  pillMuted: { backgroundColor: '#F0F0EC' },
  pillText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  pillTextMuted: { color: colors.muted },
  segmented: { backgroundColor: '#ECEDE9', borderRadius: radii.pill, flexDirection: 'row', padding: 3 },
  segment: { alignItems: 'center', borderRadius: radii.pill, flex: 1, paddingVertical: 8 },
  segmentActive: { backgroundColor: colors.pine },
  segmentText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  segmentTextActive: { color: '#FFF' },
  statCard: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, flex: 1, gap: 5, padding: 12 },
  statValue: { color: colors.ink, fontSize: 23, fontWeight: '700' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.pine, borderRadius: radii.pill, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  iconButton: { alignItems: 'center', backgroundColor: '#F0F1ED', borderRadius: 20, height: 38, justifyContent: 'center', width: 38 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
})

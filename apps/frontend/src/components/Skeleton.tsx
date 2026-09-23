import { Feather } from '@expo/vector-icons'
import { createContext, ReactNode, useContext, useEffect, useRef } from 'react'
import {
  Animated,
  DimensionValue,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native'

import { colors, radii } from '../ui/theme'

const SkeletonContext = createContext<Animated.Value | null>(null)

export function SkeletonPulse({
  children,
  style,
  accessibilityLabel,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  const parentOpacity = useContext(SkeletonContext)
  const localOpacityRef = useRef<Animated.Value | null>(null)
  if (!parentOpacity && !localOpacityRef.current) {
    localOpacityRef.current = new Animated.Value(0.45)
  }
  const opacity = parentOpacity ?? localOpacityRef.current!

  useEffect(() => {
    if (parentOpacity || process.env.NODE_ENV === 'test' || !localOpacityRef.current) {
      return
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(localOpacityRef.current, { toValue: 0.85, duration: 800, useNativeDriver: true }),
        Animated.timing(localOpacityRef.current, { toValue: 0.45, duration: 800, useNativeDriver: true }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [parentOpacity])

  return (
    <SkeletonContext.Provider value={opacity}>
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityLabel ? 'progressbar' : 'none'}
        style={style}
      >
        {children}
      </View>
    </SkeletonContext.Provider>
  )
}

export function SkeletonBox({
  width,
  height,
  borderRadius = 6,
  style,
  accessibilityLabel,
}: {
  width?: DimensionValue
  height?: DimensionValue
  borderRadius?: number
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  const contextOpacity = useContext(SkeletonContext)
  const flatStyle = StyleSheet.flatten(style)
  const hasExplicitOpacity = flatStyle?.opacity !== undefined

  const localOpacityRef = useRef<Animated.Value | null>(null)
  if (!contextOpacity && !hasExplicitOpacity && !localOpacityRef.current) {
    localOpacityRef.current = new Animated.Value(0.45)
  }
  const localOpacity = localOpacityRef.current

  useEffect(() => {
    if (contextOpacity || hasExplicitOpacity || !localOpacity || process.env.NODE_ENV === 'test') {
      return
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(localOpacity, { toValue: 0.85, duration: 800, useNativeDriver: true }),
        Animated.timing(localOpacity, { toValue: 0.45, duration: 800, useNativeDriver: true }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [contextOpacity, hasExplicitOpacity, localOpacity])

  if (hasExplicitOpacity) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="none"
        style={[
          styles.box,
          {
            borderRadius,
            height,
            width,
          },
          style,
        ]}
      />
    )
  }

  const opacity = contextOpacity ?? localOpacity!

  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="none"
      style={[
        styles.box,
        {
          borderRadius,
          height,
          opacity,
          width,
        },
        style,
      ]}
    />
  )
}

export function SkeletonCircle({
  size = 40,
  style,
  accessibilityLabel,
}: {
  size?: number
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  return (
    <SkeletonBox
      width={size}
      height={size}
      borderRadius={size / 2}
      style={style}
      accessibilityLabel={accessibilityLabel}
    />
  )
}

export function SkeletonLine({
  width = '100%',
  height = 12,
  borderRadius = 4,
  style,
  accessibilityLabel,
}: {
  width?: DimensionValue
  height?: DimensionValue
  borderRadius?: number
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  return (
    <SkeletonBox
      width={width}
      height={height}
      borderRadius={borderRadius}
      style={style}
      accessibilityLabel={accessibilityLabel}
    />
  )
}

export function CourseCardSkeleton({
  compact = false,
  style,
}: {
  compact?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <SkeletonPulse style={[styles.card, compact && styles.compactCard, style]}>
      <SkeletonBox
        height={compact ? 92 : 132}
        width="100%"
        borderRadius={0}
        style={styles.cardVisualSkeleton}
      />
      <View style={styles.cardBody}>
        <SkeletonLine width="75%" height={14} style={{ marginBottom: 2 }} />
        <SkeletonLine width="48%" height={11} style={{ marginBottom: 4 }} />
        <View style={styles.inlineRow}>
          <SkeletonLine width={36} height={11} />
          <SkeletonLine width={24} height={11} />
          <SkeletonLine width={42} height={11} style={{ marginLeft: 'auto' }} />
        </View>
      </View>
    </SkeletonPulse>
  )
}

export function CourseRowSkeleton({
  hasIndex = false,
  style,
}: {
  hasIndex?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <SkeletonPulse style={[styles.courseRow, style]}>
      {hasIndex ? <SkeletonBox width={20} height={20} borderRadius={4} /> : null}
      <SkeletonBox width={76} height={52} borderRadius={6} />
      <View style={{ flex: 1, gap: 5 }}>
        <SkeletonLine width="68%" height={14} />
        <SkeletonLine width="42%" height={11} />
        <SkeletonLine width="28%" height={11} />
      </View>
      <SkeletonBox width={14} height={14} borderRadius={7} style={styles.chevronPlaceholder} />
    </SkeletonPulse>
  )
}

export function FeaturedActivitySkeleton() {
  return (
    <View style={styles.featuredContainer}>
      <SkeletonBox height={228} width="100%" borderRadius={10} style={{ marginBottom: 10 }} />
      <View style={{ gap: 6, paddingHorizontal: 2 }}>
        <SkeletonLine width="60%" height={14} />
        <SkeletonLine width="40%" height={11} />
      </View>
    </View>
  )
}

export function RecentActivitySkeleton({ last = false }: { last?: boolean }) {
  return (
    <View style={[styles.activityRow, last && styles.lastRow]}>
      <SkeletonCircle size={38} />
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonLine width="55%" height={13} />
        <SkeletonLine width="72%" height={14} />
        <SkeletonLine width="32%" height={10} />
      </View>
      <SkeletonBox width={36} height={28} borderRadius={6} />
    </View>
  )
}

export function FeedActivitySkeleton() {
  return (
    <SkeletonPulse accessibilityLabel="Loading friends activity" style={styles.feedSkeleton}>
      <FeaturedActivitySkeleton />
      <View style={styles.sectionDivider}>
        <SkeletonLine width={110} height={10} style={{ marginBottom: 12, marginTop: 14 }} />
      </View>
      <View>
        <RecentActivitySkeleton />
        <RecentActivitySkeleton />
        <RecentActivitySkeleton last />
      </View>
    </SkeletonPulse>
  )
}

export function ProfileStatsSkeleton({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  return (
    <SkeletonPulse style={[styles.statsRow, style]}>
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} style={[styles.statBox, i === 3 && styles.statBoxLast]}>
          <SkeletonBox width={34} height={20} borderRadius={4} style={{ marginBottom: 5 }} />
          <SkeletonLine width={44} height={10} />
        </View>
      ))}
    </SkeletonPulse>
  )
}

export function RecentRoundSkeleton({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  return (
    <SkeletonPulse style={[styles.recentRound, style]}>
      <SkeletonBox width={62} height={62} borderRadius={8} />
      <View style={{ flex: 1, gap: 6, marginLeft: 12 }}>
        <SkeletonLine width="65%" height={15} />
        <SkeletonLine width="45%" height={12} />
      </View>
      <SkeletonBox width={40} height={32} borderRadius={6} />
    </SkeletonPulse>
  )
}

export function CourseDetailSkeleton({
  topInset = 59,
  onBack,
}: {
  topInset?: number
  onBack?: () => void
}) {
  return (
    <SkeletonPulse accessibilityLabel="Loading course" style={styles.detailContainer}>
      <View style={[styles.detailHero, { height: 245 }]}>
        <SkeletonBox height={245} width="100%" borderRadius={0} />
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={({ pressed }) => [styles.heroBackButton, { top: topInset + 12 }, pressed && styles.pressed]}
          >
            <View style={styles.backCircle}>
              <Feather name="arrow-left" size={18} color={colors.ink} />
            </View>
          </Pressable>
        ) : (
          <View style={[styles.heroBackButton, { top: topInset + 12 }]}>
            <SkeletonCircle size={38} />
          </View>
        )}
      </View>
      <View style={styles.detailPanel}>
        <SkeletonLine width="72%" height={26} style={{ marginBottom: 8 }} />
        <SkeletonLine width="42%" height={14} style={{ marginBottom: 10 }} />
        <SkeletonBox width={72} height={22} borderRadius={radii.pill} style={{ marginBottom: 16 }} />
        <View style={styles.factsRow}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={[styles.factBox, i > 0 && styles.factBoxBorder]}>
              <SkeletonBox width={36} height={18} borderRadius={4} style={{ marginBottom: 5 }} />
              <SkeletonLine width={30} height={10} />
            </View>
          ))}
        </View>
        <View style={{ height: 18 }} />
        <SkeletonBox width="100%" height={100} borderRadius={radii.card} />
      </View>
    </SkeletonPulse>
  )
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.line,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    overflow: 'hidden',
  },
  compactCard: {
    flex: 1,
    minWidth: 148,
  },
  cardVisualSkeleton: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  cardBody: {
    gap: 5,
    padding: 12,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
  },
  courseRow: {
    alignItems: 'center',
    borderBottomColor: '#DCDDD8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 11,
    paddingVertical: 10,
  },
  chevronPlaceholder: {
    opacity: 0.3,
  },
  featuredContainer: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionDivider: {
    paddingVertical: 4,
  },
  activityRow: {
    alignItems: 'center',
    borderBottomColor: '#ECECE7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  feedSkeleton: {
    paddingVertical: 4,
  },
  statsRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
  },
  statBox: {
    alignItems: 'center',
    borderRightColor: colors.line,
    borderRightWidth: 1,
    flex: 1,
  },
  statBoxLast: {
    borderRightWidth: 0,
  },
  recentRound: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 10,
  },
  detailContainer: {
    backgroundColor: colors.background,
    flex: 1,
  },
  detailHero: {
    backgroundColor: colors.line,
    position: 'relative',
    width: '100%',
  },
  heroBackButton: {
    left: 14,
    position: 'absolute',
    zIndex: 10,
  },
  detailPanel: {
    gap: 4,
    padding: 18,
  },
  factsRow: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    paddingVertical: 12,
  },
  factBox: {
    alignItems: 'center',
    flex: 1,
  },
  factBoxBorder: {
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
  },
  backCircle: {
    alignItems: 'center',
    backgroundColor: '#F0F1ED',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  pressed: {
    opacity: 0.75,
  },
})

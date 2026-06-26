import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { ReactNode } from 'react'
import { Dimensions, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type GetStartedScreenProps = {
  onGetStarted?: () => void
  onLogin?: () => void
}

type FloatingItemProps = {
  children: ReactNode
  size?: number
  style?: StyleProp<ViewStyle>
  rotation?: string
}

type FeatureItemProps = {
  icon: ReactNode
  title: string
  description: string
  showDivider?: boolean
}

const { width, height } = Dimensions.get('window')
const compact = height < 820
const HERO_SIZE = Math.min(width * (compact ? 0.78 : 0.84), compact ? 330 : 360)
const HERO_HEIGHT = Math.min(height * (compact ? 0.33 : 0.37), compact ? 300 : 335)
const itemScale = compact ? 0.82 : 0.9

function FloatingItem({ children, size = 64, style, rotation = '0deg' }: FloatingItemProps) {
  return (
    <View
      style={[
        styles.floatingItem,
        {
          height: size,
          transform: [{ rotate: rotation }],
          width: size,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

function FeatureItem({ icon, title, description, showDivider = true }: FeatureItemProps) {
  return (
    <View style={styles.featureWrap}>
      <View style={styles.featureContent}>
        <View style={styles.featureIcon}>{icon}</View>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
      </View>
      {showDivider ? <View style={styles.featureDivider} /> : null}
    </View>
  )
}

function AvatarCluster() {
  return (
    <View style={styles.avatarCluster}>
      <View style={[styles.avatar, styles.avatarOne]}>
        <Text style={styles.avatarInitials}>AK</Text>
      </View>
      <View style={[styles.avatar, styles.avatarTwo]}>
        <Text style={styles.avatarInitials}>RM</Text>
      </View>
      <View style={[styles.avatar, styles.avatarThree]}>
        <Text style={styles.avatarInitials}>JL</Text>
      </View>
      <View style={styles.avatarCount}>
        <Text style={styles.avatarCountText}>+12</Text>
      </View>
    </View>
  )
}

function Stars() {
  return (
    <View style={styles.starsRow}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Ionicons key={index} name="star" size={8} color="#B38A2E" />
      ))}
    </View>
  )
}

export function GetStartedScreen({ onGetStarted, onLogin }: GetStartedScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.hero}>
          <View style={styles.orbitOuter} />
          <View style={styles.orbitMiddle} />
          <View style={styles.orbitInner} />

          <View style={styles.centerCard}>
            <MaterialCommunityIcons name="golf" size={46} color="#214D3B" />
          </View>

          <FloatingItem size={66 * itemScale} style={styles.mapPinItem}>
            <View style={styles.pinBadge}>
              <Ionicons name="flag" size={24} color="#F7F3EA" />
            </View>
          </FloatingItem>

          <FloatingItem size={70 * itemScale} style={styles.ballItem} rotation="-10deg">
            <View style={styles.ball}>
              <View style={styles.ballDimples}>
                {Array.from({ length: 14 }).map((_, index) => (
                  <View key={index} style={styles.dimple} />
                ))}
              </View>
            </View>
          </FloatingItem>

          <FloatingItem size={80 * itemScale} style={styles.ratingCardItem} rotation="12deg">
            <View style={styles.ratingCard}>
              <View style={styles.ratingImage}>
                <MaterialCommunityIcons name="image-filter-hdr" size={20} color="#EAF3EC" />
              </View>
              <Text style={styles.ratingName}>Pine Valley</Text>
              <Text style={styles.ratingScore}>4.8</Text>
              <Stars />
            </View>
          </FloatingItem>

          <FloatingItem size={74 * itemScale} style={styles.journalItem} rotation="8deg">
            <View style={styles.journal}>
              <Feather name="bookmark" size={28} color="#214D3B" />
              <View style={styles.journalSnap} />
            </View>
          </FloatingItem>

          <FloatingItem size={76 * itemScale} style={styles.scorecardItem} rotation="-7deg">
            <View style={styles.scorecard}>
              <View style={styles.scoreSpiral} />
              <Text style={styles.scoreLabel}>ROUND</Text>
              <Text style={styles.scoreNumber}>72</Text>
              <Text style={styles.scoreMeta}>4 birdies</Text>
            </View>
          </FloatingItem>

          <FloatingItem size={86 * itemScale} style={styles.clubItem} rotation="-24deg">
            <MaterialCommunityIcons name="golf-tee" size={62} color="#6E756F" />
          </FloatingItem>

          <FloatingItem size={74 * itemScale} style={styles.trophyItem}>
            <View style={styles.trophyBadge}>
              <MaterialCommunityIcons name="trophy-variant" size={42} color="#214D3B" />
            </View>
          </FloatingItem>

          <FloatingItem size={94 * itemScale} style={styles.friendsItem}>
            <AvatarCluster />
          </FloatingItem>
        </View>

        <View style={styles.copy}>
          <Text style={styles.headline}>Your Game.{'\n'}Every Course.</Text>
          <Text style={styles.subtitle}>
            Track rounds, discover courses, see where friends have played, and rank your favorites.
          </Text>
        </View>

        <View style={styles.features}>
          <FeatureItem
            icon={<Feather name="bar-chart-2" size={28} color="#4F5751" />}
            title="Track"
            description="Log rounds and improve over time."
          />
          <FeatureItem
            icon={<Feather name="search" size={30} color="#4F5751" />}
            title="Discover"
            description="Find top courses near and far."
          />
          <FeatureItem
            icon={<MaterialCommunityIcons name="trophy-outline" size={31} color="#4F5751" />}
            title="Rank"
            description="Rate and rank your favorites."
          />
          <FeatureItem
            icon={<Ionicons name="people" size={30} color="#4F5751" />}
            title="Friends"
            description="See where friends played and how they scored."
            showDivider={false}
          />
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onGetStarted}
            style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed]}
          >
            <Text style={styles.ctaText}>Get Started</Text>
          </Pressable>

          <View style={styles.loginRow}>
            <Text style={styles.loginMuted}>Already have an account? </Text>
            <Pressable accessibilityRole="button" onPress={onLogin} hitSlop={8}>
              <Text style={styles.loginLink}>Log In</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

export default GetStartedScreen

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#F8F6F1',
    flex: 1,
  },
  screen: {
    alignItems: 'center',
    backgroundColor: '#F8F6F1',
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: compact ? 2 : 8,
  },
  hero: {
    alignItems: 'center',
    height: HERO_HEIGHT,
    justifyContent: 'center',
    maxHeight: compact ? 300 : 335,
    maxWidth: compact ? 330 : 360,
    position: 'relative',
    width: HERO_SIZE,
  },
  orbitOuter: {
    borderColor: '#E8E4DC',
    borderRadius: 999,
    borderWidth: 1,
    height: '92%',
    position: 'absolute',
    width: '92%',
  },
  orbitMiddle: {
    borderColor: '#EDE9E1',
    borderRadius: 999,
    borderWidth: 1,
    height: '66%',
    position: 'absolute',
    width: '66%',
  },
  orbitInner: {
    borderColor: '#F0ECE5',
    borderRadius: 999,
    borderWidth: 1,
    height: '34%',
    position: 'absolute',
    width: '34%',
  },
  centerCard: {
    alignItems: 'center',
    backgroundColor: '#FBFAF7',
    borderColor: '#F0EDE7',
    borderRadius: 999,
    borderWidth: 1,
    height: '25%',
    justifyContent: 'center',
    shadowColor: '#1B3328',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    width: '25%',
  },
  floatingItem: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    shadowColor: '#1D2D25',
    shadowOffset: { width: 0, height: 13 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  mapPinItem: {
    left: '43%',
    top: '3%',
  },
  pinBadge: {
    alignItems: 'center',
    backgroundColor: '#214D3B',
    borderRadius: 999,
    height: 58 * itemScale,
    justifyContent: 'center',
    width: 58 * itemScale,
  },
  ballItem: {
    left: '9%',
    top: '20%',
  },
  ball: {
    alignItems: 'center',
    backgroundColor: '#F4F2EC',
    borderRadius: 999,
    height: 64 * itemScale,
    justifyContent: 'center',
    width: 64 * itemScale,
  },
  ballDimples: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    height: 42 * itemScale,
    justifyContent: 'center',
    width: 42 * itemScale,
  },
  dimple: {
    backgroundColor: '#DDD9D0',
    borderRadius: 999,
    height: 6 * itemScale,
    opacity: 0.75,
    width: 6 * itemScale,
  },
  ratingCardItem: {
    right: '11%',
    top: '18%',
  },
  ratingCard: {
    alignItems: 'center',
    backgroundColor: '#FCFBF8',
    borderRadius: 12,
    gap: 2,
    height: 88 * itemScale,
    padding: 6 * itemScale,
    width: 58 * itemScale,
  },
  ratingImage: {
    alignItems: 'center',
    backgroundColor: '#214D3B',
    borderRadius: 8,
    height: 28 * itemScale,
    justifyContent: 'center',
    width: 45 * itemScale,
  },
  ratingName: {
    color: '#46514A',
    fontSize: 6 * itemScale,
    fontWeight: '700',
  },
  ratingScore: {
    color: '#214D3B',
    fontSize: 18 * itemScale,
    fontWeight: '800',
    lineHeight: 20 * itemScale,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 1,
  },
  journalItem: {
    right: '3%',
    top: '51%',
  },
  journal: {
    alignItems: 'center',
    backgroundColor: '#214D3B',
    borderRadius: 13,
    height: 66 * itemScale,
    justifyContent: 'center',
    width: 58 * itemScale,
  },
  journalSnap: {
    backgroundColor: '#E6DFD1',
    borderRadius: 999,
    height: 8,
    position: 'absolute',
    right: 7 * itemScale,
    width: 8,
  },
  scorecardItem: {
    left: '0%',
    top: '52%',
  },
  scorecard: {
    alignItems: 'center',
    backgroundColor: '#FEFDFB',
    borderRadius: 10,
    height: 75 * itemScale,
    paddingTop: 12 * itemScale,
    width: 62 * itemScale,
  },
  scoreSpiral: {
    backgroundColor: '#214D3B',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    height: 8 * itemScale,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  scoreLabel: {
    color: '#59625C',
    fontSize: 7 * itemScale,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  scoreNumber: {
    color: '#214D3B',
    fontSize: 26 * itemScale,
    fontWeight: '800',
    lineHeight: 31 * itemScale,
  },
  scoreMeta: {
    color: '#7A817B',
    fontSize: 8 * itemScale,
    fontWeight: '600',
  },
  clubItem: {
    bottom: '16%',
    left: '17%',
  },
  trophyItem: {
    bottom: '4%',
    left: '44%',
  },
  trophyBadge: {
    alignItems: 'center',
    backgroundColor: '#DDE8DF',
    borderRadius: 20,
    height: 64 * itemScale,
    justifyContent: 'center',
    width: 64 * itemScale,
  },
  friendsItem: {
    bottom: '17%',
    right: '9%',
  },
  avatarCluster: {
    height: 62 * itemScale,
    position: 'relative',
    width: 96 * itemScale,
  },
  avatar: {
    alignItems: 'center',
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 2,
    height: 36 * itemScale,
    justifyContent: 'center',
    position: 'absolute',
    top: 6 * itemScale,
    width: 36 * itemScale,
  },
  avatarOne: {
    backgroundColor: '#D8E7DD',
    left: 0,
  },
  avatarTwo: {
    backgroundColor: '#C7D5C9',
    left: 24 * itemScale,
    zIndex: 2,
  },
  avatarThree: {
    backgroundColor: '#E0E5D8',
    left: 48 * itemScale,
  },
  avatarInitials: {
    color: '#214D3B',
    fontSize: 10 * itemScale,
    fontWeight: '800',
  },
  avatarCount: {
    alignItems: 'center',
    backgroundColor: '#214D3B',
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 2,
    bottom: 0,
    height: 33 * itemScale,
    justifyContent: 'center',
    left: 34 * itemScale,
    position: 'absolute',
    width: 43 * itemScale,
    zIndex: 4,
  },
  avatarCountText: {
    color: '#FFFFFF',
    fontSize: 12 * itemScale,
    fontWeight: '800',
  },
  copy: {
    alignItems: 'center',
    marginTop: compact ? 0 : 4,
    paddingHorizontal: 8,
  },
  headline: {
    color: '#1F302B',
    fontSize: compact ? 31 : 36,
    fontWeight: '800',
    lineHeight: compact ? 35 : 40,
    textAlign: 'center',
  },
  subtitle: {
    color: '#626862',
    fontSize: compact ? 14 : 15,
    lineHeight: compact ? 20 : 22,
    marginTop: compact ? 8 : 10,
    maxWidth: 330,
    textAlign: 'center',
  },
  features: {
    flexDirection: 'row',
    marginTop: compact ? 18 : 22,
    width: '100%',
  },
  featureWrap: {
    flex: 1,
    flexDirection: 'row',
  },
  featureContent: {
    alignItems: 'center',
    flex: 1,
    minHeight: compact ? 98 : 108,
    paddingHorizontal: 4,
  },
  featureIcon: {
    alignItems: 'center',
    height: compact ? 27 : 30,
    justifyContent: 'center',
  },
  featureTitle: {
    color: '#3F4641',
    fontSize: compact ? 13 : 14,
    fontWeight: '800',
    marginTop: 6,
  },
  featureDescription: {
    color: '#656A66',
    fontSize: compact ? 10.5 : 11,
    lineHeight: compact ? 14 : 15,
    marginTop: 6,
    textAlign: 'center',
  },
  featureDivider: {
    backgroundColor: '#E2DED6',
    height: '86%',
    marginTop: 8,
    width: 1,
  },
  actions: {
    alignItems: 'center',
    marginTop: 'auto',
    minHeight: compact ? 94 : 106,
    paddingBottom: compact ? 2 : 4,
    paddingTop: compact ? 8 : 10,
    width: '100%',
  },
  ctaButton: {
    alignItems: 'center',
    backgroundColor: '#214D3B',
    borderRadius: 999,
    height: compact ? 54 : 58,
    justifyContent: 'center',
    shadowColor: '#214D3B',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: '100%',
  },
  ctaButtonPressed: {
    backgroundColor: '#183B2D',
    transform: [{ scale: 0.99 }],
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: compact ? 19 : 20,
    fontWeight: '800',
  },
  loginRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: compact ? 10 : 12,
  },
  loginMuted: {
    color: '#747A75',
    fontSize: compact ? 14 : 15,
  },
  loginLink: {
    color: '#214D3B',
    fontSize: compact ? 14 : 15,
    fontWeight: '800',
  },
})

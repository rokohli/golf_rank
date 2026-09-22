import { Feather } from '@expo/vector-icons'
import { Stack, useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { ProductScreen, ScreenHeader } from '../src/components/ProductUI'
import { openWebUrl } from '../src/webUrl'
import { colors, radii } from '../src/ui/theme'

interface FaqItem {
  id: string
  question: string
  answer: string
}

const FAQS: FaqItem[] = [
  {
    id: 'rankings',
    question: 'How do course rankings work?',
    answer:
      'Fairway uses pairwise head-to-head comparisons to determine your personal course rankings. When you rate a course, you compare it against other courses you have played. These ratings also aggregate into the 1–10 community rating shown on each course.',
  },
  {
    id: 'rounds',
    question: 'How do I log a round?',
    answer:
      'Navigate to any course page or the Rounds tab and tap "Log round". Enter your score, tee boxes, playing date, and optional personal notes or round photos.',
  },
  {
    id: 'green-fees',
    question: 'How do green fee estimates work?',
    answer:
      'When an official green fee is missing from our catalog, golfers can submit standard 18-hole walking or riding rates. Once multiple agreeing suggestions are submitted, the estimate is verified and displayed for everyone.',
  },
  {
    id: 'budget-tiers',
    question: 'What do the budget tiers ($, $$, $$$, $$$$) mean?',
    answer:
      'Budget tiers help match course discovery and trip recommendations to what you like to spend per round:\n\n• $ (Budget / Muni): Up to $50\n• $$ (Standard Public): Up to $100\n• $$$ (Premium Public): Up to $175\n• $$$$ (Splurge / Destination): $250+\n\nYou can fine-tune your exact maximum green fee anytime under Profile > Golf preferences.',
  },
  {
    id: 'hero-photos',
    question: 'How does a photo become the course cover photo?',
    answer:
      'When you attach photos to a public round, your best shots are considered for the course’s featured cover photo! Fairway selects cover photos based on image resolution, landscape composition (16:9 ratio), and clarity. If your photo is selected, it will be showcased at the top of the course page and across search results for all golfers.',
  },
  {
    id: 'data-privacy',
    question: 'How do I export or delete my data?',
    answer:
      'You can download an instant JSON export of your profile, ratings, and rounds via Settings > Download my data. You can also permanently delete your account and all associated data at any time using "Delete account" at the bottom of Settings.',
  },
]

export default function Support() {
  const router = useRouter()
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null)

  const toggleFaq = (id: string) => {
    setExpandedFaq((current) => (current === id ? null : id))
  }

  const emailSupport = () => {
    void Linking.openURL('mailto:support@fairway.app?subject=Fairway%20Support')
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen>
      <ScreenHeader onBack={() => router.back()} title="Help & support" />

      <View style={styles.heroIcon}>
        <Feather name="help-circle" size={28} color={colors.pine} />
      </View>
      <View style={styles.intro}>
        <Text style={styles.introTitle}>How can we help?</Text>
        <Text style={styles.introBody}>
          Browse common questions below or get in touch with our support team directly.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>CONTACT US</Text>
        <View style={styles.group}>
          <Pressable
            accessibilityLabel="Email Fairway support"
            accessibilityRole="button"
            onPress={emailSupport}
            style={({ pressed }) => [styles.contactRow, pressed && styles.pressed]}
          >
            <View style={styles.contactIcon}>
              <Feather name="mail" size={20} color={colors.pine} />
            </View>
            <View style={styles.contactCopy}>
              <Text style={styles.contactTitle}>Email support</Text>
              <Text style={styles.contactSub}>support@fairway.app</Text>
            </View>
            <Feather name="external-link" size={16} color={colors.muted} />
          </Pressable>
        </View>
        <Text style={styles.note}>We typically respond to support inquiries within 1–2 business days.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>FREQUENTLY ASKED QUESTIONS</Text>
        <View style={styles.group}>
          {FAQS.map((faq, index) => {
            const isExpanded = expandedFaq === faq.id
            const isLast = index === FAQS.length - 1
            return (
              <View key={faq.id} style={!isLast && styles.faqDivider}>
                <Pressable
                  accessibilityLabel={faq.question}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  onPress={() => toggleFaq(faq.id)}
                  style={({ pressed }) => [styles.faqHeader, pressed && styles.pressed]}
                >
                  <Text style={styles.faqQuestion}>{faq.question}</Text>
                  <Feather
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.pineDark}
                  />
                </Pressable>
                {isExpanded ? (
                  <View style={styles.faqBody}>
                    <Text style={styles.faqAnswer}>{faq.answer}</Text>
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>LEGAL & POLICIES</Text>
        <View style={styles.group}>
          <Pressable
            accessibilityLabel="Terms of service"
            accessibilityRole="link"
            onPress={() => void openWebUrl('/terms.html')}
            style={({ pressed }) => [styles.linkRow, styles.faqDivider, pressed && styles.pressed]}
          >
            <Feather name="file-text" size={18} color={colors.pine} />
            <Text style={styles.linkLabel}>Terms of service</Text>
            <Feather name="chevron-right" size={17} color={colors.muted} />
          </Pressable>
          <Pressable
            accessibilityLabel="Privacy policy"
            accessibilityRole="link"
            onPress={() => void openWebUrl('/privacy.html')}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <Feather name="shield" size={18} color={colors.pine} />
            <Text style={styles.linkLabel}>Privacy policy</Text>
            <Feather name="chevron-right" size={17} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.versionFooter}>Fairway v1.0.0</Text>
    </ProductScreen>
  </>
}

const styles = StyleSheet.create({
  heroIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.pineSoft,
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginTop: 8,
    width: 60,
  },
  intro: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  introTitle: {
    color: colors.ink,
    fontFamily: 'Georgia',
    fontSize: 22,
  },
  introBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  section: {
    gap: 8,
    marginTop: 8,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 4,
  },
  group: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.small,
    borderWidth: 1,
    overflow: 'hidden',
  },
  contactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  contactIcon: {
    alignItems: 'center',
    backgroundColor: colors.pineSoft,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  contactCopy: {
    flex: 1,
    gap: 2,
  },
  contactTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  contactSub: {
    color: colors.muted,
    fontSize: 11,
  },
  note: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
    paddingHorizontal: 4,
  },
  faqDivider: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  faqHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  faqQuestion: {
    color: colors.ink,
    fontFamily: 'Georgia',
    fontSize: 14,
    flex: 1,
    paddingRight: 10,
  },
  faqBody: {
    backgroundColor: '#F8F7F3',
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  faqAnswer: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  linkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  linkLabel: {
    color: colors.ink,
    fontFamily: 'Georgia',
    fontSize: 14,
    flex: 1,
  },
  versionFooter: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 8,
    paddingBottom: 20,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.65,
  },
})

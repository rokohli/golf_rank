import { Feather } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import {
  ASSISTANCE_TAGS,
  HIGHLIGHT_TAG_GROUPS,
  LOCOMOTION_TAGS,
  ROUND_TAG_LABELS,
} from '../types'
import { colors, radii } from '../ui/theme'

export const MAX_ROUND_TAGS = 8

type Props = {
  selectedTags: string[]
  onChange: (tags: string[]) => void
  maxTags?: number
}

export function TagSelector({
  selectedTags,
  onChange,
  maxTags = MAX_ROUND_TAGS,
}: Props) {
  const atMaxLimit = selectedTags.length >= maxTags

  function toggleLocomotion(tag: 'walked' | 'cart') {
    if (selectedTags.includes(tag)) {
      // Toggle off
      onChange(selectedTags.filter((t) => t !== tag))
    } else {
      // Mutually exclusive: remove the other locomotion tag if present
      const otherLocomotion = tag === 'walked' ? 'cart' : 'walked'
      const withoutOther = selectedTags.filter((t) => t !== otherLocomotion)
      if (withoutOther.length < maxTags) {
        onChange([...withoutOther, tag])
      }
    }
  }

  function toggleTag(tag: string) {
    if (selectedTags.includes(tag)) {
      onChange(selectedTags.filter((t) => t !== tag))
    } else if (!atMaxLimit) {
      onChange([...selectedTags, tag])
    }
  }

  return (
    <View style={styles.container} testID="tag-selector">
      <View style={styles.counterRow}>
        <Text style={styles.hint}>Tag observations to inform fellow golfers</Text>
        <Text
          accessibilityLabel={`${selectedTags.length} of ${maxTags} tags selected`}
          style={[styles.counter, atMaxLimit && styles.counterMax]}
        >
          {selectedTags.length}/{maxTags}
        </Text>
      </View>

      {/* Locomotion Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Feather name="navigation" size={13} color={colors.pine} />
          <Text style={styles.sectionTitle}>Locomotion</Text>
          <Text style={styles.sectionHelp}>Select how you navigated the course</Text>
        </View>
        <View style={styles.chipRow}>
          {LOCOMOTION_TAGS.map((tag) => {
            const isSelected = selectedTags.includes(tag)
            const otherLocomotion = tag === 'walked' ? 'cart' : 'walked'
            const hasOther = selectedTags.includes(otherLocomotion)
            const isDisabled = !isSelected && atMaxLimit && !hasOther
            return (
              <Pressable
                key={tag}
                accessibilityLabel={ROUND_TAG_LABELS[tag] || tag}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                disabled={isDisabled}
                onPress={() => toggleLocomotion(tag)}
                style={[
                  styles.chip,
                  isSelected && styles.chipSelected,
                  isDisabled && styles.chipDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && styles.chipTextSelected,
                    isDisabled && styles.chipTextDisabled,
                  ]}
                >
                  {ROUND_TAG_LABELS[tag] || tag}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* Bag & Assistance Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Feather name="briefcase" size={13} color={colors.pine} />
          <Text style={styles.sectionTitle}>Bag & Assistance</Text>
        </View>
        <View style={styles.chipRow}>
          {ASSISTANCE_TAGS.map((tag) => {
            const isSelected = selectedTags.includes(tag)
            const isDisabled = !isSelected && atMaxLimit
            return (
              <Pressable
                key={tag}
                accessibilityLabel={ROUND_TAG_LABELS[tag] || tag}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                disabled={isDisabled}
                onPress={() => toggleTag(tag)}
                style={[
                  styles.chip,
                  isSelected && styles.chipSelected,
                  isDisabled && styles.chipDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && styles.chipTextSelected,
                    isDisabled && styles.chipTextDisabled,
                  ]}
                >
                  {ROUND_TAG_LABELS[tag] || tag}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* Highlights & Setting Groups */}
      {HIGHLIGHT_TAG_GROUPS.map((group) => (
        <View key={group.title} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Feather name="tag" size={13} color={colors.pine} />
            <Text style={styles.sectionTitle}>{group.title}</Text>
          </View>
          <View style={styles.chipRow}>
            {group.tags.map((tag) => {
              const isSelected = selectedTags.includes(tag)
              const isDisabled = !isSelected && atMaxLimit
              return (
                <Pressable
                  key={tag}
                  accessibilityLabel={ROUND_TAG_LABELS[tag] || tag}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                  disabled={isDisabled}
                  onPress={() => toggleTag(tag)}
                  style={[
                    styles.chip,
                    isSelected && styles.chipSelected,
                    isDisabled && styles.chipDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                      isDisabled && styles.chipTextDisabled,
                    ]}
                  >
                    {ROUND_TAG_LABELS[tag] || tag}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ))}

      {atMaxLimit ? (
        <Text accessibilityRole="alert" style={styles.limitWarning}>
          Maximum {maxTags} tags selected. Deselect a tag to choose another.
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingVertical: 4,
  },
  counterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hint: {
    color: colors.muted,
    fontSize: 11,
  },
  counter: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  counterMax: {
    color: colors.gold,
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sectionHelp: {
    color: colors.muted,
    fontSize: 10,
    marginLeft: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: '#FAFAF8',
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipSelected: {
    backgroundColor: colors.pineSoft,
    borderColor: colors.pine,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: colors.pineDark,
    fontWeight: '700',
  },
  chipTextDisabled: {
    color: colors.muted,
  },
  limitWarning: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
})

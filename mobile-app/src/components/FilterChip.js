import { Pressable, StyleSheet, Text, View } from 'react-native'
import { theme } from '../theme/theme'

// A filter choice with its count, e.g. "Approved 4". Selected, it fills with the primary colour.
// `color` adds a dot in that colour (a review or conservation status colour).
export default function FilterChip({ label, count, selected, onPress, color }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count == null ? label : `${label}, ${count}`}
      // The chip is 36 high; this makes the touch area the 44 minimum
      hitSlop={(theme.buttonHeight - CHIP_HEIGHT) / 2}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}
    >
      {color ? <View style={[styles.dot, { backgroundColor: color }, selected && styles.dotOnPrimary]} /> : null}
      <Text style={[styles.label, selected && styles.textSelected]}>{label}</Text>
      {count != null ? <Text style={[styles.count, selected && styles.textSelected]}>{count}</Text> : null}
    </Pressable>
  )
}

const CHIP_HEIGHT = 36

const styles = StyleSheet.create({
  chip: {
    minHeight: CHIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs + 2,
    paddingHorizontal: theme.spacing.md,
    borderRadius: CHIP_HEIGHT / 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWhite,
  },
  selected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  pressed: {
    opacity: 0.8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  // A white ring keeps dark dots (e.g. critically endangered) visible on the primary fill
  dotOnPrimary: {
    borderWidth: 1,
    borderColor: theme.colors.surfaceWhite,
  },
  label: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
  },
  count: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
  },
  textSelected: {
    color: theme.colors.surfaceWhite,
  },
})

import { ActivityIndicator, Pressable, Text, StyleSheet, View } from 'react-native'
import { theme } from '../theme/theme'

// variant:
// - 'primary': filled with the primary colour
// - 'secondary': white with a border
// - 'danger': white with a red border and red text, for destructive actions such as Sign out
// loading: shows a spinner before the title and blocks presses (the title can say what's happening)
const VARIANTS = {
  primary: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary, color: theme.colors.surfaceWhite },
  secondary: { backgroundColor: theme.colors.surfaceWhite, borderColor: theme.colors.border, color: theme.colors.textPrimary },
  danger: { backgroundColor: theme.colors.surfaceWhite, borderColor: theme.colors.error, color: theme.colors.error },
}

export default function Button({ title, onPress, variant = 'primary', disabled = false, loading = false }) {
  const colors = VARIANTS[variant] ?? VARIANTS.primary
  const inactive = disabled || loading

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: colors.backgroundColor, borderColor: colors.borderColor },
        pressed && { opacity: 0.8 },
        // A loading button stays at full strength so its spinner reads as progress, not "off"
        disabled && !loading && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator size="small" color={colors.color} /> : null}
        <Text style={[styles.text, { color: colors.color }]}>{title}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: theme.buttonHeight,
    borderRadius: theme.radius,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  text: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
  },
  disabled: {
    opacity: 0.5,
  },
})

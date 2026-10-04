import { Pressable, Text, StyleSheet } from 'react-native'
import { theme } from '../theme/theme'

export default function Button({ title, onPress, variant = 'primary', disabled = false }) {
  const isPrimary = variant === 'primary'

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: isPrimary ? theme.colors.primary : theme.colors.surfaceWhite },
        { borderWidth: isPrimary ? 0 : 1, borderColor: theme.colors.border },
        pressed && { opacity: 0.8 },
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: isPrimary ? theme.colors.surfaceWhite : theme.colors.textPrimary },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: theme.buttonHeight,
    borderRadius: theme.radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  text: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
  },
  disabled: {
    opacity: 0.5,
  },
})

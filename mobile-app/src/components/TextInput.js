import { useState } from 'react'
import { StyleSheet, Text, TextInput as NativeTextInput, View } from 'react-native'
import { theme } from '../theme/theme'

// `style` applies to the wrapper (use it for margins); any other prop goes to the native input
export default function TextInput({ label, error, style, onFocus, onBlur, ref, ...props }) {
  const [focused, setFocused] = useState(false)

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <NativeTextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.textSecondary}
        selectionColor={theme.colors.primary}
        {...props}
        style={[styles.input, focused && styles.inputFocused, error && styles.inputError]}
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  input: {
    minHeight: theme.buttonHeight,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  inputFocused: {
    borderColor: theme.colors.primary,
  },
  inputError: {
    borderColor: theme.colors.error,
  },
  error: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
  },
})

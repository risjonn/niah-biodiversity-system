import { useState } from 'react'
import { StyleSheet, Text, TextInput as NativeTextInput, View } from 'react-native'
import { theme } from '../theme/theme'

// `style` applies to the wrapper (use it for margins); any other prop goes to the native input.
// `accessory` is an optional small element (e.g. a show/hide password button) drawn at the right
// end of the field, which keeps its text clear of it.
export default function TextInput({ label, error, style, onFocus, onBlur, ref, accessory, ...props }) {
  const [focused, setFocused] = useState(false)

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View>
        <NativeTextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={theme.colors.textSecondary}
          selectionColor={theme.colors.primary}
          {...props}
          style={[
            styles.input,
            accessory && styles.inputWithAccessory,
            focused && styles.inputFocused,
            error && styles.inputError,
          ]}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
        />
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
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
  inputWithAccessory: {
    paddingRight: theme.buttonHeight,
  },
  accessory: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: theme.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
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

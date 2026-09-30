import { Pressable, Text, StyleSheet } from 'react-native'
import { theme } from '../theme/theme'

export default function Button({ title, onPress, variant = 'primary' }) {
  const isPrimary = variant === 'primary'

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: isPrimary ? theme.colors.primary : theme.colors.surfaceWhite },
        { borderWidth: isPrimary ? 0 : 1, borderColor: theme.colors.border },
        pressed && { opacity: 0.8 },
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
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  text: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
})
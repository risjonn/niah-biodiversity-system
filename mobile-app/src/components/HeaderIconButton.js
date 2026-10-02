import { Pressable } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { theme } from '../theme/theme'

const iconSize = 24

// Icon-only button for the themed header. `name` is an Ionicons icon name. Always pass an
// accessibilityLabel too, since screen readers have no text to read on an icon-only button.
export default function HeaderIconButton({ name, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // Grows the touch area to the 44px minimum without changing the header layout
      hitSlop={(theme.buttonHeight - iconSize) / 2}
      style={({ pressed }) => pressed && { opacity: 0.8 }}
    >
      <Ionicons name={name} size={iconSize} color={theme.colors.surfaceWhite} />
    </Pressable>
  )
}

import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import TextInput from './TextInput'
import { theme } from '../theme/theme'

// A TextInput for passwords with a show/hide button at its right end. Takes every TextInput prop
// (label, error, ref, autoComplete, ...); the text is hidden until the button is pressed.
export default function PasswordInput(props) {
  const [shown, setShown] = useState(false)

  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      secureTextEntry={!shown}
      accessory={
        <Pressable
          onPress={() => setShown((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Ionicons
            name={shown ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color={theme.colors.textSecondary}
          />
        </Pressable>
      }
    />
  )
}

const styles = StyleSheet.create({
  toggle: {
    width: theme.buttonHeight,
    height: theme.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
})

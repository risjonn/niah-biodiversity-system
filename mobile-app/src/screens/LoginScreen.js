import { useRef, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Button from '../components/Button'
import HeaderBand from '../components/HeaderBand'
import TextInput from '../components/TextInput'
import { useAuth } from '../context/AuthContext'
import { theme } from '../theme/theme'

export default function LoginScreen({ navigation }) {
  const { signIn, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const passwordRef = useRef(null)

  async function handleSignIn() {
    if (submitting) return

    const trimmedEmail = email.trim()
    const errors = {
      email: trimmedEmail ? null : 'Enter your email address.',
      password: password ? null : 'Enter your password.',
    }
    setFieldErrors(errors)
    if (errors.email || errors.password) return

    Keyboard.dismiss()
    setSubmitting(true)
    try {
      // On success the navigator swaps this screen out once the user's role has loaded
      await signIn(trimmedEmail, password)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // As on Settings: automaticallyAdjustKeyboardInsets keeps the focused field above the keyboard
    // on iOS; on Android, where it does nothing, the padding makes the room instead
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'android' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* No navigation header on this screen: the band carries the app name, below the status bar */}
        <HeaderBand
          safeTop
          title="Niah Biodiversity"
          subtitle="Field records and species information for Niah National Park."
        />

        <View style={styles.container}>
          <Text style={styles.heading}>Staff sign in</Text>
          <Text style={styles.intro}>
            Sign in with your staff account to register plants and view your records.
          </Text>

          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            error={fieldErrors.email}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            style={styles.field}
          />
          <TextInput
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="current-password"
            autoCorrect={false}
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleSignIn}
            style={styles.field}
            accessory={
              <Pressable
                onPress={() => setShowPassword((shown) => !shown)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={theme.colors.textSecondary}
                />
              </Pressable>
            }
          />

          {error ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Button title={submitting ? 'Signing in…' : 'Sign in'} onPress={handleSignIn} />

          <View style={styles.guest}>
            <Text style={styles.guestPrompt}>Visiting the park? Scan plant QR codes without an account.</Text>
            <Button
              title="Continue as guest"
              variant="secondary"
              onPress={() => navigation.navigate('GuestScan')}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
  },
  // Starts straight under the band; the screen scrolls when the keyboard or a small phone
  // leaves too little room
  container: {
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
  },
  heading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.sm,
  },
  intro: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xl,
  },
  field: {
    marginBottom: theme.spacing.lg,
  },
  toggle: {
    width: theme.buttonHeight,
    height: theme.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  formError: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
    marginBottom: theme.spacing.lg,
  },
  guest: {
    marginTop: theme.spacing.xxl,
  },
  guestPrompt: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
})

import { useRef, useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native'
import Button from '../components/Button'
import TextInput from '../components/TextInput'
import { useAuth } from '../context/AuthContext'
import { theme } from '../theme/theme'

export default function LoginScreen({ navigation }) {
  const { signIn, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
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
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        autoCorrect={false}
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={handleSignIn}
        style={styles.field}
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
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
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

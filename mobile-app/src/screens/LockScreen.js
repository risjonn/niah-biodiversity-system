import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { StatusBar } from 'expo-status-bar'
import Button from '../components/Button'
import HeaderBand from '../components/HeaderBand'
import { useAppLock } from '../context/AppLockContext'
import { useAuth } from '../context/AuthContext'
import { theme } from '../theme/theme'

// Shown by RootNavigator in place of every other screen while the app is locked, so no records,
// photos or queued records are on screen (or mounted) until the user unlocks. Asks for Face ID,
// a fingerprint or the passcode as soon as it appears.
export default function LockScreen() {
  const { unlock } = useAppLock()
  const { signOut } = useAuth()
  const [checking, setChecking] = useState(true)
  const [message, setMessage] = useState(null)
  const autoPrompted = useRef(false)

  // On success the navigator replaces this screen. Whatever the result, the spinner stops, so the
  // Unlock button is always back if this screen is still showing.
  const runUnlock = useCallback(
    () =>
      unlock().then((result) => {
        setChecking(false)
        setMessage(result.success ? null : unlockErrorMessage(result.error))
      }),
    [unlock],
  )

  // One prompt on arrival. After that, only the Unlock button starts another, so a cancelled or
  // failed prompt is never followed straight away by a new one.
  useEffect(() => {
    if (autoPrompted.current) return
    autoPrompted.current = true
    runUnlock()
  }, [runUnlock])

  function handleUnlock() {
    setChecking(true)
    setMessage(null)
    runUnlock()
  }

  function handleUsePassword() {
    Alert.alert(
      'Sign in with password',
      "You'll be signed out, and signing back in needs your email, password and an internet connection. Records waiting to sync stay on this phone and sync next time you sign in with this account.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: signOut },
      ],
    )
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <HeaderBand safeTop title="Niah Biodiversity" />

        <View style={styles.container}>
          <Ionicons
            name="lock-closed-outline"
            size={theme.spacing.xxxl}
            color={theme.colors.primary}
            style={styles.icon}
            accessible={false}
          />
          <Text style={styles.heading} accessibilityRole="header">
            App locked
          </Text>
          <Text style={styles.intro}>
            Unlock with Face ID, your fingerprint or your phone&apos;s passcode to carry on.
          </Text>

          {message ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {message}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button title={checking ? 'Unlocking…' : 'Unlock'} onPress={handleUnlock} loading={checking} />
            <Button
              title="Sign in with password instead"
              variant="secondary"
              onPress={handleUsePassword}
              disabled={checking}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

function unlockErrorMessage(error) {
  switch (error) {
    case 'user_cancel':
      return 'Unlock cancelled. Tap Unlock to try again.'
    // The system or the app closed the prompt, e.g. a call came in
    case 'system_cancel':
    case 'app_cancel':
      return 'Unlock was interrupted. Tap Unlock to try again.'
    case 'timeout':
      return 'Unlock is taking too long to respond. Tap Unlock to try again.'
    case 'not_available':
    case 'not_enrolled':
    case 'passcode_not_set':
      return "Face ID, fingerprint and passcode aren't available right now. Sign in with your password instead."
    case 'lockout':
      return 'Too many attempts. Unlock your phone with its passcode, then try again.'
    default:
      return "We couldn't confirm it's you. Try again, or sign in with your password."
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
  },
  icon: {
    marginBottom: theme.spacing.lg,
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
  error: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
    marginBottom: theme.spacing.lg,
  },
  actions: {
    gap: theme.spacing.md,
  },
})

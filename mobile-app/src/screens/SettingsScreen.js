import { useRef, useState } from 'react'
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { useHeaderHeight } from '@react-navigation/elements'
import Button from '../components/Button'
import PasswordInput from '../components/PasswordInput'
import { useAuth } from '../context/AuthContext'
import { useSync } from '../context/SyncContext'
import { theme } from '../theme/theme'
import appConfig from '../../app.json'

// From app.json, so it can't drift from the version the build says it is
const APP_VERSION = appConfig.expo.version

const MIN_PASSWORD_LENGTH = 8
const EMPTY_PASSWORD_FORM = { current: '', next: '', confirm: '' }

export default function SettingsScreen() {
  const { user, role, signOut } = useAuth()
  const { unsyncedCount } = useSync()
  const headerHeight = useHeaderHeight()
  const [changingPassword, setChangingPassword] = useState(false)

  function handleSignOut() {
    Alert.alert(
      'Sign out',
      unsyncedCount > 0
        ? `You have ${unsyncedCount} ${unsyncedCount === 1 ? "record that hasn't" : "records that haven't"} synced. They'll stay on this phone and sync next time you sign in with this account.`
        : 'Are you sure you want to sign out?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: signOut,
        },
      ],
    )
  }

  function showAbout() {
    Alert.alert(
      'About This App',
      'Smart Ground-Truthing and Digital Biodiversity System\n\n' +
        'A digital platform for plant species documentation and biodiversity management at Niah National Park.\n\n' +
        'COS30049 Group Project\n' +
        'Version 1.0.0',
      [{ text: 'Close' }],
    )
  }

  function showHelp() {
    Alert.alert(
      'Help & Support',
      'If you experience any problems with the application, please contact your system administrator or project team for assistance.',
      [{ text: 'Close' }],
    )
  }

  function showDataPrivacy() { 
    Alert.alert( 
      'Data & Privacy', 
      'Location Data\n' + 
       'Your location is used when recording plant locations.\n\n' + 
       'Photos\n' + 
       'Photos may be attached to plant records for documentation.\n\n' + 
       'Account Data\n' + 
       'Your account information is protected by role-based access control.', 
      [{ text: 'Close' }], 
    ) 
  }

  return (
    // automaticallyAdjustKeyboardInsets scrolls the focused field into view but only works on iOS.
    // On Android the window doesn't resize for the keyboard, so the padding makes the room instead
    // (using it on iOS as well would leave room for the keyboard twice).
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'android' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <View style={styles.card}>
            <View style={styles.item}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>
                {user?.email ?? 'Not available'}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.item}>
              <Text style={styles.label}>Role</Text>
              <Text style={styles.value}>{formatRole(role)}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.item}>
              <Text style={styles.label}>Account protection</Text>
              <Text style={styles.description}>
                Your account is protected by role-based access control.
              </Text>
            </View>
          </View>
        </View>

        <ChangePasswordSection saving={changingPassword} onSavingChange={setChangingPassword} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>

          <View style={styles.card}>
            <Pressable style={styles.actionRow} onPress={showAbout} accessibilityRole="button">
              <View style={styles.actionContent}>
                <Text style={styles.value}>About This App</Text>
                <Text style={styles.description}>
                  Learn more about the biodiversity system.
                </Text>
              </View>

              <Text style={styles.arrow}>›</Text>
            </Pressable>

            <View style={styles.divider} />

            <Pressable style={styles.actionRow} onPress={showHelp} accessibilityRole="button">
              <View style={styles.actionContent}>
                <Text style={styles.value}>Help & Support</Text>
                <Text style={styles.description}>
                  Get help with using the application.
                </Text>
              </View>

              <Text style={styles.arrow}>›</Text>
            </Pressable>

            <View style={styles.divider} />

            <Pressable style={styles.actionRow} onPress={showDataPrivacy} accessibilityRole="button">
              <View style={styles.actionContent}>
                <Text style={styles.value}>Data & Privacy</Text>
                <Text style={styles.description}>
                  Learn how location, photos, and account data are used.
                </Text>
              </View>

              <Text style={styles.arrow}>›</Text>
            </Pressable>
          </View>
        </View>

        {__DEV__ ? <DeveloperSection /> : null}

        <View style={styles.signOutContainer}>
          <Button
            title="Sign out"
            variant="danger"
            onPress={handleSignOut}
            // The password check signs in again, which would undo a sign-out made while it runs
            disabled={changingPassword}
          />
          <Text style={styles.version}>Niah Biodiversity · Version {APP_VERSION}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function ChangePasswordSection({ saving, onSavingChange }) {
  const { changePassword } = useAuth()
  const [form, setForm] = useState(EMPTY_PASSWORD_FORM)
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [changed, setChanged] = useState(false)
  const newRef = useRef(null)
  const confirmRef = useRef(null)

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
    setChanged(false)
  }

  async function handleSubmit() {
    if (saving) return

    const errors = validatePasswordForm(form)
    setFieldErrors(errors)
    setSubmitError(null)
    setChanged(false)
    if (errors.current || errors.next || errors.confirm) return

    Keyboard.dismiss()
    onSavingChange(true)
    const { error } = await changePassword(form.current, form.next)
    onSavingChange(false)

    if (error) {
      setSubmitError(error)
      return
    }
    setForm(EMPTY_PASSWORD_FORM)
    setChanged(true)
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Change password</Text>

      <View style={styles.card}>
        <View style={styles.passwordForm}>
          <PasswordInput
            label="Current password"
            value={form.current}
            onChangeText={(value) => setField('current', value)}
            error={fieldErrors.current}
            editable={!saving}
            autoComplete="current-password"
            autoCorrect={false}
            textContentType="password"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => newRef.current?.focus()}
          />
          <PasswordInput
            ref={newRef}
            label="New password"
            value={form.next}
            onChangeText={(value) => setField('next', value)}
            error={fieldErrors.next}
            editable={!saving}
            autoComplete="new-password"
            autoCorrect={false}
            textContentType="newPassword"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <PasswordInput
            ref={confirmRef}
            label="Confirm new password"
            value={form.confirm}
            onChangeText={(value) => setField('confirm', value)}
            error={fieldErrors.confirm}
            editable={!saving}
            autoComplete="new-password"
            autoCorrect={false}
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
          />

          {submitError ? (
            <Text style={styles.passwordError} accessibilityLiveRegion="polite">
              {submitError}
            </Text>
          ) : null}
          {changed ? (
            <Text style={styles.passwordSuccess} accessibilityLiveRegion="polite">
              Your password has been changed.
            </Text>
          ) : null}

          <Button
            title={saving ? 'Changing password…' : 'Change password'}
            onPress={handleSubmit}
            loading={saving}
          />
        </View>
      </View>
    </View>
  )
}

// Development builds only: tools for testing the offline queue
function DeveloperSection() {
  const { paused, setPaused, addTestRecords } = useSync()
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)

  async function handleAddTestRecords() {
    setAdding(true)
    setMessage(null)
    const { data, error } = await addTestRecords()
    setAdding(false)
    setMessage(error ?? `Added ${data} test records to the queue.`)
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Developer</Text>

      <View style={styles.card}>
        <View style={styles.actionRow}>
          <View style={styles.actionContent}>
            <Text style={styles.value}>Pause automatic sync</Text>
            <Text style={styles.description}>
              Records stay in the queue until you tap Sync now in My Records.
            </Text>
          </View>
          <Switch
            value={paused}
            onValueChange={setPaused}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
            thumbColor={theme.colors.surfaceWhite}
            accessibilityLabel="Pause automatic sync"
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.item}>
          <Button
            title={adding ? 'Adding…' : 'Add 50 test records to the queue'}
            variant="secondary"
            onPress={handleAddTestRecords}
            disabled={adding}
          />
          {message ? <Text style={styles.description}>{message}</Text> : null}
        </View>
      </View>
    </View>
  )
}

// Passwords are compared as typed, not trimmed: a space can be part of a password
function validatePasswordForm({ current, next, confirm }) {
  const errors = {
    current: current ? null : 'Enter your current password.',
    next: null,
    confirm: null,
  }

  if (!next) errors.next = 'Enter a new password.'
  else if (next.length < MIN_PASSWORD_LENGTH) {
    errors.next = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  if (!confirm) errors.confirm = 'Confirm your new password.'
  else if (confirm !== next) errors.confirm = 'New passwords do not match.'

  return errors
}

function formatRole(role) {
  if (!role) return 'Not available'

  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  scroll: {
    backgroundColor: theme.colors.surface,
  },

  // The extra bottom padding lets Sign out scroll fully clear of the tab bar
  container: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  },

  section: {
    gap: theme.spacing.sm,
  },

  sectionTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.heading3.fontSize,
    fontWeight: theme.typography.heading3.fontWeight,
    color: theme.colors.textPrimary,
  },

  card: {
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },

  item: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },

  label: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    color: theme.colors.textSecondary,
  },

  value: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.body.fontWeight,
    color: theme.colors.textPrimary,
  },

  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },

  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },

  actionRow: {
    minHeight: theme.buttonHeight,
    padding: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },

  actionContent: {
    flex: 1,
    gap: theme.spacing.xs,
  },

  arrow: {
    fontFamily: 'Inter_400Regular',
    marginLeft: theme.spacing.md,
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textSecondary,
  },

  passwordForm: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },

  passwordError: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },

  passwordSuccess: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.success,
  },

  signOutContainer: {
    marginTop: 'auto',
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },

  version: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
})
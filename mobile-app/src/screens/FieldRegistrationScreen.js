import { useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useHeaderHeight } from '@react-navigation/elements'
import QRCode from 'react-native-qrcode-svg'
import Button from '../components/Button'
import PhotoField from '../components/PhotoField'
import ScanTagModal from '../components/ScanTagModal'
import ScientificName from '../components/ScientificName'
import SpeciesPicker from '../components/SpeciesPicker'
import TextInput from '../components/TextInput'
import { useSync } from '../context/SyncContext'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { theme } from '../theme/theme'

// Side length of the QR image shown after saving, big enough to scan from another phone
const QR_CODE_SIZE = 200

const SUBMIT_TITLES = { saving: 'Saving…', syncing: 'Submitting…' }

// How long the form waits for a new record to sync before saying it's saved on the phone. On a
// weak signal a request can hang for a minute; the record keeps syncing in the background.
const SYNC_WAIT_MS = 15000

const EMPTY_FORM = { species: null, height: '', notes: '', locationDescription: '', photo: null }

export default function FieldRegistrationScreen() {
  const { records, waitingCount, failedCount, queueRecord } = useSync()
  const location = useCurrentLocation()
  const headerHeight = useHeaderHeight()
  const scrollRef = useRef(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState({})
  // 'saving' while the record is saved on the phone, then 'syncing' while it is sent; null when
  // idle
  const [phase, setPhase] = useState(null)
  const busy = phase !== null
  const [submitError, setSubmitError] = useState(null)
  // The queued record once saved, which swaps the form for its QR code or a saved-on-phone note
  const [savedRecord, setSavedRecord] = useState(null)
  // Whether the "Scan tag" scanner is open
  const [scanOpen, setScanOpen] = useState(false)

  // Follows the record as it syncs, so the QR code appears if it syncs while this screen is open.
  // The last copy is kept if it leaves the queue.
  const liveRecord = savedRecord && records.find((record) => record.id === savedRecord.id)
  if (liveRecord && liveRecord !== savedRecord) setSavedRecord(liveRecord)

  const setField = (name) => (value) => setForm((current) => ({ ...current, [name]: value }))

  async function handleSubmit() {
    if (busy || location.status !== 'ready') return

    const height = parseHeight(form.height)
    const errors = {
      species: form.species ? null : 'Choose the species of this plant.',
      height: height.error,
    }
    setFieldErrors(errors)
    if (errors.species || errors.height) return

    Keyboard.dismiss()
    setSubmitError(null)

    // Saved on the phone first (photo included), then synced: see context/SyncContext.js
    setPhase('saving')
    const { data, error, attempt } = await queueRecord({
      species: form.species,
      height_cm: height.value,
      morphological_notes: form.notes.trim() || null,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      location_description: form.locationDescription.trim() || null,
      photoUri: form.photo?.uri ?? null,
    })

    // On failure everything entered stays in the form so it can be submitted again
    if (error) {
      setPhase(null)
      setSubmitError(error)
      return
    }

    setPhase('syncing')
    await Promise.race([attempt, wait(SYNC_WAIT_MS)])
    setPhase(null)
    // Swapped for the record's latest state from the queue on the next render
    setSavedRecord(data)
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }

  // The next plant is somewhere else, so the location is read again too
  function handleRegisterAnother() {
    setForm(EMPTY_FORM)
    setFieldErrors({})
    setSubmitError(null)
    setSavedRecord(null)
    location.refresh()
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <QueueStatus waitingCount={waitingCount} failedCount={failedCount} />
        {savedRecord ? (
          <SavedRecord record={savedRecord} onRegisterAnother={handleRegisterAnother} />
        ) : (
          <>
            <View style={styles.field}>
              <Button
                title="Scan tag"
                variant="secondary"
                onPress={() => setScanOpen(true)}
                disabled={busy}
              />
            </View>
            {scanOpen ? (
              <ScanTagModal onClose={() => setScanOpen(false)} />
            ) : null}

            <SpeciesPicker
              label="Species"
              value={form.species}
              onChange={setField('species')}
              error={fieldErrors.species}
              disabled={busy}
              style={styles.field}
            />
            <TextInput
              label="Height (cm, optional)"
              editable={!busy}
              value={form.height}
              onChangeText={setField('height')}
              error={fieldErrors.height}
              keyboardType="decimal-pad"
              style={styles.field}
            />
            <TextInput
              label="Morphological notes (optional)"
              editable={!busy}
              value={form.notes}
              onChangeText={setField('notes')}
              multiline
              style={styles.field}
            />
            <TextInput
              label="Location description (optional)"
              editable={!busy}
              value={form.locationDescription}
              onChangeText={setField('locationDescription')}
              placeholder="e.g. Beside the trail to the Great Cave"
              returnKeyType="done"
              style={styles.field}
            />

            <PhotoField
              label="Photo (optional)"
              value={form.photo}
              onChange={setField('photo')}
              disabled={busy}
              style={styles.field}
            />

            <LocationPanel location={location} disabled={busy} />

            {submitError ? (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {submitError}
              </Text>
            ) : null}

            <Button
              title={SUBMIT_TITLES[phase] ?? 'Submit registration'}
              onPress={handleSubmit}
              disabled={busy || location.status !== 'ready'}
            />
            {location.status !== 'ready' ? (
              <Text style={styles.hint}>You can submit once your location has been captured.</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function LocationPanel({ location, disabled }) {
  const { status, coords, message, refresh } = location

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>GPS location</Text>
      {status === 'locating' ? <Text style={styles.panelText}>Finding your location…</Text> : null}
      {status === 'ready' ? (
        <>
          <Text style={styles.panelText}>Latitude {coords.latitude.toFixed(6)}</Text>
          <Text style={styles.panelText}>Longitude {coords.longitude.toFixed(6)}</Text>
          <Text style={styles.panelMeta}>
            {coords.accuracy != null
              ? `Accurate to about ${Math.round(coords.accuracy)} m`
              : 'Accuracy unknown'}
          </Text>
        </>
      ) : null}
      {message ? (
        <Text style={styles.panelError} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      <Button
        title="Refresh location"
        variant="secondary"
        onPress={refresh}
        disabled={disabled || status === 'locating'}
      />
    </View>
  )
}

// Shown above the form while the queue has records that haven't synced
function QueueStatus({ waitingCount, failedCount }) {
  if (waitingCount === 0 && failedCount === 0) return null

  return (
    <View style={styles.queueStatus}>
      {waitingCount > 0 ? (
        <Text style={styles.queueStatusText}>
          {waitingCount} {waitingCount === 1 ? 'record' : 'records'} waiting to sync
        </Text>
      ) : null}
      {failedCount > 0 ? (
        <Text style={styles.queueStatusError}>
          {failedCount} {failedCount === 1 ? "record couldn't" : "records couldn't"} sync. See My
          Records.
        </Text>
      ) : null}
    </View>
  )
}

// A record from the queue: its QR code once synced, otherwise a note that it's on the phone
function SavedRecord({ record, onRegisterAnother }) {
  const action = (
    <View style={styles.savedAction}>
      <Button title="Register another plant" onPress={onRegisterAnother} />
    </View>
  )

  if (record.status !== 'synced') {
    return (
      <View style={styles.saved}>
        <Text style={styles.savedHeadingQueued}>Plant saved</Text>
        <Text style={styles.savedText}>
          {record.status === 'failed'
            ? `Saved on this phone, but it couldn't sync: ${withoutFinalStop(record.error_message)}. You can discard it in My Records.`
            : "Saved on this phone. It will sync automatically when you're back online. The QR code will be created when it syncs."}
        </Text>
        {action}
      </View>
    )
  }

  return (
    <View style={styles.saved}>
      <Text style={styles.savedHeading}>Plant registered</Text>
      <Text style={styles.savedText}>
        <ScientificName>{record.species_scientific_name}</ScientificName> has been saved and is
        waiting for review. Label the plant with this QR code:
      </Text>
      <Text style={styles.qrText} selectable>
        {record.qr_code}
      </Text>
      <View style={styles.qrImage}>
        <QRCode
          value={record.qr_code}
          size={QR_CODE_SIZE}
          color={theme.colors.textPrimary}
          backgroundColor={theme.colors.surfaceWhite}
        />
      </View>
      {action}
    </View>
  )
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Error messages end with a full stop; the sentence they go into adds its own
function withoutFinalStop(message) {
  return (message ?? 'unknown error').replace(/\.\s*$/, '')
}

// Height is optional. Resolves to { value, error }, with value as a number of cm or null if blank.
function parseHeight(text) {
  const trimmed = text.trim()
  if (!trimmed) return { value: null, error: null }
  // Some keyboards type a comma as the decimal point
  const value = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) {
    return { value: null, error: 'Enter the height as a number of centimetres greater than 0.' }
  }
  return { value, error: null }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  field: {
    marginBottom: theme.spacing.lg,
  },
  panel: {
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
    marginBottom: theme.spacing.lg,
  },
  panelTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
  },
  panelText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  panelMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
  panelError: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },
  formError: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
    marginBottom: theme.spacing.lg,
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
  saved: {
    alignItems: 'center',
    gap: theme.spacing.lg,
  },
  savedHeading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.success,
  },
  savedHeadingQueued: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
  },
  queueStatus: {
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: theme.spacing.xs,
    borderLeftColor: theme.colors.alert,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
    marginBottom: theme.spacing.lg,
  },
  queueStatusText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
  },
  queueStatusError: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },
  savedText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  qrText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading1.fontSize,
    color: theme.colors.textPrimary,
  },
  qrImage: {
    padding: theme.spacing.lg,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  savedAction: {
    alignSelf: 'stretch',
  },
})
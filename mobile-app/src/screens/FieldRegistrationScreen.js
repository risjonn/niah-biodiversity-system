import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useHeaderHeight } from '@react-navigation/elements'
import Ionicons from '@expo/vector-icons/Ionicons'
import QRCode from 'react-native-qrcode-svg'
import Button from '../components/Button'
import PhotoField from '../components/PhotoField'
import ReviewStatusChip from '../components/ReviewStatusChip'
import ScanTagModal from '../components/ScanTagModal'
import ScientificName from '../components/ScientificName'
import SpeciesPicker from '../components/SpeciesPicker'
import SyncStatusChip from '../components/SyncStatusChip'
import TextInput from '../components/TextInput'
import { useSync } from '../context/SyncContext'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { MAX_PHOTOS } from '../lib/photos'
import { queuedRecordAsPlant } from '../lib/queuedRecord'
import { theme } from '../theme/theme'

// Side length of the QR image shown after saving, big enough to scan from another phone
const QR_CODE_SIZE = 200

const SUBMIT_TITLES = { saving: 'Saving…', syncing: 'Submitting…' }

// How long the form waits for a new record to sync before saying it's saved on the phone. On a
// weak signal a request can hang for a minute; the record keeps syncing in the background.
const SYNC_WAIT_MS = 15000

// GPS accuracy in metres: up to GOOD is green, up to FAIR amber, anything worse (or no fix) red
const ACCURACY_GOOD_M = 20
const ACCURACY_FAIR_M = 50

const EMPTY_FORM = { species: null, height: '', notes: '', locationDescription: '', photos: [] }

export default function FieldRegistrationScreen({ navigation }) {
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

  const setField = (name) => (value) => {
    setForm((current) => ({ ...current, [name]: value }))
    // A field's message goes once it is changed
    setFieldErrors((current) => (current[name] ? { ...current, [name]: null } : current))
  }

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

    // Saved on the phone first (photos included), then synced: see context/SyncContext.js
    setPhase('saving')
    const { data, error, attempt } = await queueRecord({
      species: form.species,
      height_cm: height.value,
      morphological_notes: form.notes.trim() || null,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      location_description: form.locationDescription.trim() || null,
      photoUris: form.photos.map((photo) => photo.uri),
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

  // Why Submit can't be pressed yet, if it can't
  const submitHint = !form.species
    ? 'Choose a species to submit.'
    : location.status !== 'ready'
      ? 'You can submit once your location has been captured.'
      : null

  return (
    // As on Settings: on iOS automaticallyAdjustKeyboardInsets insets the scroll view by the part
    // the keyboard covers (above the tab bar) and scrolls the focused field into view. Android
    // ignores it, so the padding makes the room there instead (on iOS as well it would leave room
    // for the keyboard twice).
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'android' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <QueueStatus waitingCount={waitingCount} failedCount={failedCount} />
        {savedRecord ? (
          <SavedRecord
            record={savedRecord}
            onRegisterAnother={handleRegisterAnother}
            onViewRecord={() =>
              navigation.navigate('RecordDetail', {
                plantId: savedRecord.id,
                plant: queuedRecordAsPlant(savedRecord),
              })
            }
          />
        ) : (
          <>
            {/* Under the screen title: checks whether a tag is already registered */}
            <Pressable
              onPress={() => setScanOpen(true)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              hitSlop={theme.spacing.md}
              style={({ pressed }) => [styles.scanLink, (pressed || busy) && styles.dimmed]}
            >
              <Text style={styles.scanLinkText}>Already tagged? Scan to check</Text>
            </Pressable>
            {scanOpen ? (
              <ScanTagModal
                onClose={() => setScanOpen(false)}
                onViewRecord={(plant) => {
                  setScanOpen(false)
                  navigation.navigate('RecordDetail', { plantId: plant.id, plant })
                }}
              />
            ) : null}

            <Section title="Plant">
              <SpeciesPicker
                label="Species"
                value={form.species}
                onChange={setField('species')}
                error={fieldErrors.species}
                disabled={busy}
              />
              <TextInput
                label="Height (cm, optional)"
                editable={!busy}
                value={form.height}
                onChangeText={setField('height')}
                error={fieldErrors.height}
                keyboardType="decimal-pad"
              />
              <TextInput
                label="Morphological notes (optional)"
                editable={!busy}
                value={form.notes}
                onChangeText={setField('notes')}
                multiline
              />
            </Section>

            <Section title="Photos" note={`Optional, up to ${MAX_PHOTOS}`}>
              <PhotoField value={form.photos} onChange={setField('photos')} disabled={busy} />
            </Section>

            <Section title="Location">
              <LocationCard location={location} disabled={busy} />
              <TextInput
                label="Location description (optional)"
                editable={!busy}
                value={form.locationDescription}
                onChangeText={setField('locationDescription')}
                placeholder="e.g. Beside the trail to the Great Cave"
                returnKeyType="done"
              />
            </Section>

            {submitError ? (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {submitError}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Outside the scroll view, so Submit stays in view at the bottom, just above the tab bar */}
      {!savedRecord ? (
        <View style={styles.footer}>
          <Button
            title={SUBMIT_TITLES[phase] ?? 'Submit registration'}
            onPress={handleSubmit}
            disabled={!form.species || location.status !== 'ready'}
            loading={busy}
          />
          {submitHint && !busy ? (
            <Text style={styles.hint} accessibilityLiveRegion="polite">
              {submitHint}
            </Text>
          ) : null}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  )
}

// A group of fields under a small heading
function Section({ title, note, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {note ? <Text style={styles.sectionNote}>{note}</Text> : null}
      </View>
      {children}
    </View>
  )
}

// The GPS reading: a status dot, an accuracy chip, the coordinates and a refresh button
function LocationCard({ location, disabled }) {
  const { status, coords, message, refresh } = location
  const accuracy = status === 'ready' ? coords.accuracy : null
  const quality =
    accuracy == null ? 'none' : accuracy <= ACCURACY_GOOD_M ? 'good' : accuracy <= ACCURACY_FAIR_M ? 'fair' : 'poor'
  const dotColor =
    status === 'locating' ? theme.colors.alert : status === 'ready' ? theme.colors.success : theme.colors.error
  const statusText =
    status === 'locating' ? 'Finding your location…' : status === 'ready' ? 'Location captured' : 'No location'

  return (
    <View style={styles.gpsCard}>
      <View style={styles.gpsHeader}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.gpsStatus} accessibilityLiveRegion="polite">
          {statusText}
        </Text>
        <AccuracyChip quality={quality} accuracy={accuracy} locating={status === 'locating'} />
        <Pressable
          onPress={refresh}
          disabled={disabled || status === 'locating'}
          accessibilityRole="button"
          accessibilityLabel="Refresh location"
          accessibilityState={{ disabled: disabled || status === 'locating' }}
          style={({ pressed }) => [styles.iconButton, pressed && styles.dimmed]}
        >
          {status === 'locating' ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <Ionicons
              name="refresh"
              size={22}
              color={disabled ? theme.colors.textSecondary : theme.colors.primary}
            />
          )}
        </Pressable>
      </View>
      {status === 'ready' ? (
        <Text style={styles.coords} selectable>
          {coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}
        </Text>
      ) : null}
      {message ? (
        <Text style={styles.gpsError} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </View>
  )
}

const ACCURACY_CHIP_COLORS = {
  good: { backgroundColor: theme.colors.success, color: theme.colors.surfaceWhite },
  // Amber is too light for white text
  fair: { backgroundColor: theme.colors.alert, color: theme.colors.textPrimary },
  poor: { backgroundColor: theme.colors.error, color: theme.colors.surfaceWhite },
  none: { backgroundColor: theme.colors.error, color: theme.colors.surfaceWhite },
}

function AccuracyChip({ quality, accuracy, locating }) {
  // Nothing to say yet while the first reading is coming in
  if (locating) return null
  const colors = ACCURACY_CHIP_COLORS[quality]
  const text = accuracy == null ? 'No fix' : `±${Math.round(accuracy)} m`
  return (
    <View
      style={[styles.accuracyChip, { backgroundColor: colors.backgroundColor }]}
      accessible
      accessibilityLabel={accuracy == null ? 'No GPS fix' : `Accurate to about ${Math.round(accuracy)} metres`}
    >
      <Text style={[styles.accuracyText, { color: colors.color }]}>{text}</Text>
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
function SavedRecord({ record, onRegisterAnother, onViewRecord }) {
  if (record.status !== 'synced') {
    return (
      <View style={styles.saved}>
        <Text style={styles.savedHeadingQueued}>Plant saved</Text>
        <SyncStatusChip status={record.status} style={styles.centred} />
        <Text style={styles.savedText}>
          {record.status === 'failed'
            ? `Saved on this phone, but it couldn't sync: ${withoutFinalStop(record.error_message)}. You can discard it in My Records.`
            : "Saved on this phone. It will sync automatically when you're back online. The QR code will be created when it syncs."}
        </Text>
        <View style={styles.savedAction}>
          <Button title="Register another" onPress={onRegisterAnother} />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.saved}>
      <Text style={styles.savedHeading}>Plant registered</Text>
      <ReviewStatusChip status="pending_review" style={styles.centred} />
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
      <View style={styles.savedActions}>
        <Button title="View record" onPress={onViewRecord} />
        <Button title="Register another" variant="secondary" onPress={onRegisterAnother} />
      </View>
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
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.xl,
  },
  dimmed: {
    opacity: 0.6,
  },
  scanLink: {
    alignSelf: 'flex-start',
  },
  scanLinkText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.primary,
    textDecorationLine: 'underline',
  },
  section: {
    gap: theme.spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.bodySmall.fontSize,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.colors.textSecondary,
  },
  sectionNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
  gpsCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  gpsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  gpsStatus: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  accuracyChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius * 2,
  },
  accuracyText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.caption.fontSize,
  },
  iconButton: {
    width: theme.buttonHeight,
    height: theme.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -theme.spacing.sm,
    marginRight: -theme.spacing.sm,
  },
  coords: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
  gpsError: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 20,
    color: theme.colors.error,
  },
  formError: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWhite,
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  saved: {
    alignItems: 'center',
    gap: theme.spacing.lg,
  },
  centred: {
    alignSelf: 'center',
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
  savedActions: {
    alignSelf: 'stretch',
    gap: theme.spacing.md,
  },
})

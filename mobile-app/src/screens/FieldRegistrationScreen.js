import { useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useHeaderHeight } from '@react-navigation/elements'
import QRCode from 'react-native-qrcode-svg'
import Button from '../components/Button'
import ScientificName from '../components/ScientificName'
import SpeciesPicker from '../components/SpeciesPicker'
import TextInput from '../components/TextInput'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { usePlants } from '../hooks/usePlants'
import { theme } from '../theme/theme'

// Side length of the QR image shown after saving, big enough to scan from another phone
const QR_CODE_SIZE = 200

const EMPTY_FORM = { species: null, height: '', notes: '', locationDescription: '' }

export default function FieldRegistrationScreen() {
  const { submitPlant } = usePlants()
  const location = useCurrentLocation()
  const headerHeight = useHeaderHeight()
  const scrollRef = useRef(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  // The record returned by submitPlant once saved, which swaps the form for its QR code
  const [savedPlant, setSavedPlant] = useState(null)

  const setField = (name) => (value) => setForm((current) => ({ ...current, [name]: value }))

  async function handleSubmit() {
    if (submitting || location.status !== 'ready') return

    const height = parseHeight(form.height)
    const errors = {
      species: form.species ? null : 'Choose the species of this plant.',
      height: height.error,
    }
    setFieldErrors(errors)
    if (errors.species || errors.height) return

    Keyboard.dismiss()
    setSubmitting(true)
    setSubmitError(null)
    // photo_url is left out until photo capture is added, so it stays empty
    const { data, error } = await submitPlant({
      species_id: form.species.id,
      height_cm: height.value,
      morphological_notes: form.notes.trim() || null,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      location_description: form.locationDescription.trim() || null,
    })
    setSubmitting(false)

    // On failure everything entered stays in the form so it can be submitted again
    if (error) {
      setSubmitError(error)
      return
    }
    setSavedPlant({ ...data, species: form.species })
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }

  // The next plant is somewhere else, so the location is read again too
  function handleRegisterAnother() {
    setForm(EMPTY_FORM)
    setFieldErrors({})
    setSubmitError(null)
    setSavedPlant(null)
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
        {savedPlant ? (
          <SavedPlant plant={savedPlant} onRegisterAnother={handleRegisterAnother} />
        ) : (
          <>
            <SpeciesPicker
              label="Species"
              value={form.species}
              onChange={setField('species')}
              error={fieldErrors.species}
              style={styles.field}
            />
            <TextInput
              label="Height (cm, optional)"
              value={form.height}
              onChangeText={setField('height')}
              error={fieldErrors.height}
              keyboardType="decimal-pad"
              style={styles.field}
            />
            <TextInput
              label="Morphological notes (optional)"
              value={form.notes}
              onChangeText={setField('notes')}
              multiline
              style={styles.field}
            />
            <TextInput
              label="Location description (optional)"
              value={form.locationDescription}
              onChangeText={setField('locationDescription')}
              placeholder="e.g. Beside the trail to the Great Cave"
              returnKeyType="done"
              style={styles.field}
            />

            <LocationPanel location={location} />

            {submitError ? (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {submitError}
              </Text>
            ) : null}

            <Button
              title={submitting ? 'Submitting…' : 'Submit registration'}
              onPress={handleSubmit}
              disabled={submitting || location.status !== 'ready'}
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

function LocationPanel({ location }) {
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
        disabled={status === 'locating'}
      />
    </View>
  )
}

function SavedPlant({ plant, onRegisterAnother }) {
  return (
    <View style={styles.saved}>
      <Text style={styles.savedHeading}>Plant registered</Text>
      <Text style={styles.savedText}>
        <ScientificName>{plant.species.scientific_name}</ScientificName> has been saved and is
        waiting for review. Label the plant with this QR code:
      </Text>
      <Text style={styles.qrText} selectable>
        {plant.qr_code}
      </Text>
      <View style={styles.qrImage}>
        <QRCode
          value={plant.qr_code}
          size={QR_CODE_SIZE}
          color={theme.colors.textPrimary}
          backgroundColor={theme.colors.surfaceWhite}
        />
      </View>
      <View style={styles.savedAction}>
        <Button title="Register another plant" onPress={onRegisterAnother} />
      </View>
    </View>
  )
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

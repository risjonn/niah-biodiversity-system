import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Button from '../components/Button'
import ConservationStatusChip from '../components/ConservationStatusChip'
import QrScanner from '../components/QRScanner'
import ScientificName from '../components/ScientificName'
import TextInput from '../components/TextInput'
import { usePublicPlants } from '../hooks/usePublicPlants'
import { useSpecies } from '../hooks/useSpecies'
import { QR_CODE_PATTERN, normaliseQrCode } from '../lib/qrCode'
import { theme } from '../theme/theme'

// Guest mode: scan a plant's QR tag, or type its code, to see the approved record and its species.
// Works offline from the plant and species lists saved on the phone. Guests are not signed in, so
// only public data is used: the plants_public view and the species table.
export default function GuestScanScreen() {
  const plants = usePublicPlants()
  const { fetchSpecies } = useSpecies()
  const [speciesResult, setSpeciesResult] = useState(null)
  // Reported by QrScanner: false while permission is off or the camera failed to start
  const [cameraUsable, setCameraUsable] = useState(false)
  const [scanning, setScanning] = useState(true)
  // Set the moment a code is read, since the camera can report the same code several times before
  // `scanning` updates. Cleared only by "Scan another".
  const scanLockedRef = useRef(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState(null)
  // { plant } or { message }, or null while nothing has been looked up
  const [lookup, setLookup] = useState(null)
  const scrollRef = useRef(null)
  const resultYRef = useRef(0)

  const loadSpecies = useCallback(() => {
    setSpeciesResult(null)
    return fetchSpecies().then(setSpeciesResult)
  }, [fetchSpecies])

  useEffect(() => {
    let cancelled = false
    fetchSpecies().then((nextResult) => {
      if (!cancelled) setSpeciesResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [fetchSpecies])

  const speciesById = useMemo(
    () => new Map((speciesResult?.data ?? []).map((species) => [species.id, species])),
    [speciesResult],
  )

  // Brings the result into view, below the camera and code box
  useEffect(() => {
    if (lookup) scrollRef.current?.scrollTo({ y: resultYRef.current, animated: true })
  }, [lookup])

  function lookUp(rawCode) {
    const normalised = normaliseQrCode(rawCode)
    if (!QR_CODE_PATTERN.test(normalised)) return { message: "This isn't a Niah plant tag." }

    const { data: plant, error } = plants.lookupByQrCode(normalised)
    if (error) return { message: error }
    // Same message whether the code doesn't exist or isn't approved yet
    if (!plant) return { message: 'No approved record for this tag yet.' }
    return { plant }
  }

  // Shows the result for a scanned or typed code and pauses scanning until "Scan another"
  function showLookup(rawCode) {
    scanLockedRef.current = true
    setScanning(false)
    setLookup(lookUp(rawCode))
  }

  function handleScanned(data) {
    if (scanLockedRef.current) return
    showLookup(data)
  }

  function handleLookUpCode() {
    if (!code.trim()) {
      setCodeError('Enter the code printed on the plant tag.')
      return
    }
    setCodeError(null)
    Keyboard.dismiss()
    showLookup(code)
  }

  // Downloads both lists again, since they usually fail together (offline)
  function retry() {
    plants.reload()
    loadSpecies()
  }

  function scanAnother() {
    setLookup(null)
    setCode('')
    setCodeError(null)
    scanLockedRef.current = false
    setScanning(true)
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }

  const loading = plants.loading || !speciesResult

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      {loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Loading" />
          <Text style={styles.note}>Loading plant data…</Text>
        </View>
      ) : null}
      {plants.error ? (
        <View style={styles.status}>
          <Text style={styles.errorText} accessibilityLiveRegion="polite">
            {plants.error}
          </Text>
          <Button title="Try again" variant="secondary" onPress={retry} />
        </View>
      ) : null}
      {plants.savedAt ? (
        <Text style={styles.note}>Using plant data saved on {formatDate(plants.savedAt)}</Text>
      ) : null}
      {speciesResult?.savedAt ? (
        <Text style={styles.note}>
          Using species data saved on {formatDate(speciesResult.savedAt)}
        </Text>
      ) : null}

      <Text style={styles.heading}>Scan a plant tag</Text>
      <Text style={styles.intro}>
        Point the camera at the QR code on a plant tag to learn about the plant.
      </Text>

      <QrScanner
        scanning={scanning}
        onScan={handleScanned}
        onUsableChange={setCameraUsable}
        typeHint=" You can still type the code below."
      />

      <View style={styles.codeBox}>
        <TextInput
          label="Enter code"
          placeholder="NIAH-XXXXXX"
          value={code}
          onChangeText={setCode}
          error={codeError}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="search"
          onSubmitEditing={handleLookUpCode}
        />
        <Button title="Look up" variant="secondary" onPress={handleLookUpCode} />
      </View>

      <View
        onLayout={(event) => {
          resultYRef.current = event.nativeEvent.layout.y
        }}
      >
        {lookup ? (
          <View style={styles.result}>
            {lookup.plant ? (
              <PlantResult
                plant={lookup.plant}
                species={speciesById.get(lookup.plant.species_id)}
                speciesLoading={!speciesResult}
              />
            ) : (
              <View style={styles.card}>
                <Text style={styles.body} accessibilityLiveRegion="polite">
                  {lookup.message}
                </Text>
              </View>
            )}
            <Button
              title={cameraUsable ? 'Scan another' : 'Look up another'}
              onPress={scanAnother}
            />
          </View>
        ) : null}
      </View>
    </ScrollView>
  )
}

function PlantResult({ plant, species, speciesLoading }) {
  const latitude = Number(plant.latitude)
  const longitude = Number(plant.longitude)
  // Monitored plants' coordinates are already rounded to 2 decimal places by plants_public
  const decimals = plant.is_monitored ? 2 : 5

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      {species ? (
        <>
          <ScientificName style={styles.scientificName}>{species.scientific_name}</ScientificName>
          {species.common_name ? <Text style={styles.commonName}>{species.common_name}</Text> : null}
          {species.family ? <Text style={styles.family}>Family: {species.family}</Text> : null}
          {species.conservation_status ? (
            <ConservationStatusChip status={species.conservation_status} />
          ) : null}
          {species.reference_photo_url ? (
            <SpeciesPhoto
              key={species.reference_photo_url}
              uri={species.reference_photo_url}
              name={species.scientific_name}
            />
          ) : null}
          <Detail label="About this species" value={species.description} />
          <Detail label="Cultural significance" value={species.cultural_significance} />
        </>
      ) : (
        <Text style={styles.note}>
          {speciesLoading
            ? 'Loading species details…'
            : 'Species details are not available. Connect to the internet to download them.'}
        </Text>
      )}

      <View style={styles.divider} />

      <Detail label="Height" value={plant.height_cm != null ? `${plant.height_cm} cm` : null} />
      <Detail label="Notes" value={plant.morphological_notes} />
      <Detail label="Recorded" value={formatDate(plant.recorded_at)} />
      <Detail
        label={
          plant.is_monitored ? 'Approximate location (hidden to protect this plant)' : 'Location'
        }
        value={`${latitude.toFixed(decimals)}, ${longitude.toFixed(decimals)}`}
      />
    </View>
  )
}

// A labelled line of the result card. Skipped when there is no value.
function Detail({ label, value }) {
  const text = typeof value === 'string' ? value.trim() : value
  if (!text) return null
  return (
    <View>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.body}>{text}</Text>
    </View>
  )
}

// The species' public reference photo, or a placeholder when it can't load (e.g. offline). Only
// rendered when the species has a photo. Plant photos are never shown: they are in a bucket guests
// can't read.
function SpeciesPhoto({ uri, name }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <View style={[styles.photo, styles.photoPlaceholder]} accessibilityLabel="No photo available">
        <Ionicons name="leaf-outline" size={48} color={theme.colors.textSecondary} />
      </View>
    )
  }
  return (
    <Image
      source={{ uri }}
      style={styles.photo}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityLabel={`Reference photo of ${name}`}
    />
  )
}

// e.g. "3 Oct 2026"
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  status: {
    gap: theme.spacing.sm,
  },
  note: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },
  heading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
  },
  intro: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textSecondary,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  codeBox: {
    gap: theme.spacing.sm,
  },
  result: {
    gap: theme.spacing.md,
  },
  card: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  scientificName: {
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  commonName: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
    marginTop: -theme.spacing.sm,
  },
  family: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
    marginTop: -theme.spacing.sm,
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.border,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  detailLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
})
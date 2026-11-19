import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Button from '../components/Button'
import ConservationStatusChip from '../components/ConservationStatusChip'
import HeaderBand from '../components/HeaderBand'
import PhotoGallery from '../components/PhotoGallery'
import QrScanner from '../components/QRScanner'
import ScientificName from '../components/ScientificName'
import TextInput from '../components/TextInput'
import { usePlantPhotos } from '../hooks/usePlantPhotos'
import { usePublicPlants } from '../hooks/usePublicPlants'
import { useSpecies } from '../hooks/useSpecies'
import { QR_CODE_PATTERN, normaliseQrCode } from '../lib/qrCode'
import { formatDate } from '../lib/sarawakTime'
import { theme } from '../theme/theme'

// Guest mode: scan a plant's QR tag, or type its code, to see the approved record and its species,
// or browse the species list. Works offline from the plant and species lists saved on the phone.
// Guests are not signed in, so only public data is used: the plants_public view (approved plants
// only), the species table and its public photos, and the photos of approved, unmonitored plants.
export default function GuestScanScreen({ navigation }) {
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
  // { plant }, { notPublic: true } or { message }, or null while nothing has been looked up
  const [lookup, setLookup] = useState(null)
  const scrollRef = useRef(null)
  // Where the scan section and the result are, for scrolling to them: each is measured inside the
  // padded container, which itself sits below the band
  const containerYRef = useRef(0)
  const scanYRef = useRef(0)
  const resultYRef = useRef(0)
  const scrollToSection = (sectionYRef) =>
    scrollRef.current?.scrollTo({ y: containerYRef.current + sectionYRef.current, animated: true })

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
    if (lookup) scrollToSection(resultYRef)
  }, [lookup])

  function lookUp(rawCode) {
    const normalised = normaliseQrCode(rawCode)
    if (!QR_CODE_PATTERN.test(normalised)) return { message: "This isn't a Niah plant tag." }

    const { data: plant, error } = plants.lookupByQrCode(normalised)
    if (error) return { message: error }
    // Guests can only read approved plants, so a code that is pending, rejected or not in use
    // looks the same: none of them is public
    if (!plant) return { notPublic: true }
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
    scrollToSection(scanYRef)
  }

  function openSpecies(species) {
    navigation.navigate('SpeciesDetail', { speciesId: species.id, species, guest: true })
  }

  const loading = plants.loading || !speciesResult

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      {/* Right under the primary header, which only shows Back, so the two read as one */}
      <HeaderBand
        title="Explore Niah's plants"
        subtitle="Scan a plant tag, or browse the species of Niah National Park."
      />

      <View
        style={styles.container}
        onLayout={(event) => {
          containerYRef.current = event.nativeEvent.layout.y
        }}
      >
        <View style={styles.actions}>
          <ActionTile
            icon="qr-code-outline"
            label="Scan a tag"
            onPress={() => scrollToSection(scanYRef)}
          />
          <ActionTile
            icon="leaf-outline"
            label="Browse species"
            onPress={() => navigation.navigate('PlantSpecies', { guest: true })}
          />
        </View>

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

        <View
          style={styles.scanSection}
          onLayout={(event) => {
            scanYRef.current = event.nativeEvent.layout.y
          }}
        >
          <Text style={styles.heading} accessibilityRole="header">
            Scan a plant tag
          </Text>
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
                  onLearnMore={openSpecies}
                />
              ) : lookup.notPublic ? (
                <NotPublicResult />
              ) : (
                <View style={styles.card}>
                  <Text style={styles.body} accessibilityLiveRegion="polite">
                    {lookup.message}
                  </Text>
                </View>
              )}
              <Button
                title={cameraUsable ? 'Scan another' : 'Look up another'}
                variant="secondary"
                onPress={scanAnother}
              />
            </View>
          ) : null}
        </View>
      </View>
    </ScrollView>
  )
}

function ActionTile({ icon, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={24} color={theme.colors.primary} />
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  )
}

// An approved plant: its photos, its species (names, status, a short description and "Learn
// more"), then the record's own details
function PlantResult({ plant, species, speciesLoading, onLearnMore }) {
  const latitude = Number(plant.latitude)
  const longitude = Number(plant.longitude)
  // Monitored plants' coordinates are already rounded to 2 decimal places by plants_public
  const decimals = plant.is_monitored ? 2 : 5

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      {/* Keyed by plant, so another scan starts its own lookup */}
      <ScannedPlantPhotos key={plant.id} plant={plant} species={species} />
      {species ? (
        <>
          <View style={styles.titleBlock}>
            <ScientificName style={styles.scientificName}>{species.scientific_name}</ScientificName>
            {species.common_name ? <Text style={styles.commonName}>{species.common_name}</Text> : null}
            {species.conservation_status ? (
              <ConservationStatusChip status={species.conservation_status} style={styles.chip} />
            ) : null}
          </View>
          {species.description?.trim() ? (
            <Text style={styles.body} numberOfLines={3}>
              {species.description.trim()}
            </Text>
          ) : null}
          <Button title="Learn more" onPress={() => onLearnMore(species)} />
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

// The scanned plant's own photos, falling back to its species' cover photo, then to the leaf.
// Guests can read and sign the photos of approved plants that aren't monitored; for any other
// plant (or offline) the lookup finds none, and the species photo shows instead. has_photos from
// the plant list skips the lookup when there is nothing to find; a list saved by an older version
// of the app doesn't have it, so the lookup runs then.
function ScannedPlantPhotos({ plant, species }) {
  const { photos: plantPhotos, loading } = usePlantPhotos(plant.id, null, {
    enabled: plant.has_photos !== false,
  })
  const speciesName = species?.scientific_name
  const total = plantPhotos.length

  const photos =
    total > 0
      ? plantPhotos.map((photo, index) => ({
          key: photo.path,
          uri: photo.uri,
          alt: `Photo ${total > 1 ? `${index + 1} ` : ''}of this ${speciesName ?? 'plant'}`,
        }))
      : species?.reference_photo_url
        ? [
            {
              key: species.reference_photo_url,
              uri: species.reference_photo_url,
              alt: `Reference photo of ${speciesName}`,
            },
          ]
        : []

  return (
    <PhotoGallery
      photos={photos}
      loading={loading}
      tint={species ? theme.chart.conservationStatus[species.conservation_status] : undefined}
      emptyText="No photo of this plant yet"
    />
  )
}

// A tag that is valid but has no approved plant: pending review, rejected, or not used yet
function NotPublicResult() {
  return (
    <View style={[styles.card, styles.notPublic]} accessibilityLiveRegion="polite">
      <View style={styles.notPublicIcon}>
        <Ionicons name="time-outline" size={28} color={theme.colors.primary} accessibilityElementsHidden />
      </View>
      <Text style={styles.notPublicTitle}>This plant isn&apos;t public yet</Text>
      <Text style={styles.notPublicText}>
        Its record may still be waiting for a conservation officer to check it. Try again another
        time.
      </Text>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
    gap: theme.spacing.lg,
  },
  pressed: {
    opacity: 0.8,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  tile: {
    flex: 1,
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWhite,
  },
  tileLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
    textAlign: 'center',
  },
  scanSection: {
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
    lineHeight: 22,
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
  titleBlock: {
    gap: theme.spacing.xs,
  },
  scientificName: {
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textSecondary,
  },
  chip: {
    marginTop: theme.spacing.xs,
  },
  notPublic: {
    alignItems: 'center',
  },
  notPublicIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  notPublicTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
    textAlign: 'center',
  },
  notPublicText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    lineHeight: 22,
    color: theme.colors.textSecondary,
    textAlign: 'center',
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

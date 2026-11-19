import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import Button from '../components/Button'
import ConservationStatusChip from '../components/ConservationStatusChip'
import EmptyState from '../components/EmptyState'
import PhotoGallery from '../components/PhotoGallery'
import ReviewStatusChip from '../components/ReviewStatusChip'
import ScientificName from '../components/ScientificName'
import { usePlantPhotos } from '../hooks/usePlantPhotos'
import { usePlants } from '../hooks/usePlants'
import { useSpecies } from '../hooks/useSpecies'
import { formatDateTime } from '../lib/sarawakTime'
import { theme } from '../theme/theme'

// Side length of the QR image, the same as after registering, big enough to scan from another phone
const QR_CODE_SIZE = 200

// One of the botanist's own records, read-only. Opened with { plantId } and, when the opener
// already has it, the record itself as { plant }, which shows straight away (also offline) while
// the latest copy loads.
export default function RecordDetailScreen({ route, navigation }) {
  const { plantId, plant: initialPlant } = route.params ?? {}
  const { fetchPlant } = usePlants()
  const { fetchSpecies } = useSpecies()
  const [plant, setPlant] = useState(initialPlant ?? null)
  const [species, setSpecies] = useState(null)
  // Only shown when there is nothing to show at all
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchPlant(plantId), fetchSpecies()]).then(([plantResult, speciesResult]) => {
      if (cancelled) return
      if (!plantResult.error && plantResult.data) setPlant(plantResult.data)
      else if (!plantResult.error) setError('This record could not be found.')
      else setError(plantResult.error)
      setSpecies(speciesResult.data)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // The hooks' functions are new on every render; only another record needs another load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantId])

  // The QR code as the title, once known
  useEffect(() => {
    if (plant?.qr_code) navigation.setOptions({ title: plant.qr_code })
  }, [navigation, plant?.qr_code])

  if (!plant) {
    if (!loaded) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Loading record" />
        </View>
      )
    }
    return (
      <View style={styles.centerPadded}>
        <EmptyState
          icon="cloud-offline-outline"
          message={error}
          action={{ title: 'Back', onPress: () => navigation.goBack() }}
        />
      </View>
    )
  }

  const plantSpecies = species?.find((item) => item.id === plant.species_id)
  const scientificName = plantSpecies?.scientific_name ?? plant.species_scientific_name
  const commonName = plantSpecies?.common_name ?? plant.species_common_name

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {plant.review_status === 'rejected' ? (
        <View style={styles.rejection} accessibilityRole="summary">
          <Text style={styles.rejectionTitle}>Why it was rejected</Text>
          <Text style={styles.rejectionText}>
            {plant.rejection_reason || 'No reason was given. Ask a conservation officer.'}
          </Text>
        </View>
      ) : null}

      <RecordPhotos plant={plant} name={scientificName ?? 'the plant'} />

      <View style={styles.titleBlock}>
        {scientificName ? (
          <ScientificName style={styles.scientificName}>{scientificName}</ScientificName>
        ) : (
          <Text style={[styles.scientificName, styles.unknown]}>Unknown species</Text>
        )}
        {commonName ? <Text style={styles.commonName}>{commonName}</Text> : null}
        <View style={styles.chips}>
          {plantSpecies ? <ConservationStatusChip status={plantSpecies.conservation_status} /> : null}
          <ReviewStatusChip status={plant.review_status} />
        </View>
      </View>

      <View style={styles.card}>
        <Detail label="Recorded" value={formatDateTime(plant.recorded_at)} />
        <Detail label="Location description" value={plant.location_description || 'Not recorded'} />
        <View style={[styles.detail, styles.detailDivider]}>
          <Text style={styles.detailLabel}>Coordinates</Text>
          <Text style={styles.detailValue} selectable>
            {formatCoordinates(plant)}
          </Text>
          {plant.latitude != null && plant.longitude != null ? (
            <View style={styles.mapButton}>
              <Button
                title="Open in Maps"
                variant="secondary"
                onPress={() => openInMaps(plant, scientificName)}
              />
            </View>
          ) : null}
        </View>
        <Detail label="Height" value={plant.height_cm != null ? `${plant.height_cm} cm` : 'Not recorded'} />
        <Detail label="Morphological notes" value={plant.morphological_notes || 'None'} last />
      </View>

      {plant.qr_code ? (
        <View style={[styles.card, styles.qrCard]}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            QR code
          </Text>
          {/* Encodes the raw qr_code, as FieldRegistrationScreen does after saving */}
          <View accessible accessibilityLabel={`QR code for ${plant.qr_code}`}>
            <QRCode
              value={plant.qr_code}
              size={QR_CODE_SIZE}
              color={theme.colors.textPrimary}
              backgroundColor={theme.colors.surfaceWhite}
            />
          </View>
          <Text style={styles.qrText} selectable>
            {plant.qr_code}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

// The record's photos (plant_photos, falling back to photo_url), signed in one request
function RecordPhotos({ plant, name }) {
  const { photos, error, loading } = usePlantPhotos(plant.id, plant.photo_url || null)
  const total = photos.length
  return (
    <PhotoGallery
      photos={photos.map((photo, index) => ({
        key: photo.path,
        uri: photo.uri,
        alt: total > 1 ? `Photo ${index + 1} of ${name}` : `Photo of ${name}`,
      }))}
      loading={loading}
      emptyText={error ? "The photos can't be shown right now" : 'No photo with this record'}
    />
  )
}

function Detail({ label, value, last = false }) {
  return (
    <View style={[styles.detail, !last && styles.detailDivider]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

function formatCoordinates(plant) {
  if (plant.latitude == null || plant.longitude == null) return 'Not recorded'
  return `${Number(plant.latitude).toFixed(5)}, ${Number(plant.longitude).toFixed(5)}`
}

// Opens the phone's own maps app with a pin at the plant: Apple Maps on iOS, the geo: handler
// (usually Google Maps) on Android. Falls back to Google Maps in the browser if that can't open.
async function openInMaps(plant, label) {
  const position = `${plant.latitude},${plant.longitude}`
  const name = encodeURIComponent(label ?? 'Plant')
  const url = Platform.select({
    ios: `maps://?ll=${position}&q=${name}`,
    default: `geo:${position}?q=${position}(${name})`,
  })
  try {
    await Linking.openURL(url)
  } catch {
    await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${position}`).catch(() => {})
  }
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  centerPadded: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  },
  rejection: {
    gap: theme.spacing.xs,
    padding: theme.spacing.lg,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderLeftWidth: 6,
    // White, not a red tint: the red heading needs it to reach 4.5:1 (5.4:1 on white)
    backgroundColor: theme.colors.surfaceWhite,
  },
  rejectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.error,
  },
  rejectionText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    lineHeight: 22,
    color: theme.colors.textPrimary,
  },
  titleBlock: {
    gap: theme.spacing.xs,
  },
  scientificName: {
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
  },
  unknown: {
    fontFamily: 'Inter_400Regular',
  },
  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  card: {
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  detail: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  detailDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  detailLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
  detailValue: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    lineHeight: 22,
    color: theme.colors.textPrimary,
  },
  mapButton: {
    marginTop: theme.spacing.sm,
    alignSelf: 'flex-start',
  },
  qrCard: {
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  sectionTitle: {
    alignSelf: 'flex-start',
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  qrText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    letterSpacing: 1,
    color: theme.colors.textPrimary,
  },
})

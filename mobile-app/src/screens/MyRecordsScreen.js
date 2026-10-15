import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { usePlantPhoto } from '../hooks/usePlantPhoto'
import { usePlants } from '../hooks/usePlants'
import { useSpecies } from '../hooks/useSpecies'
import { theme } from '../theme/theme'

export default function MyRecordsScreen() {
  const { getPlantPhotoUrl } = usePlantPhoto()
  const [photoUrls, setPhotoUrls] = useState({})
  const { fetchMyPlants } = usePlants()
  const { fetchSpecies } = useSpecies()

  const [plants, setPlants] = useState([])
  const [species, setSpecies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadRecords()
  }, [])

  async function loadRecords() {
    setLoading(true)
    setError(null)

    const [plantsResult, speciesResult] = await Promise.all([
      fetchMyPlants(),
      fetchSpecies(),
    ])

    if (plantsResult.error) {
      setError(plantsResult.error)
      setPlants([])
      setLoading(false)
      return
    }

    if (speciesResult.error) {
      setError(speciesResult.error)
      setPlants([])
      setLoading(false)
      return
    }

    setPlants(plantsResult.data)
    setSpecies(speciesResult.data)

    const photoResults = await Promise.all(
      plantsResult.data.map(async (plant) => {
        if (!plant.photo_url) {
          return [plant.id, null]
        }

        const result = await getPlantPhotoUrl(plant.photo_url)
        return [plant.id, result.data]
      })
    )

    setPhotoUrls(Object.fromEntries(photoResults))
    setLoading(false)
  }

  function getSpecies(plant) {
    return species.find((item) => item.id === plant.species_id)
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator
          size="large"
          color={theme.colors.primary}
          accessibilityLabel="Loading plant records"
        />
        <Text style={styles.loadingText}>Loading your records…</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Unable to load records</Text>
        <Text style={styles.errorText}>{error}</Text>

        <Pressable style={styles.retryButton} onPress={loadRecords}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>My Records</Text>
        <Text style={styles.subtitle}>
          Plant records you have submitted and their review status.
        </Text>
      </View>

      {plants.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No plant records yet</Text>
          <Text style={styles.emptyText}>
            Your submitted plant records will appear here once you register a plant.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {plants.map((plant) => {
            const plantSpecies = getSpecies(plant)

            return (
              <PlantRecordCard
                key={plant.id}
                plant={plant}
                species={plantSpecies}
                photoUrl={photoUrls[plant.id]}
              />
            )
          })}
        </View>
      )}

      {plants.length > 0 ? (
        <Pressable style={styles.refreshButton} onPress={loadRecords}>
          <Text style={styles.refreshText}>Refresh Records</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

function PlantRecordCard({ plant, species, photoUrl }) {
  const status = getStatusInfo(plant.review_status)

  return (
    <View style={styles.card}>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={styles.plantImage}
          resizeMode="cover"
          accessibilityLabel="Uploaded plant photograph"
        />
      ) : plant.photo_url ? (
        <Text style={styles.photoError}>
          Unable to load plant photo.
        </Text>
      ) : (
        <Text style={styles.photoPlaceholder}>
          No photo uploaded
        </Text>
      )}
      <View style={styles.cardHeader}>
        <View style={styles.speciesContainer}>
          <Text style={styles.scientificName}>
            {species?.scientific_name ?? 'Unknown species'}
          </Text>

          {species?.common_name ? (
            <Text style={styles.commonName}>{species.common_name}</Text>
          ) : null}
        </View>

        <View style={[styles.statusBadge, { backgroundColor: status.backgroundColor }]}>
          <Text style={[styles.statusText, { color: status.color }]}>
            {status.label}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.details}>
        {plant.height_cm != null ? (
          <DetailRow
            label="Height"
            value={`${plant.height_cm} cm`}
          />
        ) : null}

        {plant.location_description ? (
          <DetailRow
            label="Location"
            value={plant.location_description}
          />
        ) : null}

        <DetailRow
          label="Recorded"
          value={formatDate(plant.recorded_at)}
        />

        <DetailRow
          label="QR Code"
          value={plant.qr_code}
          selectable
        />
      </View>

      {plant.morphological_notes ? (
        <View style={styles.notes}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{plant.morphological_notes}</Text>
        </View>
      ) : null}

      {plant.review_status === 'rejected' && plant.rejection_reason ? (
        <View style={styles.rejection}>
          <Text style={styles.rejectionLabel}>Rejection reason</Text>
          <Text style={styles.rejectionText}>{plant.rejection_reason}</Text>
        </View>
      ) : null}
    </View>
  )
}

function DetailRow({ label, value, selectable = false }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={styles.detailValue}
        selectable={selectable}
      >
        {value}
      </Text>
    </View>
  )
}

function getStatusInfo(status) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        color: theme.colors.success,
        // backgroundColor: '#E8F0E4',
      }

    case 'rejected':
      return {
        label: 'Rejected',
        color: theme.colors.error,
        // backgroundColor: '#F8E7E5',
      }

    case 'pending_review':
    default:
      return {
        label: 'Pending Review',
        color: theme.colors.alert,
        // backgroundColor: '#F8EEDC',
      }
  }
}

function formatDate(date) {
  if (!date) return 'Not available'

  const parsedDate = new Date(date)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Not available'
  }

  return parsedDate.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const styles = StyleSheet.create({
  plantImage: {
    width: '100%',
    height: 200,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surface,
  },

  imagePlaceholder: {
    width: '100%',
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
  },

  placeholderText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.lg,
  },

  header: {
    gap: theme.spacing.xs,
  },

  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading1.fontSize,
    fontWeight: theme.typography.heading1.fontWeight,
    color: theme.colors.textPrimary,
  },

  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },

  list: {
    gap: theme.spacing.lg,
  },

  card: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    gap: theme.spacing.md,
  },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },

  speciesContainer: {
    flex: 1,
    gap: theme.spacing.xs,
  },

  scientificName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    fontWeight: theme.typography.heading3.fontWeight,
    color: theme.colors.textPrimary,
  },

  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    color: theme.colors.textSecondary,
  },

  statusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius,
  },

  statusText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '500',
  },

  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },

  details: {
    gap: theme.spacing.sm,
  },

  detailRow: {
    gap: theme.spacing.xs,
  },

  detailLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    fontWeight: theme.typography.caption.fontWeight,
    color: theme.colors.textSecondary,
  },

  detailValue: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    color: theme.colors.textPrimary,
  },

  notes: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    gap: theme.spacing.xs,
  },

  notesLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    color: theme.colors.textPrimary,
  },

  notesText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },

  rejection: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
    gap: theme.spacing.xs,
  },

  rejectionLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    color: theme.colors.error,
  },

  rejectionText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },

  emptyCard: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    gap: theme.spacing.sm,
  },

  emptyTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.heading3.fontSize,
    fontWeight: theme.typography.heading3.fontWeight,
    color: theme.colors.textPrimary,
    textAlign: 'center',
  },

  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },

  center: {
    flex: 1,
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },

  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    color: theme.colors.textSecondary,
  },

  errorTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.heading3.fontSize,
    fontWeight: theme.typography.heading3.fontWeight,
    color: theme.colors.textPrimary,
    textAlign: 'center',
  },

  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },

  retryButton: {
    minHeight: theme.buttonHeight,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius,
    backgroundColor: theme.colors.primary,
  },

  retryText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: '500',
    color: theme.colors.surfaceWhite,
  },

  refreshButton: {
    minHeight: theme.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },

  refreshText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: '500',
    color: theme.colors.primary,
  },
})
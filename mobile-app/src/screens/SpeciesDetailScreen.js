import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import ConservationStatusChip from '../components/ConservationStatusChip'
import EmptyState from '../components/EmptyState'
import PhotoBanner from '../components/PhotoBanner'
import ScientificName from '../components/ScientificName'
import { usePlants } from '../hooks/usePlants'
import { useSpecies } from '../hooks/useSpecies'
import { theme } from '../theme/theme'

// One species, read-only. Opened with { speciesId } and, from the Species tab, the species itself
// as { species }, which shows straight away; otherwise it is looked up in the species list (the
// copy saved on the phone when offline).
export default function SpeciesDetailScreen({ route, navigation }) {
  const { speciesId, species: initialSpecies } = route.params ?? {}
  const { fetchSpecies } = useSpecies()
  const { getLoadedMyPlants } = usePlants()
  const [species, setSpecies] = useState(initialSpecies ?? null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (initialSpecies) return undefined
    let cancelled = false
    fetchSpecies().then((result) => {
      if (cancelled) return
      const found = result.data.find((item) => item.id === speciesId)
      if (found) setSpecies(found)
      else setError(result.error ?? 'This species could not be found.')
    })
    return () => {
      cancelled = true
    }
    // fetchSpecies is a module function, the same on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speciesId, initialSpecies])

  useEffect(() => {
    if (species?.scientific_name) navigation.setOptions({ title: species.scientific_name })
  }, [navigation, species?.scientific_name])

  if (!species) {
    return (
      <View style={styles.centerPadded}>
        {error ? (
          <EmptyState
            icon="cloud-offline-outline"
            message={error}
            action={{ title: 'Back', onPress: () => navigation.goBack() }}
          />
        ) : (
          <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Loading species" />
        )}
      </View>
    )
  }

  // Counted from the botanist's records already loaded this session (Home or Records); left out
  // when they haven't loaded, rather than loading them just for this
  const myPlants = getLoadedMyPlants()
  const myRecordCount = myPlants
    ? myPlants.filter((plant) => plant.species_id === species.id).length
    : null

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <PhotoBanner
        uri={species.reference_photo_url}
        alt={`Reference photo of ${species.scientific_name}`}
        tint={theme.chart.conservationStatus[species.conservation_status]}
        emptyText="No reference photo yet"
      />

      <View style={styles.titleBlock}>
        <ScientificName style={styles.scientificName}>{species.scientific_name}</ScientificName>
        {species.common_name ? <Text style={styles.commonName}>{species.common_name}</Text> : null}
        <Text style={styles.family}>
          {species.family ? `Family: ${species.family}` : 'Family not recorded yet'}
        </Text>
        <ConservationStatusChip status={species.conservation_status} style={styles.chip} />
      </View>

      {myRecordCount != null ? (
        <View style={styles.countCard}>
          <Text style={styles.countLabel}>Your records of this species</Text>
          <Text style={styles.countValue}>{myRecordCount}</Text>
        </View>
      ) : null}

      <TextSection title="Description" text={species.description} />
      <TextSection title="Cultural significance" text={species.cultural_significance} />
    </ScrollView>
  )
}

function TextSection({ title, text }) {
  const value = text?.trim()
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.body, !value && styles.bodyMissing]}>{value || 'Not recorded yet'}</Text>
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
  centerPadded: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  },
  titleBlock: {
    gap: theme.spacing.xs,
  },
  scientificName: {
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
  },
  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textSecondary,
  },
  family: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  chip: {
    marginTop: theme.spacing.sm,
  },
  countCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  countLabel: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  countValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
  },
  card: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    lineHeight: 24,
    color: theme.colors.textPrimary,
  },
  bodyMissing: {
    color: theme.colors.textSecondary,
  },
})

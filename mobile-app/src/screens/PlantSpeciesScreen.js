import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import ConservationStatusChip from '../components/ConservationStatusChip'
import EmptyState from '../components/EmptyState'
import FilterChip from '../components/FilterChip'
import OfflineBanner from '../components/OfflineBanner'
import PlantThumbnail from '../components/PlantThumbnail'
import ScientificName from '../components/ScientificName'
import SkeletonRows from '../components/Skeleton'
import TextInput from '../components/TextInput'
import { useReconnect } from '../hooks/useReconnect'
import { useSpecies } from '../hooks/useSpecies'
import { conservationStatusLabels, conservationStatuses } from '../lib/conservationStatus'
import { formatDateTime } from '../lib/sarawakTime'
import { theme } from '../theme/theme'

// The species catalogue: search by name, filter by conservation status (each status with how
// many of the search's matches have it), pull to refresh. A species opens its detail screen.
export default function PlantSpeciesScreen({ navigation }) {
  const { fetchSpecies } = useSpecies()
  // { data, savedAt, offline } once loaded; kept while reloading. offline: the server couldn't be
  // reached and this is the list saved on the phone (savedAt is when it was downloaded).
  const [result, setResult] = useState(null)
  // { message, offline } when the last load failed with no saved list to fall back on
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  // '' for all, or a conservation_status
  const [status, setStatus] = useState('')

  async function loadSpecies() {
    // Gives up after LOAD_TIMEOUT_MS, so the skeletons never stay up for long
    const nextResult = await fetchSpecies()
    if (nextResult.error) {
      setError({ message: nextResult.error, offline: nextResult.offline })
      // A list already on screen stays, marked as offline
      if (nextResult.offline) setResult((current) => current && { ...current, offline: true })
      return
    }
    setError(null)
    setResult({ data: nextResult.data, savedAt: nextResult.savedAt, offline: nextResult.offline })
  }

  // The focus effect always calls the latest loadSpecies
  const loadRef = useRef(loadSpecies)
  useEffect(() => {
    loadRef.current = loadSpecies
  })

  // Every time the tab comes into view, as before, so new species show up
  useFocusEffect(
    useCallback(() => {
      loadRef.current()
    }, []),
  )

  // Back online: replace the saved list with the server's
  useReconnect(() => loadRef.current())

  async function handleRefresh() {
    setRefreshing(true)
    await loadSpecies()
    setRefreshing(false)
  }

  const keyword = search.trim().toLowerCase()
  const matches = (result?.data ?? []).filter(
    (item) =>
      !keyword ||
      [item.scientific_name, item.common_name].some((name) => name?.toLowerCase().includes(keyword)),
  )
  const counts = Object.fromEntries(
    conservationStatuses.map((value) => [
      value,
      matches.filter((item) => item.conservation_status === value).length,
    ]),
  )
  const shown = status ? matches.filter((item) => item.conservation_status === status) : matches

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search by scientific or common name"
        accessibilityLabel="Search plant species"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      <View style={styles.chips} accessibilityLabel="Filter by conservation status">
        <FilterChip
          label="All"
          count={result ? matches.length : null}
          selected={status === ''}
          onPress={() => setStatus('')}
        />
        {conservationStatuses.map((value) => (
          <FilterChip
            key={value}
            label={conservationStatusLabels[value]}
            count={result ? counts[value] : null}
            color={theme.chart.conservationStatus[value]}
            selected={status === value}
            onPress={() => setStatus(value)}
          />
        ))}
      </View>

      {result?.offline ? (
        <OfflineBanner savedAt={result.savedAt} onRetry={handleRefresh} retrying={refreshing} />
      ) : result?.savedAt ? (
        // The server answered with an error, so the saved list stands in
        <Text style={styles.note}>Showing the list saved on {formatDateTime(result.savedAt)}.</Text>
      ) : null}

      {!result && !error ? <SkeletonRows count={5} label="Loading plant species" /> : null}
      {error && !result ? (
        <EmptyState
          icon="cloud-offline-outline"
          message={
            error.offline
              ? "You're offline. The species list will download when you're back online."
              : error.message
          }
          action={{ title: 'Try again', onPress: handleRefresh }}
        />
      ) : null}
      {error && result && !result.offline ? (
        <Text style={styles.note}>Couldn&apos;t refresh: {error.message}</Text>
      ) : null}

      {result && shown.length === 0 ? (
        <EmptyState
          icon="search-outline"
          message={
            keyword
              ? 'No species match your search.'
              : status
                ? `No ${conservationStatusLabels[status].toLowerCase()} species`
                : 'No species in the database yet.'
          }
        />
      ) : null}

      {shown.length > 0 ? (
        <View style={styles.list}>
          {shown.map((item) => (
            <SpeciesCard
              key={item.id}
              species={item}
              onPress={() => navigation.navigate('SpeciesDetail', { speciesId: item.id, species: item })}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

function SpeciesCard({ species, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Opens the species"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {/* The same public reference photo the web app shows */}
      <PlantThumbnail
        uri={species.reference_photo_url}
        tint={theme.chart.conservationStatus[species.conservation_status]}
      />
      <View style={styles.cardText}>
        <ScientificName style={styles.scientificName}>{species.scientific_name}</ScientificName>
        {species.common_name ? <Text style={styles.commonName}>{species.common_name}</Text> : null}
        <ConservationStatusChip status={species.conservation_status} style={styles.chip} />
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
    </Pressable>
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  note: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  list: {
    gap: theme.spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  cardText: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  scientificName: {
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  chip: {
    marginTop: theme.spacing.xs,
  },
})

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Ionicons from '@expo/vector-icons/Ionicons'
import EmptyState from '../components/EmptyState'
import HeaderBand from '../components/HeaderBand'
import PlantThumbnail from '../components/PlantThumbnail'
import ReviewStatusChip from '../components/ReviewStatusChip'
import ScanTagModal from '../components/ScanTagModal'
import ScientificName from '../components/ScientificName'
import SkeletonRows, { SkeletonBlock, SkeletonGroup } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { useSync } from '../context/SyncContext'
import { usePlants } from '../hooks/usePlants'
import { useSpecies } from '../hooks/useSpecies'
import { reviewStatuses, reviewStatusLabels, reviewStatusShortLabels } from '../lib/reviewStatus'
import { formatLongDate, formatRelativeTime, greetingFor } from '../lib/sarawakTime'
import { theme } from '../theme/theme'

const RECENT_COUNT = 3
const THUMBNAIL_SIZE = 56
// The status count tiles, and their loading placeholders, so nothing moves when they load
const SUMMARY_TILE_HEIGHT = 96

// The botanist's start screen: a greeting, counts of their own records by review status, shortcuts
// and their latest records. It reloads whenever it comes back into view (e.g. after registering a
// plant) and when queued records finish syncing, and on pull to refresh.
export default function BotanistHomeScreen({ navigation }) {
  const { fullName } = useAuth()
  const { fetchMyPlants } = usePlants()
  const { fetchSpecies } = useSpecies()
  const { syncedVersion } = useSync()
  // { plants, speciesById } once loaded; kept while reloading so the screen doesn't blank out
  const [data, setData] = useState(null)
  // The last load's error message, or null
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  // When the data was loaded, for the greeting and the relative times
  const [now, setNow] = useState(() => Date.now())

  async function load() {
    // The species list falls back to the copy saved on the phone when offline, so names still
    // show; without it the records just read "Unknown species"
    const [plantsResult, speciesResult] = await Promise.all([fetchMyPlants(), fetchSpecies()])
    setNow(Date.now())
    if (plantsResult.error) {
      setError(plantsResult.error)
      return
    }
    setError(null)
    setData({
      plants: plantsResult.data,
      speciesById: new Map(speciesResult.data.map((species) => [species.id, species])),
    })
  }

  // The focus and sync effects below always call the latest load
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useFocusEffect(
    useCallback(() => {
      loadRef.current()
    }, []),
  )

  const firstSyncedVersion = useRef(syncedVersion)
  useEffect(() => {
    if (syncedVersion !== firstSyncedVersion.current) loadRef.current()
  }, [syncedVersion])

  async function handleRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const firstName = fullName?.trim().split(/\s+/)[0]
  const greeting = greetingFor(now)
  const plants = data?.plants ?? []
  const counts = Object.fromEntries(
    reviewStatuses.map((status) => [status, plants.filter((plant) => plant.review_status === status).length]),
  )

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <HeaderBand
        safeTop
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        subtitle={formatLongDate(now)}
      />

      <View style={styles.content}>
        {/* Counts of the botanist's own records; each opens Records filtered to that status */}
        {data ? (
          <View style={styles.summaryRow}>
            {reviewStatuses.map((status) => (
              <SummaryTile
                key={status}
                status={status}
                count={counts[status]}
                onPress={() => navigation.navigate('MyRecords', { status })}
              />
            ))}
          </View>
        ) : !error ? (
          <SkeletonGroup label="Loading your record counts" style={styles.summaryRow}>
            {reviewStatuses.map((status) => (
              <View key={status} style={styles.summarySkeleton}>
                <SkeletonBlock height={SUMMARY_TILE_HEIGHT} radius={theme.radius} />
              </View>
            ))}
          </SkeletonGroup>
        ) : null}

        <Pressable
          onPress={() => navigation.navigate('FieldRegistration')}
          accessibilityRole="button"
          accessibilityLabel="Register a plant"
          accessibilityHint="Record a new plant with its species, photo and location"
          style={({ pressed }) => [styles.registerTile, pressed && styles.pressed]}
        >
          <View style={styles.registerIcon}>
            <Ionicons name="add" size={28} color={theme.colors.primary} />
          </View>
          <View style={styles.registerText}>
            <Text style={styles.registerTitle}>Register a plant</Text>
            <Text style={styles.registerDescription}>Species, photo and GPS location</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.surfaceWhite} />
        </Pressable>

        <View style={styles.tiles}>
          <Tile icon="list-outline" label="My records" onPress={() => navigation.navigate('MyRecords')} />
          <Tile icon="leaf-outline" label="Species" onPress={() => navigation.navigate('PlantSpecies')} />
          <Tile icon="qr-code-outline" label="Scan tag" onPress={() => setScanOpen(true)} />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Recent records
            </Text>
            {plants.length > 0 ? (
              <Pressable
                onPress={() => navigation.navigate('MyRecords')}
                accessibilityRole="button"
                hitSlop={theme.spacing.md}
              >
                <Text style={styles.link}>View all</Text>
              </Pressable>
            ) : null}
          </View>

          {!data && !error ? <SkeletonRows count={RECENT_COUNT} label="Loading your recent records" /> : null}
          {error && !data ? (
            <EmptyState
              icon="cloud-offline-outline"
              message={error}
              action={{ title: 'Try again', onPress: handleRefresh }}
            />
          ) : null}
          {error && data ? (
            <Text style={styles.staleNote} accessibilityLiveRegion="polite">
              Couldn&apos;t refresh: {error}
            </Text>
          ) : null}
          {data && plants.length === 0 ? (
            <EmptyState
              icon="leaf-outline"
              message="You haven't registered any plants yet. Your records will show here."
              action={{ title: 'Register a plant', onPress: () => navigation.navigate('FieldRegistration') }}
            />
          ) : null}
          {plants.length > 0 ? (
            <View style={styles.card}>
              {plants.slice(0, RECENT_COUNT).map((plant, index) => (
                <RecentRecord
                  key={plant.id}
                  plant={plant}
                  species={data.speciesById.get(plant.species_id)}
                  now={now}
                  first={index === 0}
                  onPress={() => navigation.navigate('RecordDetail', { plantId: plant.id, plant })}
                />
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {scanOpen ? (
        <ScanTagModal
          onClose={() => setScanOpen(false)}
          onViewRecord={(plant) => {
            setScanOpen(false)
            navigation.navigate('RecordDetail', { plantId: plant.id, plant })
          }}
        />
      ) : null}
    </ScrollView>
  )
}

// One status count as a mini tile (a bar in the status colour, the number, the label under it).
// Opens Records filtered to that status. Three share a row equally.
function SummaryTile({ status, count, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${reviewStatusLabels[status]}: ${count}`}
      accessibilityHint="Shows these records"
      style={({ pressed }) => [styles.summaryTile, pressed && styles.pressed]}
    >
      <View style={[styles.summaryAccent, { backgroundColor: theme.chart.reviewStatus[status] }]} />
      <Text style={styles.summaryCount}>{count}</Text>
      <Text style={styles.summaryLabel}>{reviewStatusShortLabels[status]}</Text>
    </Pressable>
  )
}

function Tile({ icon, label, onPress }) {
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

function RecentRecord({ plant, species, now, first, onPress }) {
  const name = species?.scientific_name ?? 'Unknown species'
  const ago = formatRelativeTime(plant.recorded_at, now)

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${reviewStatusLabels[plant.review_status] ?? plant.review_status}, recorded ${ago}`}
      accessibilityHint="Opens the record"
      style={({ pressed }) => [styles.recordRow, !first && styles.recordDivider, pressed && styles.pressed]}
    >
      <PlantThumbnail photoPath={plant.photo_url} size={THUMBNAIL_SIZE} />
      <View style={styles.recordText}>
        {species ? (
          <ScientificName style={styles.recordName}>
            {name}
          </ScientificName>
        ) : (
          <Text style={[styles.recordName, styles.recordNameUnknown]}>{name}</Text>
        )}
        <View style={styles.recordMeta}>
          <ReviewStatusChip status={plant.review_status} />
          <Text style={styles.recordTime}>{ago}</Text>
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  scrollContent: {
    paddingBottom: theme.spacing.xxl,
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xl,
  },
  pressed: {
    opacity: 0.8,
  },

  summaryRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  summaryTile: {
    flex: 1,
    minHeight: SUMMARY_TILE_HEIGHT,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWhite,
  },
  summarySkeleton: {
    flex: 1,
  },
  // A short bar in the status colour across the top of the tile
  summaryAccent: {
    width: theme.spacing.xl,
    height: theme.spacing.xs,
    borderRadius: theme.spacing.xs / 2,
    marginBottom: theme.spacing.xs,
  },
  summaryCount: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading1.fontSize,
    color: theme.colors.textPrimary,
  },
  summaryLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },

  registerTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    padding: theme.spacing.xl,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.primary,
  },
  registerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceWhite,
  },
  registerText: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  registerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.surfaceWhite,
  },
  registerDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.surfaceWhite,
  },

  tiles: {
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

  section: {
    gap: theme.spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  link: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.primary,
  },
  staleNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },

  card: {
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  recordDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  recordText: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  recordName: {
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  recordNameUnknown: {
    fontFamily: 'Inter_400Regular',
  },
  recordMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  recordTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
})

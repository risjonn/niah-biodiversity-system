import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Ionicons from '@expo/vector-icons/Ionicons'
import EmptyState from '../components/EmptyState'
import HeaderBand from '../components/HeaderBand'
import OfflineBanner from '../components/OfflineBanner'
import PlantThumbnail from '../components/PlantThumbnail'
import ReviewStatusChip from '../components/ReviewStatusChip'
import ScanTagModal from '../components/ScanTagModal'
import ScientificName from '../components/ScientificName'
import SkeletonRows, { SkeletonBlock, SkeletonGroup } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { useSync } from '../context/SyncContext'
import { countPlantPhotos } from '../hooks/usePlantPhoto'
import { usePlants } from '../hooks/usePlants'
import { useReconnect } from '../hooks/useReconnect'
import { useSpecies } from '../hooks/useSpecies'
import { queuedRecordAsPlant } from '../lib/queuedRecord'
import { reviewStatuses, reviewStatusLabels, reviewStatusShortLabels } from '../lib/reviewStatus'
import { isStaffRole, roleLabels } from '../lib/roles'
import { formatLongDate, formatRelativeTime, greetingFor } from '../lib/sarawakTime'
import { theme } from '../theme/theme'

const RECENT_COUNT = 3
const THUMBNAIL_SIZE = 56
// The status count tiles, and their loading placeholders, so nothing moves when they load
const SUMMARY_TILE_HEIGHT = 96

// The field app's start screen (every role): a greeting, counts of the user's own records by
// review status, shortcuts and their latest records. Conservation officers and admins also see
// their role as a chip on the band. It reloads whenever it comes back into view (e.g. after registering a
// plant) and when queued records finish syncing, and on pull to refresh.
export default function BotanistHomeScreen({ navigation }) {
  const { fullName, role } = useAuth()
  const { fetchMyPlants } = usePlants()
  const { fetchSpecies } = useSpecies()
  const { records, syncedVersion } = useSync()
  // { plants, speciesById, offline, savedAt } once loaded; kept while reloading so the screen
  // doesn't blank out. Offline, plants are the ones saved on the phone (savedAt is when they
  // loaded), or none (savedAt null) if nothing was saved.
  const [data, setData] = useState(null)
  // How many photos each recent record has, by plant id
  const [photoCounts, setPhotoCounts] = useState({})
  // The last load's error message, or null
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  // When the data was loaded, for the greeting and the relative times
  const [now, setNow] = useState(() => Date.now())

  async function load() {
    // The species list falls back to the copy saved on the phone when offline, so names still
    // show; without it the records just read "Unknown species"
    // Both give up after LOAD_TIMEOUT_MS, so the skeletons never stay up for long
    const [plantsResult, speciesResult] = await Promise.all([fetchMyPlants(), fetchSpecies()])
    setNow(Date.now())
    if (plantsResult.error && !plantsResult.offline) {
      setError(plantsResult.error)
      return
    }
    setError(null)
    setData({
      plants: plantsResult.data,
      speciesById: new Map(speciesResult.data.map((species) => [species.id, species])),
      offline: plantsResult.offline,
      savedAt: plantsResult.savedAt ?? null,
    })
    if (plantsResult.offline) return
    // The "+2" badges for the recent records, from one batched count; covers show without them
    const counts = await countPlantPhotos(
      plantsResult.data.slice(0, RECENT_COUNT).map((plant) => plant.id),
    )
    setPhotoCounts(counts.data)
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

  // Back online: replace the saved data with the server's
  useReconnect(() => loadRef.current())

  async function handleRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const firstName = fullName?.trim().split(/\s+/)[0]
  const greeting = greetingFor(now)
  // Records on the phone count too, as in Records: those waiting to sync (pending review once
  // saved), and synced ones the server list doesn't have yet (e.g. offline)
  const unsynced = records.filter((record) => record.status !== 'synced')
  const unsyncedIds = new Set(unsynced.map((record) => record.id))
  const serverPlants = (data?.plants ?? []).filter((plant) => !unsyncedIds.has(plant.id))
  const serverIds = new Set(serverPlants.map((plant) => plant.id))
  const plants = [
    ...records
      .filter((record) => record.status === 'synced' && !serverIds.has(record.id))
      .map(queuedRecordAsPlant),
    ...serverPlants,
  ].sort(byNewest)
  const counts = Object.fromEntries(
    reviewStatuses.map((status) => [status, plants.filter((plant) => plant.review_status === status).length]),
  )
  counts.pending_review += unsynced.length

  const offline = data?.offline === true
  // Offline with nothing saved on the phone and nothing queued: nothing to show at all
  const offlineEmpty = offline && !data.savedAt && plants.length === 0 && unsynced.length === 0

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
      >
        {isStaffRole(role) ? (
          <View style={styles.roleChip}>
            <Text style={styles.roleChipText}>{roleLabels[role]}</Text>
          </View>
        ) : null}
      </HeaderBand>

      <View style={styles.content}>
        {offline && !offlineEmpty ? (
          <OfflineBanner savedAt={data.savedAt} onRetry={handleRefresh} retrying={refreshing} />
        ) : null}

        {/* Counts of the botanist's own records; each opens Records filtered to that status */}
        {data && !offlineEmpty ? (
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
        ) : !data && !error ? (
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
          {unsynced.length > 0 ? (
            <Pressable
              onPress={() => navigation.navigate('MyRecords')}
              accessibilityRole="button"
              accessibilityHint="Opens My Records"
              style={({ pressed }) => [styles.queueNote, pressed && styles.pressed]}
            >
              <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.queueNoteText}>
                {unsynced.length === 1 ? '1 record' : `${unsynced.length} records`} waiting to sync
                {offline ? " when you're back online" : ''}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          ) : null}
          {offlineEmpty ? (
            <EmptyState
              icon="cloud-offline-outline"
              message="You're offline. You can still register plants; they'll sync when you're back online."
              action={{ title: 'Register a plant', onPress: () => navigation.navigate('FieldRegistration') }}
            />
          ) : null}
          {data && !offlineEmpty && plants.length === 0 && unsynced.length === 0 ? (
            <EmptyState
              icon="leaf-outline"
              message="You haven't registered any plants yet. Your records will show here."
              action={{ title: 'Register a plant', onPress: () => navigation.navigate('FieldRegistration') }}
            />
          ) : null}
          {data && plants.length > 0 ? (
            <View style={styles.card}>
              {plants.slice(0, RECENT_COUNT).map((plant, index) => (
                <RecentRecord
                  key={plant.id}
                  plant={plant}
                  photoCount={photoCounts[plant.id] ?? 0}
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

function byNewest(a, b) {
  return new Date(b.recorded_at) - new Date(a.recorded_at)
}

function RecentRecord({ plant, photoCount, species: listedSpecies, now, first, onPress }) {
  // A record from the queue carries the species name it was saved with, for when the species list
  // isn't on the phone
  const species =
    listedSpecies ??
    (plant.species_scientific_name ? { scientific_name: plant.species_scientific_name } : undefined)
  const name = species?.scientific_name ?? 'Unknown species'
  const ago = formatRelativeTime(plant.recorded_at, now)
  const photos = photoCount > 1 ? `, ${photoCount} photos` : ''

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${reviewStatusLabels[plant.review_status] ?? plant.review_status}, recorded ${ago}${photos}`}
      accessibilityHint="Opens the record"
      style={({ pressed }) => [styles.recordRow, !first && styles.recordDivider, pressed && styles.pressed]}
    >
      <PlantThumbnail photoPath={plant.photo_url} size={THUMBNAIL_SIZE} count={photoCount} />
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
  // White on the primary band, with the primary colour as text (about 6.9:1)
  roleChip: {
    alignSelf: 'flex-start',
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius * 2,
    backgroundColor: theme.colors.surfaceWhite,
  },
  roleChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.primary,
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
  queueNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.buttonHeight,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWhite,
  },
  queueNoteText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
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

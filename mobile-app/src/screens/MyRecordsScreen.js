import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import FilterChip from '../components/FilterChip'
import OfflineBanner from '../components/OfflineBanner'
import PlantThumbnail from '../components/PlantThumbnail'
import ReviewStatusChip from '../components/ReviewStatusChip'
import ScientificName from '../components/ScientificName'
import SkeletonRows from '../components/Skeleton'
import SyncStatusChip from '../components/SyncStatusChip'
import { useSync } from '../context/SyncContext'
import { countPlantPhotos } from '../hooks/usePlantPhoto'
import { usePlants } from '../hooks/usePlants'
import { useReconnect } from '../hooks/useReconnect'
import { useSpecies } from '../hooks/useSpecies'
import { queuedCoverUri, queuedRecordAsPlant } from '../lib/queuedRecord'
import { reviewStatuses, reviewStatusShortLabels } from '../lib/reviewStatus'
import { formatRelativeTime } from '../lib/sarawakTime'
import { theme } from '../theme/theme'

const SYNC_STOPPED_MESSAGE =
  "Couldn't reach the server. The records will sync automatically when you're back online."

// 'all' or a review_status
const FILTERS = ['all', ...reviewStatuses]
const FILTER_LABELS = { all: 'All', ...reviewStatusShortLabels }
const EMPTY_MESSAGES = {
  all: "You haven't registered any plants yet. Your records will show here.",
  pending_review: 'No pending records',
  approved: 'No approved records',
  rejected: 'No rejected records',
}

// The botanist's own records, filtered by review status. Records still on the phone (waiting to
// sync, or synced but not yet in the server's list) are included too.
//
// Home's status tiles open this tab with a `status` route param. The tab stays mounted, so the
// param is applied whenever it changes and then cleared: tapping the same status again later is
// a change again, and tapping the tab itself (no param) keeps the last chosen filter.
export default function MyRecordsScreen({ navigation, route }) {
  const { fetchMyPlants } = usePlants()
  const { fetchSpecies } = useSpecies()
  const { records, syncing, syncedVersion, syncNow, retry, discard, markShown } = useSync()

  const [plants, setPlants] = useState([])
  // How many photos each server record has, by plant id, for the "+2" badge
  const [photoCounts, setPhotoCounts] = useState({})
  const [speciesById, setSpeciesById] = useState(() => new Map())
  // True until the server records have loaded once
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // { message } when the server refused to load the records
  const [error, setError] = useState(null)
  // { savedAt } when the server couldn't be reached and `plants` are the ones saved on the phone
  // (savedAt null if none were saved)
  const [offline, setOffline] = useState(null)
  const [syncMessage, setSyncMessage] = useState(null)
  // Records being retried or discarded, so their buttons can't be pressed twice
  const [busyIds, setBusyIds] = useState([])
  const [filter, setFilter] = useState('all')
  // When the records were loaded, for the relative times
  const [now, setNow] = useState(() => Date.now())

  // The status asked for by Home, applied while rendering so the right filter shows straight away
  const requestedStatus = route.params?.status
  const [seenRequest, setSeenRequest] = useState(undefined)
  if (requestedStatus !== seenRequest) {
    setSeenRequest(requestedStatus)
    if (requestedStatus !== undefined) {
      setFilter(FILTERS.includes(requestedStatus) ? requestedStatus : 'all')
    }
  }
  // ...and then cleared, so the next request is a change even if it asks for the same status
  useEffect(() => {
    if (requestedStatus !== undefined) navigation.setParams({ status: undefined })
  }, [requestedStatus, navigation])

  async function loadRecords() {
    setError(null)
    // Both give up after LOAD_TIMEOUT_MS, so the skeletons never stay up for long. Offline, the
    // records saved on the phone come back instead.
    const [plantsResult, speciesResult] = await Promise.all([fetchMyPlants(), fetchSpecies()])
    setNow(Date.now())
    if (plantsResult.error && !plantsResult.offline) {
      setError({ message: plantsResult.error })
    } else {
      setPlants(plantsResult.data)
      // The species list falls back to the copy saved on the phone; without it names read
      // "Unknown species"
      setSpeciesById(new Map(speciesResult.data.map((species) => [species.id, species])))
    }
    setOffline(plantsResult.offline ? { savedAt: plantsResult.savedAt ?? null } : null)
    setLoading(false)
    // The badges come after the list, from one batched count; without them the covers still show
    if (!plantsResult.error && !plantsResult.offline) {
      const counts = await countPlantPhotos(plantsResult.data.map((plant) => plant.id))
      setPhotoCounts(counts.data)
    }
  }

  // The effects below always call the latest loadRecords
  const loadRef = useRef(loadRecords)
  useEffect(() => {
    loadRef.current = loadRecords
  })

  // Every time the tab comes into view, so review decisions made meanwhile show up
  useFocusEffect(
    useCallback(() => {
      loadRef.current()
    }, []),
  )

  // Records that sync while this screen is open move from the queue to the server list
  const openedAtSyncedVersion = useRef(syncedVersion)
  useEffect(() => {
    if (syncedVersion !== openedAtSyncedVersion.current) loadRef.current()
  }, [syncedVersion])

  // Back online: replace the saved records with the server's
  useReconnect(() => loadRef.current())

  async function handleRefresh() {
    setRefreshing(true)
    await loadRecords()
    setRefreshing(false)
  }

  const unsynced = records.filter((record) => record.status !== 'synced')
  // A record whose plant is saved but whose photos aren't added yet is already in the server list;
  // it shows only in the queue until it has finished
  const unsyncedIds = new Set(unsynced.map((record) => record.id))
  const serverPlants = plants.filter((plant) => !unsyncedIds.has(plant.id))
  const serverIds = new Set(plants.map((plant) => plant.id))
  // Synced records not in the server list yet, e.g. while offline: shown from the queue so the
  // botanist still has their QR codes
  const recentlySynced = records.filter(
    (record) => record.status === 'synced' && !serverIds.has(record.id),
  )
  const syncedIdsInServerList = records
    .filter((record) => record.status === 'synced' && serverIds.has(record.id))
    .map((record) => record.id)
    .join(',')

  // Once a synced record shows in the server list, the queue doesn't need it any more
  useEffect(() => {
    if (syncedIdsInServerList) markShown(syncedIdsInServerList.split(','))
  }, [syncedIdsInServerList, markShown])

  // QR codes shown from the queue count as seen when the botanist leaves the tab, so the record
  // doesn't vanish while they're reading it
  const shownFromQueue = useRef(new Set())
  useEffect(() => {
    recentlySynced.forEach((record) => shownFromQueue.current.add(record.id))
  })
  useFocusEffect(
    useCallback(() => {
      const shown = shownFromQueue.current
      return () => {
        if (shown.size > 0) markShown([...shown])
        shown.clear()
      }
    }, [markShown]),
  )

  // Synced records from the queue, shaped like server rows. They are saved, so pending review.
  const queuedAsPlants = recentlySynced.map(queuedRecordAsPlant)
  const allRecords = [...queuedAsPlants, ...serverPlants].sort(byNewest)
  const counts = {
    all: allRecords.length + unsynced.length,
    // Records waiting to sync will be pending review once they're saved
    pending_review:
      allRecords.filter((plant) => plant.review_status === 'pending_review').length + unsynced.length,
    approved: allRecords.filter((plant) => plant.review_status === 'approved').length,
    rejected: allRecords.filter((plant) => plant.review_status === 'rejected').length,
  }
  const shown = filter === 'all' ? allRecords : allRecords.filter((plant) => plant.review_status === filter)
  const showQueue = unsynced.length > 0 && (filter === 'all' || filter === 'pending_review')

  async function handleSyncNow() {
    setSyncMessage(null)
    const result = await syncNow()
    if (!result) {
      setSyncMessage("Couldn't sync. Try again.")
    } else if (result.stopped) {
      setSyncMessage(SYNC_STOPPED_MESSAGE)
    }
  }

  async function withBusy(id, task) {
    setBusyIds((ids) => [...ids, id])
    try {
      await task()
    } finally {
      setBusyIds((ids) => ids.filter((busyId) => busyId !== id))
    }
  }

  function handleRetry(record) {
    setSyncMessage(null)
    withBusy(record.id, async () => {
      const result = await retry(record.id)
      if (result?.stopped) setSyncMessage(SYNC_STOPPED_MESSAGE)
    })
  }

  function handleDiscard(record) {
    Alert.alert(
      'Discard record',
      record.plant_saved
        ? `The ${record.species_scientific_name} record is already saved as ${record.qr_code}, so it stays in your records without the photos that couldn't be added. Discard those photos from this phone?`
        : `Discard this ${record.species_scientific_name} record? It hasn't been saved to the server and will be deleted from this phone, with its photos.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => withBusy(record.id, () => discard(record.id)),
        },
      ],
    )
  }

  function openRecord(plant) {
    navigation.navigate('RecordDetail', { plantId: plant.id, plant })
  }

  const hasAnything = allRecords.length > 0 || unsynced.length > 0
  // Offline with no records saved on the phone and none queued
  const offlineEmpty = offline !== null && !offline.savedAt && !hasAnything

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      {offline && !offlineEmpty ? (
        <OfflineBanner savedAt={offline.savedAt} onRetry={handleRefresh} retrying={refreshing} />
      ) : null}

      <View style={styles.chips} accessibilityLabel="Filter by review status">
        {FILTERS.map((value) => (
          <FilterChip
            key={value}
            label={FILTER_LABELS[value]}
            // No counts until the server records have loaded, since they'd be too low
            count={loading ? null : counts[value]}
            color={value === 'all' ? undefined : theme.chart.reviewStatus[value]}
            selected={filter === value}
            onPress={() => setFilter(value)}
          />
        ))}
      </View>

      {showQueue ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Waiting to sync
          </Text>
          {unsynced.map((record) => (
            <QueuedRecordCard
              key={record.id}
              record={record}
              now={now}
              busy={busyIds.includes(record.id)}
              onRetry={() => handleRetry(record)}
              onDiscard={() => handleDiscard(record)}
            />
          ))}
          {syncMessage ? <Text style={styles.note}>{syncMessage}</Text> : null}
          <Button
            title={syncing ? 'Syncing…' : 'Sync now'}
            variant="secondary"
            onPress={handleSyncNow}
            disabled={syncing}
          />
        </View>
      ) : null}

      {loading && !error ? <SkeletonRows count={4} label="Loading your records" /> : null}

      {error && !hasAnything ? (
        <EmptyState
          icon="cloud-offline-outline"
          message={error.message}
          action={{ title: 'Try again', onPress: handleRefresh }}
        />
      ) : null}
      {error && hasAnything ? (
        <View style={styles.errorNote}>
          <Text style={styles.note}>{error.message}</Text>
          <Button title="Try again" variant="secondary" onPress={handleRefresh} />
        </View>
      ) : null}

      {offlineEmpty ? (
        <EmptyState
          icon="cloud-offline-outline"
          message="You're offline. You can still register plants; they'll sync when you're back online."
          action={{ title: 'Register a plant', onPress: () => navigation.navigate('FieldRegistration') }}
        />
      ) : null}

      {!loading && !error && !offlineEmpty && shown.length === 0 && !showQueue ? (
        <EmptyState
          icon={filter === 'rejected' ? 'checkmark-circle-outline' : 'leaf-outline'}
          message={EMPTY_MESSAGES[filter]}
          action={
            filter === 'all'
              ? { title: 'Register a plant', onPress: () => navigation.navigate('FieldRegistration') }
              : undefined
          }
        />
      ) : null}

      {shown.length > 0 ? (
        <View style={styles.list}>
          {shown.map((plant) => (
            <RecordCard
              key={plant.id}
              plant={plant}
              photoCount={photoCounts[plant.id] ?? 0}
              species={speciesById.get(plant.species_id)}
              now={now}
              onPress={() => openRecord(plant)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

function byNewest(a, b) {
  return new Date(b.recorded_at) - new Date(a.recorded_at)
}

// One saved record: thumbnail, species, status, QR code and when it was recorded. Opens the
// record's detail screen.
function RecordCard({ plant, photoCount, species, now, onPress }) {
  const scientificName = species?.scientific_name ?? plant.species_scientific_name
  const commonName = species?.common_name ?? plant.species_common_name
  const ago = formatRelativeTime(plant.recorded_at, now)

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Opens the record"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <PlantThumbnail photoPath={plant.photo_url} count={photoCount} />
      <View style={styles.cardText}>
        {scientificName ? (
          <ScientificName style={styles.scientificName}>{scientificName}</ScientificName>
        ) : (
          <Text style={[styles.scientificName, styles.unknown]}>Unknown species</Text>
        )}
        {commonName ? <Text style={styles.commonName}>{commonName}</Text> : null}
        <View style={styles.meta}>
          <ReviewStatusChip status={plant.review_status} />
          <Text style={styles.metaText} selectable>
            {plant.qr_code}
          </Text>
        </View>
        {/* On its own line on every card, so the cards line up */}
        <Text style={styles.metaText}>{ago}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
    </Pressable>
  )
}

// A record still on the phone. It has no review status yet, so it shows its sync state instead;
// one that couldn't sync gets the reason with Try again and Discard. A record whose plant is
// already saved (only its photos are left) shows its QR code too, so the plant can be tagged.
function QueuedRecordCard({ record, now, busy, onRetry, onDiscard }) {
  const failed = record.status === 'failed'

  return (
    <View style={styles.queuedCard}>
      <View style={styles.queuedRow}>
        <PlantThumbnail uri={queuedCoverUri(record)} count={record.photos?.length ?? 0} />
        <View style={styles.cardText}>
          <ScientificName style={styles.scientificName}>{record.species_scientific_name}</ScientificName>
          {record.species_common_name ? (
            <Text style={styles.commonName}>{record.species_common_name}</Text>
          ) : null}
          <View style={styles.meta}>
            <SyncStatusChip status={record.status} />
            {record.plant_saved && record.qr_code ? (
              <Text style={styles.metaText} selectable>
                {record.qr_code}
              </Text>
            ) : null}
          </View>
          <Text style={styles.metaText}>{formatRelativeTime(record.recorded_at, now)}</Text>
        </View>
      </View>
      {failed ? (
        <>
          <View style={styles.failure}>
            <Text style={styles.failureText}>{record.error_message}</Text>
          </View>
          <View style={styles.queueActions}>
            <View style={styles.queueAction}>
              <Button title="Try again" variant="secondary" onPress={onRetry} disabled={busy} />
            </View>
            <View style={styles.queueAction}>
              <Button title="Discard" variant="secondary" onPress={onDiscard} disabled={busy} />
            </View>
          </View>
        </>
      ) : null}
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  section: {
    gap: theme.spacing.md,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  note: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },
  errorNote: {
    gap: theme.spacing.md,
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
  unknown: {
    fontFamily: 'Inter_400Regular',
  },
  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  metaText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
  queuedCard: {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  queuedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  failure: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
  },
  failureText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 20,
    color: theme.colors.textPrimary,
  },
  queueActions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  queueAction: {
    flex: 1,
  },
})

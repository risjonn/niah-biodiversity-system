import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Button from '../components/Button'
import ScientificName from '../components/ScientificName'
import { useSync } from '../context/SyncContext'
import { usePlants } from '../hooks/usePlants'
import { useSpecies } from '../hooks/useSpecies'
import { theme } from '../theme/theme'
import { usePlantPhoto } from '../hooks/usePlantPhoto'

const SYNC_STOPPED_MESSAGE =
  "Couldn't reach the server. The records will sync automatically when you're back online."

export default function MyRecordsScreen() {
  const { fetchMyPlants } = usePlants()
  const { fetchSpecies } = useSpecies()
  const { records, syncing, syncedVersion, syncNow, retry, discard, markShown } = useSync()

  const [plants, setPlants] = useState([])
  const [species, setSpecies] = useState([])
  const [loading, setLoading] = useState(true)
  // { message, offline } when the server records couldn't be loaded
  const [error, setError] = useState(null)
  const [syncMessage, setSyncMessage] = useState(null)
  // Records being retried or discarded, so their buttons can't be pressed twice
  const [busyIds, setBusyIds] = useState([])

  useEffect(() => {
    loadRecords()
  }, [])

  // Records that sync while this screen is open move from the queue to the server list
  const openedAtSyncedVersion = useRef(syncedVersion)
  useEffect(() => {
    if (syncedVersion !== openedAtSyncedVersion.current) loadRecords({ quiet: true })
  }, [syncedVersion])

  async function loadRecords({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    setError(null)

    const [plantsResult, speciesResult] = await Promise.all([
      fetchMyPlants(),
      fetchSpecies(),
    ])

    if (plantsResult.error) {
      setError({ message: plantsResult.error, offline: !plantsResult.code })
      setPlants([])
      setLoading(false)
      return
    }

    if (speciesResult.error) {
      setError({ message: speciesResult.error, offline: false })
      setPlants([])
      setLoading(false)
      return
    }

    setPlants(plantsResult.data)
    setSpecies(speciesResult.data)
    setLoading(false)
  }

  function getSpecies(plant) {
    return species.find((item) => item.id === plant.species_id)
  }

  const serverIds = new Set(plants.map((plant) => plant.id))
  const unsynced = records.filter((record) => record.status !== 'synced')
  // Synced records not in the server list yet, e.g. while offline: shown from the queue so the
  // botanist still has their QR codes
  const recentlySynced = records.filter(
    (record) => record.status === 'synced' && !serverIds.has(record.id),
  )
  const hasQueue = unsynced.length > 0 || recentlySynced.length > 0
  const syncedIdsInServerList = records
    .filter((record) => record.status === 'synced' && serverIds.has(record.id))
    .map((record) => record.id)
    .join(',')

  // Once a synced record shows in the server list, the queue doesn't need it any more
  useEffect(() => {
    if (syncedIdsInServerList) markShown(syncedIdsInServerList.split(','))
  }, [syncedIdsInServerList, markShown])

  // QR codes shown from the queue count as seen when the botanist leaves the screen, so the
  // record doesn't vanish while they're reading it
  const shownFromQueue = useRef(new Set())
  useEffect(() => {
    recentlySynced.forEach((record) => shownFromQueue.current.add(record.id))
  })
  useEffect(() => {
    const shown = shownFromQueue.current
    return () => markShown([...shown])
  }, [markShown])

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
      `Discard this ${record.species_scientific_name} record? It hasn't been saved to the server and will be deleted from this phone.`,
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

  if (loading && !hasQueue) {
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

  if (error && !hasQueue) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Unable to load records</Text>
        <Text style={styles.errorText}>{error.message}</Text>

        <Pressable style={styles.retryButton} onPress={() => loadRecords()}>
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

      {unsynced.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Waiting to sync</Text>
          {unsynced.map((record) => (
            <QueuedRecordCard
              key={record.id}
              record={record}
              busy={busyIds.includes(record.id)}
              onRetry={() => handleRetry(record)}
              onDiscard={() => handleDiscard(record)}
            />
          ))}
          {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}
          <Button
            title={syncing ? 'Syncing…' : 'Sync now'}
            variant="secondary"
            onPress={handleSyncNow}
            disabled={syncing}
          />
        </View>
      ) : null}

      {recentlySynced.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Synced from this phone</Text>
          {recentlySynced.map((record) => (
            <QueuedRecordCard key={record.id} record={record} />
          ))}
        </View>
      ) : null}

      {hasQueue && (loading || error) ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Synced records</Text>
          {loading ? (
            <View style={styles.inlineStatus}>
              <ActivityIndicator
                color={theme.colors.primary}
                accessibilityLabel="Loading plant records"
              />
              <Text style={styles.loadingText}>Loading your records…</Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {error.offline
                  ? "Your synced records can't be loaded while you're offline."
                  : error.message}
              </Text>
              <Button title="Try again" variant="secondary" onPress={() => loadRecords()} />
            </View>
          )}
        </View>
      ) : null}

      {loading || error || (plants.length === 0 && hasQueue) ? null : plants.length === 0 ? (
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
              />
            )
          })}
        </View>
      )}

      {plants.length > 0 ? (
        <Pressable style={styles.refreshButton} onPress={() => loadRecords()}>
          <Text style={styles.refreshText}>Refresh Records</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

const QUEUE_STATUS_LABELS = {
  pending: 'Waiting to sync',
  syncing: 'Syncing…',
  failed: "Couldn't sync",
  synced: 'Synced',
}

const QUEUE_STATUS_COLORS = {
  pending: theme.colors.alert,
  syncing: theme.colors.primary,
  failed: theme.colors.error,
  synced: theme.colors.success,
}

// A record from the phone's queue. Failed records get Try again and Discard.
function QueuedRecordCard({ record, busy = false, onRetry, onDiscard }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.speciesContainer}>
          <ScientificName style={styles.queuedScientificName}>
            {record.species_scientific_name}
          </ScientificName>
          {record.species_common_name ? (
            <Text style={styles.commonName}>{record.species_common_name}</Text>
          ) : null}
        </View>

        <Text style={[styles.statusText, { color: QUEUE_STATUS_COLORS[record.status] }]}>
          {QUEUE_STATUS_LABELS[record.status]}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.details}>
        {record.height_cm != null ? (
          <DetailRow label="Height" value={`${record.height_cm} cm`} />
        ) : null}
        {record.location_description ? (
          <DetailRow label="Location" value={record.location_description} />
        ) : null}
        {/* With the time, so two records of the same species can be told apart */}
        <DetailRow label="Recorded" value={formatDateTime(record.recorded_at)} />
        {record.status === 'synced' ? (
          <DetailRow label="QR Code" value={record.qr_code} selectable />
        ) : null}
        {/* Synced records no longer have the copy on the phone, only the uploaded path */}
        {record.local_photo_path || record.uploaded_photo_path ? (
          <Text style={styles.photoAttached}>Photo attached</Text>
        ) : null}
      </View>

      {record.morphological_notes ? (
        <View style={styles.notes}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{record.morphological_notes}</Text>
        </View>
      ) : null}

      {record.status === 'failed' ? (
        <>
          <View style={styles.rejection}>
            <Text style={styles.rejectionText}>{record.error_message}</Text>
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

function PlantRecordPhoto({ photoPath }) {
  const { getPlantPhotoUrl } = usePlantPhoto()
  const [photoUrl, setPhotoUrl] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadPhoto() {
      if (!photoPath) return

      const result = await getPlantPhotoUrl(photoPath)

      if (!cancelled && !result.error) {
        setPhotoUrl(result.data)
      }
    }

    loadPhoto()

    return () => {
      cancelled = true
    }
  }, [photoPath])

  if (!photoUrl) return null

  return (
    <Image
      source={{ uri: photoUrl }}
      style={styles.plantPhoto}
      resizeMode="cover"
      accessibilityLabel="Plant record photo"
    />
  )
}

function PlantRecordCard({ plant, species }) {
  const status = getStatusInfo(plant.review_status)

  return (
    <View style={styles.card}>
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
          value={formatDateTime(plant.recorded_at)}
        />

        <DetailRow
          label="QR Code"
          value={plant.qr_code}
          selectable
        />

        {plant.photo_url ? (
          <PlantRecordPhoto photoPath={plant.photo_url} />
        ) : null}
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

// e.g. "15 Oct 2026, 6:45 pm". The time is built by hand rather than with toLocaleTimeString,
// whose output (24-hour clock, "PM" or "p.m.") differs between Android and iOS.
function formatDateTime(date) {
  const day = formatDate(date)
  if (day === 'Not available') return day

  const parsedDate = new Date(date)
  const hours = parsedDate.getHours()
  const minutes = String(parsedDate.getMinutes()).padStart(2, '0')
  return `${day}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`
}

const styles = StyleSheet.create({
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

  section: {
    gap: theme.spacing.md,
  },

  sectionTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.heading3.fontSize,
    fontWeight: theme.typography.heading3.fontWeight,
    color: theme.colors.textPrimary,
  },

  queuedScientificName: {
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },

  photoAttached: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    fontWeight: theme.typography.caption.fontWeight,
    color: theme.colors.textSecondary,
  },

  queueActions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },

  queueAction: {
    flex: 1,
  },

  syncMessage: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },

  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
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

  plantPhoto: {
    width: '100%',
    height: 220,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surface,
  },
})
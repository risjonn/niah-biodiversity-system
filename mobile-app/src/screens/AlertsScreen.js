import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import SkeletonRows from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { useAlerts } from '../hooks/useAlerts'
import {
  alertIconName,
  alertLabel,
  alertMeaning,
  alertPosition,
  alertReadingText,
  severityLabels,
} from '../lib/alerts'
import { openInMaps } from '../lib/maps'
import { formatRelativeTime } from '../lib/sarawakTime'
import { theme } from '../theme/theme'

// How often the lists reload while the screen is in view
const REFRESH_INTERVAL_MS = 30 * 1000

// Chip colours for each alert_severity. Amber is too light for white text, so it uses dark text
// (as ReviewStatusChip does for pending).
const severityChipColors = {
  high: { backgroundColor: theme.colors.error, color: theme.colors.surfaceWhite },
  medium: { backgroundColor: theme.colors.alert, color: theme.colors.textPrimary },
  low: { backgroundColor: theme.colors.primary, color: theme.colors.surfaceWhite },
}

// Sensor alerts for conservation officers and admins (a tab only they have). Open alerts first,
// each with an Acknowledge button, then the most recently acknowledged ones, collapsed. Reloads
// on pull to refresh, when the tab comes into view and every 30 s while it stays in view. The
// tab's badge shows the open count. The tab is mounted when the tabs are (lazy: false in
// RootNavigator), so the badge is right before the tab is first opened.
export default function AlertsScreen({ navigation }) {
  const { user } = useAuth()
  const { fetchOpenAlerts, fetchAcknowledgedAlerts, acknowledgeAlert } = useAlerts()
  // { open, acknowledged } once loaded; kept while reloading so the lists don't blank out
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showAcknowledged, setShowAcknowledged] = useState(false)
  // By alert id: { busy } while acknowledging, { error } when it failed
  const [ackState, setAckState] = useState({})
  // When the data was loaded, for the relative times
  const [now, setNow] = useState(() => Date.now())
  // Counts loads, so only the latest one's result is shown: the 30 s timer can fire while a pull
  // to refresh is loading, and a load that started before an acknowledgement would bring it back
  const loadIdRef = useRef(0)

  async function load() {
    const loadId = ++loadIdRef.current
    const [openResult, acknowledgedResult] = await Promise.all([fetchOpenAlerts(), fetchAcknowledgedAlerts()])
    if (loadId !== loadIdRef.current) return
    setNow(Date.now())
    const failed = openResult.error ?? acknowledgedResult.error
    if (failed) {
      setError(failed)
      return
    }
    setError(null)
    setData({ open: openResult.data, acknowledged: acknowledgedResult.data })
  }

  // The effects below always call the latest load
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  // First load as soon as the tabs mount, for the badge
  useEffect(() => {
    loadRef.current()
  }, [])

  useFocusEffect(
    useCallback(() => {
      loadRef.current()
      const timer = setInterval(() => loadRef.current(), REFRESH_INTERVAL_MS)
      return () => clearInterval(timer)
    }, []),
  )

  const openCount = data?.open.length ?? 0
  useEffect(() => {
    navigation.setOptions({ tabBarBadge: openCount > 0 ? openCount : undefined })
  }, [navigation, openCount])

  async function handleRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function confirmAcknowledge(alert) {
    const node = alert.sensor_nodes?.node_identifier
    Alert.alert(
      'Acknowledge alert',
      `Mark "${alertLabel(alert)}"${node ? ` at ${node}` : ''} as acknowledged? It moves to Recently acknowledged with your name on it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Acknowledge', onPress: () => handleAcknowledge(alert.id) },
      ],
    )
  }

  async function handleAcknowledge(id) {
    setAckState((current) => ({ ...current, [id]: { busy: true } }))
    const result = await acknowledgeAlert(id)
    if (result.error) {
      // Not reloaded here: if someone else got there first, a reload would move the card away
      // before this message could be read. The next refresh moves it.
      setAckState((current) => ({ ...current, [id]: { error: result.error } }))
      return
    }
    setAckState((current) => {
      const { [id]: _done, ...rest } = current
      return rest
    })
    await load()
  }

  const acknowledged = data?.acknowledged ?? []

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      {error && data ? (
        <Text style={styles.staleNote} accessibilityLiveRegion="polite">
          Couldn&apos;t refresh: {error}
        </Text>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {data ? `Open (${openCount})` : 'Open'}
        </Text>
        {!data && !error ? <SkeletonRows count={3} label="Loading alerts" /> : null}
        {!data && error ? (
          <EmptyState
            icon="cloud-offline-outline"
            message={error}
            action={{ title: 'Try again', onPress: handleRefresh }}
          />
        ) : null}
        {data && openCount === 0 ? (
          <EmptyState icon="checkmark-circle-outline" message="No open alerts. New sensor alerts will show here." />
        ) : null}
        {data?.open.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            now={now}
            ackState={ackState[alert.id]}
            onAcknowledge={() => confirmAcknowledge(alert)}
          />
        ))}
      </View>

      {data ? (
        <View style={styles.section}>
          <Pressable
            onPress={() => setShowAcknowledged((shown) => !shown)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAcknowledged }}
            accessibilityLabel={`Recently acknowledged, ${acknowledged.length}`}
            hitSlop={theme.spacing.sm}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          >
            <Text style={styles.sectionTitle}>Recently acknowledged ({acknowledged.length})</Text>
            <Ionicons
              name={showAcknowledged ? 'chevron-down' : 'chevron-forward'}
              size={20}
              color={theme.colors.textSecondary}
            />
          </Pressable>
          {showAcknowledged && acknowledged.length === 0 ? (
            <Text style={styles.staleNote}>No alerts have been acknowledged yet.</Text>
          ) : null}
          {showAcknowledged
            ? acknowledged.map((alert) => (
                <AlertCard key={alert.id} alert={alert} now={now} currentUserId={user?.id} />
              ))
            : null}
        </View>
      ) : null}
    </ScrollView>
  )
}

// One alert: icon, label, severity, what it means, node and time, the triggering reading, and
// for an open alert the Acknowledge button. For PLANT_STOLEN_MOVING and GPS_SHIELDED_OR_JAMMED
// the reading's position comes with "Open in Maps".
function AlertCard({ alert, now, ackState, onAcknowledge, currentUserId }) {
  const label = alertLabel(alert)
  const meaning = alertMeaning(alert)
  const node = alert.sensor_nodes?.node_identifier ?? 'Unknown node'
  const ago = formatRelativeTime(alert.created_at, now)
  const reading = alertReadingText(alert)
  const position = alertPosition(alert)
  const chip = severityChipColors[alert.severity] ?? severityChipColors.medium

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconTile}>
          <Ionicons name={alertIconName(alert)} size={22} color={theme.colors.primary} accessibilityElementsHidden />
        </View>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardTitle}>{label}</Text>
          <Text style={styles.meta}>
            {node} · {ago}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.backgroundColor }]}>
          <Text style={[styles.chipText, { color: chip.color }]}>
            {severityLabels[alert.severity] ?? alert.severity}
          </Text>
        </View>
      </View>

      {meaning ? <Text style={styles.body}>{meaning}</Text> : null}
      {reading ? (
        <Text style={styles.reading} selectable>
          {reading}
        </Text>
      ) : null}

      {position?.latitude != null ? (
        <View style={styles.inlineButton}>
          <Button
            title="Open in Maps"
            variant="secondary"
            onPress={() => openInMaps(position.latitude, position.longitude, `${node} box`)}
          />
        </View>
      ) : null}

      {alert.is_acknowledged ? (
        <Text style={styles.meta}>
          Acknowledged by {acknowledgedByName(alert, currentUserId)}
          {alert.acknowledged_at ? `, ${formatRelativeTime(alert.acknowledged_at, now)}` : ''}
        </Text>
      ) : (
        <>
          <Button
            title={ackState?.busy ? 'Acknowledging…' : 'Acknowledge'}
            loading={ackState?.busy}
            onPress={onAcknowledge}
          />
          {ackState?.error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {ackState.error}
            </Text>
          ) : null}
        </>
      )}
    </View>
  )
}

// Officers can only read their own profile, so someone else's name is usually unknown
function acknowledgedByName(alert, currentUserId) {
  if (alert.acknowledged_by && alert.acknowledged_by === currentUserId) return 'you'
  return alert.acknowledged_by_profile?.full_name ?? 'another staff member'
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.xl,
  },
  pressed: {
    opacity: 0.8,
  },
  section: {
    gap: theme.spacing.md,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: theme.buttonHeight,
  },
  staleNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  card: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  cardTitleBlock: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  cardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  meta: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius * 2,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 20,
    color: theme.colors.textPrimary,
  },
  reading: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
  },
  inlineButton: {
    alignSelf: 'flex-start',
  },
  error: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },
})

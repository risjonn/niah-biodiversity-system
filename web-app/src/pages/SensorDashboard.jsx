import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Link,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha, keyframes } from '@mui/material/styles'
import Battery0BarIcon from '@mui/icons-material/Battery0Bar'
import Battery1BarIcon from '@mui/icons-material/Battery1Bar'
import Battery2BarIcon from '@mui/icons-material/Battery2Bar'
import Battery3BarIcon from '@mui/icons-material/Battery3Bar'
import Battery4BarIcon from '@mui/icons-material/Battery4Bar'
import Battery5BarIcon from '@mui/icons-material/Battery5Bar'
import Battery6BarIcon from '@mui/icons-material/Battery6Bar'
import BatteryFullIcon from '@mui/icons-material/BatteryFull'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import RelativeTime from '../components/RelativeTime'
import TableSkeleton from '../components/TableSkeleton'
import { useAuth } from '../context/AuthContext'
import { useNavCounts } from '../context/NavCountsContext'
import { useToast } from '../context/ToastContext'
import SensorCharts from '../components/SensorCharts'
import { useSensors } from '../hooks/useSensors'
import {
  alertIcon,
  alertLabel,
  alertMeaning,
  alertPosition,
  alertReadingText,
  alertSources,
  deviceAlertCodes,
  deviceCodeLabel,
  deviceStateColors,
  severityColors,
  severityLabels,
} from '../lib/alerts'
import {
  distanceFromInstalled,
  formatDistance,
  formatPosition,
  MOVED_DISTANCE_M,
} from '../lib/geo'
import { hoverLiftSx } from '../lib/hoverLift'
import { mapUrl } from '../lib/mapUrl'
// The battery levels are the battery chart's: below 40 % getting low, below 20 % low
import { batteryLevel, nodeSeries, temperatureSparklines } from '../lib/sensorCharts'
import { visuallyHidden } from '../lib/visuallyHidden'
import { chartTokens } from '../theme/theme'

// How often nodes and alerts reload while the page is open and the browser tab is visible
const REFRESH_INTERVAL_MS = 15 * 1000
// A node the server hasn't heard from for this long is shown as offline. The gateway sends a
// reading from each node every minute, so this is several missed readings in a row.
const OFFLINE_AFTER_MS = 5 * 60 * 1000

// The readings table's headings, shared with its loading skeleton
const READING_COLUMNS = ['Recorded', 'Temperature', 'Humidity', 'Motion']
// The GPS positions table's headings, in the readings dialog
const POSITION_COLUMNS = ['Recorded', 'Position', 'From installed', 'Device state', 'Map']

const nodeStatusLabels = { online: 'Online', offline: 'Offline', inactive: 'Inactive' }

// Battery icons from empty to full. BatteryIndicator picks one in proportion to the level.
const BATTERY_ICONS = [
  Battery0BarIcon,
  Battery1BarIcon,
  Battery2BarIcon,
  Battery3BarIcon,
  Battery4BarIcon,
  Battery5BarIcon,
  Battery6BarIcon,
  BatteryFullIcon,
]
// Palette colours for batteryLevel(), the same as the battery chart (components/SensorCharts.jsx)
const batteryColors = { low: 'error', warning: 'warning', ok: 'success' }
const batteryLevelLabels = { low: 'Low', warning: 'Getting low', ok: null }

// Size of a node card's status dot and of an alert's icon on the timeline, in px
const STATUS_DOT_SIZE = 10
const TIMELINE_ICON_SIZE = 40

// A ring that grows out from an online node's dot and fades. Off under reduced motion.
function statusPulse(color) {
  return keyframes`
    0% { box-shadow: 0 0 0 0 ${alpha(color, 0.5)}; }
    70% { box-shadow: 0 0 0 6px ${alpha(color, 0)}; }
    100% { box-shadow: 0 0 0 0 ${alpha(color, 0)}; }
  `
}

// Officers and admins only, through ProtectedRoute in router.jsx
export default function SensorDashboard() {
  const { getNodeStatus, getAlerts } = useSensors()
  const { setOpenAlertsCount } = useNavCounts()
  // The last data that loaded successfully. Kept on screen when a later refresh fails.
  const [snapshot, setSnapshot] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // When the last load attempt finished (as Date.now()), the reference point for every relative
  // time on the page
  const [checkedAt, setCheckedAt] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // Goes up on each press of Refresh, which also reloads the charts. The automatic refresh
  // leaves them alone: hourly averages barely change in 15 seconds (see SensorCharts).
  const [chartRefreshKey, setChartRefreshKey] = useState(0)
  // The hourly rows the charts last loaded ({ rows, now }), or null until they load or if they
  // failed. The node cards' sparklines come from these, with no query of their own.
  const [hourlyReadings, setHourlyReadings] = useState(null)
  // Only the newest load may update the page, so a slow earlier one can't overwrite newer data
  const latestLoad = useRef(0)

  // Resolves once the page has been updated. State is only set in the .then callback, never
  // synchronously, so this can be called straight from the effect below.
  const load = useCallback(() => {
    const loadId = ++latestLoad.current
    return Promise.all([
      getNodeStatus(),
      getAlerts({ acknowledged: false }),
      getAlerts({ acknowledged: true }),
    ]).then(([nodes, openAlerts, acknowledgedAlerts]) => {
      if (loadId !== latestLoad.current) return

      const error = nodes.error ?? openAlerts.error ?? acknowledgedAlerts.error
      setCheckedAt(Date.now())
      setLoadError(error)
      if (!error) {
        setSnapshot({
          nodes: nodes.data,
          openAlerts: openAlerts.data,
          acknowledgedAlerts: acknowledgedAlerts.data,
          loadedAt: Date.now(),
        })
        // The sidebar badge comes from this same list (open alerts aren't capped, so its length
        // is the total), so they always match: on every auto refresh, Refresh and acknowledge
        setOpenAlertsCount(openAlerts.data.length)
      }
    })
  }, [getNodeStatus, getAlerts, setOpenAlertsCount])

  // Loads straight away, then every REFRESH_INTERVAL_MS while the tab is visible. Coming back to
  // the tab loads at once, since the data may be well out of date by then.
  useEffect(() => {
    let timer = null
    const start = () => {
      timer = setInterval(load, REFRESH_INTERVAL_MS)
    }
    const stop = () => {
      clearInterval(timer)
      timer = null
    }
    function handleVisibilityChange() {
      if (document.hidden) {
        stop()
      } else if (!timer) {
        load()
        start()
      }
    }

    load()
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [load])

  async function refresh() {
    setIsRefreshing(true)
    setChartRefreshKey((current) => current + 1)
    await load()
    setIsRefreshing(false)
  }

  const retryButton = (
    <Button color="inherit" size="small" onClick={refresh} disabled={isRefreshing}>
      Retry
    </Button>
  )

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Sensors"
        action={
          snapshot ? (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" color="textSecondary">
                Last updated <RelativeTime value={snapshot.loadedAt} now={checkedAt} />
              </Typography>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={refresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </Stack>
          ) : null
        }
      />

      {!snapshot && !loadError ? (
        <Stack sx={{ alignItems: 'center', py: 4 }}>
          <CircularProgress aria-label="Loading sensors" />
        </Stack>
      ) : null}

      {loadError ? (
        <Alert severity="error" action={retryButton}>
          {snapshot ? `The latest data could not be loaded. ${loadError}` : loadError}
        </Alert>
      ) : null}

      {snapshot ? (
        <>
          <SummaryCards
            nodes={snapshot.nodes}
            openAlerts={snapshot.openAlerts}
            now={checkedAt}
          />
          <AlertsSection
            openAlerts={snapshot.openAlerts}
            acknowledgedAlerts={snapshot.acknowledgedAlerts}
            now={checkedAt}
            onChanged={load}
          />
          <SensorCharts
            nodes={snapshot.nodes}
            refreshKey={chartRefreshKey}
            onHourlyReadings={setHourlyReadings}
          />
          <NodesSection nodes={snapshot.nodes} now={checkedAt} hourlyReadings={hourlyReadings} />
          <ThresholdsCard />
        </>
      ) : null}
    </Stack>
  )
}

function nodeStatus(node, now) {
  if (!node.is_active) return 'inactive'
  if (!node.last_received_at) return 'offline'
  return now - new Date(node.last_received_at).getTime() > OFFLINE_AFTER_MS ? 'offline' : 'online'
}

function SummaryCards({ nodes, openAlerts, now }) {
  const statuses = nodes.map((node) => nodeStatus(node, now))
  const count = (status) => statuses.filter((value) => value === status).length
  const inactive = count('inactive')
  const highSeverity = openAlerts.filter((alert) => alert.severity === 'high').length

  return (
    <Grid container spacing={2}>
      <SummaryCard
        title="Total nodes"
        value={nodes.length}
        detail={inactive > 0 ? `${inactive} inactive` : null}
      />
      <SummaryCard title="Online" value={count('online')} />
      <SummaryCard title="Offline" value={count('offline')} />
      <SummaryCard
        title="Open alerts"
        value={openAlerts.length}
        detail={`${highSeverity} high severity`}
        detailColor={highSeverity > 0 ? 'error.main' : 'text.secondary'}
      />
    </Grid>
  )
}

function SummaryCard({ title, value, detail, detailColor = 'text.secondary' }) {
  return (
    <Grid size={{ xs: 6, md: 3 }}>
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="body2" color="textSecondary" component="h2">
            {title}
          </Typography>
          <Typography variant="h1" component="p">
            {value.toLocaleString()}
          </Typography>
          {detail ? (
            <Typography variant="caption" sx={{ color: detailColor }}>
              {detail}
            </Typography>
          ) : null}
        </CardContent>
      </Card>
    </Grid>
  )
}

function AlertsSection({ openAlerts, acknowledgedAlerts, now, onChanged }) {
  const { user } = useAuth()
  const { acknowledgeAlert } = useSensors()
  const toast = useToast()
  // 'all' lists the open alerts first, then the acknowledged ones
  const [tab, setTab] = useState('all')
  // Which alerts to list: a key of alertSources (all, device or environment)
  const [source, setSource] = useState('all')
  // Ids of alerts being acknowledged, so each button is disabled until its alert leaves the list
  const [savingIds, setSavingIds] = useState(() => new Set())
  const [error, setError] = useState(null)

  async function handleAcknowledge(id) {
    setSavingIds((current) => new Set(current).add(id))
    setError(null)
    const result = await acknowledgeAlert(id)
    // The error stays inline above the list; a success gets a toast
    if (result.error) setError(result.error)
    else toast.success('Alert acknowledged')
    // Reloaded either way: a success moves the alert to the acknowledged list, and "already
    // acknowledged" means the list is out of date. The reload also updates the sidebar badge.
    await onChanged()
    setSavingIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  // The tabs and the Open count follow the filter, so the count always matches the list
  const matchesSource = alertSources[source].matches
  const shownOpen = openAlerts.filter(matchesSource)
  const shownAcknowledged = acknowledgedAlerts.filter(matchesSource)
  const alertsByTab = {
    all: [...shownOpen, ...shownAcknowledged],
    open: shownOpen,
    acknowledged: shownAcknowledged,
  }
  // e.g. "No open device alerts"
  const kind = source === 'all' ? '' : `${alertSources[source].label.toLowerCase()} `
  const emptyMessages = {
    all: `No ${kind}alerts yet`,
    open: `No open ${kind}alerts`,
    acknowledged: `No acknowledged ${kind}alerts yet`,
  }
  const alerts = alertsByTab[tab]

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' } }}
        >
          <Typography variant="h2">Alerts</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={source}
            // Clicking the selected option gives null; keep the current filter instead
            onChange={(_event, value) => {
              if (value) setSource(value)
            }}
            aria-label="Alert source"
          >
            {Object.entries(alertSources).map(([value, { label }]) => (
              <ToggleButton key={value} value={value} sx={{ textTransform: 'none' }}>
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
        <Tabs
          value={tab}
          onChange={(_event, value) => setTab(value)}
          aria-label="Alert lists"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="all" label="All" />
          <Tab value="open" label={`Open (${shownOpen.length})`} />
          <Tab value="acknowledged" label="Acknowledged" />
        </Tabs>

        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {alerts.length === 0 ? (
          <EmptyState message={emptyMessages[tab]} dense />
        ) : (
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {alerts.map((alert, index) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                now={now}
                isLast={index === alerts.length - 1}
                currentUserId={user?.id}
                isSaving={savingIds.has(alert.id)}
                onAcknowledge={() => handleAcknowledge(alert.id)}
              />
            ))}
          </Box>
        )}
      </Stack>
    </Paper>
  )
}

// One alert on the timeline: its icon on the line, then a card with the severity colour down its
// left edge. The severity is also written in a chip, so it never relies on colour alone. A device
// alert is named by its code ("Critical fall") with the code's meaning below; a moved or
// GPS-jammed box also gets a link to where the reading put it.
function AlertItem({ alert, now, isLast, currentUserId, isSaving, onAcknowledge }) {
  const nodeName = alert.sensor_nodes?.node_identifier ?? 'Unknown node'
  const color = severityColors[alert.severity] ?? 'primary'
  const reading = alertReadingText(alert)
  const meaning = alertMeaning(alert)
  const position = alertPosition(alert)

  return (
    <Box component="li" sx={{ display: 'flex', gap: { xs: 1.5, sm: 2 } }}>
      {/* The icon, and the line down to the next alert */}
      <Stack sx={{ alignItems: 'center', flexShrink: 0 }} aria-hidden="true">
        <Box
          sx={(theme) => ({
            width: TIMELINE_ICON_SIZE,
            height: TIMELINE_ICON_SIZE,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(theme.palette[color].main, 0.12),
            // The dark shade keeps the icon clear on the pale circle, even for amber
            color: theme.palette[color].dark,
          })}
        >
          {alertIcon(alert, { fontSize: 'small' })}
        </Box>
        {!isLast ? <Box sx={{ flexGrow: 1, width: 2, bgcolor: 'divider', my: 0.5 }} /> : null}
      </Stack>

      <Paper
        variant="outlined"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: 2,
          mb: isLast ? 0 : 1.5,
          borderLeftWidth: 4,
          borderLeftColor: `${color}.main`,
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' } }}
        >
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Typography variant="h3" component="h3">
                {alertLabel(alert)}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={severityLabels[alert.severity] ?? alert.severity}
                color={color}
              />
            </Stack>
            <Typography variant="body2">
              {[`Node ${nodeName}`, reading].filter(Boolean).join(' · ')}
              {' · '}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                <RelativeTime value={alert.created_at} now={now} />
              </Box>
              {position?.latitude != null ? (
                <>
                  {' · '}
                  <Link
                    href={mapUrl(position.latitude, position.longitude)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in map
                  </Link>
                </>
              ) : null}
            </Typography>
            {meaning ? (
              <Typography variant="body2" color="textSecondary">
                {meaning}
              </Typography>
            ) : null}
            {alert.is_acknowledged ? (
              <Typography variant="caption" color="textSecondary">
                Acknowledged by {acknowledgedByName(alert, currentUserId)}
                {alert.acknowledged_at ? (
                  <>
                    {' · '}
                    <RelativeTime value={alert.acknowledged_at} now={now} />
                  </>
                ) : null}
              </Typography>
            ) : null}
          </Stack>
          {alert.is_acknowledged ? (
            <Chip
              size="small"
              variant="outlined"
              icon={<CheckCircleOutlinedIcon />}
              label="Acknowledged"
              sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}
            />
          ) : (
            <Button
              variant="outlined"
              onClick={onAcknowledge}
              disabled={isSaving}
              sx={{ flexShrink: 0 }}
            >
              {isSaving ? 'Acknowledging…' : 'Acknowledge'}
            </Button>
          )}
        </Stack>
      </Paper>
    </Box>
  )
}

// Officers can only read their own profile, so another officer's name comes back null
function acknowledgedByName(alert, currentUserId) {
  if (alert.acknowledged_by && alert.acknowledged_by === currentUserId) return 'You'
  return alert.acknowledged_by_profile?.full_name ?? 'Another staff member'
}

function NodesSection({ nodes, now, hourlyReadings }) {
  const [selectedNode, setSelectedNode] = useState(null)
  // Each sparkline is drawn in its node's colour from the charts above, so they match
  const seriesByNode = useMemo(
    () => nodeSeries(nodes, chartTokens.series, chartTokens.other),
    [nodes],
  )
  const sparklines = useMemo(
    () => (hourlyReadings ? temperatureSparklines(hourlyReadings.rows, hourlyReadings.now) : null),
    [hourlyReadings],
  )

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">Nodes</Typography>
        {nodes.length === 0 ? (
          <EmptyState message="No sensor nodes yet" dense />
        ) : (
          <>
            <Typography variant="body2" color="textSecondary">
              Select a node to see its latest readings.
            </Typography>
            <Grid container spacing={2}>
              {nodes.map((node) => (
                <Grid key={node.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                  <NodeCard
                    node={node}
                    now={now}
                    sparkline={sparklines?.get(node.id) ?? null}
                    sparklineColor={seriesByNode.get(node.id)?.color ?? chartTokens.other}
                    onSelect={() => setSelectedNode(node)}
                  />
                </Grid>
              ))}
            </Grid>
          </>
        )}
      </Stack>

      {selectedNode ? (
        <ReadingsDialog
          key={selectedNode.id}
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      ) : null}
    </Paper>
  )
}

// One node: name and status, its plant, the latest device state, a red banner if the box has been
// moved, the latest readings with a 24 h temperature sparkline, battery, when it last reported and
// where it is. Clicking anywhere on the card opens its latest readings; the name is a real button,
// so that also works from the keyboard.
//
// The device fields (alert_status, tilts, soil moisture, rain, person seen and the GPS fix) come
// from the latest reading on sensor_node_latest (020). Each one is left out when that reading
// doesn't have it: the gateway only sends them once SEND_EXTRA_FIELDS is on, and the GPS fix only
// when the box has one. Before 020 is applied the view has none of them, so none show.
function NodeCard({ node, now, sparkline, sparklineColor, onSelect }) {
  const status = nodeStatus(node, now)
  const hasReading = Boolean(node.reading_id)
  const movedBy = distanceFromInstalled(node, node.reading_latitude, node.reading_longitude)
  const isMoved = movedBy != null && movedBy > MOVED_DISTANCE_M
  // Only the ones the latest reading has
  const deviceMetrics = [
    { label: 'Box tilt', value: node.tilt_angle, format: (value) => `${formatNumber(value)}°` },
    { label: 'Plant tilt', value: node.plant_tilt_angle, format: (value) => `${formatNumber(value)}°` },
    { label: 'Soil moisture', value: node.soil_moisture, format: (value) => `${formatNumber(value)} %` },
    { label: 'Rain', value: node.is_raining, format: yesNo },
    { label: 'Person seen', value: node.human_detected, format: yesNo },
  ].filter((metric) => metric.value != null)

  return (
    <Card
      variant="outlined"
      onClick={onSelect}
      sx={(theme) => ({ height: '100%', cursor: 'pointer', ...hoverLiftSx(theme) })}
    >
      <CardContent sx={{ height: '100%' }}>
        {/* Gaps rather than margins, so the footer's auto top margin can push it down */}
        <Stack spacing={2} useFlexGap sx={{ height: '100%' }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
          >
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="h3" component="h3">
                <Link
                  component="button"
                  variant="inherit"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect()
                  }}
                  sx={{ textAlign: 'left', overflowWrap: 'anywhere' }}
                >
                  {node.node_identifier}
                </Link>
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {node.qr_code}
                {node.scientific_name ? (
                  <>
                    {' · '}
                    <Box component="span" sx={{ fontStyle: 'italic' }}>
                      {node.scientific_name}
                    </Box>
                  </>
                ) : null}
              </Typography>
            </Stack>
            <StatusIndicator status={status} />
          </Stack>

          {node.alert_status ? <DeviceStateChip node={node} /> : null}

          {isMoved ? (
            <Alert
              severity="error"
              action={
                <Link
                  href={mapUrl(node.reading_latitude, node.reading_longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  color="inherit"
                  variant="body2"
                  onClick={(event) => event.stopPropagation()}
                  sx={{ fontWeight: 500, whiteSpace: 'nowrap', alignSelf: 'center' }}
                >
                  Open in map
                </Link>
              }
            >
              Moved {formatDistance(movedBy)} from its installed position
            </Alert>
          ) : null}

          <Stack direction="row" spacing={3} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Metric
              label="Temperature"
              value={hasReading ? formatMeasurement(node.temperature, '°C') : '—'}
            />
            <Metric
              label="Humidity"
              value={hasReading ? formatMeasurement(node.humidity, '%') : '—'}
            />
            <Metric label="Motion" value={hasReading ? formatMotion(node) : '—'} />
            {deviceMetrics.map((metric) => (
              <Metric key={metric.label} label={metric.label} value={metric.format(metric.value)} />
            ))}
          </Stack>

          {sparkline ? <Sparkline values={sparkline} color={sparklineColor} /> : null}

          {/* Pushed to the bottom, so the footers line up across a row of cards */}
          <Stack spacing={0.5} sx={{ mt: 'auto' }}>
            <Stack
              direction="row"
              spacing={2}
              useFlexGap
              sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
            >
              <BatteryIndicator percent={node.battery_level} />
              <Typography variant="body2" color="textSecondary">
                {node.recorded_at ? (
                  <>
                    Last reading <RelativeTime value={node.recorded_at} now={now} />
                  </>
                ) : (
                  'No readings yet'
                )}
              </Typography>
            </Stack>
            <Typography variant="caption" color="textSecondary">
              {node.latitude.toFixed(5)}, {node.longitude.toFixed(5)}
              {' · '}
              <Link
                href={mapUrl(node.latitude, node.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                Open in map
              </Link>
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

// The latest reading's alert_status as a chip, e.g. "Critical fall", coloured by the code's
// severity from device_alert_codes (on sensor_node_latest, 020). The code's meaning is the
// chip's tooltip and is also read out by screen readers.
function DeviceStateChip({ node }) {
  const Icon = deviceAlertCodes[node.alert_status]?.icon ?? null
  const label = deviceCodeLabel(node.alert_status)
  const meaning = node.alert_status_description

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="caption" color="textSecondary">
        Device state
      </Typography>
      {/* An empty title shows no tooltip */}
      <Tooltip title={meaning ?? ''}>
        <Chip
          size="small"
          variant="outlined"
          icon={Icon ? <Icon aria-hidden="true" /> : undefined}
          label={
            <>
              {label}
              {meaning ? (
                <Box component="span" sx={visuallyHidden}>
                  : {meaning}
                </Box>
              ) : null}
            </>
          }
          color={deviceStateColors[node.alert_status_severity] ?? 'default'}
        />
      </Tooltip>
    </Stack>
  )
}

// A dot and a label: green with a soft pulse when online, grey when offline or inactive
function StatusIndicator({ status }) {
  const isOnline = status === 'online'

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
      <Box
        aria-hidden="true"
        sx={(theme) => ({
          width: STATUS_DOT_SIZE,
          height: STATUS_DOT_SIZE,
          borderRadius: '50%',
          bgcolor: isOnline ? 'success.main' : 'text.secondary',
          ...(isOnline && {
            animation: `${statusPulse(theme.palette.success.main)} 2s ease-out infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }),
        })}
      />
      <Typography
        variant="body2"
        sx={{ fontWeight: 500, color: isOnline ? 'success.main' : 'text.secondary' }}
      >
        {nodeStatusLabels[status]}
      </Typography>
    </Stack>
  )
}

function Metric({ label, value }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="textSecondary">
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
        {value}
      </Typography>
    </Stack>
  )
}

// A battery icon filled in proportion to the level, in the battery chart's colours. The level is
// written out next to it, so it never relies on colour alone. Nothing at all when the node has no
// level: the gateway doesn't send one (docs/iot/gateway-contract.md, section 3).
function BatteryIndicator({ percent }) {
  if (percent == null) return null

  const value = Number(percent)
  const level = batteryLevel(value)
  const step = Math.round((Math.min(Math.max(value, 0), 100) / 100) * (BATTERY_ICONS.length - 1))
  const Icon = BATTERY_ICONS[step]

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Icon fontSize="small" aria-hidden="true" sx={{ color: `${batteryColors[level]}.main` }} />
      <Typography variant="body2">
        <Box component="span" sx={visuallyHidden}>
          Battery{' '}
        </Box>
        {[`${formatNumber(value, 0)} %`, batteryLevelLabels[level]].filter(Boolean).join(' · ')}
      </Typography>
    </Stack>
  )
}

// The sparkline's own units. It stretches to the card's width; the line keeps its thickness.
const SPARK_WIDTH = 100
const SPARK_HEIGHT = 32

// A node's hourly average temperature over the last 24 hours (oldest first, null for an hour with
// no reading), as a small line with no axes. A missing hour leaves a gap, as on the temperature
// chart. Screen readers get the range in words instead.
function Sparkline({ values, color }) {
  const present = values.filter((value) => value != null)
  const min = Math.min(...present)
  const max = Math.max(...present)
  const x = (index) => (index / (values.length - 1)) * SPARK_WIDTH
  // 2 units in from the top and bottom so the line isn't clipped; a flat line sits in the middle
  const y = (value) =>
    max === min
      ? SPARK_HEIGHT / 2
      : 2 + (1 - (value - min) / (max - min)) * (SPARK_HEIGHT - 4)

  // A new segment starts after each gap
  const path = values
    .map((value, index) => {
      if (value == null) return null
      const command = index > 0 && values[index - 1] != null ? 'L' : 'M'
      return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`
    })
    .filter(Boolean)
    .join(' ')
  // An hour with no reading on either side would draw nothing, so it gets a dot instead
  const isolated = values
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value, index }) => value != null && values[index - 1] == null && values[index + 1] == null,
    )

  const range =
    max === min ? `${formatNumber(min)} °C` : `${formatNumber(min)} to ${formatNumber(max)} °C`

  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="textSecondary">
        Temperature, last 24 h
        <Box component="span" sx={visuallyHidden}>
          : {range}
        </Box>
      </Typography>
      <Box
        component="svg"
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        preserveAspectRatio="none"
        focusable="false"
        aria-hidden="true"
        sx={{ display: 'block', width: '100%', height: SPARK_HEIGHT, overflow: 'visible' }}
      >
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {isolated.map(({ value, index }) => (
          // A zero-length line with round caps, so the dot stays round when the SVG stretches
          <line
            key={index}
            x1={x(index)}
            y1={y(value)}
            x2={x(index)}
            y2={y(value)}
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Box>
    </Stack>
  )
}

// The node's latest readings and its latest GPS positions, loaded when the dialog opens. Keyed by
// node, so each node starts with a fresh load.
function ReadingsDialog({ node, onClose }) {
  const { getRecentReadings, getRecentPositions } = useSensors()
  const [attempt, setAttempt] = useState(0)
  // Kept with the attempt it was loaded for, so Retry shows loading again (as in SpeciesDetail)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getRecentReadings(node.id), getRecentPositions(node.id)]).then(
      ([readings, positions]) => {
        if (cancelled) return
        setResult({
          attempt,
          loadedAt: Date.now(),
          data: readings.data,
          positions: positions.data,
          error: readings.error ?? positions.error,
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [getRecentReadings, getRecentPositions, node.id, attempt])

  const isLoading = result?.attempt !== attempt

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Latest readings from {node.node_identifier}</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <TableSkeleton columns={READING_COLUMNS} label="Loading readings" size="small" />
        ) : null}

        {!isLoading && result.error ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setAttempt((current) => current + 1)}
              >
                Retry
              </Button>
            }
          >
            {result.error}
          </Alert>
        ) : null}

        {!isLoading && !result.error && result.data.length === 0 ? (
          <EmptyState message="No readings from this node yet" dense />
        ) : null}

        {!isLoading && !result.error && result.data.length > 0 ? (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  {READING_COLUMNS.map((column) => (
                    <TableCell key={column}>{column}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {result.data.map((reading) => (
                  <TableRow key={reading.id} sx={{ '& td': { whiteSpace: 'nowrap' } }}>
                    <TableCell>
                      <RelativeTime value={reading.recorded_at} now={result.loadedAt} />
                    </TableCell>
                    <TableCell>{formatMeasurement(reading.temperature, '°C')}</TableCell>
                    <TableCell>{formatMeasurement(reading.humidity, '%')}</TableCell>
                    <TableCell>{formatMotion(reading)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}

        {!isLoading && !result.error && result.positions.length > 0 ? (
          <PositionsTable node={node} positions={result.positions} loadedAt={result.loadedAt} />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

// The node's latest GPS fixes (from getRecentPositions), each with its time, how far it is from
// where the node was installed, and a link to it on a map. A fix more than MOVED_DISTANCE_M away
// is marked "Moved" in words as well as in red. Shown only for a node that has sent a fix.
function PositionsTable({ node, positions, loadedAt }) {
  return (
    <Stack spacing={1} sx={{ mt: 3 }}>
      <Typography variant="h3" component="h3">
        Recent GPS positions
      </Typography>
      <Typography variant="body2" color="textSecondary">
        Installed at {formatPosition(node.latitude, node.longitude)}. A box more than{' '}
        {MOVED_DISTANCE_M} m away has been moved.
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {POSITION_COLUMNS.map((column) => (
                <TableCell key={column}>{column}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {positions.map((position) => {
              const distance = distanceFromInstalled(node, position.latitude, position.longitude)
              const isMoved = distance != null && distance > MOVED_DISTANCE_M
              return (
                <TableRow key={position.id} sx={{ '& td': { whiteSpace: 'nowrap' } }}>
                  <TableCell>
                    <RelativeTime value={position.recorded_at} now={loadedAt} />
                  </TableCell>
                  <TableCell>{formatPosition(position.latitude, position.longitude)}</TableCell>
                  <TableCell sx={isMoved ? { color: 'error.main', fontWeight: 500 } : null}>
                    {distance != null ? formatDistance(distance) : '—'}
                    {isMoved ? ' · Moved' : ''}
                  </TableCell>
                  <TableCell>
                    {position.alert_status ? deviceCodeLabel(position.alert_status) : '—'}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={mapUrl(position.latitude, position.longitude)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in map
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  )
}

// The global alert limits (009), read-only. Loaded once: they rarely change.
function ThresholdsCard() {
  const { getGlobalThresholds } = useSensors()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    getGlobalThresholds().then((nextResult) => {
      if (!cancelled) setResult({ attempt, ...nextResult })
    })
    return () => {
      cancelled = true
    }
  }, [getGlobalThresholds, attempt])

  const isLoading = result?.attempt !== attempt
  const limits = result?.data

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={1}>
        <Typography variant="h2">Alert limits</Typography>
        {isLoading ? <CircularProgress size={24} aria-label="Loading alert limits" /> : null}

        {!isLoading && result.error ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setAttempt((current) => current + 1)}
              >
                Retry
              </Button>
            }
          >
            {result.error}
          </Alert>
        ) : null}

        {!isLoading && !result.error && !limits ? (
          <Typography variant="body1" color="textSecondary">
            No global alert limits set
          </Typography>
        ) : null}

        {!isLoading && limits ? (
          <>
            <Typography variant="body1">
              Temperature {formatNumber(limits.temperature_min)}–
              {formatNumber(limits.temperature_max)} °C, humidity{' '}
              {formatNumber(limits.humidity_min)}–{formatNumber(limits.humidity_max)} %, motion
              lasting {limits.motion_window_seconds} s or longer
            </Typography>
            <Typography variant="body2" color="textSecondary">
              An alert is raised when a reading falls outside these limits. They apply to every
              node that doesn&apos;t have its own limits.
            </Typography>
          </>
        ) : null}
      </Stack>
    </Paper>
  )
}

function formatNumber(value, maximumFractionDigits = 1) {
  return Number(value).toLocaleString('en-MY', { maximumFractionDigits })
}

// Temperature and humidity can be missing from a reading
function formatMeasurement(value, unit) {
  return value != null ? `${formatNumber(value)} ${unit}` : '—'
}

function yesNo(value) {
  return value ? 'Yes' : 'No'
}

function formatMotion({ motion_detected: detected, motion_duration_seconds: duration }) {
  if (!detected) return 'No'
  return duration != null ? `Yes (${formatNumber(duration)} s)` : 'Yes'
}

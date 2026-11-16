import { useCallback, useEffect, useRef, useState } from 'react'
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
  Tooltip,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import SensorCharts from '../components/SensorCharts'
import { useSensors } from '../hooks/useSensors'
import { formatDateTime, formatRelativeTime } from '../lib/formatDateTime'
// Battery levels below this (in %) are shown in the error colour. Shared with the battery chart.
import { LOW_BATTERY_PERCENT } from '../lib/sensorCharts'

// How often nodes and alerts reload while the page is open and the browser tab is visible
const REFRESH_INTERVAL_MS = 15 * 1000
// A node the server hasn't heard from for this long is shown as offline
const OFFLINE_AFTER_MS = 15 * 60 * 1000

// Matches the alert_type enum in database/schema/001_initial_schema.sql. Nothing raises
// node_offline yet; offline status is worked out on this page from last_received_at.
const alertTypeLabels = {
  motion_detected: 'Motion detected',
  temperature_anomaly: 'Temperature out of range',
  humidity_anomaly: 'Humidity out of range',
  node_offline: 'Node offline',
}

// Matches the alert_severity enum. MUI's warning colour is the alert token, which
// docs/design-system.md reserves for warnings and sensor alerts.
const severityLabels = { high: 'High', medium: 'Medium', low: 'Low' }
const severityChipColors = { high: 'error', medium: 'warning', low: 'default' }

const nodeStatusLabels = { online: 'Online', offline: 'Offline', inactive: 'Inactive' }
const nodeStatusChipColors = { online: 'success', offline: 'warning', inactive: 'default' }

// Officers and admins only, through ProtectedRoute in router.jsx
export default function SensorDashboard() {
  const { getNodeStatus, getAlerts } = useSensors()
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
      }
    })
  }, [getNodeStatus, getAlerts])

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
              <Typography variant="body2" color="text.secondary">
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
          <SensorCharts nodes={snapshot.nodes} refreshKey={chartRefreshKey} />
          <NodesSection nodes={snapshot.nodes} now={checkedAt} />
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
          <Typography variant="body2" color="text.secondary" component="h2">
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
  const [tab, setTab] = useState('open')
  // Ids of alerts being acknowledged, so each button is disabled until its alert leaves the list
  const [savingIds, setSavingIds] = useState(() => new Set())
  const [error, setError] = useState(null)

  async function handleAcknowledge(id) {
    setSavingIds((current) => new Set(current).add(id))
    setError(null)
    const result = await acknowledgeAlert(id)
    if (result.error) setError(result.error)
    // Reloaded either way: a success moves the alert to the acknowledged list, and "already
    // acknowledged" means the list is out of date
    await onChanged()
    setSavingIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  const alerts = tab === 'open' ? openAlerts : acknowledgedAlerts

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">Alerts</Typography>
        <Tabs
          value={tab}
          onChange={(_event, value) => setTab(value)}
          aria-label="Alert lists"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="open" label={`Open (${openAlerts.length})`} />
          <Tab value="acknowledged" label="Acknowledged" />
        </Tabs>

        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {alerts.length === 0 ? (
          <Typography variant="body1" color="text.secondary">
            {tab === 'open' ? 'No open alerts' : 'No acknowledged alerts yet'}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {alerts.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                now={now}
                currentUserId={user?.id}
                isSaving={savingIds.has(alert.id)}
                onAcknowledge={() => handleAcknowledge(alert.id)}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

function AlertItem({ alert, now, currentUserId, isSaving, onAcknowledge }) {
  const nodeName = alert.sensor_nodes?.node_identifier ?? 'Unknown node'

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
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
            <Chip
              size="small"
              label={severityLabels[alert.severity] ?? alert.severity}
              color={severityChipColors[alert.severity] ?? 'default'}
            />
            <Typography variant="h3" component="h3">
              {alertTypeLabels[alert.alert_type] ?? alert.alert_type}
            </Typography>
          </Stack>
          {alert.message ? <Typography variant="body2">{alert.message}</Typography> : null}
          <Typography variant="caption" color="text.secondary">
            Node {nodeName} · <RelativeTime value={alert.created_at} now={now} />
          </Typography>
          {alert.is_acknowledged ? (
            <Typography variant="caption" color="text.secondary">
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
        {!alert.is_acknowledged ? (
          <Button
            variant="outlined"
            onClick={onAcknowledge}
            disabled={isSaving}
            sx={{ flexShrink: 0 }}
          >
            {isSaving ? 'Acknowledging…' : 'Acknowledge'}
          </Button>
        ) : null}
      </Stack>
    </Paper>
  )
}

// Officers can only read their own profile, so another officer's name comes back null
function acknowledgedByName(alert, currentUserId) {
  if (alert.acknowledged_by && alert.acknowledged_by === currentUserId) return 'You'
  return alert.acknowledged_by_profile?.full_name ?? 'Another staff member'
}

function NodesSection({ nodes, now }) {
  const [selectedNode, setSelectedNode] = useState(null)

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">Nodes</Typography>
        {nodes.length === 0 ? (
          <Typography variant="body1" color="text.secondary">
            No sensor nodes yet
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              Select a node to see its latest readings.
            </Typography>
            {/* Scrolls sideways on a narrow screen instead of squeezing the columns */}
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Node</TableCell>
                    <TableCell>Plant</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Temperature</TableCell>
                    <TableCell>Humidity</TableCell>
                    <TableCell>Motion</TableCell>
                    <TableCell>Battery</TableCell>
                    <TableCell>Last reading</TableCell>
                    <TableCell>Location</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {nodes.map((node) => (
                    <NodeRow
                      key={node.id}
                      node={node}
                      now={now}
                      onSelect={() => setSelectedNode(node)}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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

function NodeRow({ node, now, onSelect }) {
  const status = nodeStatus(node, now)
  const hasReading = Boolean(node.reading_id)
  const battery = node.battery_level
  const mapUrl = `https://www.google.com/maps?q=${node.latitude},${node.longitude}`

  return (
    <TableRow hover onClick={onSelect} sx={{ cursor: 'pointer', '& td': { whiteSpace: 'nowrap' } }}>
      <TableCell>
        {/* A real button so the dialog can also be opened from the keyboard */}
        <Link
          component="button"
          variant="body2"
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
          }}
        >
          {node.node_identifier}
        </Link>
      </TableCell>
      <TableCell>
        {node.qr_code}
        <Box
          component="span"
          sx={{ display: 'block', fontStyle: 'italic', color: 'text.secondary' }}
        >
          {node.scientific_name}
        </Box>
      </TableCell>
      <TableCell>
        <Chip size="small" label={nodeStatusLabels[status]} color={nodeStatusChipColors[status]} />
      </TableCell>
      <TableCell>{hasReading ? formatMeasurement(node.temperature, '°C') : '—'}</TableCell>
      <TableCell>{hasReading ? formatMeasurement(node.humidity, '%') : '—'}</TableCell>
      <TableCell>{hasReading ? formatMotion(node) : '—'}</TableCell>
      <TableCell
        sx={{ color: battery != null && battery < LOW_BATTERY_PERCENT ? 'error.main' : undefined }}
      >
        {battery != null ? `${formatNumber(battery, 0)} %` : '—'}
      </TableCell>
      <TableCell>
        {node.recorded_at ? (
          <RelativeTime value={node.recorded_at} now={now} />
        ) : (
          'No readings yet'
        )}
      </TableCell>
      <TableCell>
        {node.latitude.toFixed(5)}, {node.longitude.toFixed(5)}
        <Link
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="body2"
          onClick={(event) => event.stopPropagation()}
          sx={{ display: 'block' }}
        >
          Open in map
        </Link>
      </TableCell>
    </TableRow>
  )
}

// The node's latest readings, loaded when the dialog opens. Keyed by node, so each node starts
// with a fresh load.
function ReadingsDialog({ node, onClose }) {
  const { getRecentReadings } = useSensors()
  const [attempt, setAttempt] = useState(0)
  // Kept with the attempt it was loaded for, so Retry shows loading again (as in SpeciesDetail)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    getRecentReadings(node.id).then((nextResult) => {
      if (!cancelled) setResult({ attempt, loadedAt: Date.now(), ...nextResult })
    })
    return () => {
      cancelled = true
    }
  }, [getRecentReadings, node.id, attempt])

  const isLoading = result?.attempt !== attempt

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Latest readings from {node.node_identifier}</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress aria-label="Loading readings" />
          </Stack>
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
          <Typography variant="body1" color="text.secondary">
            No readings from this node yet
          </Typography>
        ) : null}

        {!isLoading && !result.error && result.data.length > 0 ? (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Recorded</TableCell>
                  <TableCell>Temperature</TableCell>
                  <TableCell>Humidity</TableCell>
                  <TableCell>Motion</TableCell>
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
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
          <Typography variant="body1" color="text.secondary">
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
            <Typography variant="body2" color="text.secondary">
              An alert is raised when a reading falls outside these limits. They apply to every
              node that doesn&apos;t have its own limits.
            </Typography>
          </>
        ) : null}
      </Stack>
    </Paper>
  )
}

// "2 min ago", with the full date and time on hover
function RelativeTime({ value, now }) {
  return (
    <Tooltip title={formatDateTime(value)}>
      <Box component="time" dateTime={new Date(value).toISOString()}>
        {formatRelativeTime(value, now)}
      </Box>
    </Tooltip>
  )
}

function formatNumber(value, maximumFractionDigits = 1) {
  return Number(value).toLocaleString('en-MY', { maximumFractionDigits })
}

// Temperature and humidity can be missing from a reading
function formatMeasurement(value, unit) {
  return value != null ? `${formatNumber(value)} ${unit}` : '—'
}

function formatMotion({ motion_detected: detected, motion_duration_seconds: duration }) {
  if (!detected) return 'No'
  return duration != null ? `Yes (${formatNumber(duration)} s)` : 'Yes'
}

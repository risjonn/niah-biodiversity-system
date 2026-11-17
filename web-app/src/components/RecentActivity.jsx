import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Grid,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import DirectionsRunOutlinedIcon from '@mui/icons-material/DirectionsRunOutlined'
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined'
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined'
import ThermostatOutlinedIcon from '@mui/icons-material/ThermostatOutlined'
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined'
import WifiOffOutlinedIcon from '@mui/icons-material/WifiOffOutlined'
import EmptyState from './EmptyState'
import PlantRecordPanel from './PlantRecordPanel'
import RelativeTime from './RelativeTime'
import { usePlants } from '../hooks/usePlants'
import { useSensors } from '../hooks/useSensors'
import { alertReadingText, alertTypeLabels } from '../lib/alerts'
import { reviewStatusChipColors, reviewStatusLabels } from '../lib/reviewStatus'
import { visuallyHidden } from '../lib/visuallyHidden'

const SHOWN = 6
// Photo and icon size in the lists, in px (48 on the spacing scale)
const THUMB_SIZE = 48

const alertIcons = {
  temperature_anomaly: ThermostatOutlinedIcon,
  humidity_anomaly: WaterDropOutlinedIcon,
  motion_detected: DirectionsRunOutlinedIcon,
  node_offline: WifiOffOutlinedIcon,
}

// Palette colour of the icon tile, by severity (as the severity chips on the sensors page)
const severityColors = { high: 'error', medium: 'warning', low: 'primary' }

// The dashboard's recent activity: the latest plant records and the latest alerts, side by side
// from md up and stacked below. Each card loads on its own.
export default function RecentActivity() {
  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}>
        <LatestRecords />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <LatestAlerts />
      </Grid>
    </Grid>
  )
}

function ActivityCard({ title, viewAllTo, children }) {
  return (
    <Paper variant="outlined" sx={{ height: '100%', p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h2">{title}</Typography>
          <Button component={RouterLink} to={viewAllTo} size="small">
            View all
            <Box component="span" sx={visuallyHidden}>
              {' '}
              {title.toLowerCase()}
            </Box>
          </Button>
        </Stack>
        {children}
      </Stack>
    </Paper>
  )
}

function ListSkeleton({ label }) {
  return (
    <Box role="status" aria-label={label}>
      <Stack spacing={1.5} sx={{ py: 1 }} aria-hidden="true">
        {Array.from({ length: SHOWN }, (_, index) => (
          <Stack key={index} direction="row" spacing={2} sx={{ alignItems: 'center', px: 1 }}>
            <Skeleton variant="rounded" width={THUMB_SIZE} height={THUMB_SIZE} />
            <Box sx={{ flexGrow: 1 }}>
              <Skeleton width="60%" />
              <Skeleton width="35%" />
            </Box>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

// The six newest plant records, any status, with photos signed in one request. Clicking one opens
// the same record panel as the plant records page.
function LatestRecords() {
  const { fetchPlantRecords, getPlantPhotoUrls } = usePlants()
  const [result, setResult] = useState(null)
  const [openRecord, setOpenRecord] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchPlantRecords({ page: 0, pageSize: SHOWN }).then((records) => {
      if (cancelled) return undefined
      if (records.error) {
        setResult({ rows: [], error: records.error })
        return undefined
      }
      const rows = records.data.rows
      return getPlantPhotoUrls(rows.map((row) => row.photo_url)).then((photos) => {
        if (!cancelled) setResult({ rows, urls: photos.data, error: null, loadedAt: Date.now() })
      })
    })
    return () => {
      cancelled = true
    }
  }, [fetchPlantRecords, getPlantPhotoUrls])

  return (
    <ActivityCard title="Latest records" viewAllTo="/records">
      {!result ? <ListSkeleton label="Loading latest records" /> : null}
      {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
      {result && !result.error && result.rows.length === 0 ? (
        <EmptyState message="No plant records yet" dense />
      ) : null}
      {result && result.rows.length > 0 ? (
        <List disablePadding>
          {result.rows.map((row) => (
            <ListItemButton key={row.id} onClick={() => setOpenRecord(row)} sx={{ borderRadius: 1, px: 1 }}>
              <ListItemAvatar sx={{ minWidth: 0, mr: 2 }}>
                <Avatar
                  variant="rounded"
                  src={result.urls[row.photo_url]}
                  alt=""
                  sx={{ width: THUMB_SIZE, height: THUMB_SIZE, bgcolor: 'background.default', color: 'text.secondary' }}
                >
                  <LocalFloristOutlinedIcon fontSize="small" aria-hidden="true" />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <>
                    <Box component="span" sx={{ fontStyle: 'italic' }}>
                      {row.species?.scientific_name ?? 'Unknown species'}
                    </Box>
                    <Box component="span" sx={{ color: 'text.secondary', typography: 'caption', ml: 1 }}>
                      {row.qr_code}
                    </Box>
                  </>
                }
                secondary={
                  <Stack component="span" direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
                    <Chip
                      component="span"
                      size="small"
                      label={reviewStatusLabels[row.review_status] ?? row.review_status}
                      color={reviewStatusChipColors[row.review_status] ?? 'default'}
                    />
                    <RelativeTime value={row.recorded_at} now={result.loadedAt} longAges />
                  </Stack>
                }
                slotProps={{ secondary: { component: 'span' } }}
              />
            </ListItemButton>
          ))}
        </List>
      ) : null}
      <PlantRecordPanel
        plantId={openRecord?.id ?? null}
        plant={openRecord}
        onClose={() => setOpenRecord(null)}
      />
    </ActivityCard>
  )
}

// The six newest alerts, open or acknowledged, with the reading that raised each one. Each links
// to the sensors page, where alerts are acknowledged.
function LatestAlerts() {
  const { getRecentAlerts } = useSensors()
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    getRecentAlerts(SHOWN).then((alerts) => {
      if (!cancelled) setResult({ ...alerts, loadedAt: Date.now() })
    })
    return () => {
      cancelled = true
    }
  }, [getRecentAlerts])

  return (
    <ActivityCard title="Latest alerts" viewAllTo="/sensors">
      {!result ? <ListSkeleton label="Loading latest alerts" /> : null}
      {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
      {result && !result.error && result.data.length === 0 ? (
        <EmptyState message="No alerts yet" dense />
      ) : null}
      {result && result.data.length > 0 ? (
        <List disablePadding>
          {result.data.map((alert) => {
            const Icon = alertIcons[alert.alert_type] ?? SensorsOutlinedIcon
            const color = severityColors[alert.severity] ?? 'primary'
            const reading = alertReadingText(alert)
            return (
              <ListItemButton
                key={alert.id}
                component={RouterLink}
                to="/sensors"
                sx={{ borderRadius: 1, px: 1, gap: 1 }}
              >
                <ListItemAvatar sx={{ minWidth: 0, mr: 1 }}>
                  <Avatar
                    variant="rounded"
                    sx={(theme) => ({
                      width: THUMB_SIZE,
                      height: THUMB_SIZE,
                      bgcolor: alpha(theme.palette[color].main, 0.12),
                      color: theme.palette[color].dark,
                    })}
                  >
                    <Icon aria-hidden="true" />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={alertTypeLabels[alert.alert_type] ?? alert.alert_type}
                  secondary={
                    <>
                      {[alert.sensor_nodes?.node_identifier ?? 'Unknown node', reading].filter(Boolean).join(' · ')}
                      {' · '}
                      <RelativeTime value={alert.created_at} now={result.loadedAt} longAges />
                    </>
                  }
                  slotProps={{ secondary: { component: 'span' } }}
                  sx={{ minWidth: 0 }}
                />
                <Chip
                  size="small"
                  label={alert.is_acknowledged ? 'Acknowledged' : 'Open'}
                  color={alert.is_acknowledged ? 'default' : 'error'}
                  variant={alert.is_acknowledged ? 'outlined' : 'filled'}
                  sx={{ flexShrink: 0 }}
                />
              </ListItemButton>
            )
          })}
        </List>
      ) : null}
    </ActivityCard>
  )
}

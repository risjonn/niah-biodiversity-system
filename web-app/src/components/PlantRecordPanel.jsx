import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined'
import PlantPhoto from './PlantPhoto'
import PrintLabels from './PrintLabels'
import QrCode from './QrCode'
import { useToast } from '../context/ToastContext'
import { usePlants } from '../hooks/usePlants'
import { conservationStatusChipColor, conservationStatusLabels } from '../lib/conservationStatus'
import { formatDate, formatDateTime } from '../lib/formatDateTime'
import { mapUrl } from '../lib/mapUrl'
import { formatCoordinates, formatHeight } from '../lib/plantFormat'
import { downloadQrPng } from '../lib/qrCode'
import { reviewStatusChipColors, reviewStatusLabels } from '../lib/reviewStatus'

// One plant record in a right-side drawer, read-only: photo, details, review status, and its QR
// code with Download PNG and Print label. Shared by the plant records page and species pages.
// - plantId: the record to show, or null when closed
// - plant: the full record if the caller already has it; otherwise it is loaded by id
export default function PlantRecordPanel({ plantId, plant, onClose }) {
  return (
    <Drawer
      anchor="right"
      open={Boolean(plantId)}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 } } } }}
    >
      {/* Keyed by record, so each one starts with its own load */}
      {plantId ? (
        <PanelContent
          key={plantId}
          plantId={plantId}
          initialPlant={plant?.id === plantId ? plant : null}
          onClose={onClose}
        />
      ) : null}
    </Drawer>
  )
}

function PanelContent({ plantId, initialPlant, onClose }) {
  const { getPlantById } = usePlants()
  const [result, setResult] = useState(initialPlant ? { data: initialPlant, error: null } : null)

  useEffect(() => {
    if (initialPlant) return undefined
    let cancelled = false
    getPlantById(plantId).then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [getPlantById, plantId, initialPlant])

  const plant = result?.data ?? null

  return (
    <Stack sx={{ height: '100%' }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', px: 3, py: 2 }}
      >
        <Typography variant="h2" component="h2">
          {plant?.qr_code ?? 'Plant record'}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} edge="end">
          <CloseIcon />
        </IconButton>
      </Stack>
      <Divider />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', px: 3, py: 2 }}>
        {!result ? (
          <Stack sx={{ alignItems: 'center', py: 6 }}>
            <CircularProgress aria-label="Loading record" />
          </Stack>
        ) : null}
        {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
        {result && !result.error && !plant ? (
          <Alert severity="warning">This record could not be found. It may have been removed.</Alert>
        ) : null}
        {plant ? <RecordDetails plant={plant} onClose={onClose} /> : null}
      </Box>
    </Stack>
  )
}

function RecordDetails({ plant, onClose }) {
  const species = plant.species
  const status = plant.review_status

  return (
    <Stack spacing={3}>
      <ReviewStatus plant={plant} onClose={onClose} />
      <PlantPhoto path={plant.photo_url} alt={`Photo of ${plant.qr_code}`} maxHeight="40vh" />

      <Stack spacing={2}>
        <DetailField label="Species">
          {species ? (
            <>
              <Box component="span" sx={{ fontStyle: 'italic', display: 'block' }}>
                {species.scientific_name}
              </Box>
              {species.common_name ? (
                <Typography variant="caption" component="span" sx={{ display: 'block' }}>
                  {species.common_name}
                </Typography>
              ) : null}
              <Chip
                size="small"
                label={conservationStatusLabels[species.conservation_status] ?? species.conservation_status}
                color={conservationStatusChipColor(species.conservation_status)}
                sx={{ mt: 1 }}
              />
            </>
          ) : (
            'Unknown species'
          )}
        </DetailField>
        <DetailField label="Recorded">{formatDateTime(plant.recorded_at)}</DetailField>
        <DetailField label="Synced">
          {plant.synced_at ? formatDateTime(plant.synced_at) : '—'}
        </DetailField>
        <DetailField label="Coordinates">
          {formatCoordinates(plant)}
          <Link
            href={mapUrl(plant.latitude, plant.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            sx={{ display: 'block' }}
          >
            Open in map
          </Link>
        </DetailField>
        <DetailField label="Location description">{plant.location_description || '—'}</DetailField>
        <DetailField label="Height">{formatHeight(plant.height_cm)}</DetailField>
        <DetailField label="Monitored">{plant.is_monitored ? 'Yes' : 'No'}</DetailField>
        <DetailField label="Morphological notes">{plant.morphological_notes || '—'}</DetailField>
        <DetailField label="Review status">
          <Chip
            size="small"
            label={reviewStatusLabels[status] ?? status}
            color={reviewStatusChipColors[status] ?? 'default'}
          />
        </DetailField>
      </Stack>

      <QrSection plant={plant} />
    </Stack>
  )
}

// Where it is in review. No approve/reject here: a pending record links to Plant review.
function ReviewStatus({ plant, onClose }) {
  const status = plant.review_status

  if (status === 'pending_review') {
    return (
      <Alert
        severity="warning"
        action={
          <Button component={RouterLink} to="/review" color="inherit" size="small" onClick={onClose}>
            Open Plant review
          </Button>
        }
      >
        Waiting for review
      </Alert>
    )
  }

  const verb = status === 'approved' ? 'Approved' : 'Rejected'
  return (
    <Alert severity={status === 'approved' ? 'success' : 'error'}>
      {plant.reviewed_at ? `${verb} on ${formatDate(plant.reviewed_at)}` : verb}
      {status === 'rejected' && plant.rejection_reason ? (
        <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
          Reason: {plant.rejection_reason}
        </Box>
      ) : null}
    </Alert>
  )
}

// The tag's QR code (encoded like the mobile app's), with download and print
function QrSection({ plant }) {
  const toast = useToast()
  const [printing, setPrinting] = useState(false)

  async function handleDownload() {
    try {
      await downloadQrPng(plant.qr_code)
    } catch {
      toast.error('The QR code image could not be created. Try again.')
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h3" component="h3" sx={{ alignSelf: 'flex-start' }}>
          QR code
        </Typography>
        <QrCode value={plant.qr_code} size={176} />
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {plant.qr_code}
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={handleDownload}>
            Download PNG
          </Button>
          <Button variant="outlined" startIcon={<PrintOutlinedIcon />} onClick={() => setPrinting(true)}>
            Print label
          </Button>
        </Stack>
      </Stack>
      {printing ? (
        <PrintLabels
          labels={[{ qrCode: plant.qr_code, scientificName: plant.species?.scientific_name }]}
          onDone={() => setPrinting(false)}
        />
      ) : null}
    </Paper>
  )
}

function DetailField({ label, children }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="textSecondary">
        {label}
      </Typography>
      <Box sx={{ typography: 'body2', whiteSpace: 'pre-wrap' }}>{children}</Box>
    </Stack>
  )
}

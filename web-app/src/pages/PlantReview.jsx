import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import TableSkeleton from '../components/TableSkeleton'
import { useNavCounts } from '../context/NavCountsContext'
import { useToast } from '../context/ToastContext'
import { usePlants } from '../hooks/usePlants'
import { conservationStatusChipColor, conservationStatusLabels } from '../lib/conservationStatus'
import { formatDateTime } from '../lib/formatDateTime'
import { mapUrl } from '../lib/mapUrl'

// Hidden at tablet width and below, where the table runs out of room
const HEIGHT_COLUMN_SX = { display: { xs: 'none', lg: 'table-cell' } }

// The table's headings, shared with its loading skeleton
const COLUMNS = [
  'QR code',
  'Species',
  'Recorded',
  'Location',
  { label: 'Height', sx: HEIGHT_COLUMN_SX },
  'Actions',
]

export default function PlantReview() {
  const { fetchPendingPlants, reviewPlant } = usePlants()
  const toast = useToast()
  const { refreshCounts } = useNavCounts()
  const [result, setResult] = useState(null)
  // Ids of records with a review request running, so their buttons can't be pressed twice
  const [busyIds, setBusyIds] = useState(() => new Set())
  // Dialogs hold an id rather than the record, so they close by themselves once it is reviewed
  const [detailId, setDetailId] = useState(null)
  const [rejectId, setRejectId] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchPendingPlants().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [fetchPendingPlants])

  // The user's own records aren't in the list at all (see fetchPendingPlants)
  const plants = result?.data ?? []
  const detailPlant = plants.find((plant) => plant.id === detailId) ?? null
  const rejectPlant = plants.find((plant) => plant.id === rejectId) ?? null

  // Resolves to true once the record is reviewed and removed from the list
  async function handleReview(plant, status, rejectionReason) {
    if (busyIds.has(plant.id)) return false

    setBusyIds((ids) => new Set(ids).add(plant.id))
    const { error } = await reviewPlant(plant.id, { status, rejectionReason })
    setBusyIds((ids) => {
      const next = new Set(ids)
      next.delete(plant.id)
      return next
    })

    if (error) {
      toast.error(error)
      return false
    }
    setResult((current) => ({
      ...current,
      data: current.data.filter((pending) => pending.id !== plant.id),
    }))
    toast.success(`${status === 'approved' ? 'Approved' : 'Rejected'} ${plant.qr_code}`)
    // One fewer pending review on the sidebar badge
    refreshCounts()
    return true
  }

  async function handleConfirmReject(reason) {
    if (await handleReview(rejectPlant, 'rejected', reason)) setRejectId(null)
  }

  return (
    <Stack spacing={3}>
      {/* The note sits right under the subtitle, with the same spacing as title to subtitle */}
      <Stack spacing={0.5}>
        <PageHeader
          title="Plant review"
          subtitle={
            result && !result.error
              ? plants.length === 1
                ? '1 record waiting for review'
                : `${plants.length} records waiting for review`
              : null
          }
        />
        <Typography variant="body2" color="text.secondary">
          Your own records are reviewed by another officer.
        </Typography>
      </Stack>

      {!result ? <TableSkeleton columns={COLUMNS} label="Loading records" /> : null}
      {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
      {result && !result.error && plants.length === 0 ? (
        <EmptyState message="Nothing waiting for review" />
      ) : null}

      {plants.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                {COLUMNS.map((column) =>
                  typeof column === 'string' ? (
                    <TableCell key={column}>{column}</TableCell>
                  ) : (
                    <TableCell key={column.label} sx={column.sx}>
                      {column.label}
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {plants.map((plant) => (
                <PendingRow key={plant.id} plant={plant} onOpen={() => setDetailId(plant.id)} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      <PlantDetailDialog
        plant={detailPlant}
        actions={
          detailPlant ? (
            <ReviewActions
              busy={busyIds.has(detailPlant.id)}
              onApprove={() => handleReview(detailPlant, 'approved')}
              onReject={() => setRejectId(detailPlant.id)}
            />
          ) : null
        }
        onClose={() => setDetailId(null)}
      />
      {/* Keyed by record so the reason box starts empty for each one */}
      <RejectDialog
        key={rejectPlant?.id}
        plant={rejectPlant}
        busy={rejectPlant ? busyIds.has(rejectPlant.id) : false}
        onConfirm={handleConfirmReject}
        onClose={() => setRejectId(null)}
      />
    </Stack>
  )
}

// A click anywhere on the row opens the record. The Review button does the same and is how
// keyboard users open it. Approving and rejecting only happen inside the dialog.
function PendingRow({ plant, onOpen }) {
  return (
    <TableRow hover onClick={onOpen} sx={{ cursor: 'pointer' }}>
      <TableCell>{plant.qr_code}</TableCell>
      <TableCell>
        <SpeciesName species={plant.species} />
      </TableCell>
      <TableCell>{formatDateTime(plant.recorded_at)}</TableCell>
      <TableCell>
        <Typography variant="body2">{formatCoordinates(plant)}</Typography>
        {plant.location_description ? (
          <Typography variant="caption" component="div" color="text.secondary">
            {plant.location_description}
          </Typography>
        ) : null}
        <MapLink plant={plant} />
      </TableCell>
      <TableCell sx={HEIGHT_COLUMN_SX}>{formatHeight(plant.height_cm)}</TableCell>
      <TableCell>
        <Button
          variant="outlined"
          onClick={(event) => {
            // The row would open it too
            event.stopPropagation()
            onOpen()
          }}
        >
          Review
        </Button>
      </TableCell>
    </TableRow>
  )
}

// Opens the record's coordinates in Google Maps in a new tab, like the sensor page
function MapLink({ plant }) {
  return (
    <Link
      href={mapUrl(plant.latitude, plant.longitude)}
      target="_blank"
      rel="noopener noreferrer"
      variant="body2"
      // Following the link shouldn't also open the record
      onClick={(event) => event.stopPropagation()}
      sx={{ display: 'block' }}
    >
      Open in map
    </Link>
  )
}

function ReviewActions({ busy, onApprove, onReject }) {
  return (
    <Stack direction="row" spacing={1}>
      <Button variant="contained" color="success" loading={busy} onClick={onApprove}>
        Approve
      </Button>
      <Button variant="outlined" color="error" disabled={busy} onClick={onReject}>
        Reject
      </Button>
    </Stack>
  )
}

// Photo on the left and details on the right from md up, stacked below that
function PlantDetailDialog({ plant, actions, onClose }) {
  return (
    <Dialog open={Boolean(plant)} onClose={onClose} fullWidth maxWidth="md">
      {plant ? (
        <>
          <DialogTitle>{plant.qr_code}</DialogTitle>
          <DialogContent dividers>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              <Box sx={{ flex: { md: 1 }, minWidth: 0 }}>
                {plant.photo_url ? (
                  <PlantPhoto path={plant.photo_url} alt={`Photo of ${plant.qr_code}`} />
                ) : (
                  <PhotoFrame>
                    <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary', py: 4 }}>
                      <ImageNotSupportedOutlinedIcon aria-hidden="true" />
                      <Typography variant="body2">No photo with this record</Typography>
                    </Stack>
                  </PhotoFrame>
                )}
              </Box>
              <Stack spacing={2} sx={{ flex: { md: 1 }, minWidth: 0 }}>
                <DetailField label="Species">
                  <SpeciesName species={plant.species} />
                  {plant.species ? (
                    <Chip
                      size="small"
                      label={
                        conservationStatusLabels[plant.species.conservation_status] ??
                        plant.species.conservation_status
                      }
                      color={conservationStatusChipColor(plant.species.conservation_status)}
                      sx={{ mt: 1 }}
                    />
                  ) : null}
                </DetailField>
                <DetailField label="Recorded">{formatDateTime(plant.recorded_at)}</DetailField>
                <DetailField label="Synced">
                  {plant.synced_at ? formatDateTime(plant.synced_at) : '—'}
                </DetailField>
                <DetailField label="Coordinates">
                  {formatCoordinates(plant)}
                  <MapLink plant={plant} />
                </DetailField>
                <DetailField label="Location description">
                  {plant.location_description || '—'}
                </DetailField>
                <DetailField label="Height">{formatHeight(plant.height_cm)}</DetailField>
                <DetailField label="Monitored">{plant.is_monitored ? 'Yes' : 'No'}</DetailField>
                <DetailField label="Morphological notes">
                  {plant.morphological_notes || '—'}
                </DetailField>
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
            {actions}
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </>
      ) : null}
    </Dialog>
  )
}

// The grey box the photo (or its loading, error or missing state) sits in
function PhotoFrame({ children }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 1,
        bgcolor: 'background.default',
        overflow: 'hidden',
      }}
    >
      {children}
    </Box>
  )
}

// photo_url is a path in the private plant-photos bucket, so the image is shown through a signed
// URL. Loading lasts until both the URL and the image itself have arrived. The whole photo is
// always shown (contained, not cropped), no taller than the viewport allows, so the dialog
// doesn't need scrolling to see it.
function PlantPhoto({ path, alt }) {
  const { getPlantPhotoUrl } = usePlants()
  // Kept with the path it was loaded for, so a different record's photo never shows here
  const [result, setResult] = useState(null)
  const [imageStatus, setImageStatus] = useState({ url: null, status: null })

  useEffect(() => {
    let cancelled = false
    getPlantPhotoUrl(path).then((nextResult) => {
      if (!cancelled) setResult({ ...nextResult, path })
    })
    return () => {
      cancelled = true
    }
  }, [getPlantPhotoUrl, path])

  const url = result?.path === path ? result.data : null
  const urlError = result?.path === path ? result.error : null
  const imageState = imageStatus.url === url ? imageStatus.status : null

  if (urlError) return <Alert severity="error">{urlError}</Alert>
  if (imageState === 'error') {
    return <Alert severity="error">This photo could not be displayed. Try again later.</Alert>
  }

  return (
    <PhotoFrame>
      {imageState !== 'loaded' ? (
        <Stack sx={{ alignItems: 'center', py: 4 }}>
          <CircularProgress aria-label="Loading photo" />
        </Stack>
      ) : null}
      {url ? (
        <Box
          component="img"
          src={url}
          alt={alt}
          onLoad={() => setImageStatus({ url, status: 'loaded' })}
          onError={() => setImageStatus({ url, status: 'error' })}
          sx={{
            display: imageState === 'loaded' ? 'block' : 'none',
            maxWidth: '100%',
            maxHeight: { xs: '40vh', md: '60vh' },
            objectFit: 'contain',
          }}
        />
      ) : null}
    </PhotoFrame>
  )
}

function DetailField({ label, children }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ typography: 'body2', whiteSpace: 'pre-wrap' }}>{children}</Box>
    </Stack>
  )
}

// Asks for the reason before rejecting. Stays open if the request fails so the reason isn't lost;
// the error is shown in the page's snackbar.
function RejectDialog({ plant, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const canConfirm = reason.trim().length > 0

  function handleSubmit(event) {
    event.preventDefault()
    if (canConfirm && !busy) onConfirm(reason)
  }

  return (
    <Dialog
      open={Boolean(plant)}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { component: 'form', onSubmit: handleSubmit } }}
    >
      <DialogTitle>Reject {plant?.qr_code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            The botanist who recorded this plant will see this reason.
          </Typography>
          <TextField
            label="Rejection reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            required
            multiline
            minRows={3}
            autoFocus
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          color="error"
          loading={busy}
          disabled={!canConfirm}
        >
          Reject record
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function SpeciesName({ species }) {
  if (!species) {
    return (
      <Typography variant="body2" color="text.secondary">
        Unknown species
      </Typography>
    )
  }
  return (
    <>
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        {species.scientific_name}
      </Typography>
      {species.common_name ? (
        <Typography variant="caption" component="div" color="text.secondary">
          {species.common_name}
        </Typography>
      ) : null}
    </>
  )
}

// Five decimal places is about a metre, as precise as a phone GPS fix
function formatCoordinates(plant) {
  return `${plant.latitude.toFixed(5)}, ${plant.longitude.toFixed(5)}`
}

function formatHeight(heightCm) {
  return heightCm == null ? '—' : `${heightCm} cm`
}

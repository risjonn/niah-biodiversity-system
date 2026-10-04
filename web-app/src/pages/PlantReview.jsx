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
  Paper,
  Snackbar,
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
import { useAuth } from '../context/AuthContext'
import { usePlants } from '../hooks/usePlants'
import { conservationStatusChipColor, conservationStatusLabels } from '../lib/conservationStatus'

const OWN_RECORD_MESSAGE =
  'You submitted this record, another officer or admin needs to review it.'

export default function PlantReview() {
  const { user } = useAuth()
  const { fetchPendingPlants, reviewPlant } = usePlants()
  const [result, setResult] = useState(null)
  // Ids of records with a review request running, so their buttons can't be pressed twice
  const [busyIds, setBusyIds] = useState(() => new Set())
  // Dialogs hold an id rather than the record, so they close by themselves once it is reviewed
  const [detailId, setDetailId] = useState(null)
  const [rejectId, setRejectId] = useState(null)
  // The message stays set while the snackbar fades out, so only `open` is cleared on close
  const [snackbar, setSnackbar] = useState({ open: false })

  useEffect(() => {
    let cancelled = false
    fetchPendingPlants().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [fetchPendingPlants])

  const plants = result?.data ?? []
  const detailPlant = plants.find((plant) => plant.id === detailId) ?? null
  const rejectPlant = plants.find((plant) => plant.id === rejectId) ?? null

  // Row-level security stops anyone reviewing their own record (004_prevent_self_review.sql), so
  // the buttons are disabled up front. reviewPlant's error still covers anything else refused.
  const isOwnRecord = (plant) => Boolean(user) && plant.recorded_by === user.id

  // Resolves to true once the record is reviewed and removed from the list
  async function handleReview(plant, status, rejectionReason) {
    if (busyIds.has(plant.id) || isOwnRecord(plant)) return false

    setBusyIds((ids) => new Set(ids).add(plant.id))
    const { error } = await reviewPlant(plant.id, { status, rejectionReason })
    setBusyIds((ids) => {
      const next = new Set(ids)
      next.delete(plant.id)
      return next
    })

    if (error) {
      showSnackbar('error', error)
      return false
    }
    setResult((current) => ({
      ...current,
      data: current.data.filter((pending) => pending.id !== plant.id),
    }))
    showSnackbar('success', `${status === 'approved' ? 'Approved' : 'Rejected'} ${plant.qr_code}`)
    return true
  }

  // A new key per message restarts the auto-hide timer when one message replaces another
  function showSnackbar(severity, message) {
    setSnackbar((current) => ({ open: true, severity, message, key: (current.key ?? 0) + 1 }))
  }

  function closeSnackbar() {
    setSnackbar((current) => ({ ...current, open: false }))
  }

  async function handleConfirmReject(reason) {
    if (await handleReview(rejectPlant, 'rejected', reason)) setRejectId(null)
  }

  const actionsFor = (plant) => (
    <ReviewActions
      busy={busyIds.has(plant.id)}
      isOwnRecord={isOwnRecord(plant)}
      onApprove={() => handleReview(plant, 'approved')}
      onReject={() => setRejectId(plant.id)}
    />
  )

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h1">Plant review</Typography>
        {result && !result.error ? (
          <Typography variant="body1" color="text.secondary">
            {plants.length === 1
              ? '1 record waiting for review'
              : `${plants.length} records waiting for review`}
          </Typography>
        ) : null}
      </Stack>

      {!result ? (
        <Stack sx={{ alignItems: 'center', py: 4 }}>
          <CircularProgress aria-label="Loading records" />
        </Stack>
      ) : null}
      {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
      {result && !result.error && plants.length === 0 ? (
        <Typography variant="body1" color="text.secondary">
          Nothing waiting for review
        </Typography>
      ) : null}

      {plants.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>QR code</TableCell>
                <TableCell>Species</TableCell>
                <TableCell>Recorded</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Height</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {plants.map((plant) => (
                <PendingRow
                  key={plant.id}
                  plant={plant}
                  onOpen={() => setDetailId(plant.id)}
                  actions={actionsFor(plant)}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      <PlantDetailDialog
        plant={detailPlant}
        isOwnRecord={detailPlant ? isOwnRecord(detailPlant) : false}
        actions={detailPlant ? actionsFor(detailPlant) : null}
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

      <Snackbar
        key={snackbar.key}
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') closeSnackbar()
        }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={closeSnackbar}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Stack>
  )
}

// The row opens the full record, by click or by Enter when focused with the keyboard. Clicks and
// key presses on the action buttons are left to the buttons.
function PendingRow({ plant, onOpen, actions }) {
  return (
    <TableRow
      hover
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) onOpen()
      }}
      sx={{ cursor: 'pointer' }}
    >
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
      </TableCell>
      <TableCell>{formatHeight(plant.height_cm)}</TableCell>
      <TableCell onClick={(event) => event.stopPropagation()} sx={{ cursor: 'default' }}>
        {actions}
      </TableCell>
    </TableRow>
  )
}

function ReviewActions({ busy, isOwnRecord, onApprove, onReject }) {
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          color="success"
          loading={busy}
          disabled={isOwnRecord}
          onClick={onApprove}
        >
          Approve
        </Button>
        <Button
          variant="outlined"
          color="error"
          disabled={busy || isOwnRecord}
          onClick={onReject}
        >
          Reject
        </Button>
      </Stack>
      {isOwnRecord ? (
        <Typography variant="caption" color="text.secondary">
          {OWN_RECORD_MESSAGE}
        </Typography>
      ) : null}
    </Stack>
  )
}

function PlantDetailDialog({ plant, isOwnRecord, actions, onClose }) {
  return (
    <Dialog open={Boolean(plant)} onClose={onClose} fullWidth maxWidth="sm">
      {plant ? (
        <>
          <DialogTitle>{plant.qr_code}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {plant.photo_url ? (
                <PlantPhoto path={plant.photo_url} alt={`Photo of ${plant.qr_code}`} />
              ) : null}
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
              <DetailField label="Recorded by">
                {isOwnRecord ? 'You' : plant.recorded_by}
              </DetailField>
              <DetailField label="Coordinates">{formatCoordinates(plant)}</DetailField>
              <DetailField label="Location description">
                {plant.location_description || '—'}
              </DetailField>
              <DetailField label="Height">{formatHeight(plant.height_cm)}</DetailField>
              <DetailField label="Monitored">{plant.is_monitored ? 'Yes' : 'No'}</DetailField>
              <DetailField label="Morphological notes">
                {plant.morphological_notes || '—'}
              </DetailField>
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

// photo_url is a path in the private plant-photos bucket, so the image is shown through a signed
// URL. Loading lasts until both the URL and the image itself have arrived.
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
    <Box>
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
            width: '100%',
            borderRadius: 1,
            display: imageState === 'loaded' ? 'block' : 'none',
          }}
        />
      ) : null}
    </Box>
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

function formatDateTime(value) {
  return new Date(value).toLocaleString()
}

// Five decimal places is about a metre, as precise as a phone GPS fix
function formatCoordinates(plant) {
  return `${plant.latitude.toFixed(5)}, ${plant.longitude.toFixed(5)}`
}

function formatHeight(heightCm) {
  return heightCm == null ? '—' : `${heightCm} cm`
}

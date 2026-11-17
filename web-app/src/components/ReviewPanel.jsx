import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import EmptyState from './EmptyState'
import PlantPhotos from './PlantPhoto'
import RelativeTime from './RelativeTime'
import { conservationStatusChipColor, conservationStatusLabels } from '../lib/conservationStatus'
import { formatDateTime } from '../lib/formatDateTime'
import { mapUrl } from '../lib/mapUrl'
import { formatCoordinates, formatHeight } from '../lib/plantFormat'

// The review panel: one pending record at a time, with "Approve & next", "Reject & next" and
// "Skip". The page decides which record comes next; this panel only shows it and reports actions.
// - plant: the record to review, or null when none are left ("All caught up")
// - position: { index, total } for "3 of 15"
// - onPrevious / onNext: null at either end of the list
// - onApprove / onReject(reason): resolve once the request has finished
// - busy: a request is running; every action and shortcut waits for it
//
// Keyboard: A approve, R reject, left/right previous/next, Esc close (the drawer's own Esc).
// Ignored while busy, while typing in a field, and while the reject confirm or full-screen photo
// is open (in the full-screen photo, left/right move between the record's photos instead).
export default function ReviewPanel({
  open,
  plant,
  position,
  now,
  busy,
  onPrevious,
  onNext,
  onApprove,
  onReject,
  onSkip,
  onClose,
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)

  useEffect(() => {
    if (!open || !plant) return undefined

    function handleKeyDown(event) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (busy || rejectOpen || viewerOpen) return
      const target = event.target
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'a') onApprove()
      else if (key === 'r') setRejectOpen(true)
      else if (event.key === 'ArrowLeft' && onPrevious) onPrevious()
      else if (event.key === 'ArrowRight' && onNext) onNext()
      else return
      event.preventDefault()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, plant, busy, rejectOpen, viewerOpen, onApprove, onPrevious, onNext])

  async function handleConfirmReject(reason) {
    await onReject(reason)
    setRejectOpen(false)
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={busy ? undefined : onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', md: 720 } } } }}
    >
      <Stack sx={{ height: '100%' }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', px: { xs: 2, sm: 3 }, py: 1.5 }}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h2" component="h2" noWrap>
              {plant ? plant.qr_code : 'Plant review'}
            </Typography>
            {plant ? (
              <Typography variant="body2" color="textSecondary">
                {position.index + 1} of {position.total}
              </Typography>
            ) : null}
          </Box>
          {plant ? (
            <>
              <IconButton aria-label="Previous record" onClick={onPrevious} disabled={!onPrevious || busy}>
                <ChevronLeftIcon />
              </IconButton>
              <IconButton aria-label="Next record" onClick={onNext} disabled={!onNext || busy}>
                <ChevronRightIcon />
              </IconButton>
            </>
          ) : null}
          <IconButton aria-label="Close" onClick={onClose} disabled={busy} edge="end">
            <CloseIcon />
          </IconButton>
        </Stack>
        <Divider />

        {plant ? (
          <>
            <Box sx={{ flexGrow: 1, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2 }}>
              <RecordDetails plant={plant} now={now} onViewerOpenChange={setViewerOpen} />
            </Box>
            <Divider />
            <ReviewActions busy={busy} onApprove={onApprove} onReject={() => setRejectOpen(true)} onSkip={onSkip} />
          </>
        ) : (
          <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState
              message="All caught up"
              action={
                <Button variant="contained" onClick={onClose}>
                  Close
                </Button>
              }
            />
          </Box>
        )}
      </Stack>

      {/* Keyed by record, so the reason starts empty for each one */}
      {plant ? (
        <RejectConfirm
          key={plant.id}
          open={rejectOpen}
          plant={plant}
          busy={busy}
          onConfirm={handleConfirmReject}
          onClose={() => setRejectOpen(false)}
        />
      ) : null}
    </Drawer>
  )
}

function RecordDetails({ plant, now, onViewerOpenChange }) {
  const species = plant.species

  return (
    <Stack spacing={3}>
      {/* Keyed by record, so each one starts at its cover */}
      <PlantPhotos
        key={plant.id}
        plant={plant}
        maxHeight="45vh"
        onViewerOpenChange={onViewerOpenChange}
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          columnGap: 3,
          rowGap: 2,
        }}
      >
        <DetailField label="Species">
          {species ? (
            <>
              <Box component="span" sx={{ fontStyle: 'italic', display: 'block' }}>
                {species.scientific_name}
              </Box>
              {species.common_name ? (
                <Typography variant="caption" component="span" color="textSecondary" sx={{ display: 'block' }}>
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
        <DetailField label="Recorded">
          <RelativeTime value={plant.recorded_at} now={now} longAges />
          <Typography variant="caption" component="span" color="textSecondary" sx={{ display: 'block' }}>
            {formatDateTime(plant.recorded_at)}
          </Typography>
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
        <DetailField label="Synced">{plant.synced_at ? formatDateTime(plant.synced_at) : '—'}</DetailField>
        <DetailField label="Morphological notes">{plant.morphological_notes || '—'}</DetailField>
      </Box>
    </Stack>
  )
}

// A key shown on a button or in the hints, e.g. "A"
function Kbd({ children }) {
  return (
    <Box
      component="kbd"
      sx={{
        ml: 1,
        px: 0.75,
        borderRadius: 0.5,
        border: 1,
        borderColor: 'currentColor',
        fontFamily: 'inherit',
        typography: 'caption',
        lineHeight: 1.6,
        opacity: 0.8,
      }}
    >
      {children}
    </Box>
  )
}

function ReviewActions({ busy, onApprove, onReject, onSkip }) {
  return (
    <Stack spacing={1} sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="contained" color="success" loading={busy} onClick={onApprove}>
          Approve &amp; next
          <Kbd>A</Kbd>
        </Button>
        <Button variant="outlined" color="error" disabled={busy} onClick={onReject}>
          Reject &amp; next
          <Kbd>R</Kbd>
        </Button>
        <Button disabled={busy} onClick={onSkip}>
          Skip
        </Button>
      </Stack>
      <Typography variant="caption" color="textSecondary">
        <Kbd>←</Kbd> <Kbd>→</Kbd> previous / next
        <Kbd>Esc</Kbd> close
      </Typography>
    </Stack>
  )
}

// The usual reasons, offered as one-click fills for the reason field
const QUICK_REASONS = [
  'Photo unclear',
  'Wrong species',
  'Duplicate record',
  'Location inaccurate',
  'Not a plant record',
]

// A short confirm before rejecting. A reason is required: it is saved as the record's
// rejection_reason, which the botanist sees in My Records on the mobile app. A quick-pick chip fills
// the field, which stays editable.
function RejectConfirm({ open, plant, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const canConfirm = reason.trim().length > 0

  function handleSubmit(event) {
    event.preventDefault()
    if (canConfirm && !busy) onConfirm(reason)
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      slotProps={{ paper: { component: 'form', onSubmit: handleSubmit } }}
    >
      <DialogTitle>Reject {plant.qr_code}?</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            The botanist who recorded it sees this reason in My Records.
          </DialogContentText>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
            role="group"
            aria-label="Common reasons"
          >
            {QUICK_REASONS.map((quickReason) => {
              const chosen = reason.trim() === quickReason
              return (
                <Chip
                  key={quickReason}
                  label={quickReason}
                  size="small"
                  variant={chosen ? 'filled' : 'outlined'}
                  color={chosen ? 'primary' : 'default'}
                  aria-pressed={chosen}
                  disabled={busy}
                  onClick={() => setReason(quickReason)}
                />
              )
            })}
          </Stack>
          <TextField
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            required
            multiline
            minRows={2}
            autoFocus
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" color="error" loading={busy} disabled={!canConfirm}>
          Reject &amp; next
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// The photo as large as the screen allows, on a dark background
function DetailField({ label, children }) {
  return (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="textSecondary">
        {label}
      </Typography>
      <Box sx={{ typography: 'body2', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</Box>
    </Stack>
  )
}

import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useSpecies } from '../hooks/useSpecies'
import { usePlants } from '../hooks/usePlants'
import { conservationStatusChipColor, conservationStatusLabels } from '../lib/conservationStatus'
import { formatDateTime } from '../lib/formatDateTime'

// Matches the plant_review_status enum in database/schema/001_initial_schema.sql. Colours follow
// docs/design-system.md: alert for waiting, success for approved, error for rejected.
const REVIEW_STATUSES = ['pending_review', 'approved', 'rejected']

const reviewStatusLabels = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const reviewStatusChipColors = {
  pending_review: 'warning',
  approved: 'success',
  rejected: 'error',
}

// Editing happens on SpeciesForm (/species/:id/edit); deleting is confirmed in a dialog here
export default function SpeciesDetail() {
  const { id } = useParams()
  const { getSpeciesById } = useSpecies()
  const { getPlantsBySpecies } = usePlants()
  // Bumped by Retry so the same id loads again
  const [attempt, setAttempt] = useState(0)

  // Kept with the id it was loaded for, so opening another species shows loading again and a slow
  // earlier request can never overwrite a newer one (the same approach as SpeciesList)
  const loadKey = `${id}|${attempt}`
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const speciesResult = await getSpeciesById(id)
      // Records are only looked up for a species that exists, which also keeps a malformed id
      // from reaching the plants query
      const plantsResult = speciesResult.data
        ? await getPlantsBySpecies(id)
        : { data: [], error: null }
      if (!cancelled) {
        setResult({
          loadKey,
          species: speciesResult.data,
          speciesError: speciesResult.error,
          plants: plantsResult.data,
          plantsError: plantsResult.error,
        })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [getSpeciesById, getPlantsBySpecies, id, loadKey])

  const isLoading = result?.loadKey !== loadKey
  const retry = () => setAttempt((current) => current + 1)

  return (
    <Stack spacing={3}>
      <Box>
        <Button component={RouterLink} to="/species" startIcon={<ArrowBackIcon />}>
          Back to species
        </Button>
      </Box>

      {isLoading ? (
        <Stack sx={{ alignItems: 'center', py: 4 }}>
          <CircularProgress aria-label="Loading species" />
        </Stack>
      ) : null}

      {!isLoading && result.speciesError ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={retry}>
              Retry
            </Button>
          }
        >
          {result.speciesError}
        </Alert>
      ) : null}

      {!isLoading && !result.speciesError && !result.species ? (
        <Stack spacing={1}>
          <Typography variant="h1">Species not found</Typography>
          <Typography variant="body1" color="text.secondary">
            This species may have been removed, or the link may be wrong.
          </Typography>
        </Stack>
      ) : null}

      {!isLoading && result.species ? (
        <SpeciesContent
          species={result.species}
          plants={result.plants}
          plantsError={result.plantsError}
          onRetry={retry}
        />
      ) : null}
    </Stack>
  )
}

function SpeciesContent({ species, plants, plantsError, onRetry }) {
  const status = species.conservation_status
  const statusLabel = conservationStatusLabels[status] ?? status
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
        {/* Keyed by the URL so a changed photo starts loading again */}
        <ReferencePhoto
          key={species.reference_photo_url ?? ''}
          url={species.reference_photo_url}
          alt={`Reference photo of ${species.scientific_name}`}
        />
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h1" sx={{ fontStyle: 'italic' }}>
            {species.scientific_name}
          </Typography>
          {species.common_name ? (
            <Typography variant="h3" component="p">
              {species.common_name}
            </Typography>
          ) : null}
          <Typography variant="body1" color="text.secondary">
            {species.family ? `Family: ${species.family}` : 'Family not recorded yet'}
          </Typography>
          <Chip label={statusLabel} color={conservationStatusChipColor(status)} />
          {species.updated_at ? (
            <Typography variant="caption" color="text.secondary">
              Last updated {formatDateTime(species.updated_at)}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to={`/species/${species.id}/edit`} variant="outlined">
              Edit
            </Button>
            <Button variant="outlined" color="error" onClick={() => setIsDeleteOpen(true)}>
              Delete
            </Button>
          </Stack>
        </Stack>
      </Stack>

      <TextSection title="Description" text={species.description} />
      <TextSection title="Cultural significance" text={species.cultural_significance} />

      <SpeciesRecords plants={plants} error={plantsError} onRetry={onRetry} />

      <DeleteSpeciesDialog
        open={isDeleteOpen}
        species={species}
        // If the records failed to load this is 0, and a refused delete is caught by its error
        recordCount={plants.length}
        onClose={() => setIsDeleteOpen(false)}
      />
    </>
  )
}

// A species with plant records can't be deleted (they reference it), so the dialog only offers
// deleting when there are none
function DeleteSpeciesDialog({ open, species, recordCount, onClose }) {
  const navigate = useNavigate()
  const { deleteSpecies, removeSpeciesPhoto } = useSpecies()
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState(null)
  const hasRecords = recordCount > 0

  function handleClose() {
    if (isDeleting) return
    setError(null)
    onClose()
  }

  async function handleDelete() {
    setIsDeleting(true)
    setError(null)
    const result = await deleteSpecies(species.id)
    if (result.error) {
      setError(result.error)
      setIsDeleting(false)
      return
    }
    // Not awaited: removeSpeciesPhoto never fails and leaving the page doesn't stop it
    removeSpeciesPhoto(species.reference_photo_url)
    // Replaced so Back doesn't return to the deleted species
    navigate('/species', { replace: true })
  }

  const name = (
    <Box component="span" sx={{ fontStyle: 'italic' }}>
      {species.scientific_name}
    </Box>
  )

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>{hasRecords ? <>{name} can&apos;t be deleted</> : <>Delete {name}?</>}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            {hasRecords
              ? `This species has ${recordCount} plant ${recordCount === 1 ? 'record' : 'records'} and cannot be deleted.`
              : "This permanently removes the species and its reference photo. It can't be undone."}
          </DialogContentText>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {hasRecords ? (
          <Button onClick={handleClose}>Close</Button>
        ) : (
          <>
            <Button onClick={handleClose} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="contained" color="error" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

function TextSection({ title, text }) {
  const value = text?.trim()

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={1}>
        <Typography variant="h2">{title}</Typography>
        {value ? (
          // Keeps the line breaks the text was entered with
          <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
            {value}
          </Typography>
        ) : (
          <Typography variant="body1" color="text.secondary">
            Not recorded yet
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}

// reference_photo_url is a plain image URL for now, not a storage path
function ReferencePhoto({ url, alt }) {
  const [status, setStatus] = useState('loading')

  return (
    <Box
      sx={{
        position: 'relative',
        flexShrink: 0,
        width: { xs: '100%', md: 320 },
        aspectRatio: '4 / 3',
        overflow: 'hidden',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      {url ? (
        <>
          {status === 'loading' ? (
            <Skeleton
              variant="rectangular"
              aria-label="Loading photo"
              sx={{ position: 'absolute', inset: 0, height: '100%' }}
            />
          ) : null}
          {status === 'error' ? (
            <PhotoMessage>This photo could not be loaded.</PhotoMessage>
          ) : null}
          <Box
            component="img"
            src={url}
            alt={alt}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
            sx={{
              display: status === 'loaded' ? 'block' : 'none',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        </>
      ) : (
        <PhotoMessage>No reference photo yet</PhotoMessage>
      )}
    </Box>
  )
}

function PhotoMessage({ children }) {
  return (
    <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        {children}
      </Typography>
    </Stack>
  )
}

function SpeciesRecords({ plants, error, onRetry }) {
  const counts = Object.fromEntries(
    REVIEW_STATUSES.map((status) => [
      status,
      plants.filter((plant) => plant.review_status === status).length,
    ]),
  )

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h2">Records of this species</Typography>

        {error ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={onRetry}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        ) : (
          <>
            <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {REVIEW_STATUSES.map((status) => (
                <Box key={status}>
                  <Typography variant="h2" component="p">
                    {counts[status]}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {reviewStatusLabels[status]}
                  </Typography>
                </Box>
              ))}
            </Stack>

            {plants.length === 0 ? (
              <Typography variant="body1" color="text.secondary">
                No plant records for this species yet
              </Typography>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>QR code</TableCell>
                      <TableCell>Status</TableCell>
                      {/* Sets the column's width, so a narrow screen scrolls the table sideways instead */}
                      <TableCell sx={{ minWidth: (theme) => theme.spacing(30) }}>
                        Location description
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>Recorded</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {plants.map((plant) => (
                      <TableRow key={plant.id}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{plant.qr_code}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={reviewStatusLabels[plant.review_status] ?? plant.review_status}
                            color={reviewStatusChipColors[plant.review_status] ?? 'default'}
                          />
                        </TableCell>
                        <TableCell>{plant.location_description ?? '—'}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {formatDateTime(plant.recorded_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </Stack>
    </Paper>
  )
}

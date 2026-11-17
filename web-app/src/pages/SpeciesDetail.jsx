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
  Grid,
  Link,
  Paper,
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
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import HighlightOffOutlinedIcon from '@mui/icons-material/HighlightOffOutlined'
import ChartCard from '../components/ChartCard'
import EmptyState from '../components/EmptyState'
import LeafPlaceholder from '../components/LeafPlaceholder'
import PageHeader from '../components/PageHeader'
import PhotoGallery from '../components/PhotoGallery'
import PlantRecordPanel from '../components/PlantRecordPanel'
import RecordsByMonthBars from '../components/RecordsByMonthBars'
import StatCard from '../components/StatCard'
import { useToast } from '../context/ToastContext'
import { useSpecies } from '../hooks/useSpecies'
import { usePlants } from '../hooks/usePlants'
import { conservationStatusChipColor, conservationStatusLabels } from '../lib/conservationStatus'
import { formatDateTime, sarawakMonthKeyOf } from '../lib/formatDateTime'
import { monthKeysBetween, monthKeysEndingAt, monthlyRowsFromPlants } from '../lib/recordMonths'
import { formatMonth } from '../lib/reportExport'
import { reviewStatusChipColors, reviewStatusLabels } from '../lib/reviewStatus'

// The order the record counts are shown in on this page. Labels and colours are shared
// (lib/reviewStatus.js).
const REVIEW_STATUSES = ['pending_review', 'approved', 'rejected']

// The icon on each count's card. Pending matches the dashboard's pending reviews card.
const STATUS_ICONS = {
  pending_review: FactCheckOutlinedIcon,
  approved: CheckCircleOutlineIcon,
  rejected: HighlightOffOutlinedIcon,
}

// Editing happens on SpeciesForm (/species/:id/edit); deleting is confirmed in a dialog here
export default function SpeciesDetail() {
  const { id } = useParams()
  const { getSpeciesById, getSpeciesPhotos } = useSpecies()
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
      // Records and photos are only looked up for a species that exists, which also keeps a
      // malformed id from reaching those queries
      const [plantsResult, photosResult] = speciesResult.data
        ? await Promise.all([getPlantsBySpecies(id), getSpeciesPhotos(id)])
        : [
            { data: [], error: null },
            { data: [], error: null },
          ]
      if (!cancelled) {
        setResult({
          loadKey,
          species: speciesResult.data,
          speciesError: speciesResult.error,
          plants: plantsResult.data,
          plantsError: plantsResult.error,
          photos: speciesPhotosOrCover(speciesResult.data, photosResult.data),
        })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [getSpeciesById, getPlantsBySpecies, getSpeciesPhotos, id, loadKey])

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
        <PageHeader
          title="Species not found"
          subtitle="This species may have been removed, or the link may be wrong."
        />
      ) : null}

      {!isLoading && result.species ? (
        <SpeciesContent
          species={result.species}
          photos={result.photos}
          plants={result.plants}
          plantsError={result.plantsError}
          onRetry={retry}
        />
      ) : null}
    </Stack>
  )
}

// The species' photos for the gallery. If species_photos couldn't be read (or has no rows while
// the species still has a cover, which 017's triggers shouldn't allow), the cover alone is shown,
// as before multiple photos.
function speciesPhotosOrCover(species, photos) {
  if (!species) return []
  if (photos.length > 0) return photos
  return species.reference_photo_url ? [{ id: null, url: species.reference_photo_url }] : []
}

function SpeciesContent({ species, photos, plants, plantsError, onRetry }) {
  const status = species.conservation_status
  const statusLabel = conservationStatusLabels[status] ?? status
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

  return (
    <>
      {/* The photos beside the name, family and status; stacked on narrow screens */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: { md: 'flex-start' } }}>
        <SpeciesPhotos species={species} photos={photos} />
        <Stack spacing={2} sx={{ flexGrow: 1, minWidth: 0 }}>
          <PageHeader
            title={
              <Box component="span" sx={{ fontStyle: 'italic' }}>
                {species.scientific_name}
              </Box>
            }
            subtitle={species.common_name}
            action={
              <Stack direction="row" spacing={1}>
                <Button component={RouterLink} to={`/species/${species.id}/edit`} variant="outlined">
                  Edit
                </Button>
                <Button variant="outlined" color="error" onClick={() => setIsDeleteOpen(true)}>
                  Delete
                </Button>
              </Stack>
            }
          />
          <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="body1" color="textSecondary">
              {species.family ? `Family: ${species.family}` : 'Family not recorded yet'}
            </Typography>
            <Chip label={statusLabel} color={conservationStatusChipColor(status)} />
            {species.updated_at ? (
              <Typography variant="caption" color="textSecondary">
                Last updated {formatDateTime(species.updated_at)}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      </Stack>

      <TextSection title="Description" text={species.description} />
      <TextSection title="Cultural significance" text={species.cultural_significance} />

      <SpeciesRecords plants={plants} error={plantsError} onRetry={onRetry} />

      <DeleteSpeciesDialog
        open={isDeleteOpen}
        species={species}
        photos={photos}
        // If the records failed to load this is 0, and a refused delete is caught by its error
        recordCount={plants.length}
        onClose={() => setIsDeleteOpen(false)}
      />
    </>
  )
}

// A species with plant records can't be deleted (they reference it), so the dialog only offers
// deleting when there are none
function DeleteSpeciesDialog({ open, species, photos, recordCount, onClose }) {
  const navigate = useNavigate()
  const toast = useToast()
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
    // The photo rows went with the species (on delete cascade); their files are removed here.
    // Not awaited: removeSpeciesPhoto never fails and leaving the page doesn't stop it.
    for (const photo of photos) removeSpeciesPhoto(photo.url)
    // Shown on the species list, which the app-wide toast outlives the navigation to
    toast.success(`Deleted ${species.scientific_name}`)
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
              : `This permanently removes the species${photos.length === 0 ? '' : photos.length === 1 ? ' and its photo' : ' and its photos'}. It can't be undone.`}
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
          <Typography variant="body1" color="textSecondary">
            Not recorded yet
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}

// The species' photos (public URLs, nothing to sign) as a gallery: the cover in a 4:3 frame,
// thumbnails under it when there are more, full screen on click. Without a photo (or if one
// won't load) it is the species list's leaf placeholder with a short note.
function SpeciesPhotos({ species, photos }) {
  const name = species.scientific_name
  const total = photos.length

  return (
    <PhotoGallery
      fit="cover"
      photos={photos.map((photo, index) => ({
        key: photo.id ?? photo.url,
        url: photo.url,
        alt: total > 1 ? `Photo ${index + 1} of ${total} of ${name}` : `Reference photo of ${name}`,
      }))}
      empty={
        <Box sx={{ position: 'relative', aspectRatio: '4 / 3', ...placeholderFrameSx }}>
          <LeafNote conservationStatus={species.conservation_status}>No reference photo yet</LeafNote>
        </Box>
      }
      broken={
        <LeafNote conservationStatus={species.conservation_status}>
          This photo could not be loaded.
        </LeafNote>
      }
      sx={{ flexShrink: 0, width: { xs: '100%', md: 400, lg: 480 } }}
    />
  )
}

const placeholderFrameSx = {
  overflow: 'hidden',
  borderRadius: 1,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.default',
}

// The leaf placeholder filling its frame, with a note along the bottom
function LeafNote({ conservationStatus, children }) {
  return (
    <Box sx={{ position: 'absolute', inset: 0 }}>
      <LeafPlaceholder conservationStatus={conservationStatus} />
      {/* Primary text: the secondary grey falls below AA (4.5:1) on the darker tints */}
      <Typography
        variant="caption"
        color="textPrimary"
        sx={{ position: 'absolute', left: 0, right: 0, bottom: 12, textAlign: 'center' }}
      >
        {children}
      </Typography>
    </Box>
  )
}

function SpeciesRecords({ plants, error, onRetry }) {
  // The record open in the panel. This list only has a few columns, so the panel loads the rest.
  const [openPlantId, setOpenPlantId] = useState(null)
  const counts = Object.fromEntries(
    REVIEW_STATUSES.map((status) => [
      status,
      plants.filter((plant) => plant.review_status === status).length,
    ]),
  )

  return (
    <Stack component="section" spacing={2} aria-labelledby="species-records-heading">
      <Typography variant="h2" id="species-records-heading">
        Records of this species
      </Typography>

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
      ) : null}
      {!error && plants.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState message="No plant records for this species yet" />
        </Paper>
      ) : null}

      {!error && plants.length > 0 ? (
        <>
          <Grid container spacing={2}>
            {REVIEW_STATUSES.map((status) => (
              <Grid key={status} size={{ xs: 12, sm: 4 }}>
                <StatCard
                  size="small"
                  labelComponent="h3"
                  icon={STATUS_ICONS[status]}
                  color={reviewStatusChipColors[status]}
                  label={reviewStatusLabels[status]}
                  value={counts[status].toLocaleString('en-MY')}
                />
              </Grid>
            ))}
          </Grid>

          <RecordsOverTime plants={plants} />

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
                  // The row opens the record's panel; the QR code is also a button, for the keyboard
                  <TableRow
                    key={plant.id}
                    hover
                    onClick={() => setOpenPlantId(plant.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Link
                        component="button"
                        variant="body2"
                        onClick={(event) => {
                          event.stopPropagation()
                          setOpenPlantId(plant.id)
                        }}
                      >
                        {plant.qr_code}
                      </Link>
                    </TableCell>
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
        </>
      ) : null}
      <PlantRecordPanel plantId={openPlantId} onClose={() => setOpenPlantId(null)} />
    </Stack>
  )
}

// The species' records per month, stacked by review status, from the records the page already
// loaded. It runs from the month of the first record to this month (Sarawak time), and covers
// at least the last MIN_MONTHS months so a new species still gets a readable chart.
function RecordsOverTime({ plants }) {
  // Fixed for this visit, like the dashboard's date
  const [now] = useState(() => Date.now())
  const monthKeys = recordMonthKeys(plants, now)
  const data = monthlyRowsFromPlants(plants, monthKeys)

  return (
    <ChartCard
      title="Records over time"
      subtitle={`${formatMonth(`${monthKeys[0]}-01`)} to ${formatMonth(`${monthKeys.at(-1)}-01`)}`}
      height={240}
    >
      <RecordsByMonthBars data={data} />
    </ChartCard>
  )
}

const MIN_MONTHS = 6

function recordMonthKeys(plants, now) {
  const recordedMonths = plants.map((plant) => sarawakMonthKeyOf(plant.recorded_at)).filter(Boolean)
  // 'YYYY-MM' keys sort as text in date order
  const last = [sarawakMonthKeyOf(now), ...recordedMonths].sort().at(-1)
  const first = recordedMonths.length > 0 ? [...recordedMonths].sort()[0] : last
  const keys = monthKeysBetween(first, last)
  return keys.length >= MIN_MONTHS ? keys : monthKeysEndingAt(last, MIN_MONTHS)
}

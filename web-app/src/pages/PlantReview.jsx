import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  Link,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined'
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { NoPhoto } from '../components/PlantPhoto'
import RelativeTime from '../components/RelativeTime'
import ReviewPanel from '../components/ReviewPanel'
import TableSkeleton from '../components/TableSkeleton'
import { useNavCounts } from '../context/NavCountsContext'
import { useToast } from '../context/ToastContext'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePlants } from '../hooks/usePlants'
import { conservationStatusChipColor, conservationStatusLabels } from '../lib/conservationStatus'
import { formatDateTime } from '../lib/formatDateTime'
import { mapUrl } from '../lib/mapUrl'
import { formatCoordinates, formatHeight } from '../lib/plantFormat'

const VIEW_STORAGE_KEY = 'niah.reviewView'
const VIEWS = ['cards', 'table']

// Remembered per browser. Storage can be unavailable (private windows, blocked site data), so
// reading and writing fall back quietly to the cards.
function readView() {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    return VIEWS.includes(stored) ? stored : 'cards'
  } catch {
    return 'cards'
  }
}

function writeView(view) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // Not remembered this time; the toggle still works
  }
}

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

// The species filter, QR search and sort, applied to the queue in the browser (fetchPendingPlants
// already returns every pending record the user can review). Oldest first by default, so the
// records that have waited longest come first.
function applyFilters(plants, { speciesId, search, sort }) {
  const term = search.trim().toUpperCase()
  return plants
    .filter((plant) => !speciesId || plant.species_id === speciesId)
    .filter((plant) => !term || plant.qr_code.toUpperCase().includes(term))
    .sort((a, b) => {
      const difference = new Date(a.recorded_at) - new Date(b.recorded_at)
      return sort === 'newest' ? -difference : difference
    })
}

export default function PlantReview() {
  const { fetchPendingPlants, getPlantPhotoUrls, reviewPlant } = usePlants()
  const toast = useToast()
  const { refreshCounts } = useNavCounts()
  // { data, error, loadedAt }: the queue, and when it was loaded (the "now" for relative times)
  const [result, setResult] = useState(null)
  // Signed URLs for the queue's photos, by storage path (one request for the whole queue)
  const [photoUrls, setPhotoUrls] = useState(null)
  const [view, setView] = useState(readView)
  const [speciesId, setSpeciesId] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [sort, setSort] = useState('oldest')
  // The review panel: open, and the record it shows (null when none are left)
  const [panelOpen, setPanelOpen] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy] = useState(false)

  // Loads the queue and then signs its photos in one go. Resolves to the new queue. State is only
  // set in the .then callbacks, never synchronously, so it can be called straight from an effect
  // (the same approach as the sensors page).
  const loadQueue = useCallback(
    () =>
      fetchPendingPlants().then((nextResult) => {
        setResult({ ...nextResult, loadedAt: Date.now() })
        return getPlantPhotoUrls(nextResult.data.map((plant) => plant.photo_url)).then((photos) => {
          setPhotoUrls((current) => ({ ...current, ...photos.data }))
          return nextResult
        })
      }),
    [fetchPendingPlants, getPlantPhotoUrls],
  )

  useEffect(() => {
    loadQueue()
  }, [loadQueue])

  const plants = result?.data ?? []
  const filters = { speciesId, search: debouncedSearch, sort }
  const visible = applyFilters(plants, filters)
  const index = visible.findIndex((plant) => plant.id === openId)
  const current = index === -1 ? null : visible[index]
  const hasFilters = Boolean(speciesId || search.trim())

  // Species in the queue, for the filter, by scientific name
  const speciesOptions = [...new Map(plants.filter((p) => p.species).map((p) => [p.species.id, p.species])).values()]
    .sort((a, b) => a.scientific_name.localeCompare(b.scientific_name))

  function changeView(_event, next) {
    if (!next) return
    setView(next)
    writeView(next)
  }

  function openPanel(plant) {
    setOpenId(plant.id)
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    setOpenId(null)
  }

  // After a decision: the record that now sits where this one was, or the first left (the list
  // wraps round, so skipped records come back), or nothing ("All caught up")
  function nextAfterRemoving(list, removedId, atIndex) {
    const remaining = list.filter((plant) => plant.id !== removedId)
    return remaining[atIndex]?.id ?? remaining[0]?.id ?? null
  }

  async function decide(status, rejectionReason) {
    const plant = current
    if (!plant || busy) return

    setBusy(true)
    const { error } = await reviewPlant(plant.id, { status, rejectionReason })

    if (error) {
      // Most often someone else reviewed it first. Show why, reload the queue, and move on if
      // this record has gone from it; if it's still waiting (e.g. the connection dropped), stay.
      toast.error(error)
      const refreshed = await loadQueue()
      if (!refreshed.error && !refreshed.data.some((pending) => pending.id === plant.id)) {
        setOpenId(nextAfterRemoving(applyFilters(refreshed.data, filters), plant.id, index))
      }
      refreshCounts()
      setBusy(false)
      return
    }

    setResult((currentResult) => ({
      ...currentResult,
      data: currentResult.data.filter((pending) => pending.id !== plant.id),
    }))
    setOpenId(nextAfterRemoving(visible, plant.id, index))
    toast.success(`${status === 'approved' ? 'Approved' : 'Rejected'} ${plant.qr_code}`)
    // One fewer pending review on the sidebar badge
    refreshCounts()
    setBusy(false)
  }

  // Skip leaves the record waiting and goes to the next one, round to the start at the end
  function skip() {
    setOpenId(visible[index + 1]?.id ?? visible[0]?.id ?? null)
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
        <Typography variant="body2" color="textSecondary">
          Your own records are reviewed by another officer.
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          useFlexGap
          sx={{ alignItems: { md: 'center' } }}
        >
          <TextField
            select
            label="Species"
            value={speciesId}
            onChange={(event) => setSpeciesId(event.target.value)}
            sx={{ flex: { md: 2 }, minWidth: 0 }}
          >
            <MenuItem value="">All species</MenuItem>
            {speciesOptions.map((species) => (
              <MenuItem key={species.id} value={species.id}>
                <Box component="span" sx={{ fontStyle: 'italic' }}>
                  {species.scientific_name}
                </Box>
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="QR code"
            placeholder="e.g. NIAH-3FA9"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ flex: { md: 2 }, minWidth: 0 }}
          />
          <TextField
            select
            label="Sort"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            sx={{ flex: { md: 1.5 }, minWidth: 0 }}
          >
            <MenuItem value="oldest">Oldest first</MenuItem>
            <MenuItem value="newest">Newest first</MenuItem>
          </TextField>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="textSecondary" sx={{ whiteSpace: 'nowrap' }} aria-live="polite">
              {result && !result.error
                ? hasFilters
                  ? `${visible.length} of ${plants.length}`
                  : `${plants.length} ${plants.length === 1 ? 'record' : 'records'}`
                : null}
            </Typography>
            <ToggleButtonGroup value={view} exclusive onChange={changeView} size="small" aria-label="View">
              <ToggleButton value="cards" aria-label="Cards">
                <GridViewOutlinedIcon fontSize="small" />
              </ToggleButton>
              <ToggleButton value="table" aria-label="Table">
                <ViewListOutlinedIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
      </Paper>

      {!result ? (
        view === 'cards' ? <CardsSkeleton /> : <TableSkeleton columns={COLUMNS} label="Loading records" />
      ) : null}
      {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
      {result && !result.error && plants.length === 0 ? (
        <EmptyState message="Nothing waiting for review" />
      ) : null}
      {result && !result.error && plants.length > 0 && visible.length === 0 ? (
        <EmptyState
          message="No records match these filters"
          action={
            <Button
              variant="outlined"
              onClick={() => {
                setSpeciesId('')
                setSearch('')
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : null}

      {visible.length > 0 && view === 'cards' ? (
        <Grid container spacing={2}>
          {visible.map((plant) => (
            <Grid key={plant.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <ReviewCard
                plant={plant}
                photoUrl={photoUrls ? (photoUrls[plant.photo_url] ?? null) : undefined}
                now={result.loadedAt}
                onOpen={() => openPanel(plant)}
              />
            </Grid>
          ))}
        </Grid>
      ) : null}

      {visible.length > 0 && view === 'table' ? (
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
              {visible.map((plant) => (
                <PendingRow key={plant.id} plant={plant} onOpen={() => openPanel(plant)} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      <ReviewPanel
        open={panelOpen}
        plant={current}
        position={{ index, total: visible.length }}
        now={result?.loadedAt ?? 0}
        busy={busy}
        onPrevious={index > 0 ? () => setOpenId(visible[index - 1].id) : null}
        onNext={index !== -1 && index < visible.length - 1 ? () => setOpenId(visible[index + 1].id) : null}
        onApprove={() => decide('approved')}
        onReject={(reason) => decide('rejected', reason)}
        onSkip={skip}
        onClose={closePanel}
      />
    </Stack>
  )
}

// One pending record as a card. The whole card opens the review panel.
// photoUrl: a signed URL, null when it couldn't be signed, or undefined while the URLs load.
function ReviewCard({ plant, photoUrl, now, onOpen }) {
  const species = plant.species

  return (
    <Card
      variant="outlined"
      sx={(theme) => ({
        height: '100%',
        transition: theme.transitions.create(['transform', 'box-shadow'], {
          duration: theme.transitions.duration.shorter,
        }),
        '@media (hover: hover)': {
          '&:hover': { transform: 'translateY(-2px)', boxShadow: theme.shadows[3] },
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover': { transform: 'none' },
        },
      })}
    >
      <CardActionArea
        onClick={onOpen}
        sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        <Box sx={{ aspectRatio: '4 / 3', bgcolor: 'background.default', overflow: 'hidden' }}>
          <CardPhoto plant={plant} url={photoUrl} />
        </Box>
        <CardContent sx={{ flexGrow: 1 }}>
          <Stack spacing={1}>
            <Box>
              <Typography variant="body1" component="h2" sx={{ fontStyle: 'italic', fontWeight: 600 }}>
                {species?.scientific_name ?? 'Unknown species'}
              </Typography>
              {species?.common_name ? (
                <Typography variant="body2" color="textSecondary">
                  {species.common_name}
                </Typography>
              ) : null}
            </Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {species ? (
                <Chip
                  size="small"
                  label={conservationStatusLabels[species.conservation_status] ?? species.conservation_status}
                  color={conservationStatusChipColor(species.conservation_status)}
                />
              ) : null}
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {plant.qr_code}
              </Typography>
            </Stack>
            <Typography variant="body2" color="textSecondary" component="div">
              Recorded <RelativeTime value={plant.recorded_at} now={now} longAges />
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ overflowWrap: 'anywhere' }}>
              {plant.location_description || formatCoordinates(plant)}
            </Typography>
            {plant.height_cm != null ? (
              <Typography variant="body2" color="textSecondary">
                Height {formatHeight(plant.height_cm)}
              </Typography>
            ) : null}
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

function CardPhoto({ plant, url }) {
  const [failed, setFailed] = useState(false)
  if (plant.photo_url && url === undefined) {
    return <Skeleton variant="rectangular" sx={{ width: '100%', height: '100%' }} />
  }
  if (!plant.photo_url || !url || failed) return <NoPhoto fill />
  return (
    <Box
      component="img"
      src={url}
      alt={`Photo of ${plant.qr_code}`}
      loading="lazy"
      onError={() => setFailed(true)}
      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  )
}

// Placeholder cards while the queue loads, in the same grid
function CardsSkeleton() {
  return (
    <Box role="status" aria-label="Loading records">
      <Grid container spacing={2} aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <Grid key={index} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card variant="outlined">
              <Skeleton variant="rectangular" sx={{ aspectRatio: '4 / 3', height: 'auto' }} />
              <CardContent>
                <Skeleton width="70%" />
                <Skeleton width="45%" />
                <Skeleton width="55%" />
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}

// The table view (the previous layout). A click anywhere on the row opens the review panel; the
// Review button does the same and is how keyboard users open it.
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
          <Typography variant="caption" component="div" color="textSecondary">
            {plant.location_description}
          </Typography>
        ) : null}
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

function SpeciesName({ species }) {
  if (!species) {
    return (
      <Typography variant="body2" color="textSecondary">
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
        <Typography variant="caption" component="div" color="textSecondary">
          {species.common_name}
        </Typography>
      ) : null}
    </>
  )
}

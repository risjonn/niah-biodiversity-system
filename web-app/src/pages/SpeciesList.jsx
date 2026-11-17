import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
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
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined'
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined'
import EmptyState from '../components/EmptyState'
import LeafPlaceholder from '../components/LeafPlaceholder'
import PageHeader from '../components/PageHeader'
import TableSkeleton from '../components/TableSkeleton'
import { useReports } from '../hooks/useReports'
import { useSpecies } from '../hooks/useSpecies'
import {
  conservationStatusChipColor,
  conservationStatusLabels,
  conservationStatuses,
} from '../lib/conservationStatus'
import { hoverLiftSx } from '../lib/hoverLift'
import { chartTokens } from '../theme/theme'

// Thumbnail width and height in px, 48 on the spacing scale
const THUMBNAIL_SIZE = 48
// How long typing has to pause before the search runs (and goes into the URL), in ms
const SEARCH_DELAY = 300

// The table's headings, shared with its loading skeleton
const COLUMNS = [
  { label: 'Photo', sx: { width: THUMBNAIL_SIZE } },
  { label: 'Scientific name' },
  { label: 'Common name' },
  { label: 'Family' },
  { label: 'Conservation status' },
]

// Gallery or table, remembered per browser like Plant review's view
const VIEW_STORAGE_KEY = 'niah.speciesView'
const VIEWS = ['gallery', 'table']

// Storage can be unavailable (private windows, blocked site data), so reading and writing fall
// back quietly to the gallery
function readView() {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    return VIEWS.includes(stored) ? stored : 'gallery'
  } catch {
    return 'gallery'
  }
}

function writeView(view) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // Not remembered this time; the toggle still works
  }
}

// The species catalogue as a photo gallery (the default) or a table. The search and the
// conservation status filter live in the URL (/species?status=vulnerable&q=nepenthes), like
// Plant records, so a link opens the list already filtered and Back returns to the last filter.
export default function SpeciesList() {
  const { fetchSpecies } = useSpecies()
  const { fetchSpeciesSummary } = useReports()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  // Anything but a known status means All
  const status = conservationStatuses.includes(statusParam) ? statusParam : ''
  // What is searched for: the URL's q
  const query = (searchParams.get('q') ?? '').trim()
  // The search box, which runs ahead of the URL while typing
  const [search, setSearch] = useState(query)
  const searchTimer = useRef(null)
  const [view, setView] = useState(readView)

  // When the URL's q changes by itself (Back, Forward, a link), the box follows it. The page's
  // own updates already match what's in the box.
  const [seenQuery, setSeenQuery] = useState(query)
  if (query !== seenQuery) {
    setSeenQuery(query)
    if (query !== search.trim()) setSearch(query)
  }

  useEffect(() => () => clearTimeout(searchTimer.current), [])

  // Kept with the search it was loaded for, so a new search shows loading again and a slow
  // earlier request can't overwrite a newer one. The status filter is applied here in the
  // browser, so its chips can count each status among the search's matches.
  const [result, setResult] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchSpecies({ search: query }).then((nextResult) => {
      if (!cancelled) setResult({ ...nextResult, query })
    })
    return () => {
      cancelled = true
    }
  }, [fetchSpecies, query])

  // Approved records per species, from the report the Reports page's species summary uses
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchSpeciesSummary({}).then((nextSummary) => {
      if (!cancelled) setSummary(nextSummary)
    })
    return () => {
      cancelled = true
    }
  }, [fetchSpeciesSummary])

  const approvedCounts =
    summary && !summary.error
      ? new Map(summary.data.map((row) => [row.species_id, Number(row.approved)]))
      : null
  // undefined while loading; null if it failed
  const approvedCountOf = (id) => (!summary ? undefined : (approvedCounts?.get(id) ?? null))

  const isLoading = result?.query !== query
  const matches = !isLoading && !result.error ? result.data : []
  const visible = status ? matches.filter((species) => species.conservation_status === status) : matches
  const statusCounts = Object.fromEntries(
    conservationStatuses.map((value) => [
      value,
      matches.filter((species) => species.conservation_status === value).length,
    ]),
  )
  const hasFilters = Boolean(search.trim() || status)

  // Changes the URL's filters. A status change is a new history entry; typing replaces the
  // current one, so Back doesn't step through every pause in typing.
  function updateFilters(changes, { replace = false } = {}) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace },
    )
  }

  function changeSearch(value) {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => updateFilters({ q: value.trim() }, { replace: true }), SEARCH_DELAY)
  }

  // Takes what's typed so far with it, so a search still waiting on the delay isn't lost
  function changeStatus(value) {
    if ((statusParam ?? '') === value && search.trim() === query) return
    clearTimeout(searchTimer.current)
    updateFilters({ status: value, q: search.trim() })
  }

  function clearFilters() {
    clearTimeout(searchTimer.current)
    setSearch('')
    updateFilters({ status: '', q: '' })
  }

  function changeView(_event, nextView) {
    // Clicking the selected button gives null; keep the current view
    if (!nextView) return
    setView(nextView)
    writeView(nextView)
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Species"
        // How many match the current search and filter. "species" is the same in the plural.
        subtitle={isLoading || result.error ? null : `${visible.length} species`}
        action={
          <Button component={RouterLink} to="/species/new" variant="contained">
            Add species
          </Button>
        }
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <TextField
              label="Search"
              placeholder="Scientific name, common name or family"
              type="search"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              sx={{ flexGrow: 1, minWidth: 0 }}
            />
            <ToggleButtonGroup value={view} exclusive onChange={changeView} size="small" aria-label="View">
              <ToggleButton value="gallery" aria-label="Gallery">
                <GridViewOutlinedIcon fontSize="small" />
              </ToggleButton>
              <ToggleButton value="table" aria-label="Table">
                <ViewListOutlinedIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
            role="group"
            aria-label="Conservation status"
          >
            <StatusChip
              label="All"
              count={isLoading ? null : matches.length}
              selected={status === ''}
              onClick={() => changeStatus('')}
            />
            {conservationStatuses.map((value) => (
              <StatusChip
                key={value}
                status={value}
                label={conservationStatusLabels[value]}
                count={isLoading ? null : statusCounts[value]}
                selected={status === value}
                onClick={() => changeStatus(value)}
              />
            ))}
          </Stack>
        </Stack>
      </Paper>

      {summary?.error && view === 'gallery' ? (
        <Alert severity="warning">The approved record counts could not be loaded. {summary.error}</Alert>
      ) : null}

      {isLoading ? (
        view === 'gallery' ? <GallerySkeleton /> : <TableSkeleton columns={COLUMNS} label="Loading species" />
      ) : null}
      {!isLoading && result.error ? <Alert severity="error">{result.error}</Alert> : null}
      {!isLoading && !result.error && visible.length === 0 ? (
        <EmptyState
          message="No species found"
          action={
            hasFilters ? (
              <Button variant="outlined" onClick={clearFilters}>
                Clear search and filter
              </Button>
            ) : (
              <Button component={RouterLink} to="/species/new" variant="contained">
                Add species
              </Button>
            )
          }
        />
      ) : null}

      {visible.length > 0 && view === 'gallery' ? (
        <Grid container spacing={2}>
          {visible.map((species) => (
            <Grid key={species.id} size={{ xs: 12, sm: 6, md: 4, xl: 3 }}>
              <SpeciesCard species={species} approvedCount={approvedCountOf(species.id)} />
            </Grid>
          ))}
        </Grid>
      ) : null}

      {visible.length > 0 && view === 'table' ? (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableCell key={column.label} sx={column.sx}>
                    {column.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((species) => (
                <SpeciesRow
                  key={species.id}
                  species={species}
                  onOpen={() => navigate(`/species/${species.id}`)}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </Stack>
  )
}

// A filter chip with its count, e.g. "Vulnerable 1". Selected, it fills with the status's
// conservation colour (primary for All); otherwise it is outlined with a dot of that colour.
// `count` is null while the species load.
function StatusChip({ status, label, count, selected, onClick }) {
  const color = status ? conservationStatusChipColor(status) : 'primary'

  return (
    <Chip
      label={
        <>
          {label}
          {count == null ? null : (
            <Box component="span" sx={{ fontWeight: 600, ml: 0.75 }}>
              {count}
            </Box>
          )}
        </>
      }
      onClick={onClick}
      color={selected ? color : 'default'}
      variant={selected ? 'filled' : 'outlined'}
      icon={
        status && !selected ? (
          <Box
            component="span"
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: chartTokens.conservationStatus[status],
            }}
          />
        ) : undefined
      }
      aria-pressed={selected}
    />
  )
}

// One species as a photo card. The whole card links to Species detail.
// approvedCount: a number, undefined while it loads, or null when it couldn't be loaded.
function SpeciesCard({ species, approvedCount }) {
  const status = species.conservation_status

  return (
    <Card variant="outlined" sx={(theme) => ({ height: '100%', ...hoverLiftSx(theme) })}>
      <CardActionArea
        component={RouterLink}
        to={`/species/${species.id}`}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
        }}
      >
        <Box sx={{ aspectRatio: '4 / 3', overflow: 'hidden' }}>
          {/* Keyed by the URL so a changed photo gets a fresh load state */}
          <CardPhoto key={species.reference_photo_url ?? ''} species={species} />
        </Box>
        <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Gap rather than margins, so the auto margin below can push the last block down */}
          <Stack spacing={1.5} useFlexGap sx={{ flexGrow: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="body1"
                component="h2"
                sx={{ fontStyle: 'italic', fontWeight: 600, overflowWrap: 'anywhere' }}
              >
                {species.scientific_name}
              </Typography>
              {species.common_name ? (
                <Typography variant="body2" color="textSecondary">
                  {species.common_name}
                </Typography>
              ) : null}
              <Typography variant="caption" color="textSecondary" component="p">
                {species.family ? `Family ${species.family}` : 'Family not recorded yet'}
              </Typography>
            </Box>
            {/* The count on its own line under the chip, so it sits in the same place on every
                card however long the status name is. Kept at the bottom of the card, so the
                chips and counts line up across a row even when a card has no common name. */}
            <Stack spacing={1} sx={{ alignItems: 'flex-start', mt: 'auto' }}>
              <Chip
                size="small"
                label={conservationStatusLabels[status] ?? status}
                color={conservationStatusChipColor(status)}
              />
              <ApprovedCount count={approvedCount} />
            </Stack>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

function ApprovedCount({ count }) {
  if (count === undefined) return <Skeleton width={96} aria-hidden="true" />
  if (count === null) return null
  return (
    <Typography variant="caption" color="textSecondary">
      {count === 0
        ? 'No approved records'
        : `${count.toLocaleString('en-MY')} approved ${count === 1 ? 'record' : 'records'}`}
    </Typography>
  )
}

// The reference photo, cropped to fill the card. Decorative (the name is on the card), so alt is
// empty. The leaf placeholder when there is no photo or it won't load.
function CardPhoto({ species }) {
  const [failed, setFailed] = useState(false)
  const url = species.reference_photo_url

  if (!url || failed) return <LeafPlaceholder conservationStatus={species.conservation_status} />
  return (
    <Box
      component="img"
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', bgcolor: 'background.default' }}
    />
  )
}

// Placeholder cards while the species load, in the same grid
function GallerySkeleton() {
  return (
    <Box role="status" aria-label="Loading species">
      <Grid container spacing={2} aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <Grid key={index} size={{ xs: 12, sm: 6, md: 4, xl: 3 }}>
            <Card variant="outlined">
              <Skeleton variant="rectangular" sx={{ aspectRatio: '4 / 3', height: 'auto' }} />
              <CardContent>
                <Skeleton width="70%" />
                <Skeleton width="45%" />
                <Skeleton width="35%" />
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}

// The whole row opens the species page, by click or by Enter when focused with the keyboard
function SpeciesRow({ species, onOpen }) {
  const status = species.conservation_status
  const statusLabel = conservationStatusLabels[status] ?? status

  return (
    <TableRow
      hover
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen()
      }}
      sx={{ cursor: 'pointer' }}
    >
      <TableCell sx={{ py: 1 }}>
        {/* Keyed by the URL so a changed photo gets a fresh load state */}
        <Thumbnail key={species.reference_photo_url ?? ''} url={species.reference_photo_url} />
      </TableCell>
      <TableCell>
        <Typography variant="body2" component="span" sx={{ fontStyle: 'italic' }}>
          {species.scientific_name}
        </Typography>
      </TableCell>
      <TableCell>{species.common_name ?? '—'}</TableCell>
      <TableCell>{species.family ?? '—'}</TableCell>
      <TableCell>
        <Chip size="small" label={statusLabel} color={conservationStatusChipColor(status)} />
      </TableCell>
    </TableRow>
  )
}

// The species' reference photo, the same public URL the species page shows. Decorative (the name
// is in the next cell), so alt is empty. A leaf placeholder when there is no photo or it fails.
function Thumbnail({ url }) {
  const [failed, setFailed] = useState(false)
  const frameSx = {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: 1,
    overflow: 'hidden',
    bgcolor: 'background.default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'text.secondary',
  }

  if (!url || failed) {
    return (
      <Box sx={frameSx}>
        <LocalFloristOutlinedIcon fontSize="small" aria-hidden="true" />
      </Box>
    )
  }
  return (
    <Box sx={frameSx}>
      <Box
        component="img"
        src={url}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </Box>
  )
}

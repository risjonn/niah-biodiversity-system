import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined'
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import PlantRecordPanel from '../components/PlantRecordPanel'
import PrintLabels from '../components/PrintLabels'
import TableSkeleton from '../components/TableSkeleton'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePlants } from '../hooks/usePlants'
import { useSpecies } from '../hooks/useSpecies'
import { formatDateTime } from '../lib/formatDateTime'
import { formatCoordinates } from '../lib/plantFormat'
import { reviewStatusChipColors, reviewStatusLabels, reviewStatuses } from '../lib/reviewStatus'

const PAGE_SIZE = 25
// Thumbnail width and height in px, 48 on the spacing scale (as on the species list)
const THUMBNAIL_SIZE = 48

// The table's headings, shared with its loading skeleton. The first column holds the checkboxes.
const COLUMNS = [
  { label: '', sx: { width: 48 } },
  { label: 'Photo', sx: { width: THUMBNAIL_SIZE } },
  { label: 'QR code' },
  { label: 'Species' },
  { label: 'Status' },
  { label: 'Recorded' },
  { label: 'Location' },
]

// Every plant record, read-only, with filters and server-side paging. Officers and admins only
// (the whole web app is). Reviewing happens on Plant review; a pending record's panel links there.
export default function PlantRecords() {
  const { fetchPlantRecords, getPlantPhotoUrls } = usePlants()
  const { fetchSpecies } = useSpecies()
  const [status, setStatus] = useState('')
  const [speciesId, setSpeciesId] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  const [speciesOptions, setSpeciesOptions] = useState([])
  // Kept with the filters and page it was loaded for, so a change shows loading again and a slow
  // earlier request can't overwrite a newer one (the same approach as the species list)
  const loadKey = `${status}|${speciesId}|${debouncedSearch}|${page}`
  const [result, setResult] = useState(null)
  // Signed photo URLs for the current page, by storage path
  const [photoUrls, setPhotoUrls] = useState({ key: null, urls: {} })
  // Selected records for printing labels, by id, kept across pages and filters
  const [selected, setSelected] = useState(() => new Map())
  const [openRecord, setOpenRecord] = useState(null)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchSpecies().then((nextResult) => {
      if (!cancelled && !nextResult.error) setSpeciesOptions(nextResult.data)
    })
    return () => {
      cancelled = true
    }
  }, [fetchSpecies])

  useEffect(() => {
    let cancelled = false
    fetchPlantRecords({
      status: status || null,
      speciesId: speciesId || null,
      search: debouncedSearch,
      page,
      pageSize: PAGE_SIZE,
    }).then(async (nextResult) => {
      if (cancelled) return
      setResult({ ...nextResult, loadKey })
      // One request signs every photo on this page
      const paths = nextResult.data.rows.map((row) => row.photo_url)
      const photos = await getPlantPhotoUrls(paths)
      if (!cancelled) setPhotoUrls({ key: loadKey, urls: photos.data })
    })
    return () => {
      cancelled = true
    }
  }, [fetchPlantRecords, getPlantPhotoUrls, status, speciesId, debouncedSearch, page, loadKey])

  const isLoading = result?.loadKey !== loadKey
  const rows = isLoading ? [] : result.data.rows
  const total = isLoading ? null : result.data.total
  const urls = photoUrls.key === loadKey ? photoUrls.urls : null
  const hasFilters = Boolean(status || speciesId || search.trim())

  // Any filter change goes back to the first page
  function changeFilter(setter) {
    return (value) => {
      setter(value)
      setPage(0)
    }
  }
  const changeStatus = changeFilter(setStatus)
  const changeSpecies = changeFilter(setSpeciesId)
  const changeSearch = changeFilter(setSearch)

  function clearFilters() {
    setStatus('')
    setSpeciesId('')
    setSearch('')
    setPage(0)
  }

  function toggleSelected(row) {
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.set(row.id, row)
      return next
    })
  }

  const allOnPageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const someOnPageSelected = rows.some((row) => selected.has(row.id))

  function toggleAllOnPage() {
    setSelected((current) => {
      const next = new Map(current)
      for (const row of rows) {
        if (allOnPageSelected) next.delete(row.id)
        else next.set(row.id, row)
      }
      return next
    })
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Plant records"
        subtitle={
          total == null ? null : total === 1 ? '1 record' : `${total.toLocaleString('en-MY')} records`
        }
        action={
          selected.size > 0 ? (
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={() => setSelected(new Map())}>
                Clear selection
              </Button>
              <Button variant="contained" startIcon={<PrintOutlinedIcon />} onClick={() => setPrinting(true)}>
                Print labels ({selected.size})
              </Button>
            </Stack>
          ) : null
        }
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }} role="group" aria-label="Review status">
            <StatusChip label="All" selected={status === ''} onClick={() => changeStatus('')} />
            {reviewStatuses.map((value) => (
              <StatusChip
                key={value}
                label={value === 'pending_review' ? 'Pending' : reviewStatusLabels[value]}
                selected={status === value}
                onClick={() => changeStatus(value)}
              />
            ))}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Species"
              value={speciesId}
              onChange={(event) => changeSpecies(event.target.value)}
              sx={{ flex: { sm: 1 } }}
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
              onChange={(event) => changeSearch(event.target.value)}
              sx={{ flex: { sm: 1 } }}
            />
          </Stack>
        </Stack>
      </Paper>

      {isLoading ? <TableSkeleton columns={COLUMNS} label="Loading plant records" /> : null}
      {!isLoading && result.error ? <Alert severity="error">{result.error}</Alert> : null}
      {!isLoading && !result.error && rows.length === 0 ? (
        <EmptyState
          message={hasFilters ? 'No plant records match these filters' : 'No plant records yet'}
          action={
            hasFilters ? (
              <Button variant="outlined" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : null}

      {!isLoading && rows.length > 0 ? (
        <Paper variant="outlined">
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={someOnPageSelected && !allOnPageSelected}
                      onChange={toggleAllOnPage}
                      slotProps={{ input: { 'aria-label': 'Select every record on this page' } }}
                    />
                  </TableCell>
                  {COLUMNS.slice(1).map((column) => (
                    <TableCell key={column.label} sx={column.sx}>
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <RecordRow
                    key={row.id}
                    row={row}
                    photoUrl={urls ? (urls[row.photo_url] ?? null) : undefined}
                    selected={selected.has(row.id)}
                    onToggle={() => toggleSelected(row)}
                    onOpen={() => setOpenRecord(row)}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_event, nextPage) => setPage(nextPage)}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[]}
          />
        </Paper>
      ) : null}

      <PlantRecordPanel
        plantId={openRecord?.id ?? null}
        plant={openRecord}
        onClose={() => setOpenRecord(null)}
      />
      {printing ? (
        <PrintLabels
          labels={[...selected.values()].map((row) => ({
            qrCode: row.qr_code,
            scientificName: row.species?.scientific_name,
          }))}
          onDone={() => setPrinting(false)}
        />
      ) : null}
    </Stack>
  )
}

function StatusChip({ label, selected, onClick }) {
  return (
    <Chip
      label={label}
      onClick={onClick}
      color={selected ? 'primary' : 'default'}
      variant={selected ? 'filled' : 'outlined'}
      aria-pressed={selected}
    />
  )
}

// Clicking the row opens the record's panel; the QR code is also a button, for the keyboard.
// The checkbox only selects.
function RecordRow({ row, photoUrl, selected, onToggle, onOpen }) {
  const status = row.review_status
  return (
    <TableRow hover selected={selected} onClick={onOpen} sx={{ cursor: 'pointer' }}>
      <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={selected}
          onChange={onToggle}
          slotProps={{ input: { 'aria-label': `Select ${row.qr_code}` } }}
        />
      </TableCell>
      <TableCell sx={{ py: 1 }}>
        <Thumbnail hasPhoto={Boolean(row.photo_url)} url={photoUrl} />
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Link
          component="button"
          variant="body2"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
          sx={{ fontWeight: 500 }}
        >
          {row.qr_code}
        </Link>
      </TableCell>
      <TableCell>
        {row.species ? (
          <>
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
              {row.species.scientific_name}
            </Typography>
            {row.species.common_name ? (
              <Typography variant="caption" component="div" color="textSecondary">
                {row.species.common_name}
              </Typography>
            ) : null}
          </>
        ) : (
          'Unknown species'
        )}
      </TableCell>
      <TableCell>
        <Chip
          size="small"
          label={reviewStatusLabels[status] ?? status}
          color={reviewStatusChipColors[status] ?? 'default'}
        />
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.recorded_at)}</TableCell>
      <TableCell>
        <Typography variant="body2">{formatCoordinates(row)}</Typography>
        {row.location_description ? (
          <Typography variant="caption" component="div" color="textSecondary">
            {row.location_description}
          </Typography>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

// url: a signed URL, null when it couldn't be signed, or undefined while the page's URLs load.
// Decorative (the QR code is in the next cell), so alt is empty.
function Thumbnail({ hasPhoto, url }) {
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

  if (hasPhoto && url === undefined) {
    return <Skeleton variant="rounded" width={THUMBNAIL_SIZE} height={THUMBNAIL_SIZE} />
  }
  if (!hasPhoto || !url || failed) {
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

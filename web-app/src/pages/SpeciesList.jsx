import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
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
import { useSpecies } from '../hooks/useSpecies'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import {
  conservationStatusChipColor,
  conservationStatusLabels,
  conservationStatuses,
} from '../lib/conservationStatus'

export default function SpeciesList() {
  const { fetchSpecies } = useSpecies()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [conservationStatus, setConservationStatus] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim())

  // Kept with the filters it was loaded for, so changing a filter shows loading again until the
  // matching results arrive, and a slow earlier request can never overwrite a newer one
  const filtersKey = `${debouncedSearch}|${conservationStatus}`
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchSpecies({ search: debouncedSearch, conservationStatus }).then((nextResult) => {
      if (!cancelled) setResult({ ...nextResult, filtersKey })
    })
    return () => {
      cancelled = true
    }
  }, [fetchSpecies, debouncedSearch, conservationStatus, filtersKey])

  const isLoading = result?.filtersKey !== filtersKey

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="h1">Species</Typography>
        <Button component={RouterLink} to="/species/new" variant="contained">
          Add species
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Search"
          placeholder="Scientific name, common name or family"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ flex: { sm: 2 } }}
        />
        <TextField
          select
          label="Conservation status"
          value={conservationStatus}
          onChange={(event) => setConservationStatus(event.target.value)}
          sx={{ flex: { sm: 1 } }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {conservationStatuses.map((status) => (
            <MenuItem key={status} value={status}>
              {conservationStatusLabels[status]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {isLoading ? (
        <Stack sx={{ alignItems: 'center', py: 4 }}>
          <CircularProgress aria-label="Loading species" />
        </Stack>
      ) : null}
      {!isLoading && result.error ? <Alert severity="error">{result.error}</Alert> : null}
      {!isLoading && !result.error && result.data.length === 0 ? (
        <Typography variant="body1" color="text.secondary">
          No species found
        </Typography>
      ) : null}

      {!isLoading && result.data.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Scientific name</TableCell>
                <TableCell>Common name</TableCell>
                <TableCell>Family</TableCell>
                <TableCell>Conservation status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.data.map((species) => (
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
